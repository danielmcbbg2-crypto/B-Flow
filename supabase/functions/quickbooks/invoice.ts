// Turning a store order into QuickBooks Online data: the customer, the invoice lines (prices in the
// store include GST), and reading QuickBooks' errors. No network here, so it can be tested alone.

export interface OrderRow {
  id: string
  number: number
  name: string
  email: string
  phone: string
  delivery: 'pickup' | 'delivery' | 'same_day' | 'australia'
  address: string
  total: number | string
  /** Delivery orders: the delivery cost inc. GST and date the office confirmed before invoicing. */
  delivery_fee?: number | string | null
  delivery_note?: string
}

export interface ItemRow {
  title: string
  sku: string
  unit_price: number | string
  qty: number
  options: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** A value inside single quotes in a QuickBooks query. */
export const quoted = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** How the customer is named in QuickBooks (names must be unique there, so the email is added). */
export const displayName = (o: Pick<OrderRow, 'name' | 'email'>) => `${o.name.trim()} (${o.email.trim()})`.slice(0, 100)

export function customerBody(o: OrderRow) {
  return {
    DisplayName: displayName(o),
    PrimaryEmailAddr: { Address: o.email.trim() },
    ...(o.phone.trim() ? { PrimaryPhone: { FreeFormNumber: o.phone.trim() } } : {}),
    ...(o.delivery !== 'pickup' && o.address.trim() ? { BillAddr: { Line1: o.address.trim().slice(0, 500) }, ShipAddr: { Line1: o.address.trim().slice(0, 500) } } : {}),
  }
}

/**
 * The invoice for an order. With a GST tax code, the lines are entered as GST inclusive (as the
 * store's prices are), so the invoice comes to the order's total; without one (not registered for
 * GST), the prices go in as they are.
 */
const DELIVERY_NAME: Record<string, string> = { delivery: 'Melbourne standard delivery', same_day: 'Melbourne same-day delivery', australia: 'Australia-wide delivery' }

/** The order's total as invoiced: its items plus any confirmed delivery cost. */
export const invoiceTotal = (o: Pick<OrderRow, 'total' | 'delivery_fee'>) => round2(Number(o.total) + Number(o.delivery_fee ?? 0))

export function invoiceBody(o: OrderRow, items: ItemRow[], customerId: string, itemId: string, taxCodeId: string) {
  const fee = round2(Number(o.delivery_fee ?? 0))
  const note = (o.delivery_note ?? '').trim()
  // A confirmed delivery cost is a line of its own (GST inclusive, as the items are).
  const all: ItemRow[] =
    o.delivery !== 'pickup' && fee > 0
      ? [...items, { title: `Delivery: ${DELIVERY_NAME[o.delivery] ?? 'delivery'}`, sku: '', unit_price: fee, qty: 1, options: note }]
      : items
  const lines = all.map((i) => {
    const gross = round2(Number(i.unit_price) * i.qty)
    // GST inclusive: QuickBooks wants the line's amount before GST, and the inclusive amount beside it.
    const amount = taxCodeId ? round2(gross / 1.1) : gross
    return {
      DetailType: 'SalesItemLineDetail',
      Amount: amount,
      Description: [i.title, i.options, i.sku && `SKU ${i.sku}`].filter(Boolean).join(' · ').slice(0, 4000),
      SalesItemLineDetail: {
        ItemRef: { value: itemId },
        Qty: i.qty,
        UnitPrice: Math.round((amount / i.qty) * 1e6) / 1e6,
        ...(taxCodeId ? { TaxCodeRef: { value: taxCodeId }, TaxInclusiveAmt: gross } : {}),
      },
    }
  })
  return {
    CustomerRef: { value: customerId },
    BillEmail: { Address: o.email.trim() },
    Line: lines,
    GlobalTaxCalculation: taxCodeId ? 'TaxInclusive' : 'NotApplicable',
    AllowOnlineCreditCardPayment: true,
    AllowOnlineACHPayment: true,
    PrivateNote: `Online store order #${o.number} (${o.delivery})`,
    CustomerMemo: {
      value: `Thanks for your order #${o.number}. ${
        o.delivery === 'pickup'
          ? "Pickup: we'll contact you to arrange a time."
          : `${DELIVERY_NAME[o.delivery] ?? 'Delivery'} to ${o.address.trim()}${note ? `, ${note}` : ''}. Paying this invoice confirms the delivery cost and date.`
      }`.slice(0, 1000),
    },
  }
}

/** A quote's deposit invoice: one GST-inclusive line, due in 7 days. */
export function depositBody(q: { number: number; title: string }, amount: number, email: string, customerId: string, itemId: string, taxCodeId: string, today: string) {
  const gross = round2(amount)
  const net = taxCodeId ? round2(gross / 1.1) : gross
  const due = new Date(`${today}T00:00:00Z`)
  due.setUTCDate(due.getUTCDate() + 7)
  return {
    CustomerRef: { value: customerId },
    BillEmail: { Address: email.trim() },
    TxnDate: today,
    DueDate: due.toISOString().slice(0, 10),
    Line: [
      {
        DetailType: 'SalesItemLineDetail',
        Amount: net,
        Description: `Deposit for quote P-${q.number}: ${q.title}`.slice(0, 4000),
        SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: 1, UnitPrice: net, ...(taxCodeId ? { TaxCodeRef: { value: taxCodeId }, TaxInclusiveAmt: gross } : {}) },
      },
    ],
    GlobalTaxCalculation: taxCodeId ? 'TaxInclusive' : 'NotApplicable',
    AllowOnlineCreditCardPayment: true,
    AllowOnlineACHPayment: true,
    PrivateNote: `Deposit for quote P-${q.number}`,
    CustomerMemo: { value: `Thanks for accepting quote P-${q.number}. This deposit secures your booking; we'll be in touch to schedule the work.`.slice(0, 1000) },
  }
}

