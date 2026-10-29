import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ExternalLink, ImageOff, Link2, Search, Sparkles, Square } from 'lucide-react'
import { Empty, Field, Modal } from '../../components/ui'
import { useStore } from '../../lib/store'
import { CLOUD } from '../../lib/supabase'
import { STORE_CATEGORIES, type FoundProduct, type Product, type SupplierStock } from '../../lib/types'
import { uid } from '../../lib/utils'

const SUGGESTIONS = ['Frameless shower screens 900 mm', 'Wall-hung timber vanities 750 to 900 mm', 'Matte black basin mixers', 'LED bathroom mirrors with demister']

/** "1,249.00" / "$1,249 inc. GST" → 1249; empty or unreadable → 0. */
const parsePrice = (s: string) => {
  const m = s.replace(/,/g, '').match(/\d+(\.\d+)?/)
  return m ? Math.round(Number(m[0]) * 100) / 100 : 0
}

const isWebLink = (url: string) => /^https?:\/\//i.test(url)

/** The supplier's photo, or a plain placeholder when there's none or it won't load. */
function FoundPhoto({ src, className }: { src?: string; className: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div className={`flex flex-col items-center justify-center gap-1 bg-slate-50 text-xs text-slate-400 ${className}`}>
        <ImageOff size={22} strokeWidth={1.5} aria-hidden="true" />
        No photo found
      </div>
    )
  }
  // No referrer: some suppliers refuse images linked from other sites.
  return <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" className={`bg-white object-contain ${className}`} onError={() => setFailed(true)} />
}

/** "Working… 12 s" while the assistant runs, with what it's doing now and a way to stop it. */
function Working({ text, onStop }: { text: string; onStop: () => void }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
      <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate" role="status">{text}</span>
      <span className="num text-slate-400" aria-hidden="true">{seconds} s</span>
      <button type="button" className="btn-ghost px-3 py-1" onClick={onStop}>
        <Square size={12} /> Stop
      </button>
    </div>
  )
}

/**
 * Admin → Store → AI product finder: search the web for products to stock (with each product's
 * photo), then have one drafted into a listing that opens in the product editor as a draft for the
 * admin to check and publish.
 */
