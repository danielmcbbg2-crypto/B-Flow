import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { track } from '../../lib/analytics'
import { ArrowLeft, BadgeCheck, CheckCircle2, Minus, Plus, Receipt, Search, ShieldCheck, ShoppingCart, Trash2, Wrench } from 'lucide-react'
import { Empty, Field, PageHeader, Status, type Tone } from '../../components/ui'
import { Logo } from '../../components/Logo'
import { SignInModal } from '../../components/SignInModal'
import { useStore } from '../../lib/store'
import { lineKey, useCart } from '../../lib/cart'
import { navigate } from '../../lib/router'
import { SITE_URL, usePageMeta } from '../../lib/head'
import { productMeta, productPath, STORE_META } from '../../lib/seo'
import { ORDER_STATUS_LABEL, STORE_CATEGORIES, type OrderStatus, type Product, type UserAccount } from '../../lib/types'
import { ProductCard, ProductView } from './ProductView'
import { StoreFooter, StoreInfo } from './StoreInfo'
import { isStoreInfo } from '../../lib/storePolicy'
import { cheapestChoice, choicePhoto, choiceText, defaultChoice, ProductImage, unitPrice, useCatalog, type Choice } from './shopping'
import { cx, fmtDate, money } from '../../lib/utils'

const ORDER_TONE: Record<OrderStatus, Tone> = { new: 'orange', confirmed: 'outline', paid: 'dark', fulfilled: 'green', cancelled: 'red' }

/**
 * The shop: browse, product details, cart and checkout. Used on the public store page and in the
 * client and service provider portals.
 */
export function Shop({ portal, productId }: { portal?: boolean; productId?: string }) {
  const { user, actingAs } = useStore()
  const { products, loading, error } = useCatalog()
  const cart = useCart()
  const [view, setView] = useState<'browse' | 'cart'>('browse')
  // The category is kept in the address (?category=Tapware) on the public shop, so it can be shared.
  const [category, setCategoryState] = useState(() => (portal ? 'All' : new URLSearchParams(window.location.search).get('category') ?? 'All'))
  const setCategory = (c: string) => {
    setCategoryState(c)
    if (portal) return
    const url = new URL(window.location.href)
    if (c === 'All') url.searchParams.delete('category')
    else url.searchParams.set('category', c)
    window.history.replaceState(null, '', url)
  }
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('featured')
  // On the public shop each product has its own address (/store/<id>/<name>), so the open product
  // follows the address; in the portals it's just opened in place.
  const routed = !portal
  const [local, setLocal] = useState<Product | null>(null)
  const open = routed ? (products.find((p) => p.id === productId) ?? null) : local
  const [choice, setChoice] = useState<Choice>({})
  const openId = open?.id
  useEffect(() => {
    if (open) setChoice(defaultChoice(open))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId])
  const setOpen = (p: Product | null) => {
    setView('browse')
    if (routed) navigate(p ? productPath(p) : '/store')
    else {
      setLocal(p)
      window.scrollTo(0, 0)
    }
  }
  usePageMeta(!routed || loading ? null : open ? productMeta(open, SITE_URL) : STORE_META(SITE_URL))
  const [placed, setPlaced] = useState<{ number: number; total: number } | null>(null)

  const categories = useMemo(() => STORE_CATEGORIES.filter((c) => products.some((p) => p.category === c)), [products])
  const q = query.trim().toLowerCase()
  const shown = sortProducts(
    products.filter((p) => (category === 'All' || p.category === category) && (!q || `${p.title} ${p.brand} ${p.sku} ${p.description} ${(p.highlights ?? []).join(' ')}`.toLowerCase().includes(q))),
    sort,
    user,
  )
  const addToCart = (p: Product, qty = 1, chosen?: Choice) => {
    cart.add(p.id, qty, chosen)
    track('add_to_cart', { currency: 'AUD', items: [{ item_id: p.id, item_name: p.title, quantity: qty }] })
  }

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

  const cartButton = (
    <button className={cx('ml-auto', cart.count ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('cart')}>
      <ShoppingCart size={16} /> Cart{cart.count ? <span className="num">({cart.count})</span> : null}
    </button>
  )

  if (loading) return <p className="text-sm text-slate-500">Loading products…</p>
  if (error) return <Empty title="The shop couldn't load">{error}</Empty>

  if (view === 'cart') {
    return (
      <>
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <button className="btn-ghost" onClick={() => setView('browse')}>
            <ArrowLeft size={16} /> {open ? 'Back to the product' : 'Back to products'}
          </button>
        </div>
        <Checkout cart={cart} products={products} portal={portal} acting={!!actingAs} onPlaced={(r) => { track('purchase', { transaction_id: String(r.number), value: r.total, currency: 'AUD' }); cart.clear(); setPlaced(r) }} />
      </>
    )
  }

  if (open) {
    return (
      <>
        <div className="mb-4 flex justify-end">{cartButton}</div>
        <ProductView
          key={open.id}
          p={open}
          user={user}
          choice={choice}
          setChoice={setChoice}
          related={products.filter((r) => r.category === open.category && r.id !== open.id).slice(0, 4)}
          onBack={() => setOpen(null)}
          onAdd={(qty) => addToCart(open, qty, (open.options ?? []).length ? choice : undefined)}
          onViewCart={() => setView('cart')}
          onOpen={(r) => setOpen(r)}
        />
      </>
    )
  }

  return (
    <>
      {routed && <StoreIntro products={products} categories={categories} onCategory={setCategory} />}
      <div id="products" className="mb-4 flex scroll-mt-20 flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-56 sm:max-w-xs">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input className="input pl-9" type="search" placeholder="Search products" aria-label="Search products" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <select className="input w-auto" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          {(Object.keys(SORT_LABEL) as Sort[]).map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
        </select>
        {cartButton}
      </div>
      <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Category">
        {['All', ...categories].map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            aria-pressed={category === c}
            className={cx('border px-3 py-1.5 text-sm', category === c ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white hover:border-slate-900')}
          >
            {c} <span className={cx('num', category === c ? 'text-white/70' : 'text-slate-500')}>{c === 'All' ? products.length : products.filter((p) => p.category === c).length}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <Empty title={products.length ? 'Nothing matches' : 'No products yet'}>{products.length ? 'Try another search or category.' : 'Check back soon.'}</Empty>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-500" aria-live="polite"><span className="num">{shown.length}</span> {shown.length === 1 ? 'product' : 'products'}</p>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((p) => (
              <ProductCard key={p.id} p={p} user={user} routed={routed} onOpen={() => setOpen(p)} onAdd={() => addToCart(p)} />
            ))}
          </div>
        </>
      )}
    </>
  )
}

