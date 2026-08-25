/** A Gemini that answers whatever the test tells it to. Aliased over '@/lib/gemini'. */
export const __gemini = { calls: 0, reply: async () => ({ role: 'assistant', content: 'gemini says hello' }) }
export const geminiChat = async (...a) => { __gemini.calls++; return __gemini.reply(...a) }
