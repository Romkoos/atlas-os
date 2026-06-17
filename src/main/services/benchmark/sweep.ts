// Transient = a technical hiccup worth one more attempt. assertion_failed and
// rate_limited are real signals about the run and are deliberately NOT retried.
const TRANSIENT = new Set(['timeout', 'sdk_error'])

export function selectTransientFailures<T extends { success: boolean; failReason: string | null }>(
  rows: T[],
): T[] {
  return rows.filter((r) => !r.success && r.failReason !== null && TRANSIENT.has(r.failReason))
}
