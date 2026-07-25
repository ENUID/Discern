import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'

function getConvex() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) throw new Error('NEXTAUTH: NEXT_PUBLIC_CONVEX_URL is not set')
  return new ConvexHttpClient(url.trim().replace(/\/+$/, ''))
}

const SESSION_MAX_AGE = 60 * 60 * 24 * 30

// Cookie name prefix — set NEXTAUTH_COOKIE_PREFIX in env to customise (e.g. "from", "myapp").
// Leave unset to use NextAuth defaults.
const COOKIE_PREFIX = process.env.NEXTAUTH_COOKIE_PREFIX
const isProd = process.env.NODE_ENV === 'production'

// Cookie domain — set NEXTAUTH_COOKIE_DOMAIN in env (e.g. ".enuid.com" for all subdomains).
// Leave unset to let the browser use the current hostname automatically.
const COOKIE_DOMAIN = process.env.NEXTAUTH_COOKIE_DOMAIN || undefined

function makeCookies(): NextAuthOptions['cookies'] {
  if (!COOKIE_PREFIX) return undefined
  const secure = isProd ? '__Secure-' : ''
  const opts = (httpOnly: boolean) => ({
    httpOnly,
    sameSite: 'lax' as const,
    path: '/',
    secure: isProd,
    ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
  })
  return {
    sessionToken: {
      name: `${secure}${COOKIE_PREFIX}.session-token`,
      options: opts(true),
    },
    callbackUrl: {
      name: `${secure}${COOKIE_PREFIX}.callback-url`,
      options: opts(false),
    },
    csrfToken: {
      name: `${COOKIE_PREFIX}.csrf-token`,
      options: opts(false),
    },
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    // Email OTP (verification code) sign-in
    CredentialsProvider({
      id: 'email-otp',
      name: 'Email OTP',
      credentials: {
        email: { label: 'Email', type: 'email' },
        code: { label: 'Code', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.code) {
          throw new Error('Email and code required')
        }
        try {
          const serverSecret = process.env.CONVEX_AUTH_SECRET
          if (!serverSecret) throw new Error('Authentication is not configured')
          const convex = getConvex()
          const email = credentials.email.toLowerCase().trim()
          const code = credentials.code.trim()
          // Demo/reviewer bypass (e.g. YC): a SINGLE shared email + code that
          // skips the real one-time-code, so a reviewer can sign in without
          // access to the account's inbox. Defaults to the credentials already
          // shared with YC so it works with no env setup, but either can be
          // overridden via DEMO_LOGIN_EMAIL / DEMO_LOGIN_CODE. This is a normal,
          // unprivileged user account (no admin access), intentionally
          // shareable. Set DEMO_LOGIN_DISABLED=1 to turn it off after review.
          // Defaults are a short VIP nod to YC: pg (Paul Graham) + 500000, YC's
          // famous $500K standard deal.
          const demoEmail = (process.env.DEMO_LOGIN_EMAIL ?? 'pg@discern.enuid.com').toLowerCase().trim()
          const demoCode = (process.env.DEMO_LOGIN_CODE ?? '500000').trim()
          const demoOff = process.env.DEMO_LOGIN_DISABLED === '1'
          const isDemo = !demoOff && email === demoEmail && code === demoCode
          if (!isDemo) {
            const valid = await convex.mutation(api.verificationCodes.verifyAndConsumeCode, {
              email,
              code,
              serverSecret,
            })
            if (!valid) throw new Error('Invalid or expired code')
          }
          await convex.mutation(api.users.ensureUser, { email, serverSecret })
          const user = await convex.query(api.users.getUserByEmail, { email, serverSecret }) as any
          return { id: user?._id ?? email, name: user?.name ?? null, email }
        } catch (err: any) {
          throw new Error(err.message || 'Authentication failed')
        }
      },
    }),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            authorization: {
              params: {
                prompt: 'select_account',
                access_type: 'offline',
                response_type: 'code',
              },
            },
          }),
        ]
      : []),
  ],

  pages: {
    signIn: '/',
    error: '/',
  },

  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE,
    updateAge: 60 * 60 * 24,
  },

  jwt: {
    maxAge: SESSION_MAX_AGE,
  },

  cookies: makeCookies(),

  callbacks: {
    async signIn({ user, account }) {
      console.log('[auth] signIn provider:', account?.provider)
      if (user?.email) {
        try {
          const serverSecret = process.env.CONVEX_AUTH_SECRET
          if (!serverSecret) throw new Error('CONVEX_AUTH_SECRET is not configured')
          const convex = getConvex()
          await convex.mutation(api.users.ensureUser, {
            email: user.email,
            name: user.name || undefined,
            image: user.image || undefined,
            serverSecret,
          })
        } catch (err) {
          console.error('[auth] Failed to sync user to Convex:', String(err))
        }
      }
      return true
    },
    async jwt({ token, user, account }) {
      if (user) {
        if (account?.provider === 'google' && user.email) {
          try {
            const convex = getConvex()
            const serverSecret = process.env.CONVEX_AUTH_SECRET
            const convexUser = serverSecret ? await convex.query(api.users.getUserByEmail, {
              email: user.email.toLowerCase().trim(),
              serverSecret,
            }) as any : null
            token.id = convexUser?._id ?? user.id ?? token.sub
          } catch {
            token.id = user.id ?? token.id ?? token.sub
          }
        } else {
          token.id = user.id ?? token.id ?? token.sub
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) session.user.id = (token.id ?? token.sub) as string
      return session
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`
      if (url.startsWith(baseUrl)) return url
      try {
        const { hostname } = new URL(url)
        if (hostname === 'discern.enuid.com' || hostname.endsWith('.enuid.com')) return url
      } catch {}
      return `${baseUrl}/`
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
}
