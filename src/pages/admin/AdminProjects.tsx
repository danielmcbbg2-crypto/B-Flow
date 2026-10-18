import { useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Empty, Field, Modal, PageHeader, Sep, Tabs } from '../../components/ui'
import { ProjectBy, ProjectProgress } from '../../components/works'
import { ProjectStatusText } from '../../components/status'
import { ExpenseTable } from '../provider/ProviderPortal'
import { hasNoLogin, stampQuoteDecision, useLookup, useStore, type NewProject } from '../../lib/store'
import { DEFAULT_PERMISSIONS, PROJECT_STATUS_LABEL, type Project, type ProjectStatus, type Property, type UserAccount } from '../../lib/types'
import { money, todayISO, uid } from '../../lib/utils'

export function AdminProjects() {
  const { data, user, update, pushInbox } = useStore()
  const lk = useLookup()
  const [tab, setTab] = useState<'quotes' | 'active' | 'closed'>('quotes')
  const [editing, setEditing] = useState<Project | null>(null)
  const [creating, setCreating] = useState(false)

  const quotes = data.projects.filter((p) => p.status === 'quote_requested' || p.status === 'quoted')
  const active = data.projects.filter((p) => p.status === 'approved' || p.status === 'in_progress')
  const closed = data.projects.filter((p) => p.status === 'completed' || p.status === 'rejected')
  const list = tab === 'quotes' ? quotes : tab === 'active' ? active : closed
  const pendingExpenses = data.projects.flatMap((p) => p.expenses.filter((e) => e.status === 'submitted').map((e) => ({ e, p })))

  const setExpense = (pid: string, eid: string, status: 'approved' | 'rejected') =>
    update((d) => {
      const e = d.projects.find((p) => p.id === pid)?.expenses.find((x) => x.id === eid)
      if (e) e.status = status
    })

  const save = (p: Project) => {
    const before = data.projects.find((x) => x.id === p.id)
    update((d) => {
      const next = structuredClone(p)
      if (before) stampQuoteDecision(next, before.status, user?.id)
      d.projects = d.projects.map((x) => (x.id === p.id ? next : x))
    })
    if (before && p.assignedProviderId && p.assignedProviderId !== before.assignedProviderId) {
      pushInbox({ userId: p.assignedProviderId, title: `Assigned to project P-${p.number}`, body: p.title, requiresAck: true, projectId: p.id })
    }
    if (before && p.status === 'quoted' && before.status !== 'quoted') {
      pushInbox({ userId: p.clientId, title: `Quote ready: ${p.title}`, body: `Quoted at ${money(p.quoteAmount ?? 0)}. Review it under Projects.`, requiresAck: false, projectId: p.id })
    }
    setEditing(null)
  }

  return (
    <>
      <PageHeader
        title="Quotes & projects"
        subtitle="Price requests, attach scope of works, then run the project."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New project</button>}
      />
      {pendingExpenses.length > 0 && (
        <section className="card mb-6 overflow-hidden">
          <h2 className="border-b border-slate-200 px-5 py-3 font-bold">Expenses awaiting approval</h2>
          <ExpenseTable
            expenses={pendingExpenses.map((x) => x.e)}
            actions={(e) => {
              const pid = pendingExpenses.find((x) => x.e.id === e.id)!.p.id
              return (
                <div className="flex justify-end gap-1.5">
                  <button className="btn-primary px-2.5 py-1 text-xs" onClick={() => setExpense(pid, e.id, 'approved')}>Approve</button>
                  <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setExpense(pid, e.id, 'rejected')}>Reject</button>
                </div>
              )
            }}
          />
        </section>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'quotes', label: 'Quotes', count: quotes.length },
          { value: 'active', label: 'Active projects', count: active.length },
          { value: 'closed', label: 'Closed', count: closed.length },
        ]}
      />
      {list.length === 0 ? (
        <Empty title="Nothing here" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Project</th>
                <th className="th">Client</th>
                <th className="th">Status</th>
                <th className="th text-right">Budget</th>
                <th className="th text-right">Quote</th>
                <th className="th">Progress</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((p) => {
                const prop = lk.property(p.propertyId)
                const spent = p.expenses.filter((e) => e.status === 'approved').reduce((s, e) => s + e.amount, 0)
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="td">
                      <span className="num text-xs text-slate-500">P-{p.number}</span>
                      <p className="font-semibold">{p.title}</p>
                      <p className="text-xs text-slate-500">{prop?.address}, {prop?.suburb}</p>
                      <ProjectBy p={p} />
                    </td>
                    <td className="td">
                      {lk.user(p.clientId)?.name}
                      {p.assignedProviderId && <p className="text-xs text-slate-500">Trade: {lk.user(p.assignedProviderId)?.name}</p>}
                    </td>
                    <td className="td"><ProjectStatusText s={p.status} /></td>
                    <td className="td num text-right">
                      {p.budget ? money(p.budget) : '—'}
                      {spent > 0 && <p className="text-xs text-slate-500">spent {money(spent)}</p>}
                    </td>
                    <td className="td num text-right">{p.quoteAmount ? money(p.quoteAmount) : '—'}</td>
                    <td className="td"><ProjectProgress p={p} /></td>
                    <td className="td text-right"><button className="btn-ghost px-3 py-1.5" onClick={() => setEditing(p)}>{p.status === 'quote_requested' ? 'Prepare quote' : 'Manage'}</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ProjectEditor key={editing.id} project={editing} onClose={() => setEditing(null)} onSave={save} />}
      {creating && (
        <NewProjectForm
          onClose={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false)
            setTab(p.status === 'quote_requested' || p.status === 'quoted' ? 'quotes' : 'active')
          }}
        />
      )}
    </>
  )
}

