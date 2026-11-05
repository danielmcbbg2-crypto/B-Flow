import { useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Field, Status, type Tone } from '../../components/ui'
import { useStore } from '../../lib/store'
import type { Project, QuoteDraft } from '../../lib/types'
import { cx, money, uid } from '../../lib/utils'

const BASIS: Record<QuoteDraft['lines'][number]['basis'], { label: string; tone: Tone; title: string }> = {
  price_book: { label: 'Your rate', tone: 'green', title: 'From one of your templates or past quotes' },
  estimate: { label: 'Estimate', tone: 'orange', title: 'Claude’s estimate: check it' },
  allowance: { label: 'Allowance', tone: 'outline', title: 'An allowance for something the client chooses' },
}

/**
 * The AI quote drafter: the office adds what they saw on site, Claude reads that with the request
 * and the job's photos, and drafts the itemised quote, priced from the business's own templates
 * and past quotes where it can. Nothing goes into the quote until the office adds it.
 */
export function QuoteDrafter({ p, set }: { p: Project; set: (patch: Partial<Project>) => void }) {
  const { draftQuote, data } = useStore()
  const saved = data.projects.some((x) => x.id === p.id)
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<{ text: string; code?: string } | null>(null)
  const [draft, setDraft] = useState<QuoteDraft | null>(null)
  const stop = useRef<AbortController | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    setDraft(null)
    setProgress('Starting…')
    stop.current = new AbortController()
    try {
      setDraft(await draftQuote(p, notes, setProgress, stop.current.signal))
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError({ text: (e as Error).message, code: (e as { code?: string }).code })
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  const add = () => {
    if (!draft) return
    set({
      quoteItems: [...p.quoteItems, ...draft.lines.map((l) => ({ section: l.section, description: l.description, kind: l.kind, qty: l.qty, unit: l.unit, rate: l.rate, id: uid('qi') }))],
      quoteInclusions: p.quoteInclusions.trim() ? p.quoteInclusions : draft.inclusions,
      quoteExclusions: p.quoteExclusions.trim() ? p.quoteExclusions : draft.exclusions,
    })
    setDraft(null)
    setOpen(false)
    setNotes('')
  }

  if (!open) {
    return (
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
        <Sparkles size={15} className="text-violet-600" /> Draft this quote with AI
      </button>
    )
  }

  const total = draft ? draft.lines.reduce((s, l) => s + l.qty * l.rate, 0) : 0
  return (
    <section className="rounded-md border border-violet-200 bg-violet-50/40 p-4" aria-label="AI quote drafter">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-violet-600" />
        <h3 className="font-semibold">Draft this quote with AI</h3>
        <button type="button" className="ml-auto text-sm text-slate-500 hover:underline" onClick={() => { stop.current?.abort(); setOpen(false) }}>
          Close
        </button>
      </div>
      {!saved ? (
        <p className="mt-2 text-sm text-slate-600">Save the quote request first, then draft it.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-600">
            Claude reads the request, your notes and the job’s photos (on the project, and any the client sent with their enquiry), and prices from your templates
            and past quotes where it can. You check every line before it goes in.
          </p>
          <Field label="What you saw on site (sizes, condition, access, what the client wants)" className="mt-3">
            <textarea
              className="input min-h-[90px]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Bathroom 2.4 × 1.8 m, 2.4 m ceiling. Strip to frame, new shower over bath. Client supplies tiles. Easy access, second floor."
            />
          </Field>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void run()}>
              {busy ? 'Drafting…' : draft ? 'Draft again' : 'Draft the quote'}
            </button>
            {busy && (
              <>
                <span className="text-sm text-slate-600" role="status">{progress}</span>
                <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => stop.current?.abort()}>Stop</button>
              </>
            )}
          </div>
          {error && <p className="mt-3 rounded-md bg-red-50 p-2.5 text-sm text-red-700">{error.text}</p>}
        </>
      )}

      {draft && (
        <section className="mt-4 space-y-3" aria-label="Drafted quote">
          <p className="text-sm text-slate-600">
            {draft.lines.length} lines, {money(total)} ex GST
            {draft.photosUsed ? ` · from ${draft.photosUsed} photo${draft.photosUsed > 1 ? 's' : ''}` : ' · no photos'}
            {draft.priceBookLines ? ` · ${draft.priceBookLines} of your rates to price from` : ''}
          </p>
          <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">Line</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Rate ex GST</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {draft.lines.map((l, i) => (
                  <tr key={i} className={cx(i > 0 && draft.lines[i - 1].section === l.section ? '' : 'border-t-2 border-slate-200')}>
                    <td className="px-3 py-1.5">
                      {(i === 0 || draft.lines[i - 1].section !== l.section) && l.section && <span className="block text-xs font-semibold text-slate-500">{l.section}</span>}
                      {l.description}
                    </td>
                    <td className="num px-3 py-1.5 text-right">{l.qty} {l.unit}</td>
                    <td className="num px-3 py-1.5 text-right">{money(l.rate)}</td>
                    <td className="num px-3 py-1.5 text-right">{money(l.qty * l.rate)}</td>
                    <td className="px-3 py-1.5" title={BASIS[l.basis].title}><Status tone={BASIS[l.basis].tone}>{BASIS[l.basis].label}</Status></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {draft.assumptions.length > 0 && (
            <div className="text-sm">
              <p className="font-semibold">Assumed</p>
              <ul className="ml-5 list-disc text-slate-700">{draft.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
          )}
          {draft.questions.length > 0 && (
            <div className="text-sm">
              <p className="font-semibold">Check before you issue it</p>
              <ul className="ml-5 list-disc text-slate-700">{draft.questions.map((q) => <li key={q}>{q}</li>)}</ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" onClick={add}>Add these lines to the quote</button>
            <span className="text-xs text-slate-500">
              {p.quoteItems.length ? 'They go after the lines already there.' : 'Inclusions and exclusions are filled in too, where they’re empty.'} Edit anything before you issue it.
            </span>
          </div>
        </section>
      )}
    </section>
  )
}
