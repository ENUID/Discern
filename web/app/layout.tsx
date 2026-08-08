import type { Metadata, Viewport } from 'next'
import './globals.css'
import AuthProvider from '@/components/AuthProvider'
import ConvexClientProvider from '@/components/ConvexClientProvider'
import StyledJsxRegistry from '@/components/StyledJsxRegistry'
import { Analytics } from '@vercel/analytics/next'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Discern | Decide better',
  description: 'Describe what you want to wear. Discern\'s AI searches 450+ curated independent brands to find it — then Fabrics, your personal AI stylist, builds the complete outfit, compares options, and remembers your style.',
  metadataBase: new URL('https://discern.enuid.com'),
  openGraph: {
    title: 'Discern — AI Shopping Agent',
    description: 'Describe what you want to wear. Discern\'s AI searches 450+ curated independent brands to find it — then Fabrics, your personal AI stylist, builds the complete outfit, compares options, and remembers your style.',
    url: 'https://discern.enuid.com',
    siteName: 'Discern',
    images: [
      {
        url: '/favicon.png',
        width: 512,
        height: 512,
        alt: 'Discern',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Discern — AI Shopping Agent',
    description: 'Describe what you want to wear. Discern\'s AI searches 450+ curated independent brands to find it — then Fabrics, your personal AI stylist, builds the complete outfit, compares options, and remembers your style.',
    images: ['/favicon.png'],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)

  return (
    <html lang="en">
      <head>
        <link rel="icon" type="image/png" href="/favicon.png?v=2" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=2" />
        {/* Preload TAN Meringue and the PP Gatwick wordmark so both are ready before first paint — eliminates fallback flash */}
        <link rel="preload" href="/fonts/TANMeringue.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/PPGatwick-Ultralight.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=DM+Mono:wght@300;400&family=Outfit:wght@200;300;400&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=Geist:wght@300;400;500;600&family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <StyledJsxRegistry>
          <ConvexClientProvider>
            <AuthProvider session={session}>{children}</AuthProvider>
          </ConvexClientProvider>
        </StyledJsxRegistry>
        <Analytics />
      </body>
    </html>
  )
}
