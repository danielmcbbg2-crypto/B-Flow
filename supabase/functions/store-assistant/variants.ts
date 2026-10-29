// A product's variants (options and their choices, with prices), read exactly from the shop's own
// product data where the shop publishes it (Shopify), rather than from the page's wording.
import { safeFetch } from './photo.ts'

/** An option as the draft gives it: each choice with the price of the product with that choice. */
export interface DraftOption {
  name: string
  choices: { label: string; price: string; available: boolean }[]
}

type ShopifyProduct = {
  options?: (string | { name?: string; values?: string[] })[]
  variants?: { option1?: string | null; option2?: string | null; option3?: string | null; price?: number | string; available?: boolean }[]
}

/**
 * The options from Shopify product data (/products/<handle>.js, prices in cents). Each choice's price
 * is the cheapest variant with it, so the cheapest choice of each option adds nothing.
 */
export function fromShopify(product: ShopifyProduct): DraftOption[] | null {
  const variants = product?.variants
  if (!Array.isArray(variants) || !variants.length || !Array.isArray(product.options)) return null
  const cents = (p: number | string | undefined) => (typeof p === 'number' ? p / 100 : typeof p === 'string' && p.trim() ? Number(p) : NaN)
  const out: DraftOption[] = []
  product.options.slice(0, 3).forEach((o, i) => {
    const name = (typeof o === 'string' ? o : o?.name ?? '').trim()
    const key = `option${i + 1}` as 'option1' | 'option2' | 'option3'
    const labels = [...new Set(variants.map((v) => v[key]).filter((l): l is string => typeof l === 'string' && l.trim() !== ''))]
    // A shop's single "Title: Default Title" option isn't a real choice.
    if (!name || labels.length < 2) return
    out.push({
      name,
      choices: labels.slice(0, 30).map((label) => {
        const withIt = variants.filter((v) => v[key] === label)
        const prices = withIt.map((v) => cents(v.price)).filter((p) => Number.isFinite(p) && p >= 0)
        return { label: label.trim(), price: prices.length ? Math.min(...prices).toFixed(2) : '', available: withIt.some((v) => v.available !== false) }
      }),
    })
  })
  return out
}

/** The shop's own variant data for a product page, or null when it doesn't publish any. */
export async function shopVariants(pageUrl: string, signal: AbortSignal): Promise<DraftOption[] | null> {
  try {
    const u = new URL(pageUrl)
    const m = u.pathname.match(/^(.*\/products\/[^/]+?)\/?$/)
    if (!m) return null
    const data = await safeFetch(`${u.origin}${m[1]}.js`, AbortSignal.any([signal, AbortSignal.timeout(10000)]), 'application/json', 2_000_000)
    if (!data.type.includes('json') && !data.type.includes('javascript')) return null
    return fromShopify(JSON.parse(new TextDecoder().decode(data.bytes)))
  } catch {
    return null
  }
}
