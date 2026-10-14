import { useState } from 'react'
import { Building2, CalendarDays, FolderKanban, LayoutDashboard, MessageSquareText, Receipt, Truck, Users } from 'lucide-react'
import { GridTile, PortalShell, type NavItem } from '../../components/PortalShell'
import { Calendar } from '../../components/Calendar'
import { Empty, PageHeader, Sep, Stat } from '../../components/ui'
import { RequestDetail, RequestRow, useLinkedCalendar } from '../../components/works'
import { useLookup, useStore } from '../../lib/store'
import { money } from '../../lib/utils'
import { Dispatch } from './Dispatch'
import { AdminProjects } from './AdminProjects'
import { Finance } from './Finance'
import { SmsGateway } from './SmsGateway'
import { Accounts } from './Accounts'
import { PropertyCard } from '../client/ClientPortal'

export function AdminPortal({ section }: { section: string }) {
  const { data, can } = useStore()
  const pending = data.requests.filter((r) => r.status === 'pending').length
  const quotes = data.projects.filter((p) => p.status === 'quote_requested').length
  const nav: NavItem[] = [
    { key: 'home', label: 'Command centre', icon: LayoutDashboard },
    { key: 'dispatch', label: 'Triage & dispatch', icon: Truck, badge: pending },
    { key: 'projects', label: 'Quotes & projects', icon: FolderKanban, badge: quotes },
    { key: 'calendar', label: 'Calendar', icon: CalendarDays },
    { key: 'finance', label: 'Finance', icon: Receipt },
    { key: 'properties', label: 'Properties', icon: Building2 },
    { key: 'sms', label: 'SMS gateway', icon: MessageSquareText },
    ...(can('canEditPermissions') ? [{ key: 'accounts', label: 'Accounts', icon: Users }] : []),
  ]
  const body = (() => {
    switch (section) {
      case 'dispatch':
        return <Dispatch />
      case 'projects':
        return <AdminProjects />
      case 'calendar':
        return <AdminCalendar />
      case 'finance':
        return can('canManageInvoices') ? <Finance /> : <Empty title="You don't have access to finance." />
      case 'properties':
        return <AllProperties />
      case 'sms':
        return <SmsGateway />
      case 'accounts':
        return can('canEditPermissions') ? <Accounts /> : <Empty title="You don't have access to accounts." />
      default:
        return <CommandCentre />
    }
  })()
  return (
    <PortalShell role="admin" label="Ops command centre" nav={nav} active={section}>
      {body}
    </PortalShell>
  )
}

