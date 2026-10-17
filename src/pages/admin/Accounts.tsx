import { useRef, useState } from 'react'
import { Copy, LayoutDashboard, Mail, MessageSquare, UserPlus } from 'lucide-react'
import { Field, Modal, PageHeader, Status, Tabs } from '../../components/ui'
import { useStore } from '../../lib/store'
import { navigate } from '../../lib/router'
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, TRADES, type Permission, type Role, type UserAccount } from '../../lib/types'
import { fmtDate, generateInviteCode, uid } from '../../lib/utils'
import { CLOUD } from '../../lib/supabase'

const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', client: 'Client', provider: 'Service provider' }
const MASTER_ID = 'u-admin'

type Delivery = 'email' | 'link'

/** A one-time sign-in link the admin sends themselves, with copy, text and email shortcuts. */
function ShareLink({ account, link, invite }: { account: UserAccount; link: string; invite: boolean }) {
  const [copied, setCopied] = useState<'message' | 'link' | null>(null)
  const first = account.name.trim().split(/\s+/)[0] || account.name
  const message = invite
    ? `Hi ${first}, here's your invite to the Next Phase Maintenance portal. Open this link to choose your password (you'll sign in with ${account.email}): ${link}`
    : `Hi ${first}, here's a link to choose a new password for the Next Phase Maintenance portal: ${link}`
  const subject = invite ? 'Your Next Phase Maintenance portal invite' : 'Reset your Next Phase Maintenance portal password'
  // Some browsers and embedded views refuse clipboard access; the link stays visible to copy by hand.
  const copy = (text: string, what: 'message' | 'link') =>
    navigator.clipboard?.writeText(text).then(() => setCopied(what)).catch(() => {})
  return (
    <div className="space-y-3">
      <input className="input text-xs" readOnly value={link} aria-label="Sign-in link" onFocus={(e) => e.currentTarget.select()} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={() => copy(message, 'message')}>
          <Copy size={15} /> {copied === 'message' ? 'Message copied' : 'Copy message'}
        </button>
        <button type="button" className="btn-ghost" onClick={() => copy(link, 'link')}>
          {copied === 'link' ? 'Link copied' : 'Copy link only'}
        </button>
        {account.phone && (
          <a className="btn-ghost" href={`sms:${account.phone.replace(/[\s()-]/g, '')}?&body=${encodeURIComponent(message)}`}>
            <MessageSquare size={15} /> Text it
          </a>
        )}
        <a className="btn-ghost" href={`mailto:${account.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`}>
          <Mail size={15} /> Email it
        </a>
      </div>
      <p className="text-xs text-slate-500">
        The link works once, and making a new one cancels this one. If it expires before {first} uses it, open their account and choose “
        {invite ? 'Create new invite link' : 'Create password link'}”.
      </p>
    </div>
  )
}

