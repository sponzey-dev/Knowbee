#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises"
import { homedir, platform, tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { promisify } from "node:util"

import { HOSTED_CLEAN_MACHINE_REQUIRED_CHECKS } from "./lib/installer-hosted-clean-machine-receipt.mjs"

const execFile = promisify(execFileCallback)
const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u
const SHA256 = /^[a-f0-9]{64}$/u

function reject(reasonCode) {
  return { status: "rejected", reasonCode }
}

function readConfig(environment) {
  const releaseTag = environment.RELEASE_TAG
  const target = environment.INSTALLER_TARGET
  if (!RELEASE_TAG.test(releaseTag ?? "") || typeof target !== "string") {
    return reject("installer_hosted_clean_environment_invalid")
  }
  const expectedPlatform = target.startsWith("win32-") ? "win32" : target.split("-")[0]
  if (expectedPlatform !== platform()) return reject("installer_hosted_clean_target_mismatch")
  return {
    status: "ready",
    releaseTag,
    target,
    candidateRoot: resolve("release/candidate"),
    outputRoot: resolve("release/clean-receipt"),
  }
}

async function candidateIdentity(config) {
  try {
    const manifest = await readFile(join(config.candidateRoot, "prepared", "installer-manifest.json"))
    const receipts = JSON.parse(
      await readFile(join(config.candidateRoot, "receipts", "artifact-receipts.json"), "utf8"),
    )
    const artifact = Array.isArray(receipts)
      ? receipts.find((value) => value?.target === config.target)
      : undefined
    if (typeof artifact?.sha256 !== "string" || !SHA256.test(artifact.sha256)) {
      return reject("installer_hosted_clean_candidate_invalid")
    }
    return {
      status: "ready",
      candidateId: `sha256:${createHash("sha256").update(manifest).digest("hex")}`,
      artifactSha256: artifact.sha256,
      artifactName: artifact.name,
    }
  } catch {
    return reject("installer_hosted_clean_candidate_unavailable")
  }
}

async function run(command, args) {
  try {
    const result = await execFile(command, args, {
      timeout: 10 * 60_000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    })
    return { status: "passed", output: `${result.stdout}\n${result.stderr}` }
  } catch (error) {
    return {
      status: "failed",
      output: `${typeof error?.stdout === "string" ? error.stdout : ""}\n${typeof error?.stderr === "string" ? error.stderr : ""}`,
    }
  }
}

async function prepareBootstrap(config, directory) {
  const isWindows = platform() === "win32"
  const bootstrap = join(directory, isWindows ? "install.ps1" : "install.sh")
  const url = `https://github.com/Sponzey-com/Sponzey-Knowbee/releases/download/${config.releaseTag}/${basename(bootstrap)}`
  const downloaded = isWindows
    ? await run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Invoke-WebRequest -UseBasicParsing -Uri '${url}' -OutFile '${bootstrap.replace(/'/gu, "''")}'`,
      ])
    : await run("curl", ["-fsSL", "--proto", "=https", "--proto-redir", "=https", "--output", bootstrap, url])
  if (downloaded.status !== "passed") return reject("installer_hosted_clean_bootstrap_download_failed")
  if (!isWindows) await chmod(bootstrap, 0o700)
  return { status: "ready", bootstrap }
}

async function prepareOfflineBundle(config, identity, directory) {
  const bundleDirectory = join(directory, "offline")
  const artifactSource = join(
    config.candidateRoot,
    "bundles",
    `installer-bundle-${config.target}`,
    identity.artifactName,
  )
  const verifierName = `knowbee-installer-verify-${config.target}${platform() === "win32" ? ".exe" : ""}`
  const verifierSource = join(
    config.candidateRoot,
    "verifiers",
    `installer-verifier-${config.target}`,
    verifierName,
  )
  try {
    await mkdir(bundleDirectory, { mode: 0o700 })
    await Promise.all([
      copyFile(join(config.candidateRoot, "prepared", "installer-manifest.json"), join(directory, "installer-manifest.json")),
      copyFile(artifactSource, join(bundleDirectory, identity.artifactName)),
      copyFile(verifierSource, join(bundleDirectory, verifierName)),
    ])
    return { status: "ready", manifest: join(directory, "installer-manifest.json"), bundleDirectory }
  } catch {
    return reject("installer_hosted_clean_offline_bundle_unavailable")
  }
}

