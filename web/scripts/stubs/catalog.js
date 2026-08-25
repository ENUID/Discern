/**
 * A catalogue that answers whatever the test tells it to.
 *
 * `scripts/retrieval.js` aliases '@/lib/services/GlobalCatalogService' to this
 * file so the retrieval harness can watch what ninety stores were ASKED without
 * asking them. Every call is recorded; `__stub.search` is what replies.
 */
export const __calls = []
export const __stub = { search: async () => [] }
export const GlobalCatalogService = {
  search: async (...args) => { __calls.push(args); return __stub.search(...args) },
}
