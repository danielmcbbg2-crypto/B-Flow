import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Empty, Field, Modal, PageHeader, Stat, Tabs } from '../../components/ui'
import { InvoiceStatusText } from '../../components/status'
import { useLookup, useStore } from '../../lib/store'
import type { InvoiceStatus, QuickBooksInvoice } from '../../lib/types'
import { fmtDate, money, toISODate, todayISO, uid } from '../../lib/utils'

export function Finance() {
  const { data, update } = useStore()
  const lk = useLookup()
  const [tab, setTab] = useState<'all' | InvoiceStatus>('all')
  const [creating, setCreating] = useState(false)
  const [paying, setPaying] = useState<QuickBooksInvoice | null>(null)
  const [bankOpen, setBankOpen] = useState(false)

  const list = data.invoices.filter((i) => tab === 'all' || i.status === tab).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const sum = (s: InvoiceStatus) => data.invoices.filter((i) => i.status === s).reduce((t, i) => t + i.amount, 0)
  const today = todayISO()
  const overdue = data.invoices.filter((i) => i.status === 'sent' && i.dueDate < today)

  const linked = (i: QuickBooksInvoice) => {
    if (i.requestId) {
      const r = lk.request(i.requestId)
      return r ? `#${r.number} ${r.title}` : 'Work order'
    }
    if (i.projectId) {
      const p = lk.project(i.projectId)
      return p ? `P-${p.number} ${p.title}` : 'Project'
    }
    return '—'
  }

  return (
    <>
      <PageHeader
        title="Finance & QuickBooks"
        subtitle="Record QuickBooks invoice numbers and confirm bank transfer settlements."
        actions={
          <>
            <button className="btn-ghost" onClick={() => setBankOpen(true)}>Bank details</button>
            <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> Record invoice</button>
          </>
        }
      />
      <div className="card mb-6 grid grid-cols-2 divide-x divide-y divide-slate-100 md:grid-cols-4 md:divide-y-0">
        <Stat label="Draft" value={money(sum('draft'))} />
        <Stat label="Invoiced, unpaid" value={money(sum('sent'))} />
        <Stat label="Overdue" value={money(overdue.reduce((t, i) => t + i.amount, 0))} hint={<>{overdue.length} {overdue.length === 1 ? 'invoice' : 'invoices'}</>} />
        <Stat label="Paid" value={money(sum('paid'))} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'all', label: 'All', count: data.invoices.length },
          { value: 'draft', label: 'Draft' },
          { value: 'sent', label: 'Invoiced' },
          { value: 'paid', label: 'Paid' },
        ]}
      />
      {list.length === 0 ? (
        <Empty title="No invoices" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">QB invoice</th>
                <th className="th">Client</th>
                <th className="th">For</th>
                <th className="th text-right">Amount</th>
                <th className="th">Due</th>
                <th className="th">Status</th>
                <th className="th">Bank ref</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <td className="td num font-medium">{i.qbInvoiceNumber}</td>
                  <td className="td">{lk.user(i.clientId)?.name ?? '—'}</td>
                  <td className="td max-w-[220px] truncate text-slate-600">{linked(i)}</td>
                  <td className="td num text-right">{money(i.amount)}</td>
                  <td className={`td num whitespace-nowrap ${i.status === 'sent' && i.dueDate < today ? 'font-semibold text-accent' : 'text-slate-600'}`}>{fmtDate(i.dueDate)}</td>
                  <td className="td"><InvoiceStatusText s={i.status} /></td>
                  <td className="td num text-xs text-slate-600">
                    {i.bankTransferRef || '—'}
                    {i.paidDate && <span className="block text-slate-400">{fmtDate(i.paidDate)}</span>}
                  </td>
                  <td className="td text-right">
                    {i.status === 'draft' && (
                      <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => update((d) => { d.invoices.find((x) => x.id === i.id)!.status = 'sent' })}>Mark sent</button>
                    )}
                    {i.status === 'sent' && (
                      <button className="btn-primary px-2.5 py-1 text-xs" onClick={() => setPaying(i)}>Record payment</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <InvoiceForm onClose={() => setCreating(false)} />}
      {paying && <PaymentForm key={paying.id} invoice={paying} onClose={() => setPaying(null)} />}
      {bankOpen && <BankForm onClose={() => setBankOpen(false)} />}
    </>
  )
}

