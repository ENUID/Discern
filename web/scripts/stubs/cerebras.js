/** A Cerebras that answers whatever the test tells it to. Aliased over '@/lib/cerebras'.
 *  `opts` of the last call is kept so the harness can assert reasoning_effort. */
export const __cerebras = { calls: 0, lastOpts: null, reply: async () => ({ role: 'assistant', content: 'cerebras says hello' }) }
export const cerebrasChat = async (messages, system, opts) => {
  __cerebras.calls++; __cerebras.lastOpts = opts; return __cerebras.reply(messages, system, opts)
}
export const cerebrasVisionChat = async () => ({ content: '' })
export const CEREBRAS_VISION_CONFIGURED = false
