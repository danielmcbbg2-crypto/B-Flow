import { useState, type FormEvent } from 'react'
import { ExternalLink, Link2, Search, Unlink } from 'lucide-react'
import { CLOUD } from '../../lib/supabase'
import { useStore } from '../../lib/store'
import type { QuickBooksCustomer, UserAccount } from '../../lib/types'
import { fmtDate, money } from '../../lib/utils'

/**
 * A client's link to their QuickBooks customer (office): search QuickBooks and link one, or unlink.
 * Once linked, their estimates and invoices go to that customer, and its QuickBooks invoices show
 * here and in their portal.
 */
export function QuickBooksCustomerLink({ account }: { account: UserAccount }) {
  const { data, can, searchQuickBooksCustomers, linkQuickBooksCustomer } = useStore()
  const [q, setQ] = useState(account.email || account.name)
  const [results, setResults] = useState<QuickBooksCustomer[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unlinking, setUnlinking] = useState(false)
  if (!CLOUD || account.role !== 'client' || !(can('canManageInvoices') || can('canManageStore'))) return null
  const linked = account.qboCustomer
  const invoices = data.invoices.filter((i) => i.clientId === account.id && i.fromQuickBooks).sort((a, b) => b.dueDate.localeCompare(a.dueDate))

  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const search = (e: FormEvent) => {
    e.preventDefault()
    void act(async () => setResults(await searchQuickBooksCustomers(q)))
  }

  return (
    <section className="rounded-md border border-slate-200 p-4 sm:col-span-2" aria-labelledby={`qbo-${account.id}`}>
      <h3 id={`qbo-${account.id}`} className="font-bold">QuickBooks customer</h3>
      {linked ? (
        <>
          <p className="mt-1 text-sm">
            Linked to <span className="font-semibold">{linked.name}</span>. Their estimates and invoices go to this customer, and its QuickBooks invoices show in their portal.
          </p>
          {invoices.length > 0 ? (
            <ul className="mt-3 divide-y divide-slate-100 text-sm" aria-label="Their QuickBooks invoices">
              {invoices.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                  <span className="num font-semibold">{i.qbInvoiceNumber}</span>
                  <span className="text-slate-500">due {fmtDate(i.dueDate)}</span>
                  <span className="num ml-auto">{money(i.amount)}</span>
                  <span className={i.status === 'paid' ? 'text-emerald-700' : 'text-amber-700'}>{i.status === 'paid' ? 'Paid' : 'Owing'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-slate-500">No invoices in QuickBooks for them yet (they're checked every half hour).</p>
          )}
          {unlinking ? (
            <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900" role="alertdialog" aria-label="Unlink from QuickBooks">
              Unlink {account.name} from {linked.name}? Their QuickBooks invoices disappear from the portal (nothing changes in QuickBooks), and new billing goes to the customer with their email again.
              <div className="mt-2 flex gap-2">
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => void act(async () => { await linkQuickBooksCustomer(account.id, null); setUnlinking(false) })}>
                  {busy ? 'Unlinking…' : 'Yes, unlink'}
                </button>
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => setUnlinking(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-ghost mt-3" onClick={() => setUnlinking(true)}>
              <Unlink size={15} aria-hidden="true" /> Unlink
            </button>
          )}
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-600">Not linked. Their billing goes to the QuickBooks customer with their email (made if there isn't one). Link them to use a particular customer and show its invoices in their portal.</p>
          <div className="mt-3 flex gap-2" role="search">
            <label className="sr-only" htmlFor={`qbo-q-${account.id}`}>Search QuickBooks customers</label>
            <input id={`qbo-q-${account.id}`} className="input flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" onKeyDown={(e) => { if (e.key === 'Enter') search(e) }} />
            <button type="button" className="btn-ghost" disabled={busy || q.trim().length < 2} onClick={search}>
              <Search size={15} aria-hidden="true" /> {busy && !results ? 'Searching…' : 'Search QuickBooks'}
            </button>
          </div>
          {results && (
            results.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No QuickBooks customers match “{q}”.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100 text-sm" aria-label="QuickBooks customers found">
                {results.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className="min-w-0">
                      <span className="font-semibold">{c.name}</span>
                      {(c.company || c.email) && <span className="block text-xs text-slate-500">{[c.company, c.email].filter(Boolean).join(' · ')}</span>}
                    </span>
                    {c.balance > 0 && <span className="num text-xs text-amber-700">{money(c.balance)} owing</span>}
                    <button type="button" className="btn-ghost ml-auto px-3 py-1" disabled={busy} onClick={() => void act(async () => { await linkQuickBooksCustomer(account.id, c.id); setResults(null) })}>
                      <Link2 size={14} aria-hidden="true" /> Link
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  )
}

/** A client's invoices, with QuickBooks pay links for those still owing. */
export function ClientInvoices({ invoices }: { invoices: { id: string; qbInvoiceNumber: string; amount: number; status: string; dueDate: string; paidDate?: string; payLink?: string }[] }) {
  if (!invoices.length) return null
  const today = new Date().toISOString().slice(0, 10)
  const list = [...invoices].sort((a, b) => (a.status === 'paid' ? 1 : 0) - (b.status === 'paid' ? 1 : 0) || b.dueDate.localeCompare(a.dueDate))
  return (
    <section className="card mt-6 overflow-hidden" aria-labelledby="my-invoices">
      <h2 id="my-invoices" className="border-b border-slate-200 px-5 py-3 font-bold">Your invoices</h2>
      <ul className="divide-y divide-slate-100">
        {list.map((i) => {
          const overdue = i.status === 'sent' && i.dueDate < today
          return (
            <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
              <span className="num font-semibold">Invoice {i.qbInvoiceNumber}</span>
              <span className="text-slate-500">{i.status === 'paid' ? `Paid${i.paidDate ? ` ${fmtDate(i.paidDate)}` : ''}` : `Due ${fmtDate(i.dueDate)}`}</span>
              {overdue && <span className="font-semibold text-red-600">Overdue</span>}
              <span className="num ml-auto font-semibold">{money(i.amount)}</span>
              {i.status === 'sent' && i.payLink ? (
                <a className="btn-primary px-3 py-1" href={i.payLink} target="_blank" rel="noreferrer">
                  Pay <ExternalLink size={13} aria-hidden="true" />
                </a>
              ) : i.status === 'paid' ? (
                <span className="text-emerald-700">Paid</span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