type Sort = 'featured' | 'price-low' | 'price-high' | 'name'
const SORT_LABEL: Record<Sort, string> = { featured: 'Featured', 'price-low': 'Price: low to high', 'price-high': 'Price: high to low', name: 'Name' }
function sortProducts(list: Product[], sort: Sort, user: UserAccount | null): Product[] {
  const from = (p: Product) => unitPrice(p, user, cheapestChoice(p, user))
  if (sort === 'price-low') return [...list].sort((a, b) => from(a) - from(b))
  if (sort === 'price-high') return [...list].sort((a, b) => from(b) - from(a))
  if (sort === 'name') return [...list].sort((a, b) => a.title.localeCompare(b.title))
  // Featured: by category, in the shop's order, then the most complete listings first.
  const order = (p: Product) => STORE_CATEGORIES.indexOf(p.category as (typeof STORE_CATEGORIES)[number])
  return [...list].sort((a, b) => order(a) - order(b) || (b.highlights?.length ?? 0) - (a.highlights?.length ?? 0) || a.title.localeCompare(b.title))
}

/** The top of the public shop: what it is, why buy here, and its categories. */
function StoreIntro({ products, categories, onCategory }: { products: Product[]; categories: string[]; onCategory: (c: string) => void }) {
  const pick = (c: string) => {
    onCategory(c)
    document.getElementById('products')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  return (
    <div className="mb-10 space-y-8">
      <section className="bg-slate-900 px-6 py-10 text-white sm:px-10 sm:py-14">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Next Phase Maintenance shop</p>
        <h1 className="mt-3 max-w-2xl font-display text-3xl font-bold leading-tight text-balance sm:text-5xl">Quality bathroom fixtures at honest prices</h1>
        <p className="mt-4 max-w-xl text-base font-light text-white/80 sm:text-lg">
          Vanities, shower screens, toilets and tapware for Melbourne homes and rentals. Buy on its own, or have our team supply and install it.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <button className="btn-accent px-6 py-3 text-base" onClick={() => pick('All')}>Shop all products</button>
          <a href="/store/delivery" className="btn border border-white px-6 py-3 text-base text-white hover:bg-white hover:text-slate-900">Delivery and installation</a>
        </div>
      </section>
      <ul className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: BadgeCheck, title: 'Australian standards', body: 'WELS ratings and WaterMark details on every tap and toilet.' },
          { icon: Receipt, title: 'Prices include GST', body: 'The price you see is the price you pay for the product.' },
          { icon: Wrench, title: 'Supply and install', body: 'One team to supply and fit it, anywhere in Melbourne.' },
          { icon: ShieldCheck, title: 'Your rights protected', body: 'Australian Consumer Law guarantees on everything we sell.' },
        ].map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-3 border border-slate-200 bg-white p-4">
            <Icon size={22} className="shrink-0 text-accent-ink" aria-hidden="true" />
            <span>
              <span className="block font-semibold text-slate-900">{title}</span>
              <span className="text-slate-600">{body}</span>
            </span>
          </li>
        ))}
      </ul>
      <section aria-labelledby="shop-categories">
        <h2 id="shop-categories" className="rule-above font-display text-xl font-bold">Shop by category</h2>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {categories.map((c) => {
            const items = products.filter((p) => p.category === c)
            const cover = items.find((p) => p.images.length) ?? items[0]
            return (
              <button key={c} onClick={() => pick(c)} className="group overflow-hidden border border-slate-200 bg-white text-left">
                {cover && <ProductImage p={cover} src={cover.images[1] ?? cover.images[0]} className="aspect-[4/3] w-full transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none" />}
                <span className="flex items-center justify-between gap-2 p-3">
                  <span className="font-semibold">{c}</span>
                  <span className="num text-sm text-slate-500">{items.length}</span>
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </div>
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
    .map((l) => {
      const found = products.find((p) => p.id === l.productId)
      const chosen = found ? choiceText(found, l.options) : null
      // A product whose options changed since it went in the cart is treated as gone.
      return { ...l, key: lineKey(l), p: chosen === null ? undefined : found, chosen, title: found?.title }
    })
    .sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''))
  const total = lines.reduce((s, l) => s + (l.p ? unitPrice(l.p, user, l.options) * l.qty : 0), 0)
  const missing = lines.filter((l) => !l.p)
  const tooMany = lines.length - missing.length > 30

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (acting) return
    setBusy(true)
    setError(null)
    try {
      onPlaced(await placeOrder({ ...form, items: lines.filter((l) => l.p).map((l) => ({ productId: l.productId, qty: l.qty, options: l.options })) }))
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
          <div key={l.key} className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
            {l.p ? <ProductImage p={l.p} src={choicePhoto(l.p, l.options)} className="aspect-square w-16 shrink-0" /> : null}
            <div className="min-w-0 flex-1 basis-40">
              <p className="font-semibold leading-snug">{l.p ? l.p.title : l.title ? `${l.title}: options no longer available` : 'No longer available'}</p>
              {l.chosen && <p className="text-xs text-slate-600">{l.chosen}</p>}
              {l.p && <p className="num text-xs text-slate-500">{money(unitPrice(l.p, user, l.options))} each</p>}
            </div>
            {l.p && (
              <div className="flex items-center gap-1">
                <button type="button" className="btn-ghost px-2 py-1" aria-label={`One less ${l.p.title}`} onClick={() => cart.setQty(l, l.qty - 1)}><Minus size={14} /></button>
                <span className="num w-8 text-center" aria-label="Quantity">{l.qty}</span>
                <button type="button" className="btn-ghost px-2 py-1" aria-label={`One more ${l.p.title}`} onClick={() => cart.setQty(l, l.qty + 1)}><Plus size={14} /></button>
              </div>
            )}
            <button type="button" className="text-slate-500 hover:text-red-600" aria-label="Remove" onClick={() => cart.setQty(l, 0)}><Trash2 size={16} /></button>
          </div>
        ))}
        <div className="flex items-center justify-between p-4">
          <span className="font-semibold">Total (inc. GST)</span>
          <span className="num text-lg font-bold">{money(total)}</span>
        </div>
        {missing.length > 0 && <p className="p-4 text-sm text-red-600">Some items are no longer available; remove them to continue.</p>}
        {tooMany && <p className="p-4 text-sm text-red-600">Up to 30 different products per order. Please split it into two orders.</p>}
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
          {user?.role === 'provider' && user.status === 'active' && ' Trade prices apply to your account.'}
        </p>
        {acting && <p className="text-sm text-red-600">Orders can't be placed from someone else's dashboard.</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={busy || acting || missing.length > 0 || tooMany}>
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
              <p className="mt-1 text-sm text-slate-600">{o.items.map((i) => `${i.qty} × ${i.title}${i.options ? ` (${i.options})` : ''}`).join(', ')}</p>
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
export function StorePage({ productId }: { productId?: string }) {
  const { user, can } = useStore()
  const manage = user?.role === 'admin' && can('canManageStore')
  const [signIn, setSignIn] = useState(false)
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo sub="Store" />
          <nav aria-label="Shop" className="ml-auto mr-2 hidden items-center gap-5 text-sm md:flex">
            <a href="/" className="text-slate-700 hover:text-slate-900">Maintenance services</a>
            <a href="/store/delivery" className="text-slate-700 hover:text-slate-900">Delivery</a>
            <a href="/store/returns" className="text-slate-700 hover:text-slate-900">Returns</a>
            <a href="/store/contact" className="text-slate-700 hover:text-slate-900">Contact</a>
          </nav>
          {user ? (
            <button
              className="btn-accent text-[15px] font-normal"
              onClick={() => navigate(manage ? '/admin/store' : user.role === 'admin' ? '/admin' : `/${user.role}/store`)}
            >
              {manage ? 'Manage store' : 'Your portal'}
            </button>
          ) : (
            <button className="btn-accent text-[15px] font-normal" onClick={() => setSignIn(true)}>Sign in</button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {isStoreInfo(productId) ? <StoreInfo slug={productId} /> : <Shop productId={productId} />}
      </main>
      <StoreFooter />
      <SignInModal open={signIn} onClose={() => setSignIn(false)} />
    </div>
  )
}
