import { Fragment, useState, type FormEvent } from 'react'
import { ExternalLink, Package, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Empty, Field, Modal, PageHeader, PhotoInput, Status, Tabs, type Tone } from '../../components/ui'
import { useLookup, useStore } from '../../lib/store'
import { ORDER_STATUS_LABEL, STOCK_LABEL, STORE_CATEGORIES, SUPPLIER_STOCK_LABEL, type OrderStatus, type OptionPrice, type PriceChange, type Pricing, type Product, type ProductOption, type ProductSource, type StoreOrder, type SupplierStock } from '../../lib/types'
import { cx, fmtDate, fmtDateTime, money, uid } from '../../lib/utils'
import { ProductAssistant } from './ProductAssistant'
import { CLOUD } from '../../lib/supabase'
import { autoOptions, autoPrices, manualOptions, marginOf, optionAddOn } from '../../lib/pricing'

const ORDER_TONE: Record<OrderStatus, Tone> = { new: 'orange', confirmed: 'outline', paid: 'dark', fulfilled: 'green', cancelled: 'red' }
const PRODUCT_TONE: Record<Product['status'], Tone> = { draft: 'slate', published: 'green', archived: 'red' }
const PRODUCT_STATUS_LABEL: Record<Product['status'], string> = { draft: 'Draft', published: 'Published', archived: 'Archived' }
const SUPPLIER_TONE: Record<SupplierStock['status'], Tone> = { in_stock: 'green', low: 'orange', out_of_stock: 'red', unknown: 'slate' }

/** The supplier's stock as last read: "In stock · 12" with when, or why it couldn't be read. */
function SupplierStockBadge({ s }: { s?: SupplierStock }) {
  if (!s || (s.status === 'unknown' && !s.checkedAt)) return <span className="text-xs text-slate-400">Not checked yet</span>
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Status tone={SUPPLIER_TONE[s.status]}>{s.status === 'unknown' ? 'Couldn’t tell' : SUPPLIER_STOCK_LABEL[s.status]}{s.qty !== undefined ? ` · ${s.qty}` : ''}</Status>
    </span>
  )
}

export const EMPTY_PRODUCT = (): Product => ({
  id: uid('sp'),
  title: '',
  description: '',
  category: 'Vanities',
  brand: '',
  options: [],
  sku: '',
  price: 0,
  images: [],
  status: 'draft',
  stock: 'in_stock',
  createdAt: new Date().toISOString(),
})

/** Admin → Store: orders, products, and the AI product assistant. */
export function AdminStore() {
  const { data } = useStore()
  const newOrders = data.orders.filter((o) => o.status === 'new').length
  const [tab, setTab] = useState<'orders' | 'products' | 'assistant'>(newOrders || data.products.length ? 'orders' : 'products')
  const [editing, setEditing] = useState<Product | null>(null)
  const [notice, setNotice] = useState<string | undefined>()
  // After saving a draft from the AI finder, stay there (with its results) and say where it went.
  const [savedDraft, setSavedDraft] = useState(false)
  return (
    <>
      <PageHeader
        title="Store"
        subtitle="Orders from the online shop, your product listings, and an assistant that finds products and drafts listings."
        actions={
          <div className="flex flex-wrap gap-2">
            <a className="btn-ghost" href="#/store" target="_blank" rel="noreferrer"><ExternalLink size={15} /> View shop</a>
            <button className="btn-primary" onClick={() => setEditing(EMPTY_PRODUCT())}><Plus size={16} /> Add product</button>
          </div>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'orders', label: 'Orders', count: newOrders },
          { value: 'products', label: 'Products', count: data.products.length },
          { value: 'assistant', label: 'AI product finder' },
        ]}
      />
      {tab === 'assistant' && savedDraft && (
        <p className="mb-4 text-sm text-emerald-700">Saved. Find it under Products to check it, add photos and publish.</p>
      )}
      {tab === 'orders' ? <Orders /> : tab === 'products' ? <Products onEdit={setEditing} /> : <ProductAssistant
          onDraft={(p, notice) => {
            setNotice(notice)
            setEditing(p)
          }}
        />}
      {editing && (
        <ProductEditor
          key={editing.id}
          product={editing}
          notice={notice}
          onClose={() => {
            setEditing(null)
            setNotice(undefined)
          }}
          onSaved={() => {
            if (tab === 'assistant') setSavedDraft(true)
            else setTab('products')
            setEditing(null)
            setNotice(undefined)
          }}
        />
      )}
    </>
  )
}

