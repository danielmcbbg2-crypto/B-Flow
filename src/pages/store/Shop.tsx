import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, CheckCircle2, Minus, Package, Plus, Search, ShoppingCart, Trash2 } from 'lucide-react'
import { Empty, Field, Modal, PageHeader, Status, type Tone } from '../../components/ui'
import { Logo } from '../../components/Logo'
import { SignInModal } from '../../components/SignInModal'
import { useStore } from '../../lib/store'
import { useCart } from '../../lib/cart'
import { navigate } from '../../lib/router'
import { ORDER_STATUS_LABEL, STOCK_LABEL, STORE_CATEGORIES, type OrderStatus, type Product, type UserAccount } from '../../lib/types'
import { cx, fmtDate, money } from '../../lib/utils'

const STOCK_TONE: Record<Product['stock'], Tone> = { in_stock: 'green', to_order: 'outline', out_of_stock: 'red' }
const ORDER_TONE: Record<OrderStatus, Tone> = { new: 'orange', confirmed: 'outline', paid: 'dark', fulfilled: 'green', cancelled: 'red' }

/** Signed-in service providers pay the trade price where one is set. */
export function unitPrice(p: Product, user: UserAccount | null): number {
  return user?.role === 'provider' && p.tradePrice !== undefined ? p.tradePrice : p.price
}

/** Published products: from the signed-in person's data, or loaded for a visitor. */
function useCatalog() {
  const { data, user, loadCatalog, phase } = useStore()
  const [visitor, setVisitor] = useState<{ products: Product[]; error?: string } | null>(null)
  useEffect(() => {
    if (user || phase !== 'ready') return
    let live = true
    loadCatalog()
      .then((products) => live && setVisitor({ products }))
      .catch((e: Error) => live && setVisitor({ products: [], error: e.message }))
    return () => {
      live = false
    }
  }, [user, phase, loadCatalog])
  if (user) return { products: data.products.filter((p) => p.status === 'published'), loading: false, error: undefined }
  return { products: visitor?.products ?? [], loading: !visitor, error: visitor?.error }
}

function Price({ p, user, large }: { p: Product; user: UserAccount | null; large?: boolean }) {
  const price = unitPrice(p, user)
  return (
    <span className={cx('num', large ? 'text-2xl font-bold' : 'font-semibold')}>
      {money(price)}
      {price !== p.price && (
        <span className="ml-2 align-middle text-xs font-normal text-slate-500">
          Trade price <span className="line-through">{money(p.price)}</span>
        </span>
      )}
    </span>
  )
}

function ProductImage({ p, className }: { p: Product; className?: string }) {
  return p.images[0] ? (
    <img src={p.images[0]} alt="" className={cx('object-cover', className)} loading="lazy" />
  ) : (
    <div className={cx('flex items-center justify-center bg-slate-100 text-slate-400', className)} aria-hidden="true">
      <Package size={40} strokeWidth={1.25} />
    </div>
  )
}

/**
 * The shop: browse, product details, cart and checkout. Used on the public store page and in the
 * client and service provider portals.
 */
