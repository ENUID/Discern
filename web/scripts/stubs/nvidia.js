/** An NVIDIA that answers whatever the test tells it to. Aliased over '@/lib/nvidia'.
 *  NVIDIA_CONFIGURED is a `let` so the harness can turn the last rung on and off —
 *  the ladder reads it at call time, so the live binding is what matters. */
export let NVIDIA_CONFIGURED = false
export const __nvidia = {
  calls: 0,
  reply: async () => ({ role: 'assistant', content: 'nvidia says hello' }),
  configure: (v) => { NVIDIA_CONFIGURED = v },
}
export const nvidiaChat = async (...a) => { __nvidia.calls++; return __nvidia.reply(...a) }
export const nvidiaVisionChat = async () => ({ content: '' })
