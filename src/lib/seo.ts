// What search engines and link previews read about each public page: its address, title,
// description, picture and structured data (schema.org JSON-LD). Shared by the app (which keeps the
// page's <head> up to date as people move around) and by scripts/prerender.mts (which writes each
// public page's <head> into the built site, for crawlers and previews that don't run the app).
// Kept free of browser and build-tool APIs so both can import it.
import { BRAND } from './brand'

/** Where the site lives, without a trailing slash. */
export const DEFAULT_SITE_URL = 'https://portal.nextphasemaintenance.com.au'

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')

/** A product's own page: /store/<id>/<name>. The id finds it; the name is for people and search. */
export const productPath = (p: { id: string; title: string }) => `/store/${p.id}/${slugify(p.title) || 'product'}`

export interface ProductForSeo {
  id: string
  title: string
  description: string
  category: string
  brand: string
  sku: string
  price: number
  images: string[]
  stock: 'in_stock' | 'to_order' | 'out_of_stock'
  options?: { values: { price: number; available: boolean }[] }[]
}

export interface PageMeta {
  title: string
  description: string
  /** The page's address on the site, e.g. "/store". */
  path: string
  image?: string
  /** "product" for a product page; otherwise "website". */
  type?: 'website' | 'product'
  jsonLd?: object[]
}

/** A description cut to what search results show, at a word. */
export const snippet = (text: string, max = 158) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  return `${cut.slice(0, cut.lastIndexOf(' ') > 80 ? cut.lastIndexOf(' ') : cut.length).replace(/[,;:.\s-]+$/, '')}…`
}

export const pageTitle = (title: string) => (title === BRAND.name ? title : `${title} | ${BRAND.name}`)

/** The business, as search engines read it (on the home page and as every product's seller). */
export function businessJsonLd(siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HomeAndConstructionBusiness',
    '@id': `${siteUrl}/#business`,
    name: BRAND.name,
    url: `${siteUrl}/`,
    email: BRAND.email,
    ...(BRAND.phone ? { telephone: BRAND.phone } : {}),
    address: { '@type': 'PostalAddress', addressLocality: 'Melbourne', addressRegion: 'VIC', addressCountry: 'AU' },
    areaServed: BRAND.coverage.flatMap((c) => c.suburbs.split(' · ').map((name) => ({ '@type': 'City', name: `${name}, VIC` }))),
    openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '07:00', closes: '17:00' }],
    identifier: { '@type': 'PropertyValue', propertyID: 'ABN', value: BRAND.abn.replace(/\s/g, '') },
  }
}

const AVAILABILITY: Record<ProductForSeo['stock'], string> = {
  in_stock: 'https://schema.org/InStock',
  to_order: 'https://schema.org/BackOrder',
  out_of_stock: 'https://schema.org/OutOfStock',
}

/** The lowest and highest public price over the product's choices. */
export function priceRange(p: ProductForSeo) {
  let low = p.price
  let high = p.price
  for (const g of p.options ?? []) {
    const prices = g.values.filter((v) => v.available).map((v) => v.price)
    if (!prices.length) continue
    low += Math.min(...prices)
    high += Math.max(...prices)
  }
  return { low, high }
}

export function productJsonLd(p: ProductForSeo, siteUrl: string) {
  const url = `${siteUrl}${productPath(p)}`
  const { low, high } = priceRange(p)
  const seller = { '@id': `${siteUrl}/#business` }
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.title,
    description: snippet(p.description, 500),
    url,
    ...(p.images.length ? { image: p.images.slice(0, 5) } : {}),
    ...(p.sku ? { sku: p.sku } : {}),
    ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}),
    category: p.category,
    offers:
      low === high
        ? { '@type': 'Offer', url, price: low.toFixed(2), priceCurrency: 'AUD', availability: AVAILABILITY[p.stock], seller }
        : { '@type': 'AggregateOffer', url, lowPrice: low.toFixed(2), highPrice: high.toFixed(2), priceCurrency: 'AUD', availability: AVAILABILITY[p.stock], seller },
  }
}

export function breadcrumbJsonLd(siteUrl: string, trail: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: `${siteUrl}${t.path}` })),
  }
}

/** A product page's title, description, picture and structured data. */
export function productMeta(p: ProductForSeo, siteUrl: string): PageMeta {
  const { low, high } = priceRange(p)
  const price = low === high ? `$${low.toLocaleString('en-AU')}` : `From $${low.toLocaleString('en-AU')}`
  return {
    title: p.title,
    description: snippet(`${price} inc. GST. ${p.description} Supplied and installed in Melbourne by ${BRAND.name}.`),
    path: productPath(p),
    image: p.images[0],
    type: 'product',
    jsonLd: [
      productJsonLd(p, siteUrl),
      breadcrumbJsonLd(siteUrl, [
        { name: 'Home', path: '/' },
        { name: 'Shop', path: '/store' },
        { name: p.title, path: productPath(p) },
      ]),
    ],
  }
}

export const HOME_META = (siteUrl: string): PageMeta => ({
  title: BRAND.name,
  description: `Property maintenance in Melbourne: plumbing, electrical, carpentry, painting, plastering, handyman and emergency repairs for homes and businesses. Request a job online. ABN ${BRAND.abn}.`,
  path: '/',
  jsonLd: [businessJsonLd(siteUrl)],
})

export const STORE_META = (siteUrl: string): PageMeta => ({
  title: 'Shop bathroom and kitchen fixtures',
  description: `Vanities, shower screens, toilets, tapware and more, at Melbourne prices. Order online, and ${BRAND.name} can deliver and install.`,
  path: '/store',
  jsonLd: [
    breadcrumbJsonLd(siteUrl, [
      { name: 'Home', path: '/' },
      { name: 'Shop', path: '/store' },
    ]),
  ],
})
