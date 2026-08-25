/**
 * The harness's way in.
 *
 * esbuild bundles the stubs INTO retrieval's bundle, so there is no way to
 * reach them from outside — a second bundle would be a second instance, which
 * is the whole class of bug `scripts/limits.js` exists to catch. This entry
 * point re-exports retrieval and the stub handles together, so the harness and
 * the code under test are provably holding the same objects.
 */
export * from '@/lib/stylist/retrieval'
export { __stub as __catalog, __calls as __searches } from '@/lib/services/GlobalCatalogService'
export { __groq } from '@/lib/groq'
