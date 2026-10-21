import { contractTotal, GST_RATE, itemsSubtotal, lineTotal, paymentAmounts, quoteTotal, sections, withGst } from '../lib/quote'
import { QUOTE_ITEM_KIND_LABEL, type Project, type QuickBooksInvoice } from '../lib/types'
import { fmtDate, money } from '../lib/utils'

const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''))

/** An itemised quote as the client sees it: sections, lines, subtotal, GST and total, and its terms. */
export function QuoteBreakdown({ p }: { p: Project }) {
  const subtotal = itemsSubtotal(p.quoteItems)
  return (
    <div className="space-y-4 text-sm">
      {p.quoteItems.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full min-w-[520px]">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Item</th>
                <th className="px-3 py-2 text-right font-semibold">Qty</th>
                <th className="px-3 py-2 text-right font-semibold">Rate</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            {sections(p.quoteItems).map((g) => (
              <tbody key={g.name} className="border-t border-slate-200">
                <tr className="bg-slate-50/60">
                  <th colSpan={3} className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">{g.name}</th>
                  <td className="num px-3 py-1.5 text-right text-xs font-semibold text-slate-600">{money(g.subtotal)}</td>
                </tr>
                {g.items.map((i) => (
                  <tr key={i.id} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">
                      {i.description}
                      <span className="ml-1.5 text-xs text-slate-400">{QUOTE_ITEM_KIND_LABEL[i.kind]}</span>
                    </td>
                    <td className="num whitespace-nowrap px-3 py-1.5 text-right text-slate-600">{qtyText(i.qty)}{i.unit ? ` ${i.unit}` : ''}</td>
                    <td className="num px-3 py-1.5 text-right text-slate-600">{money(i.rate)}</td>
                    <td className="num px-3 py-1.5 text-right">{money(lineTotal(i))}</td>
                  </tr>
                ))}
              </tbody>
            ))}
            <tfoot className="border-t border-slate-200">
              <tr>
                <td colSpan={3} className="px-3 py-1.5 text-right text-slate-600">Subtotal (ex GST)</td>
                <td className="num px-3 py-1.5 text-right">{money(subtotal)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="px-3 py-1.5 text-right text-slate-600">GST ({Math.round(GST_RATE * 100)}%)</td>
                <td className="num px-3 py-1.5 text-right">{money(withGst(subtotal) - subtotal)}</td>
              </tr>
              <tr className="font-bold">
                <td colSpan={3} className="px-3 py-2 text-right">Total (inc GST)</td>
                <td className="num px-3 py-2 text-right">{money(quoteTotal(p))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {(p.quoteInclusions || p.quoteExclusions || p.quoteValidUntil) && (
        <dl className="grid gap-3 sm:grid-cols-2">
          {p.quoteInclusions && (
            <div>
              <dt className="text-xs font-semibold text-slate-500">Included</dt>
              <dd className="whitespace-pre-wrap text-slate-700">{p.quoteInclusions}</dd>
            </div>
          )}
          {p.quoteExclusions && (
            <div>
              <dt className="text-xs font-semibold text-slate-500">Not included</dt>
              <dd className="whitespace-pre-wrap text-slate-700">{p.quoteExclusions}</dd>
            </div>
          )}
          {p.quoteValidUntil && (
            <div>
              <dt className="text-xs font-semibold text-slate-500">Quote valid until</dt>
              <dd className="num text-slate-700">{fmtDate(p.quoteValidUntil)}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}

/** Payment stages with their amounts and where each one is up to. */
export function PaymentSchedule({ p, invoices }: { p: Project; invoices: QuickBooksInvoice[] }) {
  const amounts = paymentAmounts(p, invoices)
  if (p.payments.length === 0) return null
  return (
    <ol className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
      {p.payments.map((s) => {
        const inv = s.invoiceId ? invoices.find((i) => i.id === s.invoiceId) : undefined
        const milestone = p.milestones.find((m) => m.id === s.milestoneId)
        return (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <p className="font-medium">{s.title}</p>
              <p className="text-xs text-slate-500">
                {s.basis === 'percent' ? `${s.value}% of the quote` : s.basis === 'balance' ? 'Balance of the contract' : 'Fixed amount'}
                {milestone ? ` · when “${milestone.title}” is done` : ''}
              </p>
            </div>
            <div className="text-right">
              <p className="num font-semibold">{money(amounts.get(s.id) ?? 0)}</p>
              <p className="text-xs text-slate-500">
                {!inv ? 'Upcoming' : inv.status === 'paid' ? `Paid · ${inv.qbInvoiceNumber}` : inv.status === 'sent' ? `Invoiced · ${inv.qbInvoiceNumber}` : 'Invoice being prepared'}
              </p>
            </div>
          </li>
        )
      })}
      <li className="flex justify-between px-3 py-2 text-xs text-slate-500">
        <span>Contract total (quote and approved variations, inc GST)</span>
        <span className="num font-semibold text-slate-700">{money(contractTotal(p))}</span>
      </li>
    </ol>
  )
}
