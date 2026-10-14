import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Empty, Field, Modal, PageHeader, Sep, Tabs } from '../../components/ui'
import { ProjectProgress } from '../../components/works'
import { ProjectStatusText } from '../../components/status'
import { ExpenseTable } from '../provider/ProviderPortal'
import { useLookup, useStore } from '../../lib/store'
import { PROJECT_STATUS_LABEL, type Project, type ProjectStatus } from '../../lib/types'
import { money, todayISO, uid } from '../../lib/utils'

export function AdminProjects() {
  const { data, update, pushInbox } = useStore()
  const lk = useLookup()
  const [tab, setTab] = useState<'quotes' | 'active' | 'closed'>('quotes')
  const [editing, setEditing] = useState<Project | null>(null)

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
      d.projects = d.projects.map((x) => (x.id === p.id ? p : x))
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
      <PageHeader title="Quotes & projects" subtitle="Price requests, attach scope of works, then run the project." />
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
    </>
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
                <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => set({ milestones: p.milestones.filter((x) => x.id !== m.id) })} aria-label="Remove milestone">
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
