/**
 * A judge that answers whatever the test tells it to, and takes as long as the
 * test says. Aliased over '@/lib/ai/infer' by the judge-scope harness, which
 * needs two judgements in flight at once with a controlled finishing order.
 */
export const __infer = {
  calls: [],
  reply: async () => ({ text: '', provider: 'stub' }),
}
export const infer = async (...a) => { __infer.calls.push(a); return __infer.reply(...a) }
