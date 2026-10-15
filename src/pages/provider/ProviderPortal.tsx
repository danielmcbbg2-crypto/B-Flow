import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { CalendarDays, FolderKanban, Home, Inbox as InboxIcon, Receipt, Wrench, Check, Plus } from 'lucide-react'
import { GridTile, PortalShell, type NavItem } from '../../components/PortalShell'
import { Calendar } from '../../components/Calendar'
import { Empty, Field, Modal, PageHeader, PhotoInput, Sep, Status, Tabs } from '../../components/ui'
import { ProjectStatusText } from '../../components/status'
import { ProjectProgress, RequestDetail, RequestRow, useLinkedCalendar } from '../../components/works'
import { useLookup, useStore } from '../../lib/store'
import { REQUEST_STATUS_LABEL, type Expense, type RequestStatus } from '../../lib/types'
import { cx, fmtDate, fmtDateTime, money, todayISO, uid } from '../../lib/utils'

export function ProviderPortal({ section }: { section: string }) {
  const { data, user } = useStore()
  const unread = data.inbox.filter((m) => m.userId === user?.id && (!m.read || (m.requiresAck && !m.acknowledged))).length
  const nav: NavItem[] = [
    { key: 'home', label: 'Overview', icon: Home },
    { key: 'inbox', label: 'Inbox', icon: InboxIcon, badge: unread },
    { key: 'hub', label: 'Maintenance Hub', icon: Wrench },
    { key: 'projects', label: 'Projects', icon: FolderKanban },
    { key: 'calendar', label: 'Calendar', icon: CalendarDays },
    { key: 'budget', label: 'Budget & expenses', icon: Receipt },
  ]
  return (
    <PortalShell role="provider" label="Service provider portal" nav={nav} active={section}>
      {section === 'inbox' ? (
        <Inbox />
      ) : section === 'hub' ? (
        <Hub />
      ) : section === 'projects' ? (
        <Projects />
      ) : section === 'calendar' ? (
        <ProviderCalendar />
      ) : section === 'budget' ? (
        <Budget />
      ) : (
        <Overview unread={unread} />
      )}
    </PortalShell>
  )
}

function useAssigned() {
  const { data, user } = useStore()
  return useMemo(
    () => ({
      requests: data.requests.filter((r) => r.assignedProviderId === user?.id),
      projects: data.projects.filter((p) => p.assignedProviderId === user?.id),
      inbox: data.inbox.filter((m) => m.userId === user?.id),
    }),
    [data, user],
  )
}

function Overview({ unread }: { unread: number }) {
  const { user } = useStore()
  const a = useAssigned()
  const live = a.requests.filter((r) => r.status !== 'completed')
  const today = todayISO()
  const todays = live.filter((r) => r.scheduledDate === today).length
  const liveProjects = a.projects.filter((p) => p.status === 'in_progress' || p.status === 'approved')
  const pendingExp = a.projects.flatMap((p) => p.expenses).filter((e) => e.providerId === user?.id && e.status === 'submitted').length
  return (
    <>
      <PageHeader title={`G'day, ${user?.name.split(' ')[0]}`} subtitle={user?.company} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <GridTile href="#/provider/inbox" icon={InboxIcon} emphasis={unread > 0} title="Inbox" description="Work orders to acknowledge and messages from the office." meta={<><span className="num">{unread}</span> need attention</>} />
        <GridTile href="#/provider/hub" icon={Wrench} title="Maintenance Hub" description="Your live work orders: update status and upload completion photos." meta={<><span className="num">{live.length}</span> live<Sep /><span className="num">{todays}</span> today</>} />
        <GridTile href="#/provider/projects" icon={FolderKanban} title="Live projects" description="Renovation projects you're assigned to, with milestones." meta={<><span className="num">{liveProjects.length}</span> active</>} />
        <GridTile href="#/provider/calendar" icon={CalendarDays} title="Project calendar" description="Maintenance visits and project milestones on one calendar. Drag to reschedule." />
        <GridTile href="#/provider/budget" icon={Receipt} title="Budget & expenses" description="Submit materials, labour and hire costs against project budgets." meta={<><span className="num">{pendingExp}</span> awaiting approval</>} />
      </div>
    </>
  )
}

