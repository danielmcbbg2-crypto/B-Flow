import { useEffect, useState, type FormEvent } from 'react'
import { Field, Modal } from './ui'
import { Logo } from './Logo'
import { useStore } from '../lib/store'
import { navigate } from '../lib/router'

type Mode = 'login' | 'invite' | 'reset'

const TITLES: Record<Mode, string> = {
  login: 'Sign in to your portal',
  invite: 'Activate your invite',
  reset: 'Reset your password',
}

export function SignInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { login, acceptInvite, sendPasswordEmail, cloud } = useStore()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const switchTo = (m: Mode) => {
    setMode(m)
    setError(null)
    setNotice(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    if (mode === 'reset') {
      const err = await sendPasswordEmail(email)
      setBusy(false)
      if (err) setError(err)
      else setNotice('If that email has an account, a link to set a new password is on its way.')
      return
    }
    const res = mode === 'login' ? await login(email, password) : await acceptInvite(email, code, password)
    setBusy(false)
    if (res.error) return setError(res.error)
    onClose()
    setPassword('')
    navigate(`/${res.role ?? ''}`)
  }

  return (
    <Modal open={open} onClose={onClose} title={TITLES[mode]} width="max-w-md">
      <form onSubmit={submit} className="space-y-4">
        {mode === 'reset' && <p className="text-sm text-slate-600">We'll email you a link to choose a new password.</p>}
        <Field label="Email">
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {mode === 'invite' && (
          <Field label="Invite code">
            <input className="input num uppercase" required placeholder="XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
        )}
        {mode !== 'reset' && (
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
        )}
        {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {notice && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'invite' ? 'Activate account' : 'Email me a link'}
        </button>
        <div className="space-y-1 text-center text-sm text-slate-500">
          {mode === 'login' ? (
            <>
              {cloud ? (
                <p>
                  Accounts are invite-only — check your email for an invitation.{' '}
                  <button type="button" className="font-semibold text-slate-900 underline-offset-2 hover:underline" onClick={() => switchTo('reset')}>
                    Forgot password?
                  </button>
                </p>
              ) : (
                <p>
                  Accounts are invite-only.{' '}
                  <button type="button" className="font-semibold text-slate-900 underline-offset-2 hover:underline" onClick={() => switchTo('invite')}>
                    I have an invite code
                  </button>
                </p>
              )}
            </>
          ) : (
            <button type="button" className="font-semibold text-slate-900 underline-offset-2 hover:underline" onClick={() => switchTo('login')}>
              Back to sign in
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}

/**
 * Landing page for links from "Create invite link" and "Copy password link". The one-time token is
 * only used when the person presses Continue, so link previews can't use it up first. Once signed
 * in, the store moves on to "Choose your password".
 */
export function AcceptLinkScreen({ tokenHash, type, purpose }: { tokenHash: string; type: string; purpose: string }) {
  const { acceptLink, phase, user, authNotice } = useStore()
  const [state, setState] = useState<'idle' | 'busy' | 'signed-in'>('idle')
  const [error, setError] = useState<string | null>(null)
  const invite = purpose ? purpose === 'invite' : type === 'invite'

  useEffect(() => {
    if (state !== 'signed-in' || phase !== 'ready') return
    if (user) navigate(`/${user.role}`)
    else if (authNotice) {
      setError(authNotice)
      setState('idle')
    }
  }, [state, phase, user, authNotice])

  const go = async () => {
    setState('busy')
    setError(null)
    const err = await acceptLink(tokenHash, type)
    if (err) {
      setError(err)
      setState('idle')
    } else setState('signed-in')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="card w-full max-w-md space-y-5 p-6">
        <Logo />
        <div>
          <h1 className="text-xl font-bold">{invite ? 'You’re invited' : 'Reset your password'}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {invite
              ? 'Next Phase Maintenance has set up a portal account for you. Continue to choose your password.'
              : 'Continue to choose a new password for your Next Phase Maintenance portal.'}
          </p>
        </div>
        {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button className="btn-primary w-full" disabled={state !== 'idle'} onClick={() => void go()}>
          {state === 'idle' ? 'Continue' : 'Checking your link…'}
        </button>
        <a href="#/" className="block text-center text-sm text-slate-500 hover:text-slate-900">
          Go to the home page
        </a>
      </div>
    </div>
  )
}

/** Shown after someone follows an invite or password-reset email link. */
export function SetPasswordScreen() {
  const { setNewPassword, logout } = useStore()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) return setError('Passwords do not match.')
    setBusy(true)
    setError(null)
    const res = await setNewPassword(password)
    setBusy(false)
    if (res.error) return setError(res.error)
    navigate(`/${res.role ?? ''}`)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <form onSubmit={submit} className="card w-full max-w-md space-y-4 p-6">
        <div>
          <h1 className="text-xl font-bold">Choose your password</h1>
          <p className="mt-1 text-sm text-slate-600">Set a password to finish setting up your Next Phase Maintenance portal access.</p>
        </div>
        <Field label="New password (min. 8 characters)">
          <input className="input" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password">
          <input className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Save password & continue'}</button>
        <button type="button" className="w-full text-sm text-slate-500 hover:text-slate-900" onClick={() => void logout()}>
          Cancel
        </button>
      </form>
    </div>
  )
}
