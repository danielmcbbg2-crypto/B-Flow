import { useState } from 'react'
import { Copy, UserPlus } from 'lucide-react'
import { Field, Modal, PageHeader, Status, Tabs } from '../../components/ui'
import { useStore } from '../../lib/store'
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, TRADES, type Permission, type Role, type UserAccount } from '../../lib/types'
import { fmtDate, generateInviteCode, uid } from '../../lib/utils'
import { CLOUD } from '../../lib/supabase'

const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', client: 'Client', provider: 'Service provider' }
const MASTER_ID = 'u-admin'

export function Accounts() {
  const { data, update, user, inviteAccount, deleteAccount } = useStore()
  const [tab, setTab] = useState<'all' | Role>('all')
  const [editing, setEditing] = useState<UserAccount | null>(null)
  const [inviting, setInviting] = useState(false)
  const [issued, setIssued] = useState<{ account: UserAccount; code?: string } | null>(null)
  const list = data.users.filter((u) => tab === 'all' || u.role === tab)

  return (
    <>
      <PageHeader
        title="Accounts & permissions"
        subtitle={
          CLOUD
            ? 'Accounts are invite-only. Invited people get an email link to choose their password.'
            : 'Accounts are invite-only. Share the invite code with the person; they activate it from Sign in.'
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
                  <p className="font-semibold">{u.name}</p>
                  <p className="text-xs text-slate-500">{u.email}</p>
                  {u.company && <p className="text-xs text-slate-500">{u.company}{u.trade ? ` · ${u.trade}` : ''}</p>}
                </td>
                <td className="td">{ROLE_LABEL[u.role]}</td>
                <td className="td num whitespace-nowrap">{u.phone || '—'}</td>
                <td className="td num text-slate-600">{u.permissions.length}/{ALL_PERMISSIONS.length}</td>
                <td className="td">
                  <Status tone={u.status === 'active' ? 'green' : u.status === 'invited' ? 'amber' : 'red'}>
                    {u.status === 'active' ? 'Active' : u.status === 'invited' ? 'Invite pending' : 'Suspended'}
                  </Status>
                  {!CLOUD && u.status === 'invited' && u.inviteCode && <p className="num mt-0.5 text-xs text-slate-500">{u.inviteCode}</p>}
                </td>
                <td className="td num whitespace-nowrap text-slate-600">{fmtDate(u.createdAt)}</td>
                <td className="td text-right">
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
          onSave={(a) => {
            update((d) => { d.users = d.users.map((x) => (x.id === a.id ? a : x)) })
            setEditing(null)
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
          onCreate={async (a) => {
            const res = await inviteAccount(a)
            if (res.error) return res.error
            setInviting(false)
            setIssued({ account: a, code: res.code })
            return null
          }}
        />
      )}
      <Modal open={!!issued} onClose={() => setIssued(null)} title="Invite created">
        {issued && !issued.code && (
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
                onClick={() => navigator.clipboard?.writeText(`Your Next Phase Maintenance portal invite: ${issued.code} (sign in with ${issued.account.email})`)}
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
            <code className="num text-[11px] text-slate-400">{p.key}</code>
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
}: {
  account: UserAccount
  locked: boolean
  onClose: () => void
  onSave: (a: UserAccount) => void
  onDelete?: () => Promise<string | null>
}) {
  const { sendPasswordEmail } = useStore()
  const [a, setA] = useState(account)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const set = (patch: Partial<UserAccount>) => setA({ ...a, ...patch })
  return (
    <Modal open onClose={onClose} title={`Edit ${account.name}`} width="max-w-2xl">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); onSave(a) }}>
        <AccountFields a={a} set={set} lockRole={locked} lockEmail={CLOUD} />
        <div className="sm:col-span-2">
          <span className="label">Permissions</span>
          <PermissionBoxes value={a.permissions} onChange={(permissions) => set({ permissions })} disabled={locked} />
          {locked && <p className="mt-2 text-xs text-slate-500">You can't change your own role, permissions or status.</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 sm:col-span-2">
          <div className="flex gap-2">
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
            {onDelete && (
              <button
                type="button"
                className="btn-ghost text-red-600"
                onClick={async () => {
                  if (!confirm(`Delete ${account.name}? This removes their login and everything linked to them, and can't be undone.`)) return
                  const err = await onDelete()
                  if (err) setMsg({ ok: false, text: err })
                }}
              >
                Delete
              </button>
            )}
          </div>
          <button className="btn-primary">Save account</button>
        </div>
        {msg && <p className={`text-sm sm:col-span-2 ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</p>}
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
  onCreate: (a: UserAccount) => Promise<string | null>
  existingEmails: string[]
}) {
  const [busy, setBusy] = useState(false)
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
          setBusy(true)
          setError(await onCreate({ ...a, email: a.email.trim() }))
          setBusy(false)
        }}
      >
        <AccountFields a={a} set={set} />
        {dupe && <p className="text-sm text-red-600 sm:col-span-2">An account with this email already exists.</p>}
        <div className="sm:col-span-2">
          <span className="label">Permissions</span>
          <PermissionBoxes value={a.permissions} onChange={(permissions) => set({ permissions })} />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="flex justify-end sm:col-span-2">
          <button className="btn-primary" disabled={dupe || busy}>{busy ? 'Sending…' : CLOUD ? 'Send invitation' : 'Create invite'}</button>
        </div>
      </form>
    </Modal>
  )
}
