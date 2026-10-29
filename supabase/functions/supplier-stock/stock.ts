// Reads a supplier's product page for its stock: in stock, running low, out of stock, how many and
// the price. Uses what the page states for search engines first (schema.org product data), then
// shop-platform data, then plain wording on the page. Anything it can't tell is "unknown".

export type StockStatus = 'in_stock' | 'low' | 'out_of_stock' | 'unknown'
export interface Reading {
  status: StockStatus
  qty: number | null
  price: number | null
  /** How it was worked out, for the office. */
  note: string
}

/** At or below this many left counts as running low. */
export const LOW_AT = 3

export const fromQty = (qty: number): StockStatus => (qty <= 0 ? 'out_of_stock' : qty <= LOW_AT ? 'low' : 'in_stock')

/** schema.org availability (a URL or a bare name) → our status. */
export function fromAvailability(a: string): StockStatus {
  const v = a.toLowerCase().replace(/^https?:\/\/schema\.org\//, '').replace(/[\s_-]/g, '')
  if (/^(instock|onlineonly|instoreonly|available)$/.test(v)) return 'in_stock'
  if (/^limitedavailability$/.test(v)) return 'low'
  if (/^(outofstock|soldout|discontinued|backorder|preorder|presale|madetoorder|reserved|oos|unavailable)$/.test(v)) return 'out_of_stock'
  return 'unknown'
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Every object in a JSON value, depth first. */
function* walk(v: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(v)) for (const x of v) yield* walk(x)
  else if (v && typeof v === 'object') {
    yield v as Record<string, unknown>
    for (const x of Object.values(v)) yield* walk(x)
  }
}

const isType = (o: Record<string, unknown>, t: string) => {
  const ty = o['@type']
  return Array.isArray(ty) ? ty.includes(t) : ty === t
}

/** From the page's JSON-LD product data. With several offers (sizes, colours), the best one counts. */
function fromJsonLd(html: string): Reading | null {
  const offers: Record<string, unknown>[] = []
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown
    try {
      data = JSON.parse(m[1].trim())
    } catch {
      continue
    }
    for (const o of walk(data)) if ((isType(o, 'Offer') || isType(o, 'AggregateOffer')) && ('availability' in o || 'inventoryLevel' in o)) offers.push(o)
  }
  if (!offers.length) return null
  const rank: Record<StockStatus, number> = { in_stock: 3, low: 2, out_of_stock: 1, unknown: 0 }
  let best: Reading | null = null
  for (const o of offers) {
    const level = o.inventoryLevel as { value?: unknown } | number | undefined
    const qty = num(typeof level === 'object' ? level?.value : level)
    const status = qty !== null ? fromQty(qty) : fromAvailability(String(o.availability ?? ''))
    const r: Reading = { status, qty, price: num(o.price ?? o.lowPrice), note: 'from the page’s product data' }
    if (!best || rank[r.status] > rank[best.status]) best = r
  }
  return best && best.status !== 'unknown' ? best : null
}

/**
 * The product's price wherever the page states it: its product data (an offer's price, lowest price
 * or price specification), price meta tags, microdata, or the shop's own price attributes (Magento's
 * data-price-amount). null if it doesn't state one.
 */
