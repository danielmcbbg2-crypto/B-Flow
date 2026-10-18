import { useState, type FormEvent } from 'react'
import { ExternalLink, Search, Sparkles } from 'lucide-react'
import { Empty, Field } from '../../components/ui'
import { useStore } from '../../lib/store'
import { CLOUD } from '../../lib/supabase'
import { STORE_CATEGORIES, type FoundProduct, type Product } from '../../lib/types'
import { uid } from '../../lib/utils'

const SUGGESTIONS = ['Frameless shower screens 900 mm', 'Wall-hung timber vanities 750 to 900 mm', 'Matte black basin mixers', 'LED bathroom mirrors with demister']

/** "1,249.00" / "$1,249 inc. GST" → 1249; empty or unreadable → 0. */
const parsePrice = (s: string) => {
  const m = s.replace(/,/g, '').match(/\d+(\.\d+)?/)
  return m ? Math.round(Number(m[0]) * 100) / 100 : 0
}

/**
 * Admin → Store → AI product finder: search the web for products to stock, then have one drafted
 * into a listing that opens in the product editor as a draft for the admin to check and publish.
 */
export function ProductAssistant({ onDraft }: { onDraft: (p: Product) => void }) {
  const { findProducts, draftListing } = useStore()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<'find' | string | null>(null)
  const [results, setResults] = useState<{ products: FoundProduct[]; note: string } | null>(null)
  const [error, setError] = useState<{ text: string; setup?: boolean } | null>(null)
  const [instructions, setInstructions] = useState('')

  const fail = (e: unknown) => {
    const err = e as Error & { code?: string }
    setError({ text: err.message, setup: err.code === 'not_configured' })
  }

  const find = async (e?: FormEvent, q = query) => {
    e?.preventDefault()
    if (!q.trim()) return
    setQuery(q)
    setBusy('find')
    setError(null)
    setResults(null)
    try {
      setResults(await findProducts(q))
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const draft = async (found: FoundProduct) => {
    setBusy(found.url)
    setError(null)
    try {
      const l = await draftListing(found, instructions)
      const specs = l.specs.filter(Boolean)
      onDraft({
        id: uid('sp'),
        title: l.title,
        description: [l.description.trim(), specs.length ? specs.map((s) => `• ${s}`).join('\n') : ''].filter(Boolean).join('\n\n'),
        category: (STORE_CATEGORIES as readonly string[]).includes(l.category) ? l.category : 'Other',
        brand: l.brand,
        sku: l.sku,
        price: parsePrice(l.suggested_price) || parsePrice(found.price),
        images: [],
        status: 'draft',
        stock: 'to_order',
        source: { supplier: found.supplier, url: found.url, notes: l.notes ? `AI draft notes: ${l.notes}` : '' },
        createdAt: new Date().toISOString(),
      })
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <form className="card space-y-3 p-5" onSubmit={find}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center bg-accent text-slate-900"><Sparkles size={20} /></span>
          <div>
            <h2 className="font-bold">Find products to stock</h2>
            <p className="text-sm text-slate-600">
              Describe what you're after. The assistant searches the web for products sold in Australia and lists them with links and prices. Pick one and
              it drafts a listing in your words for you to review: nothing is published until you choose to.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input className="input pl-9" placeholder="e.g. frameless shower screens 900 mm" aria-label="What are you looking for?" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button className="btn-primary" disabled={!!busy || !query.trim()}>{busy === 'find' ? 'Searching…' : 'Find products'}</button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:border-slate-400" disabled={!!busy} onClick={() => void find(undefined, s)}>
              {s}
            </button>
          ))}
        </div>
        {busy === 'find' && <p className="text-sm text-slate-500">Searching the web… this can take up to a minute.</p>}
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
          <p className="text-sm text-red-600">{error.text}</p>
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
            <div className="grid gap-4 md:grid-cols-2">
              {results.products.map((p, i) => (
                <article key={`${i}-${p.url}`} className="card flex flex-col p-4">
                  <p className="text-xs text-slate-500">{[p.category, p.brand].filter(Boolean).join(' · ')}</p>
                  <h3 className="mt-1 font-semibold leading-snug">{p.name}</h3>
                  <p className="mt-1 text-sm text-slate-600">{p.summary}</p>
                  <p className="mt-2 text-sm">
                    <span className="num font-semibold">{p.price || 'Price not shown'}</span>
                    <span className="text-slate-500"> · {p.supplier}</span>
                  </p>
                  <div className="mt-auto flex flex-wrap gap-2 pt-4">
                    <a className="btn-ghost px-3 py-1.5" href={p.url} target="_blank" rel="noreferrer noopener">
                      <ExternalLink size={14} /> Supplier page
                    </a>
                    <button className="btn-primary px-3 py-1.5" disabled={!!busy} onClick={() => void draft(p)}>
                      <Sparkles size={14} /> {busy === p.url ? 'Drafting…' : 'Draft listing'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              Results come from the web and can be out of date: check prices, specifications and stock with the supplier before publishing.
              {!CLOUD && ' (Demo mode shows sample results.)'}
            </p>
          </>
        ))}
    </div>
  )
}