export function ProductAssistant({ onDraft }: { onDraft: (p: Product, notice?: string) => void }) {
  const { findProducts, draftListing, recreatePhotos, checkSupplierStock } = useStore()
  const [link, setLink] = useState('')
  const [makePhotos, setMakePhotos] = useState(true)
  const [query, setQuery] = useState('')
  // What's running: a search, or drafting the product with this link.
  const [busy, setBusy] = useState<{ kind: 'find' } | { kind: 'draft'; url: string } | null>(null)
  const [progress, setProgress] = useState('')
  const [results, setResults] = useState<{ products: FoundProduct[]; note: string } | null>(null)
  const [error, setError] = useState<{ text: string; setup?: boolean } | null>(null)
  const [instructions, setInstructions] = useState('')
  const [preview, setPreview] = useState<FoundProduct | null>(null)
  const stopper = useRef<AbortController | null>(null)

  // Leaving the page stops anything still running.
  useEffect(() => () => stopper.current?.abort(), [])

  const begin = (b: NonNullable<typeof busy>, first: string) => {
    stopper.current?.abort()
    stopper.current = new AbortController()
    setBusy(b)
    setProgress(first)
    setError(null)
    return stopper.current.signal
  }
  const fail = (e: unknown) => {
    const err = e as Error & { code?: string }
    if (err.name === 'AbortError') return setError({ text: 'Stopped.' })
    setError({ text: err.message, setup: err.code === 'not_configured' })
  }

  const find = async (e?: FormEvent, q = query) => {
    e?.preventDefault()
    if (!q.trim()) return
    setQuery(q)
    setResults(null)
    const signal = begin({ kind: 'find' }, 'Starting the search…')
    // A newer search or draft takes over: then this one's outcome is ignored.
    const current = () => stopper.current?.signal === signal
    try {
      const found = await findProducts(q, (t) => current() && setProgress(t), signal)
      if (current()) setResults(found)
    } catch (err) {
      if (current()) fail(err)
    } finally {
      if (current()) setBusy(null)
    }
  }

  /**
   * Drafts the listing for a product page, then (alongside) makes new photos from the supplier's and
   * reads their stock, and opens it all in the product editor as a draft.
   */
  const draft = async (found: FoundProduct) => {
    setPreview(null)
    const signal = begin({ kind: 'draft', url: found.url }, `Reading ${found.supplier || 'the product page'}…`)
    const current = () => stopper.current?.signal === signal
    try {
      const l = await draftListing(found, instructions, (t) => current() && setProgress(t), signal)
      if (!current()) return
      // Photos and stock don't stop the listing: what fails is noted for the admin.
      const [photos, stock] = await Promise.all([
        makePhotos
          ? recreatePhotos(found.url, l.title, (l.photos ?? []).filter(isWebLink), (t) => current() && setProgress(t), signal).catch((err: Error & { code?: string }) => {
              if (err.name === 'AbortError') throw err
              return { error: err.code === 'images_not_configured' ? 'New photos weren’t made: add a Google Gemini API key (GEMINI_API_KEY) to the Supabase secrets.' : `New photos weren’t made: ${err.message}` }
            })
          : null,
        checkSupplierStock({ url: found.url }).catch(() => null as SupplierStock | null),
      ])
      if (!current()) return
      const images = photos && 'images' in photos ? photos.images : []
      const specs = l.specs.filter(Boolean)
      onDraft({
        id: uid('sp'),
        title: l.title,
        description: [l.description.trim(), specs.length ? specs.map((s) => `• ${s}`).join('\n') : ''].filter(Boolean).join('\n\n'),
        category: (STORE_CATEGORIES as readonly string[]).includes(l.category) ? l.category : 'Other',
        brand: l.brand,
        sku: l.sku,
        // Only the drafted retail price (inc. GST); otherwise the admin enters one.
        price: parsePrice(l.suggested_price),
        images,
        options: [],
        status: 'draft',
        // What the supplier's page says now; "To order" when it doesn't say.
        stock: stock?.status === 'out_of_stock' ? 'out_of_stock' : stock?.status === 'in_stock' || stock?.status === 'low' ? 'in_stock' : 'to_order',
        source: {
          supplier: found.supplier,
          url: found.url,
          trackStock: true,
          outOfStockAs: 'out_of_stock',
          autoPrice: true,
          // The supplier's price as read now: the draft is priced from it at the store's margins.
          supplierStock: stock ?? undefined,
          notes: [
            l.notes && `AI draft notes: ${l.notes}`,
            found.price && `Price shown in search: ${found.price}`,
            images.length > 0 && `Photos: made by AI from the supplier's photos on ${new Date().toLocaleDateString('en-AU')}. Check they match the product before publishing.`,
            photos && 'error' in photos && photos.error,
            stock &&
              (stock.status === 'unknown'
                ? `Supplier stock: couldn't tell from the page (${stock.note.replace(/\.$/, '')}). It's checked again every 6 hours once saved.`
                : `Supplier stock when drafted: ${stock.status.replace(/_/g, ' ')}${stock.qty !== undefined ? ` (${stock.qty})` : ''}. ${stock.note}`),
            images.length === 0 && found.image && isWebLink(found.image) && `Supplier photo: ${found.image} (check you may use it before adding it)`,
          ]
            .filter(Boolean)
            .join('\n'),
        },
        createdAt: new Date().toISOString(),
      }, photos && 'error' in photos ? photos.error : undefined)
    } catch (err) {
      if (current()) fail(err)
    } finally {
      if (current()) setBusy(null)
    }
  }

  /** "Add from a link": the same, for a supplier page the admin already has. */
  const fromLink = (e: FormEvent) => {
    e.preventDefault()
    const url = link.trim()
    if (!isWebLink(url)) return setError({ text: 'Paste the full link to the product page (starting with https://).' })
    let host = 'the supplier'
    try {
      host = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return setError({ text: 'That link doesn’t look right. Copy it from the browser’s address bar.' })
    }
    void draft({ name: '', brand: '', supplier: host, url, price: '', category: 'Other', summary: '' })
  }

  const stop = () => {
    stopper.current?.abort()
    setBusy(null)
  }

  return (
    <div className="space-y-5">
      <form className="card space-y-3 p-5" onSubmit={fromLink}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center bg-slate-900 text-white"><Link2 size={20} /></span>
          <div>
            <h2 className="font-bold">Add a product from a supplier link</h2>
            <p className="text-sm text-slate-600">
              Paste the link to a product on a supplier's website. The assistant writes a new listing in your words, makes new photos of the product (so
              you're not reusing the supplier's), and checks their stock. It opens as a draft for you to check; after that, the supplier's stock is
              checked every 6 hours and the listing updates when they run out or get more.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative flex-1">
            <Link2 size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input className="input pl-9" type="url" placeholder="https://supplier.com.au/products/…" aria-label="Supplier product link" value={link} onChange={(e) => setLink(e.target.value)} />
          </label>
          <button className="btn-primary" disabled={!!busy || !link.trim()}>{busy?.kind === 'draft' && busy.url === link.trim() ? 'Working…' : 'Create listing'}</button>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-slate-900" checked={makePhotos} onChange={(e) => setMakePhotos(e.target.checked)} />
            Make new photos with AI
          </label>
          <input className="input min-w-0 flex-1 py-1.5" aria-label="Instructions for the listing (optional)" placeholder="Instructions (optional), e.g. mention we install across Melbourne" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </div>
        {busy?.kind === 'draft' && busy.url === link.trim() && <Working text={progress} onStop={stop} />}
        <p className="text-xs text-slate-500">
          New photos are made by Google's Gemini image AI from the supplier's photos: the same product, shot fresh in a studio and in a room. They
          reduce but don't remove copyright risk (the product's design and any brand names are still the maker's), so check the supplier is happy
          for you to resell it, and that the photos match the real product.
        </p>
      </form>

      <form className="card space-y-3 p-5" onSubmit={find}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center bg-accent text-slate-900"><Sparkles size={20} /></span>
          <div>
            <h2 className="font-bold">Find products to stock</h2>
            <p className="text-sm text-slate-600">
              Describe what you're after. The assistant searches the web for products sold in Australia and lists them with photos, links and prices.
              Pick one and it drafts a listing in your words for you to review: nothing is published until you choose to.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input className="input pl-9" placeholder="e.g. frameless shower screens 900 mm" aria-label="What are you looking for?" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button className="btn-primary" disabled={!!busy || !query.trim()}>{busy?.kind === 'find' ? 'Searching…' : 'Find products'}</button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:border-slate-400" disabled={!!busy} onClick={() => void find(undefined, s)}>
              {s}
            </button>
          ))}
        </div>
        {busy?.kind === 'find' && <Working text={progress} onStop={stop} />}
      </form>

      {error &&
        (error.setup ? (
          <div className="card space-y-2 border-accent p-5 text-sm">
            <p className="font-semibold">The AI assistant isn't set up yet</p>
            <ol className="list-decimal space-y-1 pl-5 text-slate-700">
              <li>Create an API key at console.anthropic.com (Settings → API keys), add some credit and set a monthly spend limit. Each search or draft usually costs well under a dollar.</li>
              <li>In Supabase, open your project → Edge Functions → Secrets, and add <code className="font-mono">ANTHROPIC_API_KEY</code> with that key.</li>
              <li>Come back here and search again.</li>
            </ol>
          </div>
        ) : (
          <p className={error.text === 'Stopped.' ? 'text-sm text-slate-500' : 'text-sm text-red-600'}>{error.text}</p>
        ))}

      {results &&
        (results.products.length === 0 ? (
          <Empty title="Nothing suitable found">{results.note || 'Try a different description.'}</Empty>
        ) : (
          <>
            {results.note && <p className="text-sm text-slate-600">{results.note}</p>}
            <Field label="Instructions for drafting (optional)">
              <input className="input" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. mention we install across Melbourne; keep it short" />
            </Field>
            {busy?.kind === 'draft' && <Working text={progress} onStop={stop} />}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {results.products.map((p, i) => (
                <article key={`${i}-${p.url}`} className="card flex flex-col overflow-hidden">
                  <button type="button" className="block border-b border-slate-100" onClick={() => setPreview(p)} aria-label={`Preview ${p.name}`}>
                    <FoundPhoto src={p.image} className="aspect-[4/3] w-full" />
                  </button>
                  <div className="flex flex-1 flex-col p-4">
                    <p className="text-xs text-slate-500">{[p.category, p.brand].filter(Boolean).join(' · ')}</p>
                    <h3 className="mt-1 font-semibold leading-snug">{p.name}</h3>
                    <p className="mt-1 text-sm text-slate-600">{p.summary}</p>
                    <p className="mt-2 text-sm">
                      <span className="num font-semibold">{p.price || 'Price not shown'}</span>
                      <span className="text-slate-500"> · {p.supplier}</span>
                    </p>
                    <div className="mt-auto flex flex-wrap gap-2 pt-4">
                      {isWebLink(p.url) && (
                        <a className="btn-ghost px-3 py-1.5" href={p.url} target="_blank" rel="noreferrer noopener">
                          <ExternalLink size={14} /> Supplier page
                        </a>
                      )}
                      <button className="btn-primary px-3 py-1.5" disabled={!!busy} onClick={() => void draft(p)}>
                        <Sparkles size={14} /> {busy?.kind === 'draft' && busy.url === p.url ? 'Drafting…' : 'Draft listing'}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              Results come from the web and can be out of date: check prices, specifications and stock with the supplier before publishing. Photos are
              the supplier's: use your own, or ones they let you use, in your listings.
              {!CLOUD && ' (Demo mode shows sample results.)'}
            </p>
          </>
        ))}

      {preview && (
        <Modal open onClose={() => setPreview(null)} title={preview.name} width="max-w-3xl">
          <div className="grid gap-5 md:grid-cols-2">
            <FoundPhoto src={preview.image} className="aspect-square w-full border border-slate-100" />
            <div className="space-y-3 text-sm">
              <p className="text-xs text-slate-500">{[preview.category, preview.brand, preview.supplier].filter(Boolean).join(' · ')}</p>
              <p className="num text-lg font-bold">{preview.price || 'Price not shown'}</p>
              <p className="text-slate-700">{preview.summary}</p>
              <div className="flex flex-wrap gap-2 pt-2">
                {isWebLink(preview.url) && (
                  <a className="btn-ghost px-3 py-1.5" href={preview.url} target="_blank" rel="noreferrer noopener">
                    <ExternalLink size={14} /> Supplier page
                  </a>
                )}
                <button className="btn-primary px-3 py-1.5" disabled={!!busy} onClick={() => void draft(preview)}>
                  <Sparkles size={14} /> Draft listing
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
