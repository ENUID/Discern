/**
 * A provider's own words, minus the parts that must never leave the server.
 *
 * Two places report a failure verbatim to the outside — the public provider
 * check, and a degraded stylist reply — because in both cases the label alone
 * was useless. "unknown" for a Gemini model Google had retired months earlier,
 * and "I could not think this one through" for a chain that had, in fact, said
 * exactly why on every rung and then thrown it in a console nobody outside the
 * deploy can read.
 *
 * Both endpoints are reachable without authentication, and provider errors
 * quote the failing request back at you — which is where the key lives. So this
 * is the only thing standing between a diagnosis and a leaked credential, and
 * it is tested rather than trusted: see scripts/status-redaction.js, which runs
 * it against real key shapes and also asserts that the diagnosis SURVIVES. A
 * redaction that ate "models/gemini-2.0-flash is not found" would be perfectly
 * safe and completely useless.
 */
export function redactSecrets(input: unknown): string {
  const raw = String((input as Error)?.message ?? input ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) return ''
  return raw
    .replace(/(bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/([?&](?:key|api_?key|access_?token|token)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/("(?:api_?key|key|token|authorization)"\s*:\s*")[^"]*/gi, '$1[redacted]')
    // Anything long enough and dense enough to be a key, whatever it is called.
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[redacted]')
    .slice(0, 300)
}
