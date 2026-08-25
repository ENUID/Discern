/**
 * A model that answers whatever the test tells it to.
 *
 * Aliased over '@/lib/groq' by `scripts/retrieval.js`. Only `groqChat` is
 * actually exercised (by refineSearchQuery); the rest exist because modules
 * pulled in transitively import them and esbuild resolves every named import.
 */
export const FAST_MODEL = 'stub-fast-model'
export const GROQ_DIRECT_VISION_MODEL = 'stub-vision-model'
export const stripThinkTags = (s) => s
export const groqVisionChat = async () => ({ content: '' })
export const wardrobeVisionChat = async () => ''

export const __groq = { calls: [], reply: async () => ({ content: '' }) }
export const groqChat = async (...args) => { __groq.calls.push(args); return __groq.reply(...args) }
