import { describe, expect, it } from "vitest"

import {
  buildHostedCleanMachineReceipt,
  HOSTED_CLEAN_MACHINE_REQUIRED_CHECKS,
} from "../scripts/lib/installer-hosted-clean-machine-receipt.mjs"
import { installerFailureReason } from "../scripts/lib/installer-hosted-clean-machine-diagnostics.mjs"

const input = {
  target: "linux-x64",
  candidateId: `sha256:${"a".repeat(64)}`,
  artifactSha256: "b".repeat(64),
  originTrust: "unsigned_origin_unverified",
  executionEnvironment: "github_hosted",
  limitations: { rebootRecovery: "github_hosted_runner_disposable" },
  interaction: { commandCount: 1, confirmationCount: 0, followUpCommandCount: 0 },
  osWarning: { observed: true, acknowledged: true },
  checks: Object.fromEntries(HOSTED_CLEAN_MACHINE_REQUIRED_CHECKS.map((check) => [check, true])),
}

describe("task029 hosted clean-machine receipt", () => {
  it("emits only a v2 hosted receipt with the explicit disposable-runner reboot limitation", () => {
    expect(buildHostedCleanMachineReceipt(input)).toMatchObject({
      status: "ready",
      receipt: { schemaVersion: 2, executionEnvironment: "github_hosted" },
    })
  })

  it("rejects a synthetic reboot success or any unsupported check result", () => {
    expect(
      buildHostedCleanMachineReceipt({
        ...input,
        limitations: { rebootRecovery: "passed" },
      }),
    ).toEqual({ status: "rejected", reasonCode: "installer_hosted_clean_receipt_invalid" })
    expect(
      buildHostedCleanMachineReceipt({
        ...input,
        checks: { ...input.checks, onlineInstall: false },
      }),
    ).toEqual({ status: "rejected", reasonCode: "installer_hosted_clean_receipt_invalid" })
  })

  it("preserves only the bounded Windows field-debug exception class when the bootstrap result is generic", () => {
    expect(
      installerFailureReason(
        '{"status":"rejected","reasonCode":"installer_failed","fieldDebug":{"exceptionType":"Win32Exception"}}',
      ),
    ).toBe("installer_failed:win32exception")
    expect(installerFailureReason('raw path=C:\\Users\\Bee\\secret-token')).toBe("unknown")
  })
})