function bootstrapCommand(bootstrap, args) {
  return platform() === "win32"
    ? { command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", bootstrap, ...args] }
    : { command: bootstrap, args }
}

async function install(bootstrap, args) {
  const invocation = bootstrapCommand(bootstrap, args)
  return run(invocation.command, invocation.args)
}

function parseDryRun(output) {
  try {
    return JSON.parse(output.trim())
  } catch {
    return undefined
  }
}

function installerReason(output) {
  const reasonCodes = output
    .split(/\r?\n/u)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line)
        return typeof value?.reasonCode === "string" && /^[a-z0-9_.:-]{1,160}$/u.test(value.reasonCode)
          ? [value.reasonCode]
          : []
      } catch {
        return []
      }
    })
    .filter((reasonCode) => reasonCode !== "installer_failed")
  if (reasonCodes.length > 0) return reasonCodes.at(-1)
  const matches = output.match(/installer_[a-z0-9_:-]{1,160}/gu)
  return matches?.at(-1) ?? "unknown"
}

async function main() {
  const config = readConfig({ ...process.env })
  if (config.status !== "ready") return config
  const identity = await candidateIdentity(config)
  if (identity.status !== "ready") return identity
  const directory = await mkdtemp(join(tmpdir(), "knowbee-hosted-clean-"))
  try {
    const [bootstrap, offline] = await Promise.all([
      prepareBootstrap(config, directory),
      prepareOfflineBundle(config, identity, directory),
    ])
    if (bootstrap.status !== "ready") return bootstrap
    if (offline.status !== "ready") return offline
    const base = ["--version", config.releaseTag, "--non-interactive", "--no-service", "--no-browser"]
    const dryRun = await install(bootstrap.bootstrap, [...base, "--dry-run", "--json"])
    const online = await install(bootstrap.bootstrap, base)
    const offlineInstall = await install(bootstrap.bootstrap, [
      ...base,
      "--manifest",
      offline.manifest,
      "--bundle-dir",
      offline.bundleDirectory,
    ])
    const sameVersion = await install(bootstrap.bootstrap, [
      ...base,
      "--manifest",
      offline.manifest,
      "--bundle-dir",
      offline.bundleDirectory,
    ])
    const dryRunResult = parseDryRun(dryRun.output)
    const checks = {
      dryRun: dryRun.status === "passed" && dryRunResult?.target === config.target,
      onlineInstall: online.status === "passed",
      offlineInstall: offlineInstall.status === "passed",
      noService: dryRunResult?.service === false,
      noBrowser: dryRunResult?.browser === false,
      sameVersion: sameVersion.status === "passed",
    }
    const failedCheck = HOSTED_CLEAN_MACHINE_REQUIRED_CHECKS.find((check) => checks[check] !== true)
    if (failedCheck) {
      const failedOutput =
        failedCheck === "onlineInstall"
          ? online.output
          : failedCheck === "offlineInstall"
            ? offlineInstall.output
            : failedCheck === "sameVersion"
              ? sameVersion.output
              : dryRun.output
      return reject(
        `installer_hosted_clean_lifecycle_failed:${failedCheck}:${installerReason(failedOutput)}`,
      )
    }
    const warningObserved = online.output.includes("unsigned_origin_unverified")
    if (!warningObserved) return reject("installer_hosted_clean_unsigned_warning_missing")
    await mkdir(config.outputRoot, { recursive: true, mode: 0o700 })
    const input = join(directory, "receipt-input.json")
    const output = join(config.outputRoot, `clean-machine-receipt-${config.target}.json`)
    await writeFile(
      input,
      `${JSON.stringify({
        target: config.target,
        candidateId: identity.candidateId,
        artifactSha256: identity.artifactSha256,
        originTrust: "unsigned_origin_unverified",
        executionEnvironment: "github_hosted",
        limitations: { rebootRecovery: "github_hosted_runner_disposable" },
        interaction: { commandCount: 1, confirmationCount: 0, followUpCommandCount: 0 },
        osWarning: { observed: true, acknowledged: true },
        checks,
      })}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    )
    const written = await run(process.execPath, ["scripts/write-installer-hosted-clean-machine-receipt.mjs", "--input", input, "--output", output])
    return written.status === "passed" ? { status: "ready", target: config.target } : reject("installer_hosted_clean_receipt_write_failed")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const result = await main().catch(() => reject("installer_hosted_clean_failed"))
process.stdout.write(`${JSON.stringify(result)}\n`)
if (result.status !== "ready") process.exitCode = 1
