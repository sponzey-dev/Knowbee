const REASON_CODE = /^[a-z0-9_.:-]{1,160}$/u
const FIELD_DEBUG_EXCEPTION = /^Knowbee installer field-debug exception-type=([A-Za-z][A-Za-z0-9.]{0,120})$/u
const FIELD_DEBUG_PHASES = new Set([
  "host_preflight",
  "offline_inputs",
  "manifest_download",
  "verifier_download",
  "manifest_verification",
  "artifact_download",
  "artifact_verification",
  "application_apply",
])

/**
 * Reduces installer output to a public, bounded failure code. Hosted clean-machine
 * runs may opt into the bootstrap's field-debug exception class; never retain the
 * command output, paths, arguments, or exception message in the receipt result.
 */
export function installerFailureReason(output) {
  const lines = output.split(/\r?\n/u)
  const results = lines
    .flatMap((line) => {
      try {
        const value = JSON.parse(line)
        return typeof value?.reasonCode === "string" && REASON_CODE.test(value.reasonCode)
          ? [value]
          : []
      } catch {
        return []
      }
    })
  const reasonCodes = results.map((value) => value.reasonCode)

  const reasonCode = reasonCodes.findLast((value) => value !== "installer_failed")
  if (reasonCode) return reasonCode

  const debugResult = results
    .map((value) => value.fieldDebug)
    .findLast(
      (value) =>
        typeof value?.exceptionType === "string" &&
        /^[A-Za-z][A-Za-z0-9.]{0,120}$/u.test(value.exceptionType),
    )
  const exception = debugResult?.exceptionType
    ?? lines
    .map((line) => FIELD_DEBUG_EXCEPTION.exec(line)?.[1])
    .findLast((value) => typeof value === "string")
  if (reasonCodes.includes("installer_failed") && exception) {
    const phase = debugResult?.phase
    const innerExceptionType = debugResult?.innerExceptionType
    const result = ["installer_failed", exception.toLowerCase()]
    if (typeof phase === "string" && FIELD_DEBUG_PHASES.has(phase)) result.push(phase)
    if (
      typeof innerExceptionType === "string" &&
      /^[A-Za-z][A-Za-z0-9.]{0,120}$/u.test(innerExceptionType)
    ) {
      result.push(innerExceptionType.toLowerCase())
    }
    return result.join(":")
  }

  const matches = output.match(/installer_[a-z0-9_:-]{1,160}/gu)
  return matches?.at(-1) ?? "unknown"
}