export function Accounts() {
  const { data, update, user, inviteAccount, getSignInLink, deleteAccount, startActingAs } = useStore()
  const [tab, setTab] = useState<'all' | Role>('all')
  const [editing, setEditing] = useState<UserAccount | null>(null)
  const [inviting, setInviting] = useState(false)
  const [issued, setIssued] = useState<{ account: UserAccount; code?: string; link?: string } | null>(null)
  const list = data.users.filter((u) => tab === 'all' || u.role === tab)
  // Clients' and trades' dashboards open here for the admin to view and work in; admins have none.
  const openDashboard = (u: UserAccount) => {
    startActingAs(u.id)
    navigate(`/${u.role}`)
  }

  return (
    <>
      <PageHeader
        title="Accounts & permissions"
        subtitle={
          <>
            {CLOUD
              ? 'Accounts are invite-only. Send each person an invite link by text or email; they choose their own password.'
              : 'Accounts are invite-only. Share the invite code with the person; they activate it from Sign in.'}{' '}
            Open a client's or service provider's dashboard to see and work in it as they would; what you do there is recorded as you.
          </>
        }
        actions={<button className="btn-primary" onClick={() => setInviting(true)}><UserPlus size={16} /> Invite account</button>}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'all', label: 'All', count: data.users.length },
          { value: 'client', label: 'Clients', count: data.users.filter((u) => u.role === 'client').length },
          { value: 'provider', label: 'Service providers', count: data.users.filter((u) => u.role === 'provider').length },
          { value: 'admin', label: 'Admins', count: data.users.filter((u) => u.role === 'admin').length },
        ]}
      />
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Name</th>
              <th className="th">Role</th>
              <th className="th">Phone</th>
              <th className="th">Permissions</th>
              <th className="th">Status</th>
              <th className="th">Created</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="td">
                  {u.role === 'admin' ? (
                    <p className="font-semibold">{u.name}</p>
                  ) : (
                    <button className="text-left font-semibold underline-offset-2 hover:underline" onClick={() => openDashboard(u)} title={`Open ${u.name}'s dashboard`}>
                      {u.name}
                    </button>
                  )}
                  <p className="text-xs text-slate-500">{u.email}</p>
                  {u.company && <p className="text-xs text-slate-500">{u.company}{u.trade ? ` · ${u.trade}` : ''}</p>}
                </td>
                <td className="td">{ROLE_LABEL[u.role]}</td>
                <td className="td num whitespace-nowrap">{u.phone || '—'}</td>
                <td className="td num text-slate-600">{u.permissions.length}/{ALL_PERMISSIONS.length}</td>
                <td className="td">
                  <Status tone={u.status === 'active' ? 'green' : u.status === 'invited' ? 'outline' : 'red'}>
                    {u.status === 'active' ? 'Active' : u.status === 'invited' ? 'Invite pending' : 'Suspended'}
                  </Status>
                  {!CLOUD && u.status === 'invited' && u.inviteCode && <p className="num mt-0.5 text-xs text-slate-500">{u.inviteCode}</p>}
                </td>
                <td className="td num whitespace-nowrap text-slate-600">{fmtDate(u.createdAt)}</td>
                <td className="td whitespace-nowrap text-right">
                  {u.role !== 'admin' && (
                    <button className="btn-ghost px-3 py-1.5" onClick={() => openDashboard(u)} aria-label={`Open dashboard: ${u.name}`}>
                      <LayoutDashboard size={15} /> Open dashboard
                    </button>
                  )}
                  <button className="btn-ghost px-3 py-1.5" onClick={() => setEditing(u)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <AccountEditor
          key={editing.id}
          account={editing}
          locked={editing.id === MASTER_ID || editing.id === user?.id}
          onClose={() => setEditing(null)}
          onGetLink={CLOUD && !(editing.id === MASTER_ID || editing.id === user?.id) ? () => getSignInLink(editing.id) : undefined}
          onSave={(a) => {
            const email = a.email.trim().toLowerCase()
            if (data.users.some((u) => u.id !== a.id && u.email.toLowerCase() === email)) return 'Another account already uses this email.'
            update((d) => { d.users = d.users.map((x) => (x.id === a.id ? { ...a, email: a.email.trim() } : x)) })
            setEditing(null)
            return null
          }}
          onDelete={
            editing.id === MASTER_ID || editing.id === user?.id
              ? undefined
              : async () => {
                  const err = await deleteAccount(editing.id)
                  if (err) return err
                  setEditing(null)
                  return null
                }
          }
        />
      )}
      {inviting && (
        <InviteForm
          onClose={() => setInviting(false)}
          existingEmails={data.users.map((u) => u.email.toLowerCase())}
          onCreate={async (a, delivery) => {
            const res = await inviteAccount(a, delivery)
            if (res.error) return res.error
            setInviting(false)
            setIssued({ account: a, code: res.code, link: res.link })
            return null
          }}
        />
      )}
      <Modal open={!!issued} onClose={() => setIssued(null)} title={issued?.link ? 'Invite link ready' : 'Invite created'} width={issued?.link ? 'max-w-xl' : undefined}>
        {issued?.link && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Send <span className="font-semibold text-slate-900">{issued.account.name}</span> this link by text or email. They'll choose a password
              and land in their portal.
            </p>
            <ShareLink account={issued.account} link={issued.link} invite />
          </div>
        )}
        {issued && !issued.code && !issued.link && (
          <p className="text-sm text-slate-600">
            An invitation email is on its way to <span className="font-semibold text-slate-900">{issued.account.email}</span>. The link lets{' '}
            {issued.account.name} choose a password and open their portal.
          </p>
        )}
        {issued?.code && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Send <span className="font-semibold text-slate-900">{issued.account.name}</span> this code. They'll choose a password when they sign in with
              “I have an invite code”.
            </p>
            <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
              <span className="num text-2xl tracking-widest">{issued.code}</span>
              <button
                className="btn-ghost px-2.5 py-1.5"
                onClick={() => {
                  // Some browsers and embedded views refuse clipboard access; the code stays visible to copy by hand.
                  navigator.clipboard?.writeText(`Your Next Phase Maintenance portal invite: ${issued.code} (sign in with ${issued.account.email})`).catch(() => {})
                }}
              >
                <Copy size={15} /> Copy
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

function PermissionBoxes({ value, onChange, disabled }: { value: Permission[]; onChange: (v: Permission[]) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {ALL_PERMISSIONS.map((p) => (
        <label key={p.key} className="flex items-start gap-2 rounded-md border border-slate-200 p-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-slate-900"
            disabled={disabled}
            checked={value.includes(p.key)}
            onChange={(e) => onChange(e.target.checked ? [...value, p.key] : value.filter((x) => x !== p.key))}
          />
          <span>
            <span className="block font-medium">{p.label}</span>
            <code className="font-mono text-[11px] text-slate-500">{p.key}</code>
          </span>
        </label>
      ))}
    </div>
  )
}

function AccountFields({ a, set, lockRole, lockEmail }: { a: UserAccount; set: (p: Partial<UserAccount>) => void; lockRole?: boolean; lockEmail?: boolean }) {
  return (
    <>
      <Field label="Full name"><input className="input" required value={a.name} onChange={(e) => set({ name: e.target.value })} /></Field>
      <Field label="Email">
        <input className="input disabled:bg-slate-50 disabled:text-slate-500" type="email" required disabled={lockEmail} value={a.email} onChange={(e) => set({ email: e.target.value })} />
      </Field>
      <Field label="Mobile"><input className="input num" type="tel" value={a.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
      <Field label="Role">
        <select
          className="input"
          disabled={lockRole}
          value={a.role}
          onChange={(e) => {
            const role = e.target.value as Role
            set({ role, permissions: DEFAULT_PERMISSIONS[role] })
          }}
        >
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </Field>
      <Field label="Company"><input className="input" value={a.company ?? ''} onChange={(e) => set({ company: e.target.value || undefined })} /></Field>
      {a.role === 'provider' && (
        <Field label="Primary trade">
          <select className="input" value={a.trade ?? ''} onChange={(e) => set({ trade: e.target.value || undefined })}>
            <option value="">—</option>
            {TRADES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
      )}
    </>
  )
}

function AccountEditor({
  account,
  locked,
  onClose,
  onSave,
  onDelete,
  onGetLink,
}: {
  account: UserAccount
  locked: boolean
  onClose: () => void
  onSave: (a: UserAccount) => string | null
  onDelete?: () => Promise<string | null>
  onGetLink?: () => Promise<{ error?: string; link?: string }>
}) {
  const { sendPasswordEmail } = useStore()
  const [a, setA] = useState(account)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [shared, setShared] = useState<string | null>(null)
  const [linkBusy, setLinkBusy] = useState(false)
  // Based on the saved account, not unsaved edits in this form.
  const invitePending = account.status === 'invited'
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const set = (patch: Partial<UserAccount>) => setA({ ...a, ...patch })
  return (
    <Modal open onClose={onClose} title={`Edit ${account.name}`} width="max-w-2xl">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault()
          const err = onSave(a)
          if (err) setMsg({ ok: false, text: err })
        }}>
        <AccountFields a={a} set={set} lockRole={locked} lockEmail={CLOUD} />
        <div className="sm:col-span-2">
          <span className="label">Permissions</span>
          <PermissionBoxes value={a.permissions} onChange={(permissions) => set({ permissions })} disabled={locked} />
          {locked && <p className="mt-2 text-xs text-slate-500">You can't change your own role, permissions or status.</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 sm:col-span-2">
          <div className="flex flex-wrap gap-2">
            {!locked && a.status !== 'invited' && (
              <button type="button" className="btn-ghost" onClick={() => set({ status: a.status === 'active' ? 'suspended' : 'active' })}>
                {a.status === 'active' ? 'Suspend' : 'Reactivate'}
              </button>
            )}
            {!locked &&
              (CLOUD ? (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={async () => {
                    const err = await sendPasswordEmail(a.email)
                    setMsg(err ? { ok: false, text: err } : { ok: true, text: `Password link emailed to ${a.email}.` })
                  }}
                >
                  Email password link
                </button>
              ) : (
                <button type="button" className="btn-ghost" onClick={() => set({ status: 'invited', passwordHash: '', inviteCode: generateInviteCode() })}>
                  Reset & re-invite
                </button>
              ))}
            {onGetLink && account.status !== 'suspended' && (
              <button
                type="button"
                className="btn-ghost"
                disabled={linkBusy}
                onClick={async () => {
                  setLinkBusy(true)
                  setMsg(null)
                  const res = await onGetLink()
                  setLinkBusy(false)
                  if (res.link) setShared(res.link)
                  else setMsg({ ok: false, text: res.error ?? 'Could not create the link.' })
                }}
              >
                <Copy size={15} /> {linkBusy ? 'Creating link…' : invitePending ? 'Create new invite link' : 'Create password link'}
              </button>
            )}
            {onDelete &&
              (confirmingDelete ? (
                <>
                  <button
                    type="button"
                    className="btn bg-red-600 text-white hover:bg-red-700"
                    onClick={async () => {
                      setConfirmingDelete(false)
                      const err = await onDelete()
                      if (err) setMsg({ ok: false, text: err })
                    }}
                  >
                    Confirm delete
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setConfirmingDelete(false)}>
                    Keep account
                  </button>
                </>
              ) : (
                <button type="button" className="btn-ghost text-red-600" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </button>
              ))}
          </div>
          <button className="btn-primary ml-auto">Save account</button>
        </div>
        {confirmingDelete && (
          <p className="text-sm text-red-700 sm:col-span-2">
            Delete {account.name}'s account and login? This can't be undone. Accounts with jobs or invoices on record can't be deleted; suspend
            them instead.
          </p>
        )}
        {msg && <p className={`text-sm sm:col-span-2 ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</p>}
        {shared && (
          <div className="border-t border-slate-100 pt-4 sm:col-span-2">
            <ShareLink key={shared} account={account} link={shared} invite={invitePending} />
          </div>
        )}
      </form>
    </Modal>
  )
}

function InviteForm({
  onClose,
  onCreate,
  existingEmails,
}: {
  onClose: () => void
  onCreate: (a: UserAccount, delivery: Delivery) => Promise<string | null>
  existingEmails: string[]
}) {
  const [busy, setBusy] = useState<Delivery | null>(null)
  // Which submit button was pressed; a ref so the submit handler sees it straight away.
  const delivery = useRef<Delivery>('link')
  const [error, setError] = useState<string | null>(null)
  const [a, setA] = useState<UserAccount>({
    id: uid('u'),
    name: '',
    email: '',
    role: 'client',
    phone: '',
    permissions: DEFAULT_PERMISSIONS.client,
    createdAt: new Date().toISOString(),
    status: 'invited',
    passwordHash: '',
    inviteCode: generateInviteCode(),
  })
  const set = (patch: Partial<UserAccount>) => setA({ ...a, ...patch })
  const dupe = existingEmails.includes(a.email.trim().toLowerCase())
  return (
    <Modal open onClose={onClose} title="Invite a new account" width="max-w-2xl">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (dupe) return
          setBusy(delivery.current)
          setError(await onCreate({ ...a, email: a.email.trim() }, delivery.current))
          setBusy(null)
        }}
      >
        <AccountFields a={a} set={set} />
        {dupe && <p className="text-sm text-red-600 sm:col-span-2">An account with this email already exists.</p>}
        <div className="sm:col-span-2">
          <span className="label">Permissions</span>
          <PermissionBoxes value={a.permissions} onChange={(permissions) => set({ permissions })} />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        {/* Reversed so "Create invite link" comes first in the form and is what Enter submits. */}
        <div className="flex flex-row-reverse flex-wrap items-center justify-start gap-2 sm:col-span-2">
          {CLOUD ? (
            <>
              <button className="btn-primary" disabled={dupe || !!busy} onClick={() => (delivery.current = 'link')}>
                <Copy size={15} /> {busy === 'link' ? 'Creating…' : 'Create invite link'}
              </button>
              <button className="btn-ghost" disabled={dupe || !!busy} onClick={() => (delivery.current = 'email')}>
                <Mail size={15} /> {busy === 'email' ? 'Sending…' : 'Email the invite'}
              </button>
            </>
          ) : (
            <button className="btn-primary" disabled={dupe || !!busy}>{busy ? 'Creating…' : 'Create invite'}</button>
          )}
        </div>
      </form>
    </Modal>
  )
}
