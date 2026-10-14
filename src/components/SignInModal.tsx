import { useState, type FormEvent } from 'react'
import { Field, Modal } from './ui'
import { useStore } from '../lib/store'
import { navigate } from '../lib/router'

export function SignInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { login, acceptInvite, data } = useStore()
  const [mode, setMode] = useState<'login' | 'invite'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const err = mode === 'login' ? await login(email, password) : await acceptInvite(email, code, password)
    setBusy(false)
    if (err) return setError(err)
    const u = data.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase())
    onClose()
    setPassword('')
    navigate(`/${u?.role ?? ''}`)
  }

  return (
    <Modal open={open} onClose={onClose} title={mode === 'login' ? 'Sign in to your portal' : 'Activate your invite'} width="max-w-md">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {mode === 'invite' && (
          <Field label="Invite code">
            <input className="input num uppercase" required placeholder="XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
        )}
        <Field label={mode === 'login' ? 'Password' : 'Choose a password (min. 8 characters)'}>
          <input
            className="input"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Checking…' : mode === 'login' ? 'Sign in' : 'Activate account'}
        </button>
        <p className="text-center text-sm text-slate-500">
          {mode === 'login' ? (
            <>
              Accounts are invite-only.{' '}
              <button type="button" className="font-semibold text-slate-900 underline-offset-2 hover:underline" onClick={() => { setMode('invite'); setError(null) }}>
                I have an invite code
              </button>
            </>
          ) : (
            <button type="button" className="font-semibold text-slate-900 underline-offset-2 hover:underline" onClick={() => { setMode('login'); setError(null) }}>
              Back to sign in
            </button>
          )}
        </p>
      </form>
    </Modal>
  )
}