export function findPrice(html: string): number | null {
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown
    try {
      data = JSON.parse(m[1].trim())
    } catch {
      continue
    }
    for (const o of walk(data)) {
      if (!isType(o, 'Offer') && !isType(o, 'AggregateOffer')) continue
      const spec = o.priceSpecification as Record<string, unknown> | Record<string, unknown>[] | undefined
      const p = num(o.price ?? o.lowPrice ?? (Array.isArray(spec) ? spec[0]?.price : spec?.price))
      if (p) return p
    }
  }
  const patterns = [
    /property\s*=\s*["'](?:product|og):price:amount["'][^>]*content\s*=\s*["']([\d.,]+)["']/i,
    /content\s*=\s*["']([\d.,]+)["'][^>]*property\s*=\s*["'](?:product|og):price:amount["']/i,
    /itemprop\s*=\s*["']price["'][^>]*content\s*=\s*["']([\d.,]+)["']/i,
    /content\s*=\s*["']([\d.,]+)["'][^>]*itemprop\s*=\s*["']price["']/i,
    /data-price-amount\s*=\s*["']([\d.]+)["']/i,
  ]
  for (const re of patterns) {
    const p = num(html.match(re)?.[1].replace(/,/g, ''))
    if (p) return p
  }
  return null
}

/** From microdata or meta tags (itemprop="availability", product:availability). */
function fromTags(html: string): Reading | null {
  const m =
    html.match(/itemprop\s*=\s*["']availability["'][^>]*(?:content|href)\s*=\s*["']([^"']+)["']/i) ??
    html.match(/(?:content|href)\s*=\s*["']([^"']+)["'][^>]*itemprop\s*=\s*["']availability["']/i) ??
    html.match(/property\s*=\s*["'](?:product|og):availability["'][^>]*content\s*=\s*["']([^"']+)["']/i) ??
    html.match(/content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["'](?:product|og):availability["']/i)
  if (!m) return null
  const status = fromAvailability(m[1])
  if (status === 'unknown') return null
  const price = html.match(/property\s*=\s*["'](?:product|og):price:amount["'][^>]*content\s*=\s*["']([\d.,]+)["']/i)
  return { status, qty: null, price: price ? num(price[1]) : null, note: 'from the page’s stock tag' }
}

/** The page's visible words (scripts, styles and tags removed), squeezed. */
export function pageText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** From plain wording ("12 in stock", "Only 2 left", "Sold out"), only when it's clear-cut. */
function fromWords(text: string): Reading | null {
  const qtyMatch = text.match(/\b(\d{1,5})\s+(?:in stock|available|units? available|left in stock)\b/i) ?? text.match(/\bonly\s+(\d{1,4})\s+left\b/i)
  if (qtyMatch) {
    const qty = Number(qtyMatch[1])
    return { status: fromQty(qty), qty, price: null, note: `the page says “${qtyMatch[0]}”` }
  }
  const out = text.match(/\b(out of stock|sold out|currently unavailable|no longer available|temporarily unavailable)\b/i)
  const inn = text.match(/\b(in stock|available now|ready to ship|ships today)\b/i)
  // Both (e.g. related products) or neither: can't tell from the words alone.
  if (out && !inn) return { status: 'out_of_stock', qty: null, price: null, note: `the page says “${out[0]}”` }
  if (inn && !out) return { status: 'in_stock', qty: null, price: null, note: `the page says “${inn[0]}”` }
  return null
}

/** Shopify's product data (/products/<handle>.js): whether any variant is available, and how many. */
export function fromShopify(product: { available?: boolean; price?: number; variants?: { available?: boolean; inventory_quantity?: number; price?: number | string }[] }): Reading | null {
  if (typeof product?.available !== 'boolean') return null
  const counts = (product.variants ?? []).map((v) => v.inventory_quantity).filter((q): q is number => typeof q === 'number')
  const qty = counts.length ? Math.max(0, counts.reduce((a, b) => a + Math.max(0, b), 0)) : null
  const price = typeof product.price === 'number' ? product.price / 100 : null
  const status = !product.available ? 'out_of_stock' : qty !== null ? fromQty(qty) : 'in_stock'
  return { status, qty: product.available ? qty : 0, price, note: 'from the shop’s product data' }
}

/** Everything the page itself says, best source first; null if it doesn't say. */
export function readStock(html: string): Reading | null {
  return fromJsonLd(html) ?? fromTags(html) ?? fromWords(pageText(html))
}

/** A short fingerprint of the page's words, to tell whether it changed since last time. */
export async function fingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('')
}
