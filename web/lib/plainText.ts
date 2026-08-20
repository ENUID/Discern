/**
 * Markdown the shopper was never meant to read.
 *
 * The model writes markdown. Two of the places its words end up render plain
 * text and nothing else: the line above the composer, and the composer itself.
 * So a reply reached a shopper's screen reading
 *
 *   "…and a sleek knit **elevated** baseline."
 *
 * asterisks and all, which is how you can tell at a glance that a person did
 * not write it. It is a small thing and it is on the first screen of the app.
 *
 * Two functions because the two callers want different things. Prose keeps its
 * spacing and punctuation — it is a sentence, and collapsing it would run the
 * paragraph's parts together. A search query wants a single clean line.
 */

/** Emphasis, code ticks, heading hashes and link syntax removed; every space,
 *  newline and full stop left exactly where it was. */
export function stripEmphasis(text: string): string {
  return text
    .replace(/```([\s\S]*?)```/g, '$1')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    // Single * and _ only when they wrap a word rather than sit inside one:
    // snake_case names and a lone asterisk in prose must both survive.
    .replace(/(^|[\s(["'])\*([^*\n]+)\*(?=[\s.,!?;:)\]"']|$)/g, '$1$2')
    .replace(/(^|[\s(["'])_([^_\n]+)_(?=[\s.,!?;:)\]"']|$)/g, '$1$2')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/\[([^\]]+)\]\([^)\s]*\)/g, '$1')
}

/** The same, as one line — for anything that is about to become a query. */
export function plainWords(text: string): string {
  return stripEmphasis(text).replace(/\s+/g, ' ').trim()
}
