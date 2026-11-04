import { useState, type FormEvent } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Field } from './ui'
import { Logo } from './Logo'
import { useStore, type TwoStepSetup } from '../lib/store'
import { navigate } from '../lib/router'

/**
 * The second sign-in step for admins: a 6-digit code from an authenticator app (Google
 * Authenticator, Microsoft Authenticator, 1Password…). The first time, the admin sets the app up by
 * scanning a QR code. Until the code is entered, the database gives the login no admin access.
 */
export function TwoStepScreen() {
  const { twoStep, startTwoStepSetup, confirmTwoStep, logout, cloudUserEmail } = useStore()
  const [setup, setSetup] = useState<TwoStepSetup | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const settingUp = twoStep === 'set-up'

  const begin = async () => {
    setBusy(true)
    setError(null)
    try {
      setSetup(await startTwoStepSetup())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const err = await confirmTwoStep(code, setup?.factorId)
    setBusy(false)
    if (err) setError(err)
  }

  const signOut = async () => {
    await logout()
    navigate('/')
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-12">
      <div className="card w-full max-w-md p-6">
        <Logo />
        <div className="mt-5 flex items-center gap-2">
          <ShieldCheck size={22} className="text-emerald-600" />
          <h1 className="text-lg font-bold">{settingUp ? 'Set up two-step sign-in' : 'Enter your sign-in code'}</h1>
        </div>
        {cloudUserEmail && <p className="mt-1 text-sm text-slate-500">{cloudUserEmail}</p>}

        {settingUp && !setup && (
          <div className="mt-4 space-y-3 text-sm text-slate-700">
            <p>
              Admin logins need a second step, so a stolen password alone can’t open the office portal. You’ll need an authenticator app on your phone, such
              as <strong>Google Authenticator</strong>, <strong>Microsoft Authenticator</strong> or <strong>1Password</strong>.
            </p>
            <p>It takes about a minute, once. After that, signing in asks for the 6-digit code the app shows.</p>
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void begin()}>
              {busy ? 'Please wait…' : 'Set up my authenticator app'}
            </button>
          </div>
        )}

        {settingUp && setup && (
          <div className="mt-4 space-y-3 text-sm text-slate-700">
            <p>
              1. In your authenticator app, add an account and <strong>scan this code</strong>:
            </p>
            <img src={setup.qr} alt="QR code to add Next Phase Maintenance to your authenticator app" className="mx-auto h-48 w-48 rounded-md border border-slate-200 bg-white p-2" />
            <p>
              Can’t scan it? Enter this key in the app instead:
              <span className="num mt-1 block select-all break-all rounded-md bg-slate-100 px-2 py-1.5 text-xs" aria-label="Setup key">{setup.secret}</span>
            </p>
            <p>2. Enter the 6-digit code the app now shows for Next Phase Maintenance.</p>
          </div>
        )}

        {(!settingUp || setup) && (
          <form className="mt-4 space-y-3" onSubmit={submit}>
            {!settingUp && <p className="text-sm text-slate-700">Open your authenticator app and enter the 6-digit code for Next Phase Maintenance.</p>}
            <Field label="6-digit code">
              <input
                className="input num text-center text-lg tracking-[0.3em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? 'Checking…' : settingUp ? 'Turn on two-step sign-in' : 'Continue'}
            </button>
          </form>
        )}

        {error && <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
          {!settingUp && <p>Lost your phone? Another admin can’t reset this; see “Two-step sign-in” in the portal’s setup guide (README) to reset it from Supabase.</p>}
          <button type="button" className="font-semibold text-slate-700 underline" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