const NEW = '__new'
const NEW_PROJECT_STATUSES: ProjectStatus[] = ['quote_requested', 'quoted', 'approved', 'in_progress']

/**
 * An admin sets up a project for any client, including one added here without a login: the client
 * sees it (with its property) once they're invited and sign in.
 */
function NewProjectForm({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
  const { data, can, createProject } = useStore()
  const lk = useLookup()
  // Ids are made once, so saving again after an error doesn't add the client or property twice.
  const [ids] = useState(() => ({ client: uid('u'), property: uid('p') }))
  const canAddClient = can('canEditPermissions')
  const clients = [...lk.clients].sort((a, b) => a.name.localeCompare(b.name))
  const [clientId, setClientId] = useState(canAddClient && clients.length === 0 ? NEW : '')
  const [client, setClient] = useState({ name: '', email: '', phone: '', company: '' })
  const [propertyId, setPropertyId] = useState('')
  const [property, setProperty] = useState({ address: '', suburb: '', postcode: '' })
  const [p, setP] = useState({
    title: '',
    description: '',
    type: 'renovation' as Project['type'],
    status: 'approved' as ProjectStatus,
    budget: '',
    quoteAmount: '',
    scopeOfWorks: '',
    assignedProviderId: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A client added here (or saved by an earlier attempt) has no properties yet, so it needs a new one.
  const newClient = clientId === NEW && !data.users.some((u) => u.id === ids.client)
  const effectiveClientId = clientId === NEW ? ids.client : clientId
  const properties = data.properties.filter((x) => x.clientId === effectiveClientId)
  const newProperty = propertyId === NEW || (!!effectiveClientId && properties.length === 0)
  // After an attempt that saved the new property but not the project, carry on with that property.
  const chosenProperty = propertyId || (properties.some((x) => x.id === ids.property) ? ids.property : '')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!effectiveClientId) return setError('Choose the client.')
    if (!newProperty && !chosenProperty) return setError('Choose the property.')
    const email = client.email.trim()
    if (newClient && email && data.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return setError('Another account already uses this email. Choose that client instead.')
    }
    if (p.status === 'quoted' && !(Number(p.quoteAmount) > 0)) return setError('Enter the quote amount to create it as an issued quote.')
    const input: NewProject = {
      newClient: newClient
        ? ({
            id: ids.client,
            name: client.name.trim(),
            email,
            phone: client.phone.trim(),
            company: client.company.trim() || undefined,
            role: 'client',
            permissions: DEFAULT_PERMISSIONS.client,
            status: 'invited',
            createdAt: new Date().toISOString(),
            passwordHash: '',
            hasLogin: false,
          } satisfies UserAccount)
        : undefined,
      newProperty: newProperty
        ? ({
            id: ids.property,
            clientId: effectiveClientId,
            address: property.address.trim(),
            suburb: property.suburb.trim(),
            postcode: property.postcode.trim(),
            paintColors: { walls: '', trim: '', ceiling: '' },
            skirtProfile: '',
            claddingType: '',
            accessCode: '',
            notes: '',
          } satisfies Property)
        : undefined,
      project: {
        clientId: effectiveClientId,
        propertyId: newProperty ? ids.property : chosenProperty,
        title: p.title.trim(),
        description: p.description.trim(),
        type: p.type,
        status: p.status,
        budget: Number(p.budget) || 0,
        quoteAmount: p.quoteAmount ? Number(p.quoteAmount) : undefined,
        scopeOfWorks: p.scopeOfWorks.trim(),
        assignedProviderId: p.assignedProviderId || undefined,
      },
    }
    setBusy(true)
    setError(null)
    try {
      onCreated(await createProject(input))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="New project" width="max-w-3xl">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <Field label="Client" className="sm:col-span-2">
          <select
            className="input"
            required
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value)
              setPropertyId('')
            }}
          >
            <option value="">Choose a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company ? ` — ${c.company}` : ''}
                {hasNoLogin(c) ? ' (no login)' : ''}
              </option>
            ))}
            {canAddClient && <option value={NEW}>+ New client (no login yet)</option>}
          </select>
        </Field>
        {newClient && (
          <fieldset className="grid gap-4 rounded-md border border-slate-200 p-4 sm:col-span-2 sm:grid-cols-2">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">New client</legend>
            <p className="text-xs text-slate-500 sm:col-span-2">
              Added without a login and sent nothing. Invite them from Accounts whenever you like; they'll see this project when they sign in.
            </p>
            <Field label="Full name"><input className="input" required value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} /></Field>
            <Field label="Email (needed to invite them)">
              <input className="input" type="email" value={client.email} onChange={(e) => setClient({ ...client, email: e.target.value })} />
            </Field>
            <Field label="Mobile"><input className="input num" type="tel" value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value })} /></Field>
            <Field label="Company"><input className="input" value={client.company} onChange={(e) => setClient({ ...client, company: e.target.value })} /></Field>
          </fieldset>
        )}
        {effectiveClientId && properties.length > 0 && (
          <Field label="Property" className="sm:col-span-2">
            <select className="input" required value={chosenProperty} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="">Choose a property…</option>
              {properties.map((x) => (
                <option key={x.id} value={x.id}>{x.address}, {x.suburb}</option>
              ))}
              <option value={NEW}>+ New property</option>
            </select>
          </Field>
        )}
        {newProperty && (
          <fieldset className="grid gap-4 rounded-md border border-slate-200 p-4 sm:col-span-2 sm:grid-cols-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">New property</legend>
            <Field label="Street address" className="sm:col-span-3">
              <input className="input" required value={property.address} onChange={(e) => setProperty({ ...property, address: e.target.value })} />
            </Field>
            <Field label="Suburb" className="sm:col-span-2">
              <input className="input" value={property.suburb} onChange={(e) => setProperty({ ...property, suburb: e.target.value })} />
            </Field>
            <Field label="Postcode">
              <input className="input num" inputMode="numeric" value={property.postcode} onChange={(e) => setProperty({ ...property, postcode: e.target.value })} />
            </Field>
          </fieldset>
        )}
        <Field label="Project title" className="sm:col-span-2">
          <input className="input" required value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} placeholder="e.g. Kitchen renovation" />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <textarea className="input min-h-[80px]" value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} />
        </Field>
        <Field label="Type">
          <select className="input" value={p.type} onChange={(e) => setP({ ...p, type: e.target.value as Project['type'] })}>
            <option value="renovation">Renovation</option>
            <option value="maintenance_contract">Maintenance contract</option>
          </select>
        </Field>
        <Field label="Status">
          <select className="input" value={p.status} onChange={(e) => setP({ ...p, status: e.target.value as ProjectStatus })}>
            {NEW_PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Budget (AUD)">
          <input type="number" min="0" step="100" className="input num" value={p.budget} onChange={(e) => setP({ ...p, budget: e.target.value })} />
        </Field>
        <Field label="Quote amount (AUD, inc. GST)">
          <input type="number" min="0" step="0.01" className="input num" value={p.quoteAmount} onChange={(e) => setP({ ...p, quoteAmount: e.target.value })} />
        </Field>
        <Field label="Assigned trade" className="sm:col-span-2">
          <select className="input" value={p.assignedProviderId} onChange={(e) => setP({ ...p, assignedProviderId: e.target.value })}>
            <option value="">Unassigned</option>
            {lk.providers.map((u) => <option key={u.id} value={u.id}>{u.name}{u.trade ? ` (${u.trade})` : ''}</option>)}
          </select>
        </Field>
        <Field label="Scope of works" className="sm:col-span-2">
          <textarea className="input min-h-[80px]" value={p.scopeOfWorks} onChange={(e) => setP({ ...p, scopeOfWorks: e.target.value })} />
        </Field>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="flex justify-end sm:col-span-2">
          <button className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create project'}</button>
        </div>
      </form>
    </Modal>
  )
}

