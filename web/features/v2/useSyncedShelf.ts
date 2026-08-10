'use client'

import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useConvexAuthProof } from '@/hooks/useConvexAuthProof'

/**
 * The bag and the recents, the same on every device signed into an account.
 *
 * Signed out, nothing here runs and the interface keeps behaving exactly as it
 * did — local only, which is right, because there is no account to attach a bag
 * to. Signed in, the account row becomes the truth and every device subscribed
 * to it moves together: bag a coat on the phone and it is in the bag on the
 * laptop; delete a recent on the laptop and it is gone from the phone.
 *
 * The one genuinely hard moment is the first sign-in on a device that already
 * has a local bag. Taking the account's copy would throw away what is in front
 * of the shopper; taking the device's copy would wipe what they bagged
 * elsewhere. So the first exchange is a UNION — nothing anyone bagged is lost —
 * and every write after it is a replacement, which is what makes deletion work
 * at all. A union on every write would make removal impossible: the other
 * device would keep handing the deleted line back.
 */

type Line = { product: { id: string } } & Record<string, unknown>

const sameLine = (a: Line, b: Line) => a?.product?.id === b?.product?.id

function unionBags(local: Line[], remote: Line[]): Line[] {
  const out = [...remote]
  for (const l of local) if (!out.some(r => sameLine(l, r))) out.push(l)
  return out
}

function unionRecents(local: string[], remote: string[]): string[] {
  const seen = new Set(remote.map(r => r.toLowerCase()))
  return [...remote, ...local.filter(l => !seen.has(l.toLowerCase()))].slice(0, 40)
}

export function useSyncedShelf(opts: {
  bag: Line[]
  recents: string[]
  onRemote: (shelf: { bag: Line[]; recents: string[] }) => void
  /** True once the local stores have been read, so the first push is not an
   *  empty bag overwriting a full one. */
  ready: boolean
}) {
  const { bag, recents, onRemote, ready } = opts

  const { data: session } = useSession()
  const email = session?.user?.email ?? undefined
  const authProof = useConvexAuthProof(email)
  const scope = email && authProof ? { userEmail: email, authProof } : 'skip'
  /** The same pair, as an object the mutation can be spread from — `scope`
   *  doubles as the query's skip sentinel and cannot be spread while it might
   *  be the string. */
  const who = email && authProof ? { userEmail: email, authProof } : null

  const shelf = useQuery(api.shopperShelf.getShelf, scope as never) as
    { bag?: Line[]; recents?: string[]; updatedAt?: number } | undefined | null
  const save = useMutation(api.shopperShelf.setShelf)

  /** Whether the one-time merge has happened for this session. */
  const merged = useRef(false)
  /** What we last wrote or last accepted, so an echo of our own write is not
   *  mistaken for a change from another device. */
  const lastSeen = useRef<string>('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Signing out ends the session; the next sign-in must merge again rather than
  // assume the last one's state.
  useEffect(() => { if (!email) merged.current = false }, [email])

  // ── Adopt what the account says ──────────────────────────────────────────
  useEffect(() => {
    if (!ready || !email || !authProof) return
    if (shelf === undefined) return   // still loading

    const remoteBag = shelf?.bag ?? []
    const remoteRecents = shelf?.recents ?? []

    if (!merged.current) {
      merged.current = true
      const nextBag = unionBags(bag, remoteBag)
      const nextRecents = unionRecents(recents, remoteRecents)
      lastSeen.current = JSON.stringify([nextBag.map(l => l.product?.id), nextRecents])
      onRemote({ bag: nextBag, recents: nextRecents })
      // Push the union straight back so the other devices see it too.
      if (who) void save({ ...who, bag: nextBag, recents: nextRecents } as never).catch(() => {})
      return
    }

    // Steady state: the account is the truth. Applied only when it differs from
    // what we last wrote, so our own echo does not cause a render loop.
    const stamp = JSON.stringify([remoteBag.map(l => l?.product?.id), remoteRecents])
    if (stamp !== lastSeen.current) {
      lastSeen.current = stamp
      onRemote({ bag: remoteBag, recents: remoteRecents })
    }
  }, [ready, email, authProof, shelf, bag, recents, onRemote, save, who])

  // ── Publish what this device did ─────────────────────────────────────────
  useEffect(() => {
    if (!ready || !email || !authProof || !merged.current) return
    const stamp = JSON.stringify([bag.map(l => l?.product?.id), recents])
    if (stamp === lastSeen.current) return

    // Debounced: bagging three things in a row is one write, not three, and a
    // rename typed letter by letter is not forty.
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      lastSeen.current = stamp
      if (who) void save({ ...who, bag, recents } as never).catch(() => {})
    }, 700)

    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [ready, email, authProof, bag, recents, save, who])
}
