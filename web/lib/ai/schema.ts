import { z } from 'zod';

export const SearchToolSchema = z.object({
  searchQuery: z.string().describe("A clean, simple search query in the dominant language of the target storefront(s) (e.g. 'linen shirt' or 'shoes'). Do NOT use logical OR, synonyms, or multiple languages."),
  budgetMax: z.number().nullable().optional().describe("Maximum budget if specified"),
  budgetCurrency: z.string().length(3).optional().describe("ISO 4217 currency code for the budget, if the user explicitly names a currency."),
  isClothing: z.boolean().optional().describe("Set to true if the product category is clothing, shoes, apparel, jewelry, bags, or other fashion/style accessories."),
  mandatoryConcepts: z.array(z.array(z.string())).optional().describe("Groups of essential concepts that MUST be present. Each group is an array of synonyms/translations. E.g. [['bag', 'túi'], ['vietnam', 'việt nam', 'vietnamese']]"),
  sort: z.enum(['price_asc', 'price_desc', 'relevance', 'trust_desc']).optional().describe("Requested sorting order. 'price_asc' (cheapest first), 'price_desc' (most expensive first), 'relevance', or 'trust_desc' (highest reputation shops first). Default is trust_desc.")
});

export type SearchToolArgs = z.infer<typeof SearchToolSchema>;

/**
 * NOTE ON WHAT IS *NOT* HERE.
 *
 * This file used to also export `SEARCH_TOOL_DEF`, an OpenAI tool-calling
 * definition for a `search_ucp` function. Its only consumer was the parked
 * grid-search route deleted in Stage 0, and search has been compiled
 * deterministically by `lib/intentCompiler.ts` since — no model is asked to
 * call a tool. The definition was removed in Phase 1 as unreachable.
 *
 * The schema below stays, and is not a leftover of that: `intentCompiler`
 * validates its own deterministic output against it (`intentCompiler.ts:382`),
 * which is what keeps the compiler and the catalogue agreeing on the shape of
 * a search.
 */
