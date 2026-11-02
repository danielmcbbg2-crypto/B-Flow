// How good and how complete a store listing is: a score out of 100 and what to fix, covering what
// Australian rules ask a listing to state (WELS water ratings, WaterMark certification, safety
// glass, the Australian Consumer Law), what search engines and link previews read, and what helps
// a customer decide. Used by the product editor and by scripts; free of browser APIs.
import type { Product, ProductCompliance, ProductSpec } from './types'

export interface ListingIssue {
  /** "must": the law or Google needs it; "should": quality and search. */
  level: 'must' | 'should'
  field: 'title' | 'description' | 'specs' | 'highlights' | 'seo' | 'images' | 'identifiers' | 'compliance' | 'price'
  message: string
}

export interface ListingCheck {
  score: number
  issues: ListingIssue[]
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length
const has = (s: string | undefined) => !!s && s.trim().length > 0

/** Taps, mixers and showers: WELS-rated tap equipment (bath fillers and spouts aren't). */
const needsTapWels = (p: Pick<Product, 'category' | 'title'>) => p.category === 'Tapware' && !/\bbath\b|\bspout\b|\bwall top\b/i.test(p.title)
const isShower = (p: Pick<Product, 'title'>) => /\bshower (head|rail|set|system)|\bhand ?shower|\bshower ?rose\b/i.test(p.title)
/** Products the WELS scheme covers: they must show the rating label's details when advertised. */
export const needsWels = (p: Pick<Product, 'category' | 'title'>) => p.category === 'Toilets' || needsTapWels(p) || isShower(p)
/** Products that connect to the water supply or drainage: they need WaterMark to be installed legally. */
export const needsWatermark = (p: Pick<Product, 'category' | 'title'>) => needsWels(p) || p.category === 'Tapware' || p.category === 'Toilets'

/** Wording the Australian Consumer Law treats as risky unless it can be proven. */
const RISKY = [/\bbest (price|quality|value)\b/i, /\bcheapest\b/i, /\blowest price\b/i, /\bguaranteed?\b(?!.*consumer law)/i, /\b100% (safe|waterproof)\b/i, /\blifetime warranty\b/i, /\bmade in australia\b/i]
/** Drafting leftovers that shouldn't reach customers. */
const LEFTOVERS = [/\(per page\)/i, /\bper (the )?page\b/i, /\bas (stated|shown) on the (supplier'?s? )?page\b/i, /\bsupplier\b/i, /\bTBC\b/, /\blorem\b/i, /\[.*?\]/]

export function checkListing(p: Product): ListingCheck {
  const issues: ListingIssue[] = []
  const must = (field: ListingIssue['field'], message: string) => issues.push({ level: 'must', field, message })
  const should = (field: ListingIssue['field'], message: string) => issues.push({ level: 'should', field, message })
  let score = 0
  const c: ProductCompliance = p.compliance ?? {}
  const text = `${p.title}\n${p.description}\n${(p.highlights ?? []).join('\n')}\n${(p.specs ?? []).map((s) => `${s.label} ${s.value}`).join('\n')}`

  // Title (10)
  if (p.title.length >= 25 && p.title.length <= 120) score += 10
  else if (p.title.length) {
    score += 5
    should('title', p.title.length < 25 ? 'Make the title more specific: type, size, finish and key feature.' : 'Shorten the title to 120 characters or fewer.')
  } else must('title', 'Add a title.')

  // Description (15)
  const n = words(p.description)
  if (n >= 100 && n <= 260) score += 10
  else if (n >= 50) {
    score += 5
    should('description', n < 100 ? `Write a fuller description (${n} words; aim for 100 to 260).` : `Tighten the description (${n} words; aim for 100 to 260).`)
  } else must('description', 'Write a description of at least 100 words: what it is, who it suits, what’s included.')
  if (/^\s*[•*-]\s/m.test(p.description)) should('description', 'Move the bullet points into the specifications.')
  const left = LEFTOVERS.find((r) => r.test(text))
  if (left) must('description', `Remove drafting leftovers (“${text.match(left)?.[0]}”).`)
  else score += 5

  // Specs and highlights (15)
  const specs = (p.specs ?? []).filter((s) => has(s.label) && has(s.value))
  if (specs.length >= 5) score += 10
  else if (specs.length) {
    score += 5
    should('specs', `Add more specifications (${specs.length}; aim for at least 5: size, material, finish, inclusions…).`)
  } else must('specs', 'Add the specifications (size, material, finish, what’s included).')
  if (!specs.some((s) => /dimension|size|width|height|depth|length/i.test(s.label))) should('specs', 'Add the dimensions.')
  if ((p.highlights ?? []).length >= 3) score += 5
  else should('highlights', 'Add 3 to 6 short selling points.')

  // Search and link previews (15)
  const seoTitle = p.seoTitle?.trim() ?? ''
  if (seoTitle.length >= 30 && seoTitle.length <= 60) score += 8
  else if (seoTitle) {
    score += 4
    should('seo', `Search title is ${seoTitle.length} characters; aim for 30 to 60.`)
  } else should('seo', 'Add a search title (30 to 60 characters).')
  const meta = p.metaDescription?.trim() ?? ''
  if (meta.length >= 120 && meta.length <= 160) score += 7
  else if (meta) {
    score += 3
    should('seo', `Search description is ${meta.length} characters; aim for 120 to 160.`)
  } else should('seo', 'Add a search description (120 to 160 characters).')

  // Photos (10)
  if (p.images.length >= 2) score += 5
  else if (p.images.length) {
    score += 3
    should('images', 'Add at least 2 photos.')
  } else must('images', 'Add a photo (Google won’t list a product without one).')
  const described = p.images.filter((_, i) => has(p.imageAlt?.[i])).length
  if (p.images.length && described === p.images.length) score += 5
  else if (p.images.length) should('images', `Describe every photo (${described} of ${p.images.length} done), for screen readers and image search.`)

  // Brand, part number, barcode (10)
  if (has(p.brand)) score += 4
  else should('identifiers', 'Add the brand if the maker has one (listings without a brand show less on Google).')
  if (has(p.sku)) score += 3
  else should('identifiers', 'Add the model or part number.')
  if (p.gtin && !/^\d{8,14}$/.test(p.gtin)) must('identifiers', 'The barcode should be 8 to 14 digits.')
  else if (has(p.gtin)) score += 3
  else should('identifiers', 'Add the barcode (GTIN/EAN) if the maker gives one; Google shows products with one more often.')

  // Australian compliance (20)
  let comp = 20
  const lose = (points: number, level: ListingIssue['level'], message: string) => {
    comp -= points
    issues.push({ level, field: 'compliance', message })
  }
  if (needsWels(p)) {
    if (!c.welsStars) lose(6, 'must', 'WELS: add the star rating (required when advertising taps, showers and toilets).')
    if (!has(c.welsWater)) lose(4, 'must', 'WELS: add the water use from the label (L/min, or L per flush).')
    if (!has(c.welsReg)) lose(3, 'must', 'WELS: add the registration number.')
  }
  if (needsWatermark(p) && !has(c.watermark)) lose(5, 'must', 'WaterMark: add the licence number (needed for the product to be legally installed).')
  if (p.category === 'Shower screens') {
    if (!(c.standards ?? []).some((s) => /2208/.test(s)) && !/2208/.test(text)) lose(5, 'must', 'Safety glass: state that the glass meets AS/NZS 2208.')
    if (!/\d+\s?mm\b.*glass|glass.*\d+\s?mm/i.test(text)) lose(2, 'should', 'State the glass thickness.')
  }
  const risky = RISKY.find((r) => r.test(text))
  if (risky) lose(4, 'must', `Consumer law: “${text.match(risky)?.[0]}” is a claim you’d need to prove; reword it.`)
  if (/warrant/i.test(text) && !has(c.warranty)) lose(2, 'should', 'Put the warranty’s length and what it covers in the warranty field.')
  score += Math.max(0, comp)

  // Price (5)
  if (p.price > 0) score += 5
  else must('price', 'Set a price.')

  return { score: Math.min(100, score), issues }
}

/** "Size: 610 x 360 mm" → { label: "Size", value: "610 x 360 mm" } (a line without a label keeps it as the value). */
export function toSpec(line: string): ProductSpec {
  const m = line.replace(/^\s*[•*-]\s*/, '').match(/^([^:]{1,40}):\s*(.+)$/)
  return m ? { label: m[1].trim(), value: m[2].trim() } : { label: 'Feature', value: line.replace(/^\s*[•*-]\s*/, '').trim() }
}

/** Only the known compliance fields, trimmed, with empty ones left out. */
export function cleanCompliance(c: Partial<Record<keyof ProductCompliance, unknown>> | undefined | null): ProductCompliance {
  if (!c) return {}
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : undefined)
  const stars = Number(c.welsStars)
  const out: ProductCompliance = {
    welsStars: stars > 0 && stars <= 6 ? stars : undefined,
    welsWater: str(c.welsWater),
    welsReg: str(c.welsReg),
    watermark: str(c.watermark),
    standards: Array.isArray(c.standards) ? c.standards.map(str).filter((s): s is string => !!s).slice(0, 6) : undefined,
    warranty: str(c.warranty),
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) as ProductCompliance
}