function Orders() {
  const { data } = useStore()
  const lk = useLookup()
  const [openId, setOpenId] = useState<string | null>(null)
  const [show, setShow] = useState<'open' | 'all'>('open')
  const list = data.orders.filter((o) => show === 'all' || !['fulfilled', 'cancelled'].includes(o.status))
  const open = data.orders.find((o) => o.id === openId)
  return (
    <>
      <div className="mb-3 flex gap-2 text-sm">
        {(['open', 'all'] as const).map((s) => (
          <button key={s} className={cx('rounded-md px-3 py-1', show === s ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')} onClick={() => setShow(s)}>
            {s === 'open' ? 'Open orders' : 'All orders'}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty title={show === 'open' ? 'No open orders' : 'No orders yet'}>Orders placed in the shop appear here, and every admin gets an inbox message.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Order</th>
                <th className="th">Customer</th>
                <th className="th">Items</th>
                <th className="th text-right">Total</th>
                <th className="th">Status</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="td">
                    <p className="num font-semibold">#{o.number}</p>
                    <p className="text-xs text-slate-500">{fmtDate(o.createdAt)} · {o.delivery === 'pickup' ? 'Pickup' : 'Delivery'}</p>
                  </td>
                  <td className="td">
                    <p className="font-semibold">{o.name}</p>
                    <p className="text-xs text-slate-500">
                      {o.customerId ? (lk.user(o.customerId)?.role === 'provider' ? 'Service provider' : 'Client') : 'Visitor'}
                      {o.trade ? ' · trade prices' : ''}
                    </p>
                  </td>
                  <td className="td text-sm text-slate-600">{o.items.map((i) => `${i.qty} × ${i.title}${i.options ? ` (${i.options})` : ''}`).join(', ')}</td>
                  <td className="td num text-right">{money(o.total)}</td>
                  <td className="td"><Status tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Status></td>
                  <td className="td text-right"><button className="btn-ghost px-3 py-1.5" onClick={() => setOpenId(o.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <OrderDetail key={open.id} order={open} onClose={() => setOpenId(null)} />}
    </>
  )
}

function OrderDetail({ order, onClose }: { order: StoreOrder; onClose: () => void }) {
  const { update } = useStore()
  const [status, setStatus] = useState(order.status)
  const [notes, setNotes] = useState(order.adminNotes)
  const save = (e: FormEvent) => {
    e.preventDefault()
    update((d) => {
      const o = d.orders.find((x) => x.id === order.id)
      if (!o) return
      o.status = status
      o.adminNotes = notes
    })
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={`Order #${order.number}`} width="max-w-2xl">
      <dl className="grid gap-x-6 gap-y-2 border-b border-slate-200 pb-4 text-sm sm:grid-cols-2">
        {[
          ['Name', order.name],
          ['Placed', fmtDateTime(order.createdAt)],
          ['Email', <a className="underline-offset-2 hover:underline" href={`mailto:${order.email}`}>{order.email}</a>],
          ['Phone', <a className="num underline-offset-2 hover:underline" href={`tel:${order.phone.replace(/[\s()-]/g, '')}`}>{order.phone}</a>],
          ['Delivery', order.delivery === 'pickup' ? 'Pickup' : `Delivery to ${order.address}`],
          ['Pricing', order.trade ? 'Trade prices' : 'Retail prices'],
        ].map(([k, v]) => (
          <div key={k as string}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k}</dt>
            <dd className="text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>
      <table className="mt-4 w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {order.items.map((i) => (
            <tr key={i.id}>
              <td className="py-2">{i.title}{i.sku && <span className="ml-2 text-xs text-slate-500">{i.sku}</span>}{i.options && <span className="block text-xs text-slate-600">{i.options}</span>}</td>
              <td className="num py-2 text-right text-slate-600">{i.qty} × {money(i.unitPrice)}</td>
              <td className="num py-2 text-right font-semibold">{money(i.qty * i.unitPrice)}</td>
            </tr>
          ))}
          <tr>
            <td className="py-2 font-semibold" colSpan={2}>Total (inc. GST)</td>
            <td className="num py-2 text-right text-base font-bold">{money(order.total)}</td>
          </tr>
        </tbody>
      </table>
      {order.notes && <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700"><span className="font-semibold">Customer notes: </span>{order.notes}</p>}
      <form className="mt-5 grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2" onSubmit={save}>
        <Field label="Status">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as OrderStatus)}>
            {(Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]).map((s) => <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Office notes (only admins see these)" className="sm:col-span-2">
          <textarea className="input min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Invoice number, delivery date, supplier order…" />
        </Field>
        <div className="flex justify-end sm:col-span-2"><button className="btn-primary">Save order</button></div>
      </form>
    </Modal>
  )
}

/** The store's margins: what every automatically priced product is priced at. */
function PriceStructure() {
  const { data, update } = useStore()
  const [editing, setEditing] = useState(false)
  const [m, setM] = useState({ public: String(data.pricing.public), client: String(data.pricing.client), trade: String(data.pricing.trade) })
  const [error, setError] = useState<string | null>(null)
  const autoCount = data.products.filter((p) => p.source && p.source.autoPrice !== false).length
  const tiers = [
    ['public', 'Public (not signed in)'],
    ['client', 'Signed-in clients'],
    ['trade', 'Trades'],
  ] as const
  const save = (e: FormEvent) => {
    e.preventDefault()
    const next = { public: Number(m.public), client: Number(m.client), trade: Number(m.trade) }
    if (Object.values(next).some((v) => !(v >= 0 && v <= 95))) return setError('Each margin must be between 0 and 95%.')
    update((d) => {
      d.pricing = next
      // The database re-prices them too; this shows it straight away.
      for (const p of d.products) {
        const a = autoPrices(p, next)
        if (a) Object.assign(p, { price: a.price, clientPrice: a.clientPrice, tradePrice: a.tradePrice, options: autoOptions(p.options ?? [], p.source?.optionCosts ?? {}, next) })
      }
    })
    setEditing(false)
    setError(null)
  }
  return (
    <section className="card mb-5 p-4" aria-label="Price structure">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <p className="font-semibold">Price structure</p>
        {!editing &&
          tiers.map(([k, label]) => (
            <span key={k} className="text-sm text-slate-600">
              {label}: <span className="num font-semibold text-slate-900">{data.pricing[k]}%</span> margin
            </span>
          ))}
        {!editing && (
          <button type="button" className="btn-ghost ml-auto px-3 py-1 text-xs" onClick={() => setEditing(true)}>
            Change margins
          </button>
        )}
      </div>
      {editing ? (
        <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={save}>
          {tiers.map(([k, label]) => (
            <Field key={k} label={`${label} (%)`}>
              <input className="input num w-28" type="number" min="0" max="95" step="0.5" required value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value })} />
            </Field>
          ))}
          <button className="btn-primary">Save margins</button>
          <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
          {error && <p className="w-full text-sm text-red-600">{error}</p>}
          <p className="w-full text-xs text-slate-500">
            Saving re-prices every automatically priced product ({autoCount} now) straight away, and the change is kept in each product's price history.
          </p>
        </form>
      ) : (
        <p className="mt-1 text-xs text-slate-500">
          Margin on the selling price: 30% means the price is the cost ÷ 0.70, rounded up to the dollar. Prices come from the cost you enter, or the
          supplier's price (checked every 6 hours), and follow when it changes.
        </p>
      )}
    </section>
  )
}

function Products({ onEdit }: { onEdit: (p: Product) => void }) {
  const { data } = useStore()
  const [show, setShow] = useState<Product['status'] | 'all'>('all')
  const list = data.products.filter((p) => show === 'all' || p.status === show)
  return (
    <>
      <PriceStructure />
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        {(['all', 'published', 'draft', 'archived'] as const).map((s) => (
          <button key={s} className={cx('rounded-md px-3 py-1', show === s ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')} onClick={() => setShow(s)}>
            {s === 'all' ? 'All' : PRODUCT_STATUS_LABEL[s]} <span className="num">({s === 'all' ? data.products.length : data.products.filter((p) => p.status === s).length})</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty title="No products here">Add one, or let the AI product finder draft some for you to review.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Product</th>
                <th className="th">Category</th>
                <th className="th text-right">Price</th>
                <th className="th text-right">Clients</th>
                <th className="th text-right">Trade</th>
                <th className="th">Stock</th>
                <th className="th">Status</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="td">
                    <div className="flex items-center gap-3">
                      {p.images[0] ? (
                        <img src={p.images[0]} alt="" className="h-10 w-10 shrink-0 object-cover" />
                      ) : (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center bg-slate-100 text-slate-400"><Package size={18} /></span>
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold">{p.title}</p>
                        <p className="text-xs text-slate-500">{[p.brand, p.sku].filter(Boolean).join(' · ')}</p>
                      </div>
                    </div>
                  </td>
                  <td className="td text-sm text-slate-600">{p.category}</td>
                  <td className="td num text-right">{money(p.price)}</td>
                  <td className="td num text-right text-slate-600">{p.clientPrice !== undefined ? money(p.clientPrice) : '—'}</td>
                  <td className="td num text-right text-slate-600">{p.tradePrice !== undefined ? money(p.tradePrice) : '—'}</td>
                  <td className="td text-sm text-slate-600">
                    {STOCK_LABEL[p.stock]}
                    {p.source?.url && p.source.trackStock !== false && (
                      <span className="mt-1 block text-xs">Supplier: <SupplierStockBadge s={p.source.supplierStock} /></span>
                    )}
                  </td>
                  <td className="td"><Status tone={PRODUCT_TONE[p.status]}>{PRODUCT_STATUS_LABEL[p.status]}</Status></td>
                  <td className="td text-right"><button className="btn-ghost px-3 py-1.5" onClick={() => onEdit(p)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

const optNumber = (v: string) => (v.trim() === '' ? undefined : Number(v))

const addOns = (o: OptionPrice) => [o.public, o.client, o.trade].map((v) => `+${money(v ?? 0)}`).join(' / ')

/**
 * What changed in the options' prices since the entry before: "Size 900 mm: +$300 / +$280 / +$254
 * (cost $210)" for each choice that's new or different, "Oak: removed" for one that's gone. The
 * first entry lists every choice that adds something.
 */
export function optionChanges(h: PriceChange, before?: PriceChange): string[] {
  const key = (o: OptionPrice) => `${o.option}\u0000${o.choice}`
  const was = new Map((before?.options ?? []).map((o) => [key(o), o]))
  const out: string[] = []
  for (const o of h.options) {
    const old = was.get(key(o))
    was.delete(key(o))
    const z = (v?: number) => v ?? 0
    const same = old && z(old.cost) === z(o.cost) && z(old.public) === z(o.public) && z(old.client) === z(o.client) && z(old.trade) === z(o.trade)
    const nothing = !z(o.cost) && !z(o.public) && !z(o.client) && !z(o.trade)
    if (same || (!before && nothing)) continue
    out.push(`${o.option} ${o.choice}: ${addOns(o)}${o.cost !== undefined ? ` (cost ${money(o.cost)})` : ''}`)
  }
  if (before) for (const o of was.values()) out.push(`${o.option} ${o.choice}: removed`)
  return out
}

/** An option being edited: what each value adds is kept as typed (cost or price, by value id). */
interface OptionDraft {
  options: ProductOption[]
  costs: Record<string, string>
  prices: Record<string, string>
}

/**
 * The product's options (e.g. Size, Colour) and their values. With automatic pricing each value
 * has an extra cost, and what it adds for each tier follows from the margins; priced by hand, each
 * value has an extra price, the same for everyone.
 */
function OptionsEditor({ draft, onChange, auto, pricing }: { draft: OptionDraft; onChange: (d: OptionDraft) => void; auto: boolean; pricing: Pricing }) {
  const { options } = draft
  const setOptions = (next: ProductOption[]) => onChange({ ...draft, options: next })
  const setOption = (id: string, patch: Partial<ProductOption>) => setOptions(options.map((g) => (g.id === id ? { ...g, ...patch } : g)))
  const newValue = () => ({ id: uid('val'), label: '', price: 0, available: true })
  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-4 sm:col-span-2" aria-label="Options">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Options</p>
          <p className="text-xs text-slate-500">
            Choices the customer makes, like size or colour.{' '}
            {auto
              ? 'Enter what each choice costs you extra; it\u2019s added to the price at your margins.'
              : 'Enter what each choice adds to the price (the same for everyone).'}
          </p>
        </div>
        {options.length < 3 && (
          <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => setOptions([...options, { id: uid('opt'), name: '', values: [newValue()] }])}>
            <Plus size={14} /> Add option
          </button>
        )}
      </div>
      {options.map((g, gi) => (
        <div key={g.id} className="space-y-2 rounded-md bg-slate-50 p-3">
          <div className="flex items-end gap-2">
            <Field label={`Option ${gi + 1}`} className="flex-1">
              <input className="input py-1" placeholder="e.g. Size" value={g.name} onChange={(e) => setOption(g.id, { name: e.target.value })} />
            </Field>
            <button type="button" className="mb-1.5 text-slate-500 hover:text-red-600" aria-label={`Remove option ${g.name || gi + 1}`} onClick={() => setOptions(options.filter((x) => x.id !== g.id))}>
              <Trash2 size={16} />
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="pb-1 font-medium">Choice</th>
                <th className="w-32 pb-1 font-medium">{auto ? 'Extra cost' : 'Extra price'}</th>
                {auto && <th className="pb-1 font-medium">Adds (public / clients / trades)</th>}
                <th className="w-20 pb-1 font-medium">Available</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {g.values.map((v) => {
                const typed = (auto ? draft.costs : draft.prices)[v.id] ?? ''
                const n = Number(typed)
                return (
                  <tr key={v.id}>
                    <td className="py-1 pr-2">
                      <input className="input py-1" aria-label="Choice" placeholder="e.g. 900 mm" value={v.label} onChange={(e) => setOption(g.id, { values: g.values.map((x) => (x.id === v.id ? { ...x, label: e.target.value } : x)) })} />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className="input num py-1"
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label={auto ? 'Extra cost' : 'Extra price'}
                        placeholder="0"
                        value={typed}
                        onChange={(e) => onChange({ ...draft, [auto ? 'costs' : 'prices']: { ...(auto ? draft.costs : draft.prices), [v.id]: e.target.value } })}
                      />
                    </td>
                    {auto && (
                      <td className="num py-1 pr-2 text-xs text-slate-600">
                        {n > 0 ? `+${money(optionAddOn(n, pricing.public))} / +${money(optionAddOn(n, pricing.client))} / +${money(optionAddOn(n, pricing.trade))}` : '—'}
                      </td>
                    )}
                    <td className="py-1 pr-2">
                      <input type="checkbox" className="h-4 w-4 accent-slate-900" aria-label={`${v.label || 'Choice'} available`} checked={v.available} onChange={(e) => setOption(g.id, { values: g.values.map((x) => (x.id === v.id ? { ...x, available: e.target.checked } : x)) })} />
                    </td>
                    <td className="py-1">
                      {g.values.length > 1 && (
                        <button type="button" className="text-slate-500 hover:text-red-600" aria-label={`Remove ${v.label || 'choice'}`} onClick={() => setOption(g.id, { values: g.values.filter((x) => x.id !== v.id) })}>
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {g.values.length < 30 && (
            <button type="button" className="text-xs font-semibold text-slate-700 underline" onClick={() => setOption(g.id, { values: [...g.values, newValue()] })}>
              Add a choice
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export function ProductEditor({ product, notice, onClose, onSaved }: { product: Product; notice?: string; onClose: () => void; onSaved: () => void }) {
  const { data, update } = useStore()
  const isNew = !data.products.some((p) => p.id === product.id)
  const [p, setP] = useState(product)
  const [nums, setNums] = useState({
    price: product.price ? String(product.price) : '',
    tradePrice: product.tradePrice !== undefined ? String(product.tradePrice) : '',
    clientPrice: product.clientPrice !== undefined ? String(product.clientPrice) : '',
    cost: product.source?.cost !== undefined ? String(product.source.cost) : '',
  })
  const [autoPrice, setAutoPrice] = useState(product.source?.autoPrice ?? true)
  const [optionDraft, setOptionDraft] = useState<OptionDraft>(() => ({
    options: product.options ?? [],
    costs: Object.fromEntries(Object.entries(product.source?.optionCosts ?? {}).map(([k, v]) => [k, String(v)])),
    prices: Object.fromEntries((product.options ?? []).flatMap((g) => g.values.map((v) => [v.id, v.price ? String(v.price) : '']))),
  }))
  const [source, setSource] = useState({
    supplier: product.source?.supplier ?? '',
    url: product.source?.url ?? '',
    notes: product.source?.notes ?? '',
    trackStock: product.source?.trackStock ?? true,
    outOfStockAs: product.source?.outOfStockAs ?? ('out_of_stock' as NonNullable<ProductSource['outOfStockAs']>),
  })
  const { checkSupplierStock } = useStore()
  const saved = data.products.find((x) => x.id === product.id)
  const [reading, setReading] = useState<SupplierStock | undefined>(product.source?.supplierStock)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  // Checks the saved supplier link now (a changed link is checked once the product is saved).
  const checkNow = async () => {
    setChecking(true)
    setCheckError(null)
    try {
      setReading(await checkSupplierStock({ productId: product.id }))
    } catch (err) {
      setCheckError((err as Error).message)
    } finally {
      setChecking(false)
    }
  }
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Product>) => setP({ ...p, ...patch })
  const cost = optNumber(nums.cost)
  // The price structure: with automatic pricing and something to base it on (the cost entered, or
  // the supplier's price as last read), the three prices come from the store's margins.
  const auto = autoPrices(
    { source: { supplier: '', url: '', notes: '', autoPrice, cost, supplierStock: product.source?.url === source.url.trim() ? reading : undefined } },
    data.pricing,
  )
  const price = auto ? auto.price : Number(nums.price)
  const priceText = (v: string, a?: number) => (auto && a !== undefined ? String(a) : v)
  const allHistory = data.priceHistory.filter((h) => h.productId === product.id)
  const history = allHistory.slice(0, 8)

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!auto && (!(price >= 0) || nums.price.trim() === '')) return setError('Enter the price, or a cost to price it automatically.')
    const tradePrice = auto ? auto.tradePrice : optNumber(nums.tradePrice)
    const clientPrice = auto ? auto.clientPrice : optNumber(nums.clientPrice)
    if (tradePrice !== undefined && !(tradePrice >= 0)) return setError('Enter a valid trade price, or leave it empty.')
    if (clientPrice !== undefined && !(clientPrice >= 0)) return setError('Enter a valid client price, or leave it empty.')
    if (cost !== undefined && !(cost >= 0)) return setError('Enter a valid cost, or leave it empty.')
    if (p.status === 'published' && !p.description.trim()) return setError('Add a description before publishing.')
    const opts = optionDraft.options.map((g) => ({ ...g, name: g.name.trim(), values: g.values.map((v) => ({ ...v, label: v.label.trim() })) }))
    if (opts.some((g) => !g.name || g.values.some((v) => !v.label))) return setError('Give each option a name and each choice a label (or remove the empty ones).')
    if (opts.some((g) => g.values.every((v) => !v.available))) return setError('Each option needs at least one available choice.')
    const amount = (m: Record<string, string>, id: string) => (m[id]?.trim() ? Number(m[id]) : 0)
    if (opts.some((g) => g.values.some((v) => !(amount(auto ? optionDraft.costs : optionDraft.prices, v.id) >= 0)))) return setError('Enter each extra amount as a number (or leave it empty).')
    const optionCosts = Object.fromEntries(opts.flatMap((g) => g.values.filter((v) => amount(optionDraft.costs, v.id) > 0).map((v) => [v.id, amount(optionDraft.costs, v.id)])))
    // The database works the add-ons out again; this shows them straight away.
    const options = auto ? autoOptions(opts, optionCosts, data.pricing) : manualOptions(opts.map((g) => ({ ...g, values: g.values.map((v) => ({ ...v, price: amount(optionDraft.prices, v.id) })) })))
    const hasSource = !!(source.supplier.trim() || source.url.trim() || source.notes.trim() || cost !== undefined)
    const next: Product = {
      ...p,
      title: p.title.trim(),
      options,
      price,
      tradePrice,
      clientPrice,
      source: hasSource
        ? {
            supplier: source.supplier.trim(),
            url: source.url.trim(),
            cost,
            notes: source.notes.trim(),
            autoPrice,
            trackStock: source.trackStock,
            outOfStockAs: source.outOfStockAs,
            optionCosts,
            supplierStock: product.source?.url === source.url.trim() ? reading : undefined,
          }
        : undefined,
    }
    update((d) => {
      d.products = isNew ? [...d.products, next] : d.products.map((x) => (x.id === next.id ? next : x))
    })
    // A new supplier link is checked straight away (once saved): its price is what automatic pricing
    // works from, for the product and its options.
    if (CLOUD && next.source?.url && (isNew || saved?.source?.url !== next.source.url)) void checkSupplierStock({ productId: next.id }).catch(() => {})
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'Add product' : `Edit ${product.title}`} width="max-w-3xl">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
        {notice && <p role="alert" className="border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2">{notice}</p>}
        <Field label="Title" className="sm:col-span-2"><input className="input" required value={p.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Category">
          <select className="input" value={p.category} onChange={(e) => set({ category: e.target.value })}>
            {STORE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Brand"><input className="input" value={p.brand} onChange={(e) => set({ brand: e.target.value })} /></Field>
        <Field label="SKU / model"><input className="input" value={p.sku} onChange={(e) => set({ sku: e.target.value })} /></Field>
        <Field label="Stock">
          <select className="input" value={p.stock} onChange={(e) => set({ stock: e.target.value as Product['stock'] })}>
            {(Object.keys(STOCK_LABEL) as Product['stock'][]).map((s) => <option key={s} value={s}>{STOCK_LABEL[s]}</option>)}
          </select>
        </Field>
        <div className="grid gap-3 rounded-md border border-slate-200 p-4 sm:col-span-2 sm:grid-cols-3">
          <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-3">
            <p className="text-sm font-semibold">Prices (AUD, inc. GST)</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-slate-900" checked={autoPrice} onChange={(e) => setAutoPrice(e.target.checked)} />
              Price automatically from the cost
            </label>
          </div>
          <Field label={`Public price${auto ? ` (${data.pricing.public}%)` : ''}`}>
            <input className="input num disabled:bg-slate-50" type="number" min="0" step="0.01" required={!auto} disabled={!!auto} value={priceText(nums.price, auto?.price)} onChange={(e) => setNums({ ...nums, price: e.target.value })} />
          </Field>
          <Field label={`Client price${auto ? ` (${data.pricing.client}%)` : ' (optional)'}`}>
            <input className="input num disabled:bg-slate-50" type="number" min="0" step="0.01" disabled={!!auto} value={priceText(nums.clientPrice, auto?.clientPrice)} onChange={(e) => setNums({ ...nums, clientPrice: e.target.value })} />
          </Field>
          <Field label={`Trade price${auto ? ` (${data.pricing.trade}%)` : ' (optional)'}`}>
            <input className="input num disabled:bg-slate-50" type="number" min="0" step="0.01" disabled={!!auto} value={priceText(nums.tradePrice, auto?.tradePrice)} onChange={(e) => setNums({ ...nums, tradePrice: e.target.value })} />
          </Field>
          <p className="text-xs text-slate-500 sm:col-span-3">
            {auto
              ? `Set by the price structure from ${cost !== undefined ? 'your cost' : 'the supplier’s price'} of ${money(auto.basis)}, rounded up to the dollar. They follow when ${cost !== undefined ? 'the cost' : 'the supplier’s price'} changes.`
              : autoPrice
                ? 'Enter the cost below (or check the supplier’s stock to read their price) and the prices are set at your margins.'
                : 'Set by hand. Tick the box to set them from the cost at your margins instead.'}
            {!auto && cost !== undefined && price > 0 && ` Public margin on the cost: ${marginOf(price, cost)}%.`} Client prices are for signed-in clients; trade prices for signed-in trades.
          </p>
        </div>
        <OptionsEditor draft={optionDraft} onChange={setOptionDraft} auto={!!auto} pricing={data.pricing} />
        <Field label="Description" className="sm:col-span-2">
          <textarea className="input min-h-[120px]" value={p.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <span className="label">Photos (first is the main one)</span>
          <PhotoInput value={p.images} onChange={(images) => set({ images })} max={8} />
          <p className="mt-1 text-xs text-slate-500">Use your own photos or ones the supplier lets you use.</p>
        </div>
        <fieldset className="grid gap-4 rounded-md border border-slate-200 p-4 sm:col-span-2 sm:grid-cols-2">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Office only</legend>
          <Field label="Supplier"><input className="input" value={source.supplier} onChange={(e) => setSource({ ...source, supplier: e.target.value })} /></Field>
          <Field label="Cost (AUD, inc. GST)">
            <input className="input num" type="number" min="0" step="0.01" value={nums.cost} onChange={(e) => setNums({ ...nums, cost: e.target.value })} />
          </Field>
          <Field label="Supplier link" className="sm:col-span-2"><input className="input" type="url" value={source.url} onChange={(e) => setSource({ ...source, url: e.target.value })} /></Field>
          {source.url.trim() && (
            <div className="space-y-2 rounded-md bg-slate-50 p-3 text-sm sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">Supplier stock</p>
                {saved?.source?.url && saved.source.url === source.url.trim() ? (
                  <button type="button" className="btn-ghost px-3 py-1 text-xs" disabled={checking} onClick={() => void checkNow()}>
                    <RefreshCw size={13} className={checking ? 'animate-spin' : ''} /> {checking ? 'Checking…' : 'Check now'}
                  </button>
                ) : (
                  <span className="text-xs text-slate-500">Checked once you save</span>
                )}
              </div>
              {product.source?.url === source.url.trim() && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                  <SupplierStockBadge s={reading} />
                  {reading?.price !== undefined && <span className="num">Their price {money(reading.price)}</span>}
                  {reading?.checkedAt && <span>Checked {fmtDateTime(reading.checkedAt)}</span>}
                  {reading?.note && <span className="w-full text-slate-500">{reading.note}</span>}
                </div>
              )}
              {checkError && <p className="text-xs text-red-600">{checkError}</p>}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-slate-900" checked={source.trackStock} onChange={(e) => setSource({ ...source, trackStock: e.target.checked })} />
                Check the supplier's page every 6 hours and update this listing
              </label>
              {source.trackStock && (
                <label className="flex flex-wrap items-center gap-2 text-sm">
                  When they run out, show
                  <select className="input w-auto py-1" aria-label="When they run out, show" value={source.outOfStockAs} onChange={(e) => setSource({ ...source, outOfStockAs: e.target.value as typeof source.outOfStockAs })}>
                    <option value="out_of_stock">Out of stock</option>
                    <option value="to_order">To order</option>
                  </select>
                  <span className="text-xs text-slate-500">(and switch back when they have it again)</span>
                </label>
              )}
            </div>
          )}
          <Field label="Notes" className="sm:col-span-2"><textarea className="input min-h-[60px]" value={source.notes} onChange={(e) => setSource({ ...source, notes: e.target.value })} /></Field>
          {cost !== undefined && price > 0 && (
            <p className="text-xs text-slate-500 sm:col-span-2">
              Margin at retail: <span className="num font-semibold text-slate-900">{money(price - cost)}</span> ({Math.round(((price - cost) / price) * 100)}%)
            </p>
          )}
          {history.length > 0 && (
            <div className="sm:col-span-2">
              <p className="text-sm font-semibold">Price history</p>
              <table className="mt-1 w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1 pr-2 font-medium">When</th>
                    <th className="py-1 pr-2 font-medium">Why</th>
                    <th className="py-1 pr-2 text-right font-medium">Cost</th>
                    <th className="py-1 pr-2 text-right font-medium">Public</th>
                    <th className="py-1 pr-2 text-right font-medium">Clients</th>
                    <th className="py-1 text-right font-medium">Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => {
                    const changes = optionChanges(h, allHistory[allHistory.indexOf(h) + 1])
                    return (
                      <Fragment key={h.id}>
                        <tr className={changes.length ? '' : 'border-b border-slate-100'}>
                          <td className="num py-1 pr-2 text-slate-600">{fmtDateTime(h.at)}</td>
                          <td className="py-1 pr-2">{h.reason}{h.changedBy ? ` (${data.users.find((u) => u.id === h.changedBy)?.name.split(' ')[0] ?? 'office'})` : ''}</td>
                          {[h.costBasis, h.publicPrice, h.clientPrice, h.tradePrice].map((v, k) => (
                            <td key={k} className="num py-1 pr-2 text-right last:pr-0">{v !== undefined ? money(v) : '—'}</td>
                          ))}
                        </tr>
                        {changes.length > 0 && (
                          <tr className="border-b border-slate-100" aria-label={`Option prices ${i + 1}`}>
                            <td />
                            <td colSpan={5} className="pb-1.5 text-slate-600">
                              {changes.map((c) => <span key={c} className="mr-3 inline-block">{c}</span>)}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </fieldset>
        <Field label="Status">
          <select className="input" value={p.status} onChange={(e) => set({ status: e.target.value as Product['status'] })}>
            <option value="draft">Draft: only admins see it</option>
            <option value="published">Published: in the shop</option>
            <option value="archived">Archived: hidden</option>
          </select>
        </Field>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="flex items-end justify-end sm:col-span-1">
          <button className="btn-primary">{isNew ? 'Add product' : 'Save product'}</button>
        </div>
      </form>
    </Modal>
  )
}