function InvoiceForm({ onClose }: { onClose: () => void }) {
  const { data, update } = useStore()
  const invoicedRequests = new Set(data.invoices.map((i) => i.requestId).filter(Boolean))
  const projectBilled = (id: string) => data.invoices.filter((i) => i.projectId === id).reduce((t, i) => t + i.amount, 0)
  // A maintenance job is invoiced once; projects can take several progress invoices, so show what's already billed.
  const options = [
    ...data.requests
      .filter((r) => r.status === 'completed')
      .map((r) => ({ key: `r:${r.id}`, label: `#${r.number} ${r.title}`, clientId: r.clientId, done: invoicedRequests.has(r.id) })),
    ...data.projects
      .filter((p) => ['approved', 'in_progress', 'completed'].includes(p.status))
      .map((p) => {
        const billed = projectBilled(p.id)
        const note = billed ? ` — ${money(billed)} billed${p.quoteAmount ? ` of ${money(p.quoteAmount)}` : ''}` : ''
        return { key: `p:${p.id}`, label: `P-${p.number} ${p.title}${note}`, clientId: p.clientId, done: false }
      }),
  ]
  const nextNum = () => {
    const nums = data.invoices.map((i) => parseInt(i.qbInvoiceNumber.replace(/\D/g, ''), 10)).filter((n) => !Number.isNaN(n))
    return `INV-${nums.length ? Math.max(...nums) + 1 : 1001}`
  }
  const due = new Date()
  due.setDate(due.getDate() + 14)
  const [f, setF] = useState({ link: options.find((o) => !o.done)?.key ?? '', qb: nextNum(), amount: '', due: toISODate(due), status: 'sent' as InvoiceStatus })
  const opt = options.find((o) => o.key === f.link)

  return (
    <Modal open onClose={onClose} title="Record QuickBooks invoice">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!opt || opt.done) return
          const [kind, id] = f.link.split(':')
          update((d) => {
            if (kind === 'r' && d.invoices.some((i) => i.requestId === id)) return
            d.invoices.unshift({
              id: uid('i'),
              requestId: kind === 'r' ? id : undefined,
              projectId: kind === 'p' ? id : undefined,
              clientId: opt.clientId,
              qbInvoiceNumber: f.qb.trim(),
              amount: Math.round(Number(f.amount) * 100) / 100,
              status: f.status,
              bankTransferRef: '',
              dueDate: f.due,
              createdAt: new Date().toISOString(),
            })
          })
          onClose()
        }}
      >
        <Field label="Work order or project" className="sm:col-span-2">
          <select className="input" required value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })}>
            <option value="" disabled>Select…</option>
            {options.map((o) => (
              <option key={o.key} value={o.key} disabled={o.done}>
                {o.label}
                {o.done ? ' (already invoiced)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="QuickBooks invoice no.">
          <input className="input num" required value={f.qb} onChange={(e) => setF({ ...f, qb: e.target.value })} />
        </Field>
        <Field label="Amount (AUD, inc. GST)">
          <input type="number" min="0.01" step="0.01" className="input num" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label="Due date">
          <input type="date" className="input num" required value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />
        </Field>
        <Field label="Status">
          <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as InvoiceStatus })}>
            <option value="draft">Draft</option>
            <option value="sent">Sent to client</option>
          </select>
        </Field>
        <div className="flex justify-end sm:col-span-2"><button className="btn-primary" disabled={!opt}>Save invoice</button></div>
      </form>
    </Modal>
  )
}

function PaymentForm({ invoice, onClose }: { invoice: QuickBooksInvoice; onClose: () => void }) {
  const { update } = useStore()
  const [ref, setRef] = useState(invoice.bankTransferRef)
  const [date, setDate] = useState(todayISO())
  return (
    <Modal open onClose={onClose} title={`Record payment · ${invoice.qbInvoiceNumber}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!ref.trim()) return
          update((d) => {
            const i = d.invoices.find((x) => x.id === invoice.id)!
            i.status = 'paid'
            i.bankTransferRef = ref.trim()
            i.paidDate = date
          })
          onClose()
        }}
      >
        <p className="text-sm text-slate-600">Check the deposit on your bank statement, then record its reference here.</p>
        <p className="num text-2xl">{money(invoice.amount)}</p>
        <Field label="Bank deposit reference">
          <input className="input num" required value={ref} onChange={(e) => setRef(e.target.value)} placeholder="As shown on the statement" />
        </Field>
        <Field label="Date received">
          <input type="date" className="input num" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="flex justify-end"><button className="btn-primary" disabled={!ref.trim()}>Mark paid</button></div>
      </form>
    </Modal>
  )
}

function BankForm({ onClose }: { onClose: () => void }) {
  const { data, update } = useStore()
  const [b, setB] = useState(data.bank)
  return (
    <Modal open onClose={onClose} title="Bank transfer details">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          update((d) => { d.bank = b })
          onClose()
        }}
      >
        <Field label="Account name" className="sm:col-span-2">
          <input className="input" value={b.accountName} onChange={(e) => setB({ ...b, accountName: e.target.value })} />
        </Field>
        <Field label="BSB">
          <input className="input num" placeholder="000-000" pattern="\d{3}-?\d{3}" value={b.bsb} onChange={(e) => setB({ ...b, bsb: e.target.value })} />
        </Field>
        <Field label="Account number">
          <input className="input num" inputMode="numeric" value={b.accountNumber} onChange={(e) => setB({ ...b, accountNumber: e.target.value })} />
        </Field>
        <p className="text-xs text-slate-500 sm:col-span-2">Used to match incoming transfers. Shown to staff only.</p>
        <div className="flex justify-end sm:col-span-2"><button className="btn-primary">Save</button></div>
      </form>
    </Modal>
  )
}
