// The quote drafter's pure parts (no network, so they can be tested alone): the price book Claude
// prices from (the business's own templates and past quotes), and tidying the draft it returns.

export const KINDS = ['labour', 'materials', 'subcontract', 'hire', 'other'] as const
export type Kind = (typeof KINDS)[number]
export type Basis = 'price_book' | 'estimate' | 'allowance'

export interface DraftLine {
  section: string
  description: string
  kind: Kind
  qty: number
  unit: string
  rate: number
  basis: Basis
}

export interface Draft {
  lines: DraftLine[]
  inclusions: string
  exclusions: string
  assumptions: string[]
  questions: string[]
}

type Line = { section?: string; description?: string; kind?: string; qty?: number | string; unit?: string; rate?: number | string }

const MAX_BOOK_LINES = 150
const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

/**
 * One line per distinct item (by description and unit), with where its rate comes from: a template
 * by name, or the newest past quote that has it. Templates win (they're the office's standard
 * rates), then newer quotes. `recent` is newest first.
 */
export function priceBook(
  templates: { name: string; items: Line[] | null }[],
  recent: { id: string; title: string }[],
  lines: (Line & { project_id: string })[],
): { text: string; count: number } {
  const seen = new Map<string, string>()
  const add = (l: Line, from: string) => {
    const description = String(l.description ?? '').replace(/\s+/g, ' ').trim()
    const rate = Number(l.rate)
    if (!description || !Number.isFinite(rate) || rate <= 0) return
    const unit = String(l.unit ?? '').trim()
    const key = `${description.toLowerCase()}|${unit.toLowerCase()}`
    if (seen.has(key) || seen.size >= MAX_BOOK_LINES) return
    const kind = KINDS.includes(l.kind as Kind) ? l.kind : 'other'
    seen.set(key, `- ${description.slice(0, 160)} | ${kind} | $${money(rate)}${unit ? ` per ${unit}` : ''} | ${from}`)
  }
  for (const t of templates) for (const l of t.items ?? []) add(l, `template "${t.name}"`)
  for (const q of recent) for (const l of lines.filter((x) => x.project_id === q.id)) add(l, `past quote "${q.title}"`)
  return { text: [...seen.values()].join('\n'), count: seen.size }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** The draft as the quote takes it: known kinds, sane numbers, trimmed text, at most 80 lines. */
export function cleanDraft(d: Draft): Draft {
  const lines = (Array.isArray(d?.lines) ? d.lines : [])
    .map((l) => ({
      section: String(l?.section ?? '').trim().slice(0, 80),
      description: String(l?.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
      kind: (KINDS.includes(l?.kind as Kind) ? l.kind : 'other') as Kind,
      qty: Math.min(100000, Math.max(0, round2(Number(l?.qty) || 0))),
      unit: String(l?.unit ?? '').trim().slice(0, 20),
      rate: Math.min(1_000_000, Math.max(0, round2(Number(l?.rate) || 0))),
      basis: (['price_book', 'estimate', 'allowance'].includes(l?.basis) ? l.basis : 'estimate') as Basis,
    }))
    .filter((l) => l.description && l.qty > 0)
    .slice(0, 80)
  const list = (v: unknown) => (Array.isArray(v) ? v : []).map((s) => String(s).trim().slice(0, 300)).filter(Boolean).slice(0, 15)
  return {
    lines,
    inclusions: String(d?.inclusions ?? '').trim().slice(0, 2000),
    exclusions: String(d?.exclusions ?? '').trim().slice(0, 2000),
    assumptions: list(d?.assumptions),
    questions: list(d?.questions),
  }
}
