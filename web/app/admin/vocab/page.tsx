'use client'

import { useState, useEffect, useCallback } from 'react'

interface Candidate {
  id: string
  phrase: string
  count: number
  reason: string
  suggestion: string | null
  status: string
  firstSeenAt: number
  lastSeenAt: number
}

// Shared with the other admin pages so one secret unlocks all of them.
const STORAGE_KEY = 'discern_admin_secret'

// Hard timeout so the UI surfaces a clear error instead of hanging silently.
async function fetchT(url: string, init: RequestInit = {}, ms = 12000): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

const fmt = (ts: number) => new Date(ts).toLocaleDateString()

export default function AdminVocabPage() {
  const [view, setView] = useState<'loading' | 'login' | 'admin'>('loading')
  const [secret, setSecret] = useState('')
  const [status, setStatus] = useState<'new' | 'approved' | 'rejected'>('new')
  const [list, setList] = useState<Candidate[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const checkAuth = useCallback(async (s: string): Promise<boolean> => {
    try {
      const r = await fetchT('/api/admin/vocab?check=1', { headers: { 'x-admin-secret': s } })
      return r.ok
    } catch {
      return false
    }
  }, [])

  const load = useCallback(async (s: string, st: string) => {
    setErr('')
    try {
      const r = await fetchT(`/api/admin/vocab?status=${st}`, { headers: { 'x-admin-secret': s } })
      const d = await r.json()
      if (!r.ok) { setErr(d?.error ?? 'Could not load'); return }
      setList(d.candidates ?? [])
    } catch {
      setErr('Could not reach the server')
    }
  }, [])

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (!saved) { setView('login'); return }
    checkAuth(saved).then(ok => {
      if (!ok) { setView('login'); return }
      setSecret(saved); setView('admin'); load(saved, 'new')
    })
  }, [checkAuth, load])

  const signIn = async () => {
    if (!(await checkAuth(secret))) { setErr('Wrong secret'); return }
    localStorage.setItem(STORAGE_KEY, secret)
    setView('admin'); setErr(''); load(secret, status)
  }

  const decide = async (id: string, next: 'approved' | 'rejected') => {
    setBusy(id)
    try {
      const r = await fetchT('/api/admin/vocab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
        body: JSON.stringify({ id, status: next }),
      })
      if (r.ok) setList(l => l.filter(c => c.id !== id))
      else setErr('Could not save that decision')
    } catch {
      setErr('Could not reach the server')
    } finally {
      setBusy(null)
    }
  }

  if (view === 'loading') return <main style={S.wrap}><p style={S.muted}>Checking…</p></main>

  if (view === 'login') {
    return (
      <main style={S.wrap}>
        <h1 style={S.h1}>Vocabulary review</h1>
        <input
          style={S.input} type="password" placeholder="Admin secret" value={secret}
          onChange={e => setSecret(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') signIn() }}
        />
        <button style={S.primary} onClick={signIn}>Sign in</button>
        {err && <p style={S.err}>{err}</p>}
      </main>
    )
  }

  return (
    <main style={S.wrap}>
      <h1 style={S.h1}>Vocabulary review</h1>
      <p style={S.note}>
        Queries the garment dictionary could not read. Approving one records that the
        mapping is right — it does <strong>not</strong> change search. Live matching stays
        hand-curated; use an approved row as the evidence for a reviewed edit to
        <code style={S.code}>lib/queryParser.ts</code>.
      </p>

      <div style={S.tabs}>
        {(['new', 'approved', 'rejected'] as const).map(s => (
          <button
            key={s}
            style={{ ...S.tab, ...(status === s ? S.tabOn : null) }}
            onClick={() => { setStatus(s); load(secret, s) }}
          >{s}</button>
        ))}
      </div>

      {err && <p style={S.err}>{err}</p>}
      {list.length === 0 && <p style={S.muted}>Nothing here.</p>}

      <ul style={S.list}>
        {list.map(c => (
          <li key={c.id} style={S.row}>
            <div style={{ minWidth: 0 }}>
              <div style={S.phrase}>{c.phrase}</div>
              <div style={S.meta}>
                seen {c.count}× · {c.reason} · {fmt(c.firstSeenAt)}–{fmt(c.lastSeenAt)}
              </div>
              <div style={S.sugg}>
                {c.suggestion ? <>suggested: <strong>{c.suggestion}</strong></> : <em>no suggestion yet</em>}
              </div>
            </div>
            {status === 'new' && (
              <div style={S.actions}>
                <button style={S.approve} disabled={busy === c.id} onClick={() => decide(c.id, 'approved')}>Approve</button>
                <button style={S.reject} disabled={busy === c.id} onClick={() => decide(c.id, 'rejected')}>Reject</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 760, margin: '0 auto', padding: '48px 20px', fontFamily: 'system-ui, sans-serif', color: '#1d1d1f' },
  h1: { fontSize: 26, fontWeight: 600, letterSpacing: '-.02em', margin: '0 0 10px' },
  note: { fontSize: 13.5, lineHeight: 1.6, color: '#555', margin: '0 0 22px' },
  code: { background: '#f2f2f2', padding: '1px 5px', borderRadius: 4, fontSize: 12.5, marginLeft: 4 },
  tabs: { display: 'flex', gap: 8, marginBottom: 18 },
  tab: { padding: '7px 14px', borderRadius: 999, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 13 },
  tabOn: { background: '#1d1d1f', color: '#fff', borderColor: '#1d1d1f' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 },
  row: { display: 'flex', gap: 14, justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', border: '1px solid #eee', borderRadius: 12 },
  phrase: { fontSize: 15, fontWeight: 500 },
  meta: { fontSize: 12, color: '#888', marginTop: 3 },
  sugg: { fontSize: 13, color: '#444', marginTop: 5 },
  actions: { display: 'flex', gap: 8, flexShrink: 0 },
  approve: { padding: '7px 13px', borderRadius: 8, border: 'none', background: '#1d1d1f', color: '#fff', cursor: 'pointer', fontSize: 13 },
  reject: { padding: '7px 13px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 13 },
  input: { width: '100%', padding: 12, borderRadius: 8, border: '1px solid #ddd', fontSize: 15, marginBottom: 10 },
  primary: { padding: '11px 20px', borderRadius: 8, border: 'none', background: '#1d1d1f', color: '#fff', cursor: 'pointer', fontSize: 14 },
  muted: { color: '#888', fontSize: 14 },
  err: { color: '#c0392b', fontSize: 13.5, marginTop: 10 },
}
