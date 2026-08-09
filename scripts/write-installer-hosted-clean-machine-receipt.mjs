#!/usr/bin/env node
import { lstat, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { buildHostedCleanMachineReceipt } from "./lib/installer-hosted-clean-machine-receipt.mjs"

function reject(reasonCode) {
  return { status: "rejected", reasonCode }
}

function parse(argv) {
  if (argv.length !== 4 || argv[0] !== "--input" || argv[2] !== "--output") {
    return reject("installer_hosted_clean_arguments_invalid")
  }
  return { status: "ready", input: resolve(argv[1]), output: resolve(argv[3]) }
}

const args = parse(process.argv.slice(2))
let result
if (args.status !== "ready") {
  result = args
} else {
  try {
    const inputMetadata = await lstat(args.input)
    const outputMetadata = await lstat(args.output).catch(() => undefined)
    const parentMetadata = await lstat(dirname(args.output))
    if (!inputMetadata.isFile() || inputMetadata.isSymbolicLink() || outputMetadata || !parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
      result = reject("installer_hosted_clean_path_unsafe")
    } else {
      const built = buildHostedCleanMachineReceipt(JSON.parse(await readFile(args.input, "utf8")))
      if (built.status !== "ready") result = built
      else {
        const temporary = `${args.output}.tmp-${process.pid}`
        await writeFile(temporary, `${JSON.stringify(built.receipt)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" })
        await rename(temporary, args.output)
        result = { status: "ready", target: built.receipt.target }
      }
    }
  } catch {
    result = reject("installer_hosted_clean_write_failed")
  }
}
process.stdout.write(`${JSON.stringify(result)}\n`)
if (result.status !== "ready") process.exitCode = 1
