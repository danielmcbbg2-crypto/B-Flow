// Supabase Edge Function: the store's product feed, as RSS 2.0 with Google's product fields. Google
// Merchant Center (free listings and Shopping ads) and Meta Commerce Manager (Facebook and Instagram
// Shop catalogue) both read this format: add the function's link as a scheduled feed in either, and
// the listings follow the store (publish, re-price or archive a product and they pick it up on their
// next fetch).
//
// Public and read-only (deployed with verify_jwt off): it reads with the anon key, so it only ever
// sees what the store already shows visitors (published products at the public price).
//
// Each item links to the product's own page (/store/<id>/<name>, as src/lib/seo.ts productPath
// makes it) and is priced as that page first shows it: the public price plus the first available
// choice of each option.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const STORE = 'https://portal.nextphasemaintenance.com.au'
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)

type Value = { id: string; label: string; price?: number; available?: boolean }
type Option = { id: string; name: string; values: Value[] }
type Compliance = { welsStars?: number; welsWater?: string; welsReg?: string; watermark?: string; standards?: string[]; warranty?: string }
type Row = {
  id: string
  title: string
  description: string | null
  category: string | null
  brand: string | null
  sku: string | null
  price: number | string
  images: string[] | null
  stock: 'in_stock' | 'to_order' | 'out_of_stock'
  options: Option[] | null
  specs?: { label: string; value: string }[] | null
  highlights?: string[] | null
  gtin?: string | null
  compliance?: Compliance | null
}

// Same as src/lib/seo.ts slugify and productPath (the site's product addresses).
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')
const productPath = (p: { id: string; title: string }) => `/store/${p.id}/${slugify(p.title) || 'product'}`

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
// Characters XML doesn't allow at all (control codes) would make the whole file fail.
const clean = (s: string | null | undefined, max: number) =>
  // eslint-disable-next-line no-control-regex
  String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max)

/** The price the store first shows a visitor: the first available choice of each option (as the shop picks it). */
function shownPrice(p: Row): number {
  return (p.options ?? []).reduce((sum, g) => {
    const v = g.values.find((x) => x.available !== false) ?? g.values[0]
    return sum + Number(v?.price ?? 0)
  }, Number(p.price))
}

/** Specs and compliance details as Google product details (section, name, value). */
function details(p: Row): [string, string, string][] {
  const c = p.compliance ?? {}
  const out: [string, string, string][] = (p.specs ?? []).map((s) => ['Specifications', clean(s.label, 140), clean(s.value, 1000)])
  if (c.welsStars) out.push(['Compliance', 'WELS rating', `${c.welsStars} star${c.welsWater ? ` (${c.welsWater})` : ''}${c.welsReg ? `, registration ${c.welsReg}` : ''}`])
  if (c.watermark) out.push(['Compliance', 'WaterMark', clean(c.watermark, 1000)])
  for (const s of c.standards ?? []) out.push(['Compliance', 'Standard', clean(s, 1000)])
  if (c.warranty) out.push(['Compliance', 'Warranty', `${clean(c.warranty, 900)}, plus your rights under the Australian Consumer Law`])
  return out.filter(([, n, v]) => n && v)
}

function item(p: Row, restockDate: string): string {
  const images = (p.images ?? []).filter((u) => /^https:\/\//.test(u))
  const brand = clean(p.brand, 70)
  const sku = clean(p.sku, 70)
  const gtin = /^\d{8,14}$/.test(p.gtin ?? '') ? p.gtin! : ''
  const tag = (k: string, v: string) => `  <${k}>${esc(v)}</${k}>`
  const fields: [string, string][] = [
    ['g:id', p.id],
    ['g:title', clean(p.title, 150)],
    ['g:description', clean(p.description, 5000) || clean(p.title, 150)],
    ['g:link', `${STORE}${productPath(p)}`],
    ['g:image_link', images[0] ?? ''],
    ...images.slice(1, 11).map((u): [string, string] => ['g:additional_image_link', u]),
    ['g:availability', p.stock === 'in_stock' ? 'in_stock' : p.stock === 'to_order' ? 'backorder' : 'out_of_stock'],
    ...(p.stock === 'to_order' ? [['g:availability_date', restockDate] as [string, string]] : []),
    ['g:price', `${shownPrice(p).toFixed(2)} AUD`],
    ['g:condition', 'new'],
    ['g:product_type', clean(p.category, 750)],
    ...(brand ? [['g:brand', brand] as [string, string]] : []),
    ...(sku ? [['g:mpn', sku] as [string, string]] : []),
    ...(gtin ? [['g:gtin', gtin] as [string, string]] : []),
    // Without a barcode, Google needs brand and part number together, or to be told there are none.
    ...(gtin || (brand && sku) ? [] : [['g:identifier_exists', 'no'] as [string, string]]),
    ...(p.highlights ?? []).slice(0, 10).map((h): [string, string] => ['g:product_highlight', clean(h, 150)]),
  ]
  const lines = fields.filter(([, v]) => v).map(([k, v]) => tag(k, v))
  for (const [section, name, value] of details(p)) {
    lines.push(`  <g:product_detail>\n  ${tag('g:section_name', section)}\n  ${tag('g:attribute_name', name)}\n  ${tag('g:attribute_value', value)}\n  </g:product_detail>`)
  }
  return `<item>\n${lines.join('\n')}\n</item>`
}

const BASIC = 'id, title, description, category, brand, sku, price, images, stock, options'

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
  const rows: Row[] = []
  // With the listing details where the database has them (migration 20261107000000), else the basics.
  let cols = `${BASIC}, specs, highlights, gtin, compliance`
  for (let from = 0; ; from += 1000) {
    let { data, error } = await db.from('products').select(cols).eq('status', 'published').order('id').range(from, from + 999)
    if (error && cols !== BASIC) {
      cols = BASIC
      ;({ data, error } = await db.from('products').select(cols).eq('status', 'published').order('id').range(from, from + 999))
    }
    if (error) {
      console.error('google-shopping-feed failed:', error.message)
      return new Response('The feed is unavailable right now. Try again shortly.', { status: 503 })
    }
    rows.push(...((data ?? []) as unknown as Row[]))
    if (!data || data.length < 1000) break
  }
  // Listings without a photo or price are rejected and flag the feed: leave them out.
  const listable = rows.filter((p) => (p.images ?? []).some((u) => /^https:\/\//.test(u)) && Number(p.price) > 0)
  // "To order" items need a date they'll be available; two weeks out is a fair estimate.
  const restockDate = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10)
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>Next Phase Maintenance Store</title>
<link>${STORE}/store</link>
<description>Bathroom and kitchen fixtures from Next Phase Maintenance, Melbourne</description>
${listable.map((p) => item(p, restockDate)).join('\n')}
</channel>
</rss>
`
  return new Response(req.method === 'HEAD' ? null : xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=900' },
  })
})
