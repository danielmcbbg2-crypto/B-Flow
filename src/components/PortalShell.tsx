import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowUpRight, KeyRound, LogOut, type LucideIcon } from 'lucide-react'
import { Field, Modal } from './ui'
import { Logo } from './Logo'
import { useStore } from '../lib/store'
import { navigate } from '../lib/router'
import { cx } from '../lib/utils'

export interface NavItem {
  key: string
  label: string
  icon: LucideIcon
  badge?: number
}

export function PortalShell({
  role,
  label,
  nav,
  active,
  children,
}: {
  role: string
  label: string
  nav: NavItem[]
  active: string
  children: ReactNode
}) {
  const { user, logout, syncError, cloud } = useStore()
  const [pwOpen, setPwOpen] = useState(false)
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo sub={label} />
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight">{user?.name}</p>
              <p className="text-xs text-slate-500">{user?.company ?? user?.email}</p>
            </div>
            <button className="btn-ghost px-2.5" aria-label="Change password" title="Change password" onClick={() => setPwOpen(true)}>
              <KeyRound size={16} />
            </button>
            <button
              className="btn-ghost"
              aria-label="Sign out"
              onClick={async () => {
                await logout()
                navigate('/')
              }}
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 sm:px-4">
          {nav.map((n) => {
            const Icon = n.icon
            const isActive = active === n.key
            return (
              <a
                key={n.key}
                href={`#/${role}${n.key === 'home' ? '' : `/${n.key}`}`}
                className={cx(
                  '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold',
                  isActive ? 'border-accent text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-900',
                )}
              >
                <Icon size={16} />
                {n.label}
                {!!n.badge && <span className="num bg-accent px-1.5 text-[11px] leading-5 text-slate-900">{n.badge}</span>}
              </a>
            )
          })}
        </nav>
      </header>
      {!cloud && (
        <div className="bg-slate-900 px-4 py-1.5 text-center text-xs text-white">
          Demo mode — data is saved in this browser only and isn't shared with anyone else.
        </div>
      )}
      {syncError && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-center text-sm text-red-700">{syncError}</div>
      )}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
      {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}
    </div>
  )
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const { changePassword } = useStore()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next !== confirm) return setMsg({ ok: false, text: 'New passwords do not match.' })
    const err = await changePassword(current, next)
    setMsg(err ? { ok: false, text: err } : { ok: true, text: 'Password updated.' })
    if (!err) {
      setCurrent('')
      setNext('')
      setConfirm('')
    }
  }
  return (
    <Modal open onClose={onClose} title="Change password" width="max-w-md">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Current password">
          <input className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password (min. 8 characters)">
          <input className="input" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirm new password">
          <input className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
        <div className="flex justify-end">
          <button className="btn-primary">Update password</button>
        </div>
      </form>
    </Modal>
  )
}

export function GridTile({
  href,
  icon: Icon,
  title,
  description,
  meta,
  emphasis,
}: {
  href: string
  icon: LucideIcon
  title: string
  description: string
  meta?: ReactNode
  emphasis?: boolean
}) {
  return (
    <a href={href} className="group card flex flex-col p-6 transition-colors hover:border-slate-400">
      <div className="flex items-start justify-between">
        <span className={cx('flex h-11 w-11 items-center justify-center', emphasis ? 'bg-accent text-slate-900' : 'bg-slate-50 text-accent')}>
          <Icon size={22} strokeWidth={1.5} />
        </span>
        <ArrowUpRight size={18} className="text-slate-300 transition-colors group-hover:text-slate-900" />
      </div>
      <h3 className="mt-5 text-xl font-bold">{title}</h3>
      <p className="mt-1 flex-1 text-sm leading-relaxed text-slate-600">{description}</p>
      {meta && <div className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600">{meta}</div>}
    </a>
  )
}
