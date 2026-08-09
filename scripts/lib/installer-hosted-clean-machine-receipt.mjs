import { INSTALLER_PLATFORM_BY_TARGET } from "./installer-platforms.mjs"

const CANDIDATE_ID = /^sha256:[a-f0-9]{64}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const REQUIRED_CHECKS = Object.freeze([
  "dryRun",
  "onlineInstall",
  "offlineInstall",
  "noService",
  "noBrowser",
  "sameVersion",
])

function reject(reasonCode) {
  return { status: "rejected", reasonCode }
}

export function buildHostedCleanMachineReceipt(input) {
  if (
    typeof input?.target !== "string" ||
    !INSTALLER_PLATFORM_BY_TARGET[input.target] ||
    typeof input.candidateId !== "string" ||
    !CANDIDATE_ID.test(input.candidateId) ||
    typeof input.artifactSha256 !== "string" ||
    !SHA256.test(input.artifactSha256) ||
    input.originTrust !== "unsigned_origin_unverified" ||
    input.executionEnvironment !== "github_hosted" ||
    input.limitations?.rebootRecovery !== "github_hosted_runner_disposable" ||
    Object.keys(input.limitations ?? {}).length !== 1 ||
    input.interaction?.commandCount !== 1 ||
    input.interaction?.confirmationCount !== 0 ||
    input.interaction?.followUpCommandCount !== 0 ||
    input.osWarning?.observed !== true ||
    input.osWarning?.acknowledged !== true ||
    typeof input.checks !== "object" ||
    input.checks === null ||
    Object.keys(input.checks).length !== REQUIRED_CHECKS.length ||
    REQUIRED_CHECKS.some((check) => input.checks[check] !== true)
  ) {
    return reject("installer_hosted_clean_receipt_invalid")
  }
  return {
    status: "ready",
    receipt: Object.freeze({
      kind: "knowbee.installer.clean_machine_receipt",
      schemaVersion: 2,
      target: input.target,
      candidateId: input.candidateId,
      artifactSha256: input.artifactSha256,
      originTrust: "unsigned_origin_unverified",
      status: "passed",
      interaction: Object.freeze({ commandCount: 1, confirmationCount: 0, followUpCommandCount: 0 }),
      osWarning: Object.freeze({ observed: true, acknowledged: true }),
      checks: Object.freeze(Object.fromEntries(REQUIRED_CHECKS.map((check) => [check, true]))),
      executionEnvironment: "github_hosted",
      limitations: Object.freeze({ rebootRecovery: "github_hosted_runner_disposable" }),
    }),
  }
}

export { REQUIRED_CHECKS as HOSTED_CLEAN_MACHINE_REQUIRED_CHECKS }
