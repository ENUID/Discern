// ── Which path a message takes ───────────────────────────────────────────────
//
// There are two: a light chat path that cannot search the catalogue, and a
// heavy path that can. Picking wrong is not a matter of degree — a shopping
// question routed light comes back as prose with no products, and the interface
// has nothing to show, so the shopper watches a loading animation and lands
// back where they started.
//
// The old gate was a whitelist of shopping words: a garment name, or `find`,
// `show`, `need`, `wedding`, `office`, `linen`… Anything outside it went light.
// That is fine for "linen shirts" and wrong for most of how people actually
// write. All of these failed it and could never search:
//
//     "I have an interview at a startup on Friday"   (interview wasn't listed)
//     "going to my sister's engagement next month"
//     "I'm flying to Milan for a week"
//     "no idea what to put on tomorrow"
//     "help me not look scruffy"
//
// Which is exactly the complaint: it works on keywords, and a sentence does
// nothing. The list can always be extended and will always be missing the next
// phrasing, because it is trying to enumerate an open set.
//
// So the default is inverted. This is a fashion app; someone typing into it
// wants to be dressed unless they have clearly said otherwise. The closed set
// is the other one — greetings, thanks, reactions, questions about the app,
// and off-topic work — and that is what is enumerated here. Anything not on it
// goes to the path that can actually answer.
//
// The cost of being wrong is asymmetric, which is what settles the default: a
// greeting routed heavy is one wasted search behind a warm reply, and a real
// question routed light is a shopper staring at an empty screen.

/** Openers and sign-offs. Whole-message only — "hi, I need a coat for Berlin"
 *  is a shopping message that happens to start politely. */
const GREETING = /^(hi|hey+|hello|yo|sup|hiya|howdy|namaste|salaam|good (morning|afternoon|evening|day))\b[\s!.,]*$/i

const SIGNOFF = /^(thanks?|thank you|ty|cheers|ok(ay)?|cool|nice|great|sure|got it|alright|k|bye|goodbye|see ya|good ?night)\b[\s!.,]*$/i

/** Questions about Fabrics rather than about clothes. */
const ABOUT_THE_APP = /\b(who are you|what are you|are you (an? )?(ai|bot|robot|human|real)|what can you do|how (do|does) (you|this|discern) work|what is (this|discern)|your name)\b/i

/** Work this is not here to do. Kept narrow: these are the things the system
 *  prompt already declines, and routing them light saves a pointless search. */
const OFF_TOPIC_WORK = /\b(write|debug|fix|explain) (me )?(some )?(code|a function|a script|a program|this bug)\b|\b(my )?(homework|assignment|essay|thesis|dissertation)\b|\b(medical|legal|financial|tax|investment) advice\b|\bdiagnose\b|\bsymptoms?\b/i

/** A message that is only a reaction to what was just shown. Feedback, not a
 *  new order — the previous results should stay on screen. */
const REACTION = new RegExp([
  // "I love it", "really like these"
  /^(i )?(really |so |absolutely )?(like|love|hate|dislike) (it|this|that|these|them|the \w+)\b[\s!.,]*$/.source,
  // "looks great", "that is nice", "these are lovely"
  /^(looks?|thats?|that is|that'?s|this is|it is|it'?s|these are|they are) (good|great|nice|amazing|perfect|cool|lovely|beautiful|awful|bad|terrible)\b[\s!.,]*$/.source,
  // bare noises
  /^(meh|hmm+|nah|nope|yep|yes|no|perfect|amazing|beautiful|wow|lol|haha)\b[\s!.,]*$/.source,
].join('|'), 'i')

/** Words that mean "search anyway", even inside something that otherwise looks
 *  like a reaction or a greeting. A reaction that asks for a change is a
 *  request. */
const STILL_WANTS_SOMETHING = /\b(another|different|more|other|instead|swap|change|replace|show|find|get|need|want|buy|shop|wear|dress|style|outfit|cheaper|pricier|else|new|add|without)\b/i

export type RouteReason =
  | 'greeting' | 'signoff' | 'about-the-app' | 'off-topic' | 'reaction' | 'shopping'

/** Why this message is going where it is going. Returned rather than a bare
 *  boolean so the decision is loggable — a mis-route should be findable in a
 *  log line, not inferred from a bad answer. */
export function routeReason(question: string): RouteReason {
  const q = (question || '').trim()
  if (!q) return 'greeting'

  // Long messages are never small talk. Nobody writes 90 characters to say
  // hello, and the patterns below are all anchored short-message shapes.
  if (q.length > 90) return 'shopping'

  if (STILL_WANTS_SOMETHING.test(q)) return 'shopping'

  if (GREETING.test(q)) return 'greeting'
  if (SIGNOFF.test(q)) return 'signoff'
  if (REACTION.test(q)) return 'reaction'
  if (ABOUT_THE_APP.test(q)) return 'about-the-app'
  if (OFF_TOPIC_WORK.test(q)) return 'off-topic'

  return 'shopping'
}

/** Whether this message should reach the path that can search the catalogue.
 *
 *  Read it as: everything, unless it is plainly one of the few things that is
 *  not a request. */
export function wantsProducts(question: string): boolean {
  return routeReason(question) === 'shopping'
}