function CommandCentre() {
  const { data } = useStore()
  const [openId, setOpenId] = useState<string | null>(null)
  const lk = useLookup()
  const pending = data.requests.filter((r) => r.status === 'pending')
  const urgentOpen = data.requests.filter((r) => r.urgency === 'urgent' && r.status !== 'completed')
  const live = data.requests.filter((r) => r.status === 'assigned' || r.status === 'in_progress' || r.status === 'awaiting_parts')
  const outstanding = data.invoices.filter((i) => i.status === 'sent')
  const quoteReqs = data.projects.filter((p) => p.status === 'quote_requested')
  const pendingExpenses = data.projects.flatMap((p) => p.expenses).filter((e) => e.status === 'submitted')
  const toInvoice = data.requests.filter((r) => r.status === 'completed' && !data.invoices.some((i) => i.requestId === r.id))
  const failedSms = data.sms.filter((s) => s.status === 'failed').length

  return (
    <>
      <PageHeader title="Command centre" subtitle="What needs doing across Next Phase Maintenance right now." />
      <div className="card mb-6 grid grid-cols-2 divide-x divide-y divide-slate-100 md:grid-cols-4 md:divide-y-0">
        <Stat label="Awaiting triage" value={pending.length} hint={<>{urgentOpen.length} urgent open</>} />
        <Stat label="Live works" value={live.length} />
        <Stat label="Quotes to issue" value={quoteReqs.length} />
        <Stat label="Outstanding invoices" value={money(outstanding.reduce((s, i) => s + i.amount, 0))} hint={<>{outstanding.length} {outstanding.length === 1 ? 'invoice' : 'invoices'}</>} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">Incoming requests</h2>
            <a href="#/admin/dispatch" className="text-sm font-semibold text-slate-600 hover:text-slate-900">Open dispatch board →</a>
          </div>
          {pending.length === 0 ? (
            <Empty title="Triage queue is clear" />
          ) : (
            <div className="card divide-y divide-slate-100">
              {[...pending]
                .sort((a, b) => (a.urgency === b.urgency ? b.createdAt.localeCompare(a.createdAt) : a.urgency === 'urgent' ? -1 : 1))
                .map((r) => (
                  <RequestRow key={r.id} r={r} onOpen={() => setOpenId(r.id)} right={<a className="btn-primary" href="#/admin/dispatch">Dispatch</a>} />
                ))}
            </div>
          )}
        </section>
        <section>
          <h2 className="mb-3 font-bold">Follow-ups</h2>
          <ul className="card divide-y divide-slate-100 text-sm">
            {[
              ['#/admin/projects', 'Quote requests to price', quoteReqs.length],
              ['#/admin/projects', 'Expenses awaiting approval', pendingExpenses.length],
              ['#/admin/finance', 'Completed jobs not yet invoiced', toInvoice.length],
              ['#/admin/sms', 'Failed SMS deliveries', failedSms],
            ].map(([href, label, n]) => (
              <li key={label as string}>
                <a href={href as string} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                  <span className={n ? 'font-medium text-slate-900' : 'text-slate-500'}>{label}</span>
                  <span className={`num ${n ? 'text-accent' : 'text-slate-400'}`}>{n}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <GridTile href="#/admin/dispatch" icon={Truck} emphasis={pending.length > 0} title="Triage & dispatch" description="Review photos, assign trades, schedule visits and send SMS alerts." />
        <GridTile href="#/admin/projects" icon={FolderKanban} title="Quotes & projects" description="Price quote requests, attach scope of works, manage milestones and expenses." />
        <GridTile href="#/admin/finance" icon={Receipt} title="Finance & QuickBooks" description="Track QuickBooks invoice numbers, amounts and bank transfer settlements." />
        <GridTile href="#/admin/sms" icon={MessageSquareText} title="SMS gateway" description="Configure Twilio, MessageBird or a webhook relay, set admin numbers and view logs." meta={data.smsSettings.provider === 'none' ? 'Not configured' : <>Provider<Sep />{data.smsSettings.provider}</>} />
        <GridTile href="#/admin/accounts" icon={Users} title="Accounts & permissions" description="Invite clients and trades, switch roles and set granular permissions." meta={<><span className="num">{data.users.length}</span> accounts</>} />
        <GridTile href="#/admin/calendar" icon={CalendarDays} title="Operations calendar" description="Every scheduled visit and project milestone across all trades." />
      </div>
      <RequestDetail r={lk.request(openId ?? undefined)} open={!!openId} onClose={() => setOpenId(null)} />
    </>
  )
}

function AdminCalendar() {
  const { data } = useStore()
  const lk = useLookup()
  const cal = useLinkedCalendar(data.requests, data.projects)
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <>
      <PageHeader title="Operations calendar" subtitle="All maintenance visits and project milestones. Drag to reschedule." />
      <Calendar events={cal.events} onMove={cal.onMove} onOpen={(ev) => ev.kind === 'request' && setOpenId(ev.id.slice(2))} />
      <RequestDetail r={lk.request(openId ?? undefined)} open={!!openId} onClose={() => setOpenId(null)} />
    </>
  )
}

function AllProperties() {
  const { data } = useStore()
  const lk = useLookup()
  return (
    <>
      <PageHeader title="Property registry" subtitle="Every client property and its specifications." />
      {data.properties.length === 0 ? (
        <Empty title="No properties registered" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.properties.map((p) => (
            <PropertyCard key={p.id} p={p} owner={lk.user(p.clientId)?.name} />
          ))}
        </div>
      )}
    </>
  )
}
