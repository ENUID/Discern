/**
 * A Groq that answers whatever the test tells it to — but keeps the REAL
 * text-cleaning helpers.
 *
 * `stripThinkTags`, `stripAiDashes`, `stripSafetyLabels` and
 * `looksLikeLeakedReasoning` are part of the ladder's behaviour: a rung that
 * returns narrated chain-of-thought is DISCARDED and the next rung is tried.
 * Stubbing them to identity would delete the very thing under test, so they are
 * re-exported from the real module by relative path, which the '@/lib/groq'
 * alias does not intercept.
 */
export { stripThinkTags, stripAiDashes, stripSafetyLabels, looksLikeLeakedReasoning } from '../../lib/groq'

export const CHAT_MODEL = 'stub-70b'
export const FAST_MODEL = 'stub-8b'

export const __groq = { calls: [], reply: async () => ({ role: 'assistant', content: 'groq says hello' }) }
export const groqChat = async (messages, system, _third, opts) => {
  __groq.calls.push(opts?.model)
  return __groq.reply(messages, system, _third, opts)
}