function Inbox() {
  const { update, user } = useStore()
  const a = useAssigned()
  const lk = useLookup()
  const [openReq, setOpenReq] = useState<string | null>(null)
  const mark = (id: string, patch: { read?: boolean; acknowledged?: boolean }) =>
    update((d) => {
      const m = d.inbox.find((x) => x.id === id)
      if (m) Object.assign(m, patch)
    })
  return (
    <>
      <PageHeader title="Inbox" subtitle="Messages and work orders from Next Phase Maintenance." />
      {a.inbox.length === 0 ? (
        <Empty title="Inbox is clear" />
      ) : (
        <div className="card divide-y divide-slate-100">
          {a.inbox.map((m) => {
            const pending = m.requiresAck && !m.acknowledged
            return (
              <div key={m.id} className={cx('flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start', !m.read && 'bg-accent-soft')}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {!m.read && <span className="h-2 w-2 rounded-full bg-accent" aria-label="Unread" />}
                    <p className="font-semibold">{m.title}</p>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-600">{m.body}</p>
                  <p className="num mt-1 text-xs text-slate-400">{fmtDateTime(m.createdAt)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {m.requestId && lk.request(m.requestId)?.assignedProviderId === user?.id && (
                    <button className="btn-ghost" onClick={() => { setOpenReq(m.requestId!); mark(m.id, { read: true }) }}>View job</button>
                  )}
                  {pending ? (
                    <button className="btn-accent" onClick={() => mark(m.id, { acknowledged: true, read: true })}>
                      <Check size={16} /> Acknowledge
                    </button>
                  ) : m.requiresAck ? (
                    <Status tone="green">Acknowledged</Status>
                  ) : (
                    !m.read && <button className="btn-ghost" onClick={() => mark(m.id, { read: true })}>Mark read</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <RequestDetail r={lk.request(openReq ?? undefined)} open={!!openReq} onClose={() => setOpenReq(null)} />
    </>
  )
}

function Hub() {
  const { update, pushAdminInbox, user } = useStore()
  const lk = useLookup()
  const a = useAssigned()
  const [tab, setTab] = useState<'live' | 'completed'>('live')
  const [openId, setOpenId] = useState<string | null>(null)
  const [photos, setPhotos] = useState<string[]>([])
  const [note, setNote] = useState('')
  const live = a.requests.filter((r) => r.status !== 'completed')
  const completed = a.requests.filter((r) => r.status === 'completed')
  const open = lk.request(openId ?? undefined)

  const setStatus = (id: string, status: RequestStatus) => {
    const r = lk.request(id)
    update((d) => {
      const x = d.requests.find((y) => y.id === id)
      if (!x) return
      x.status = status
      if (status === 'completed') x.completedAt = new Date().toISOString()
    })
    if (status === 'completed' && r) {
      void pushAdminInbox(`Work order #${r.number} completed`, `${user?.name} marked “${r.title}” complete. Ready to invoice.`, { requestId: r.id })
    }
  }

  const saveUpdate = () => {
    if (!open) return
    update((d) => {
      const x = d.requests.find((y) => y.id === open.id)
      if (!x) return
      x.completionPhotos.push(...photos)
      if (note.trim()) x.notes = [x.notes, `${fmtDate(todayISO())} — ${user?.name}: ${note.trim()}`].filter(Boolean).join('\n')
    })
    setPhotos([])
    setNote('')
  }

  const list = tab === 'live' ? live : completed
  return (
    <>
      <PageHeader title="Maintenance Hub" subtitle="Your assigned work orders." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'live', label: 'Live work orders', count: live.length }, { value: 'completed', label: 'Completed', count: completed.length }]} />
      {list.length === 0 ? (
        <Empty title={tab === 'live' ? 'No live work orders' : 'Nothing completed yet'} />
      ) : (
        <div className="card divide-y divide-slate-100">
          {list.map((r) => (
            <RequestRow
              key={r.id}
              r={r}
              onOpen={() => setOpenId(r.id)}
              right={
                r.status !== 'completed' && (
                  <select className="input w-auto py-1.5" value={r.status} onChange={(e) => setStatus(r.id, e.target.value as RequestStatus)} aria-label="Update status">
                    {(['assigned', 'in_progress', 'awaiting_parts', 'completed'] as RequestStatus[]).map((s) => (
                      <option key={s} value={s}>{REQUEST_STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                )
              }
            />
          ))}
        </div>
      )}
      <RequestDetail r={open} open={!!open} onClose={() => { setOpenId(null); setPhotos([]); setNote('') }}>
        <div className="space-y-4">
          <div>
            <span className="label">Add completion photos</span>
            <PhotoInput value={photos} onChange={setPhotos} />
          </div>
          <Field label="Site note">
            <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Work done, parts used, follow-ups…" />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            {open && open.status !== 'completed' && (
              <button className="btn-ghost" onClick={() => { saveUpdate(); setStatus(open.id, 'completed') }}>Save & mark complete</button>
            )}
            <button className="btn-primary" onClick={saveUpdate} disabled={!photos.length && !note.trim()}>Save update</button>
          </div>
        </div>
      </RequestDetail>
    </>
  )
}

function Projects() {
  const { update } = useStore()
  const lk = useLookup()
  const a = useAssigned()
  const toggle = (pid: string, mid: string) =>
    update((d) => {
      const m = d.projects.find((p) => p.id === pid)?.milestones.find((x) => x.id === mid)
      if (m) m.done = !m.done
    })
  return (
    <>
      <PageHeader title="Live projects" subtitle="Tick off milestones as they're completed." />
      {a.projects.length === 0 ? (
        <Empty title="No projects assigned" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {a.projects.map((p) => {
            const prop = lk.property(p.propertyId)
            return (
              <div key={p.id} className="card p-5">
                <div className="flex flex-wrap items-center gap-x-3">
                  <span className="num text-xs text-slate-500">P-{p.number}</span>
                  <ProjectStatusText s={p.status} />
                </div>
                <h3 className="mt-1 text-lg font-bold">{p.title}</h3>
                <p className="text-sm text-slate-500">
                  {prop?.address}, {prop?.suburb}
                  {prop?.accessCode && (<><Sep />{prop.accessCode}</>)}
                </p>
                {p.scopeOfWorks && <p className="mt-2 text-sm text-slate-600">{p.scopeOfWorks}</p>}
                <div className="mt-4"><ProjectProgress p={p} /></div>
                <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
                  {p.milestones.map((m) => (
                    <li key={m.id}>
                      <label className="flex cursor-pointer items-center gap-3 py-2 text-sm">
                        <input type="checkbox" className="h-4 w-4 accent-slate-900" checked={m.done} onChange={() => toggle(p.id, m.id)} />
                        <span className={cx('flex-1', m.done && 'text-slate-400 line-through')}>{m.title}</span>
                        <span className="num text-xs text-slate-500">{fmtDate(m.date)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function ProviderCalendar() {
  const a = useAssigned()
  const lk = useLookup()
  const cal = useLinkedCalendar(a.requests, a.projects)
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <>
      <PageHeader title="Project calendar" subtitle="Maintenance visits and renovation milestones, synced with your work orders." />
      <Calendar events={cal.events} onMove={cal.onMove} onOpen={(ev) => ev.kind === 'request' && setOpenId(ev.id.slice(2))} />
      <RequestDetail r={lk.request(openId ?? undefined)} open={!!openId} onClose={() => setOpenId(null)} />
    </>
  )
}

const OPEN_FOR_EXPENSES = ['approved', 'in_progress']

function Budget() {
  const { user, update, can } = useStore()
  const a = useAssigned()
  const [adding, setAdding] = useState<string | null>(null)
  const [form, setForm] = useState({ date: todayISO(), description: '', category: 'Materials' as Expense['category'], amount: '' })
  const canSubmit = (status: string) => can('canSubmitExpenses') && OPEN_FOR_EXPENSES.includes(status)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const project = a.projects.find((p) => p.id === adding)
    if (!project || !user || !canSubmit(project.status)) return
    update((d) => {
      d.projects.find((p) => p.id === adding)?.expenses.push({
        id: uid('e'),
        providerId: user.id,
        date: form.date,
        description: form.description,
        category: form.category,
        amount: Math.round(Number(form.amount) * 100) / 100,
        status: 'submitted',
      })
    })
    setAdding(null)
    setForm({ date: todayISO(), description: '', category: 'Materials', amount: '' })
  }

  return (
    <>
      <PageHeader title="Budget & expenses" subtitle="Costs are reviewed by the office before approval." />
      {a.projects.length === 0 ? (
        <Empty title="No projects assigned" />
      ) : (
        <div className="space-y-6">
          {a.projects.map((p) => {
            const approved = p.expenses.filter((e) => e.status === 'approved').reduce((s, e) => s + e.amount, 0)
            const submitted = p.expenses.filter((e) => e.status === 'submitted').reduce((s, e) => s + e.amount, 0)
            const pct = p.budget ? Math.min(100, ((approved + submitted) / p.budget) * 100) : 0
            return (
              <section key={p.id} className="card overflow-hidden">
                <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="num text-xs text-slate-500">P-{p.number}</p>
                    <h3 className="font-bold">{p.title}</h3>
                  </div>
                  {canSubmit(p.status) ? (
                    <button className="btn-primary" onClick={() => setAdding(p.id)}><Plus size={16} /> Submit expense</button>
                  ) : (
                    <span className="text-xs text-slate-500">{can('canSubmitExpenses') ? 'Project closed for new expenses' : 'Expense submission not enabled for your account'}</span>
                  )}
                </div>
                <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 text-sm">
                  <div className="px-5 py-3"><p className="text-xs text-slate-500">Budget</p><p className="num">{money(p.budget)}</p></div>
                  <div className="px-5 py-3"><p className="text-xs text-slate-500">Approved</p><p className="num">{money(approved)}</p></div>
                  <div className="px-5 py-3"><p className="text-xs text-slate-500">Pending</p><p className="num">{money(submitted)}</p></div>
                </div>
                <div className="px-5 pt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={cx('h-full', pct > 90 ? 'bg-accent' : 'bg-slate-900')} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="num mt-1 text-xs text-slate-500">{pct.toFixed(0)}% of budget committed</p>
                </div>
                <ExpenseTable expenses={p.expenses} />
              </section>
            )
          })}
        </div>
      )}
      <Modal open={!!adding} onClose={() => setAdding(null)} title="Submit expense">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Date"><input type="date" className="input num" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Category">
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Expense['category'] })}>
              {['Materials', 'Labour', 'Equipment hire', 'Subcontractor', 'Other'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Description" className="sm:col-span-2"><input className="input" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Amount (AUD, inc. GST)"><input type="number" min="0.01" step="0.01" className="input num" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <div className="flex items-end justify-end"><button className="btn-primary">Submit</button></div>
        </form>
      </Modal>
    </>
  )
}

export function ExpenseTable({ expenses, actions }: { expenses: Expense[]; actions?: (e: Expense) => ReactNode }) {
  const lk = useLookup()
  if (expenses.length === 0) return <p className="px-5 py-4 text-sm text-slate-500">No expenses recorded.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px]">
        <thead className="border-b border-slate-100">
          <tr>
            <th className="th">Date</th>
            <th className="th">Description</th>
            <th className="th">Category</th>
            <th className="th text-right">Amount</th>
            <th className="th">Status</th>
            {actions && <th className="th" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {expenses.map((e) => (
            <tr key={e.id}>
              <td className="td num whitespace-nowrap text-slate-600">{fmtDate(e.date)}</td>
              <td className="td">
                {e.description}
                {actions && <span className="block text-xs text-slate-500">{lk.user(e.providerId)?.name}</span>}
              </td>
              <td className="td text-slate-600">{e.category}</td>
              <td className="td num text-right">{money(e.amount)}</td>
              <td className="td">
                <Status tone={e.status === 'approved' ? 'green' : e.status === 'rejected' ? 'red' : 'amber'}>
                  {e.status === 'submitted' ? 'Awaiting approval' : e.status === 'approved' ? 'Approved' : 'Rejected'}
                </Status>
              </td>
              {actions && <td className="td text-right">{actions(e)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