export interface EstimateQuote {
  number: number
  title: string
  quote_amount: number | string | null
  quote_valid_until: string | null
  quote_inclusions: string
  quote_exclusions: string
}

/**
 * A quote as a QuickBooks estimate: its lines at their rates excluding GST (as the quote prices
 * them), or one GST-inclusive line for a quote given as a single amount.
 */
export function estimateBody(q: EstimateQuote, items: { section: string; description: string; qty: number | string; unit: string; rate: number | string }[], customerId: string, itemId: string, taxCodeId: string, today: string) {
  const tax = taxCodeId ? { TaxCodeRef: { value: taxCodeId } } : {}
  const lines = items.length
    ? items.map((i) => {
        const qty = Number(i.qty)
        const rate = Number(i.rate)
        return {
          DetailType: 'SalesItemLineDetail',
          Amount: round2(qty * rate),
          Description: [i.section.trim(), i.description.trim()].filter(Boolean).join(': ').concat(i.unit ? ` (${i.unit})` : '').slice(0, 4000),
          SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: qty, UnitPrice: rate, ...tax },
        }
      })
    : (() => {
        const gross = round2(Number(q.quote_amount ?? 0))
        const net = taxCodeId ? round2(gross / 1.1) : gross
        return [{ DetailType: 'SalesItemLineDetail', Amount: net, Description: q.title.slice(0, 4000), SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: 1, UnitPrice: net, ...(taxCodeId ? { TaxCodeRef: { value: taxCodeId }, TaxInclusiveAmt: gross } : {}) } }]
      })()
  const memo = [q.quote_inclusions.trim() && `Included: ${q.quote_inclusions.trim()}`, q.quote_exclusions.trim() && `Not included: ${q.quote_exclusions.trim()}`].filter(Boolean).join('\n')
  return {
    CustomerRef: { value: customerId },
    TxnDate: today,
    ...(q.quote_valid_until ? { ExpirationDate: q.quote_valid_until } : {}),
    Line: lines,
    GlobalTaxCalculation: !taxCodeId ? 'NotApplicable' : items.length ? 'TaxExcluded' : 'TaxInclusive',
    PrivateNote: `Quote P-${q.number}: ${q.title}`.slice(0, 4000),
    ...(memo ? { CustomerMemo: { value: memo.slice(0, 1000) } } : {}),
  }
}

/** A readable reason from a QuickBooks error reply. */
export function qboError(body: unknown, status: number): string {
  const b = body as { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] }; error?: string; error_description?: string }
  const e = b?.Fault?.Error?.[0]
  if (e) return `QuickBooks: ${e.Message ?? 'error'}${e.Detail && e.Detail !== e.Message ? ` (${e.Detail})` : ''}`.slice(0, 400)
  if (b?.error) return `QuickBooks: ${b.error_description ?? b.error}`.slice(0, 400)
  return `QuickBooks answered ${status}`
}

/** The error code from a QuickBooks error reply (e.g. "6240" for a duplicate name). */
export const qboErrorCode = (body: unknown) => (body as { Fault?: { Error?: { code?: string }[] } })?.Fault?.Error?.[0]?.code ?? ''
