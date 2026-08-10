const REASON_CODE = /^[a-z0-9_.:-]{1,160}$/u
const FIELD_DEBUG_EXCEPTION = /^Knowbee installer field-debug exception-type=([A-Za-z][A-Za-z0-9.]{0,120})$/u

/**
 * Reduces installer output to a public, bounded failure code. Hosted clean-machine
 * runs may opt into the bootstrap's field-debug exception class; never retain the
 * command output, paths, arguments, or exception message in the receipt result.
 */
export function installerFailureReason(output) {
  const lines = output.split(/\r?\n/u)
  const reasonCodes = lines
    .flatMap((line) => {
      try {
        const value = JSON.parse(line)
        return typeof value?.reasonCode === "string" && REASON_CODE.test(value.reasonCode)
          ? [value.reasonCode]
          : []
      } catch {
        return []
      }
    })

  const reasonCode = reasonCodes.findLast((value) => value !== "installer_failed")
  if (reasonCode) return reasonCode

  const exception = lines
    .map((line) => FIELD_DEBUG_EXCEPTION.exec(line)?.[1])
    .findLast((value) => typeof value === "string")
  if (reasonCodes.includes("installer_failed") && exception) {
    return `installer_failed:${exception.toLowerCase()}`
  }

  const matches = output.match(/installer_[a-z0-9_:-]{1,160}/gu)
  return matches?.at(-1) ?? "unknown"
}
