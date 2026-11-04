// Turning a store order into QuickBooks Online data: the customer, the invoice lines (prices in the
// store include GST), and reading QuickBooks' errors. No network here, so it can be tested alone.

export interface OrderRow {
  id: string
  number: number
  name: string
  email: string
  phone: string
  delivery: 'pickup' | 'delivery'
  address: string
  total: number | string
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
    ...(o.delivery === 'delivery' && o.address.trim() ? { BillAddr: { Line1: o.address.trim().slice(0, 500) }, ShipAddr: { Line1: o.address.trim().slice(0, 500) } } : {}),
  }
}

/**
 * The invoice for an order. With a GST tax code, the lines are entered as GST inclusive (as the
 * store's prices are), so the invoice comes to the order's total; without one (not registered for
 * GST), the prices go in as they are.
 */
export function invoiceBody(o: OrderRow, items: ItemRow[], customerId: string, itemId: string, taxCodeId: string) {
  const lines = items.map((i) => {
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
      value: `Thanks for your order #${o.number}. ${o.delivery === 'delivery' ? `Delivery to ${o.address.trim()}.` : 'Pickup.'} We'll be in touch to confirm the details.`.slice(0, 1000),
    },
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