function ProjectEditor({ project, onClose, onSave }: { project: Project; onClose: () => void; onSave: (p: Project) => void }) {
  const lk = useLookup()
  const [p, setP] = useState<Project>(project)
  const [ms, setMs] = useState({ title: '', date: todayISO() })
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Project>) => setP({ ...p, ...patch })
  const prop = lk.property(p.propertyId)
  const trySave = (next: Project) => {
    if (next.status === 'quoted' && !((next.quoteAmount ?? 0) > 0)) return setError('Enter the quote amount before issuing the quote.')
    setError(null)
    onSave(next)
  }
  return (
    <Modal open onClose={onClose} title={`P-${p.number} · ${p.title}`} width="max-w-3xl">
      <p className="text-sm text-slate-600">
        {lk.user(p.clientId)?.name}
        <Sep />
        {prop?.address}, {prop?.suburb}
      </p>
      <p className="mt-2 rounded-md bg-slate-50 p-3 text-sm text-slate-700">{p.description}</p>
      <form
        className="mt-5 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          trySave(p)
        }}
      >
        <Field label="Status">
          <select className="input" value={p.status} onChange={(e) => set({ status: e.target.value as ProjectStatus })}>
            {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Assigned trade">
          <select className="input" value={p.assignedProviderId ?? ''} onChange={(e) => set({ assignedProviderId: e.target.value || undefined })}>
            <option value="">Unassigned</option>
            {lk.providers.map((u) => <option key={u.id} value={u.id}>{u.name}{u.trade ? ` (${u.trade})` : ''}</option>)}
          </select>
        </Field>
        <Field label="Budget (AUD)">
          <input type="number" min="0" step="100" className="input num" value={p.budget || ''} onChange={(e) => set({ budget: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Quote amount (AUD, inc. GST)">
          <input type="number" min="0" step="0.01" className="input num" value={p.quoteAmount ?? ''} onChange={(e) => set({ quoteAmount: e.target.value ? Number(e.target.value) : undefined })} />
        </Field>
        <Field label="Scope of works" className="sm:col-span-2">
          <textarea className="input min-h-[100px]" value={p.scopeOfWorks} onChange={(e) => set({ scopeOfWorks: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <span className="label">Milestones</span>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {p.milestones.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-slate-900" checked={m.done} onChange={() => set({ milestones: p.milestones.map((x) => (x.id === m.id ? { ...x, done: !x.done } : x)) })} />
                <span className="flex-1">{m.title}</span>
                <input type="date" className="input num w-auto py-1" value={m.date} onChange={(e) => set({ milestones: p.milestones.map((x) => (x.id === m.id ? { ...x, date: e.target.value } : x)) })} />
                <button type="button" className="text-slate-500 hover:text-red-600" onClick={() => set({ milestones: p.milestones.filter((x) => x.id !== m.id) })} aria-label="Remove milestone">
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
            <li className="flex flex-wrap items-center gap-2 px-3 py-2">
              <input className="input flex-1 py-1" placeholder="New milestone" value={ms.title} onChange={(e) => setMs({ ...ms, title: e.target.value })} />
              <input type="date" className="input num w-auto py-1" value={ms.date} onChange={(e) => setMs({ ...ms, date: e.target.value })} />
              <button
                type="button"
                className="btn-ghost px-2.5 py-1"
                disabled={!ms.title.trim()}
                onClick={() => {
                  set({ milestones: [...p.milestones, { id: uid('m'), title: ms.title.trim(), date: ms.date, done: false }].sort((a, b) => a.date.localeCompare(b.date)) })
                  setMs({ title: '', date: ms.date })
                }}
              >
                <Plus size={15} /> Add
              </button>
            </li>
          </ul>
        </div>
        <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
          {p.status === 'quote_requested' && (
            <button type="button" className="btn-accent" disabled={!p.quoteAmount} onClick={() => trySave({ ...p, status: 'quoted' })}>
              Issue quote to client
            </button>
          )}
          <button className="btn-primary">Save project</button>
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
      </form>
    </Modal>
  )
}
