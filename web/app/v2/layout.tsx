import type { Metadata } from 'next'

/**
 * /v2 is an unfinished preview of the next interface. It shares a deployment
 * with the live app, so anyone holding the URL can open it — that's fine and
 * intended for review, but it must never be indexed or previewed as if it were
 * the product. The page itself is a client component and cannot export
 * metadata, hence this layout.
 */
export const metadata: Metadata = {
  title: 'Discern — preview',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
}

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return children
}
