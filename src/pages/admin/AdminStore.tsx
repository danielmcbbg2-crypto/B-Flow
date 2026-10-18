import { useState, type FormEvent } from 'react'
import { ExternalLink, Package, Plus } from 'lucide-react'
import { Empty, Field, Modal, PageHeader, PhotoInput, Status, Tabs, type Tone } from '../../components/ui'
import { useLookup, useStore } from '../../lib/store'
import { ORDER_STATUS_LABEL, STOCK_LABEL, STORE_CATEGORIES, type OrderStatus, type Product, type StoreOrder } from '../../lib/types'
import { cx, fmtDate, fmtDateTime, money, uid } from '../../lib/utils'
import { ProductAssistant } from './ProductAssistant'

const ORDER_TONE: Record<OrderStatus, Tone> = { new: 'orange', confirmed: 'outline', paid: 'dark', fulfilled: 'green', cancelled: 'red' }
const PRODUCT_TONE: Record<Product['status'], Tone> = { draft: 'slate', published: 'green', archived: 'red' }
const PRODUCT_STATUS_LABEL: Record<Product['status'], string> = { draft: 'Draft', published: 'Published', archived: 'Archived' }

export const EMPTY_PRODUCT = (): Product => ({
  id: uid('sp'),
  title: '',
  description: '',
  category: 'Vanities',
  brand: '',
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
      {tab === 'orders' ? <Orders /> : tab === 'products' ? <Products onEdit={setEditing} /> : <ProductAssistant onDraft={setEditing} />}
      {editing && <ProductEditor key={editing.id} product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setTab('products') }} />}
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
                  <td className="td text-sm text-slate-600">{o.items.map((i) => `${i.qty} × ${i.title}`).join(', ')}</td>
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
              <td className="py-2">{i.title}{i.sku && <span className="ml-2 text-xs text-slate-500">{i.sku}</span>}</td>
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

function Products({ onEdit }: { onEdit: (p: Product) => void }) {
  const { data } = useStore()
  const [show, setShow] = useState<Product['status'] | 'all'>('all')
  const list = data.products.filter((p) => show === 'all' || p.status === show)
  return (
    <>
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
                  <td className="td num text-right text-slate-600">{p.tradePrice !== undefined ? money(p.tradePrice) : '—'}</td>
                  <td className="td text-sm text-slate-600">{STOCK_LABEL[p.stock]}</td>
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

export function ProductEditor({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: () => void }) {
  const { data, update } = useStore()
  const isNew = !data.products.some((p) => p.id === product.id)
  const [p, setP] = useState(product)
  const [nums, setNums] = useState({
    price: product.price ? String(product.price) : '',
    tradePrice: product.tradePrice !== undefined ? String(product.tradePrice) : '',
    cost: product.source?.cost !== undefined ? String(product.source.cost) : '',
  })
  const [source, setSource] = useState({ supplier: product.source?.supplier ?? '', url: product.source?.url ?? '', notes: product.source?.notes ?? '' })
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Product>) => setP({ ...p, ...patch })
  const price = Number(nums.price)
  const cost = optNumber(nums.cost)

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!(price >= 0) || nums.price.trim() === '') return setError('Enter the price.')
    const tradePrice = optNumber(nums.tradePrice)
    if (tradePrice !== undefined && !(tradePrice >= 0)) return setError('Enter a valid trade price, or leave it empty.')
    if (cost !== undefined && !(cost >= 0)) return setError('Enter a valid cost, or leave it empty.')
    if (p.status === 'published' && !p.description.trim()) return setError('Add a description before publishing.')
    const hasSource = !!(source.supplier.trim() || source.url.trim() || source.notes.trim() || cost !== undefined)
    const next: Product = {
      ...p,
      title: p.title.trim(),
      price,
      tradePrice,
      source: hasSource ? { supplier: source.supplier.trim(), url: source.url.trim(), cost, notes: source.notes.trim() } : undefined,
    }
    update((d) => {
      d.products = isNew ? [...d.products, next] : d.products.map((x) => (x.id === next.id ? next : x))
    })
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'Add product' : `Edit ${product.title}`} width="max-w-3xl">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
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
        <Field label="Price (AUD, inc. GST)">
          <input className="input num" type="number" min="0" step="0.01" required value={nums.price} onChange={(e) => setNums({ ...nums, price: e.target.value })} />
        </Field>
        <Field label="Trade price (optional)">
          <input className="input num" type="number" min="0" step="0.01" value={nums.tradePrice} onChange={(e) => setNums({ ...nums, tradePrice: e.target.value })} />
        </Field>
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
          <Field label="Notes" className="sm:col-span-2"><textarea className="input min-h-[60px]" value={source.notes} onChange={(e) => setSource({ ...source, notes: e.target.value })} /></Field>
          {cost !== undefined && price > 0 && (
            <p className="text-xs text-slate-500 sm:col-span-2">
              Margin at retail: <span className="num font-semibold text-slate-900">{money(price - cost)}</span> ({Math.round(((price - cost) / price) * 100)}%)
            </p>
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