export function Shop({ portal }: { portal?: boolean }) {
  const { user, actingAs } = useStore()
  const { products, loading, error } = useCatalog()
  const cart = useCart()
  const [view, setView] = useState<'browse' | 'cart'>('browse')
  const [category, setCategory] = useState('All')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Product | null>(null)
  const [placed, setPlaced] = useState<{ number: number; total: number } | null>(null)

  const categories = useMemo(() => STORE_CATEGORIES.filter((c) => products.some((p) => p.category === c)), [products])
  const q = query.trim().toLowerCase()
  const shown = products.filter(
    (p) => (category === 'All' || p.category === category) && (!q || `${p.title} ${p.brand} ${p.sku} ${p.description}`.toLowerCase().includes(q)),
  )

  if (placed) {
    return (
      <div className="card mx-auto max-w-lg px-6 py-10 text-center">
        <CheckCircle2 size={36} className="mx-auto text-emerald-600" />
        <h2 className="mt-3 text-xl font-bold">Order #{placed.number} received</h2>
        <p className="mt-2 text-sm text-slate-600">
          Total <span className="num font-semibold text-slate-900">{money(placed.total)}</span> inc. GST. Nothing has been charged: we'll check
          availability and get back to you with an invoice and payment details.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button className="btn-primary" onClick={() => { setPlaced(null); setView('browse') }}>Keep shopping</button>
        </div>
      </div>
    )
  }

  const header = (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {view === 'cart' ? (
        <button className="btn-ghost" onClick={() => setView('browse')}>
          <ArrowLeft size={16} /> Back to products
        </button>
      ) : (
        <>
          <label className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input className="input pl-9" placeholder="Search products" aria-label="Search products" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <select className="input w-auto" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option>All</option>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
        </>
      )}
      <button className={cx('ml-auto', cart.count ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('cart')}>
        <ShoppingCart size={16} /> Cart{cart.count ? <span className="num">({cart.count})</span> : null}
      </button>
    </div>
  )

  return (
    <>
      {header}
      {view === 'cart' ? (
        <Checkout cart={cart} products={products} portal={portal} acting={!!actingAs} onPlaced={(r) => { cart.clear(); setPlaced(r) }} />
      ) : loading ? (
        <p className="text-sm text-slate-500">Loading products…</p>
      ) : error ? (
        <Empty title="The shop couldn't load">{error}</Empty>
      ) : shown.length === 0 ? (
        <Empty title={products.length ? 'Nothing matches' : 'No products yet'}>{products.length ? 'Try another search or category.' : 'Check back soon.'}</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((p) => (
            <article key={p.id} className="card flex flex-col overflow-hidden">
              <button className="text-left" onClick={() => setOpen(p)} aria-label={`View ${p.title}`}>
                <ProductImage p={p} className="aspect-[4/3] w-full" />
              </button>
              <div className="flex flex-1 flex-col p-4">
                <p className="text-xs text-slate-500">{[p.category, p.brand].filter(Boolean).join(' · ')}</p>
                <button className="mt-1 text-left font-semibold leading-snug hover:underline" onClick={() => setOpen(p)}>{p.title}</button>
                <div className="mt-2"><Status tone={STOCK_TONE[p.stock]}>{STOCK_LABEL[p.stock]}</Status></div>
                <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                  <Price p={p} user={user} />
                  <button className="btn-ghost px-3 py-1.5" disabled={p.stock === 'out_of_stock'} onClick={() => cart.add(p.id)} aria-label={`Add ${p.title} to cart`}>
                    <Plus size={15} /> Add
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {open && (
        <Modal open onClose={() => setOpen(null)} title={open.title} width="max-w-3xl">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <ProductImage p={open} className="aspect-[4/3] w-full" />
              {open.images.length > 1 && (
                <div className="grid grid-cols-4 gap-2">
                  {open.images.slice(1).map((src) => <img key={src} src={src} alt="" className="aspect-square w-full object-cover" loading="lazy" />)}
                </div>
              )}
            </div>
            <div>
              <p className="text-xs text-slate-500">{[open.category, open.brand, open.sku].filter(Boolean).join(' · ')}</p>
              <div className="mt-2"><Price p={open} user={user} large /></div>
              <p className="mt-1 text-xs text-slate-500">Inc. GST</p>
              <div className="mt-3"><Status tone={STOCK_TONE[open.stock]}>{STOCK_LABEL[open.stock]}</Status></div>
              {open.description && <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{open.description}</p>}
              <button
                className="btn-primary mt-6"
                disabled={open.stock === 'out_of_stock'}
                onClick={() => {
                  cart.add(open.id)
                  setOpen(null)
                }}
              >
                <ShoppingCart size={16} /> Add to cart
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

function Checkout({
  cart,
  products,
  portal,
  acting,
  onPlaced,
}: {
  cart: ReturnType<typeof useCart>
  products: Product[]
  portal?: boolean
  acting: boolean
  onPlaced: (r: { number: number; total: number }) => void
}) {
  const { user, placeOrder } = useStore()
  const [form, setForm] = useState(() => ({
    name: user?.name ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    delivery: 'pickup' as 'pickup' | 'delivery',
    address: '',
    notes: '',
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lines = cart.lines
    .map((l) => ({ ...l, p: products.find((p) => p.id === l.productId) }))
    .sort((a, b) => (a.p?.title ?? '').localeCompare(b.p?.title ?? ''))
  const total = lines.reduce((s, l) => s + (l.p ? unitPrice(l.p, user) * l.qty : 0), 0)
  const missing = lines.filter((l) => !l.p)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (acting) return
    setBusy(true)
    setError(null)
    try {
      onPlaced(await placeOrder({ ...form, items: lines.filter((l) => l.p).map((l) => ({ productId: l.productId, qty: l.qty })) }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (lines.length === 0) return <Empty title="Your cart is empty">Add products to get started.</Empty>
  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <section className="card divide-y divide-slate-100" aria-label="Cart">
        {lines.map((l) => (
          <div key={l.productId} className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
            {l.p ? <ProductImage p={l.p} className="aspect-square w-16 shrink-0" /> : null}
            <div className="min-w-0 flex-1 basis-40">
              <p className="font-semibold leading-snug">{l.p?.title ?? 'No longer available'}</p>
              {l.p && <p className="num text-xs text-slate-500">{money(unitPrice(l.p, user))} each</p>}
            </div>
            {l.p && (
              <div className="flex items-center gap-1">
                <button type="button" className="btn-ghost px-2 py-1" aria-label={`One less ${l.p.title}`} onClick={() => cart.setQty(l.productId, l.qty - 1)}><Minus size={14} /></button>
                <span className="num w-8 text-center" aria-label="Quantity">{l.qty}</span>
                <button type="button" className="btn-ghost px-2 py-1" aria-label={`One more ${l.p.title}`} onClick={() => cart.setQty(l.productId, l.qty + 1)}><Plus size={14} /></button>
              </div>
            )}
            <button type="button" className="text-slate-500 hover:text-red-600" aria-label="Remove" onClick={() => cart.setQty(l.productId, 0)}><Trash2 size={16} /></button>
          </div>
        ))}
        <div className="flex items-center justify-between p-4">
          <span className="font-semibold">Total (inc. GST)</span>
          <span className="num text-lg font-bold">{money(total)}</span>
        </div>
        {missing.length > 0 && <p className="p-4 text-sm text-red-600">Some items are no longer available; remove them to continue.</p>}
      </section>
      <form className="card space-y-4 p-5" onSubmit={submit}>
        <h2 className="font-bold">Your details</h2>
        <Field label="Name"><input className="input" required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Email"><input className="input" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Phone"><input className="input num" type="tel" required autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <fieldset>
          <legend className="label">Pickup or delivery</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['pickup', 'delivery'] as const).map((d) => (
              <label key={d} className={cx('flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm', form.delivery === d ? 'border-slate-900 bg-slate-50' : 'border-slate-200')}>
                <input type="radio" name="delivery" className="accent-slate-900" checked={form.delivery === d} onChange={() => setForm({ ...form, delivery: d })} />
                {d === 'pickup' ? 'Pickup' : 'Delivery'}
              </label>
            ))}
          </div>
        </fieldset>
        {form.delivery === 'delivery' && (
          <Field label="Delivery address">
            <input className="input" required autoComplete="street-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
        )}
        <Field label="Notes (optional)">
          <textarea className="input min-h-[70px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Colour, sizes, install needed, best time to call…" />
        </Field>
        <p className="text-xs text-slate-500">
          No payment now. We'll confirm availability{form.delivery === 'delivery' ? ' and delivery cost' : ''}, then send an invoice to pay by bank transfer.
          {user?.role === 'provider' && ' Trade prices apply to your account.'}
        </p>
        {acting && <p className="text-sm text-red-600">Orders can't be placed from someone else's dashboard.</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={busy || acting || missing.length > 0}>
          {busy ? 'Placing order…' : `Place order · ${money(total)}`}
        </button>
        {!portal && !user && <p className="text-xs text-slate-500">Already a client or trade? Sign in to see your orders and trade prices.</p>}
      </form>
    </div>
  )
}

/** A signed-in client's or service provider's orders. */
export function MyOrders() {
  const { data, user } = useStore()
  const mine = data.orders.filter((o) => o.customerId === user?.id)
  if (mine.length === 0) return null
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-lg font-bold">Your orders</h2>
      <div className="card divide-y divide-slate-100">
        {mine.map((o) => (
          <div key={o.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold">
                Order <span className="num">#{o.number}</span> <span className="text-sm font-normal text-slate-500">· {fmtDate(o.createdAt)}</span>
              </p>
              <p className="mt-1 text-sm text-slate-600">{o.items.map((i) => `${i.qty} × ${i.title}`).join(', ')}</p>
            </div>
            <div className="flex shrink-0 items-center gap-4 sm:flex-col sm:items-end sm:gap-1">
              <span className="num font-semibold">{money(o.total)}</span>
              <Status tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Status>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/** The store inside a client or service provider portal. */
export function PortalStore() {
  return (
    <>
      <PageHeader title="Store" subtitle="Vanities, shower screens, tapware and more, supplied (and installed) by Next Phase Maintenance." />
      <Shop portal />
      <MyOrders />
    </>
  )
}

/** The public store page, open to anyone from the home page. */
export function StorePage() {
  const { user } = useStore()
  const [signIn, setSignIn] = useState(false)
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo sub="Store" />
          {user ? (
            <button className="btn-accent text-[15px] font-normal" onClick={() => navigate(user.role === 'admin' ? '/admin/store' : `/${user.role}/store`)}>
              {user.role === 'admin' ? 'Manage store' : 'Your portal'}
            </button>
          ) : (
            <button className="btn-accent text-[15px] font-normal" onClick={() => setSignIn(true)}>Sign in</button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <PageHeader title="Shop" subtitle="Vanities, shower screens, tapware and more. Order online and we'll confirm, invoice and deliver or install." />
        <Shop />
      </main>
      <SignInModal open={signIn} onClose={() => setSignIn(false)} />
    </div>
  )
}
