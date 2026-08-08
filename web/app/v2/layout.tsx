import type { Metadata } from 'next'

/**
 * /v2 is now an alias of /, kept so links handed out while this was the preview
 * route still land somewhere. It stays noindex for the opposite reason it used
 * to: not because it is unfinished, but because it serves the same page as the
 * canonical route and should not compete with it as duplicate content.
 */
export const metadata: Metadata = {
  alternates: { canonical: '/' },
  robots: {
    index: false,
    follow: true,
    googleBot: { index: false, follow: true },
  },
}

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return children
}
