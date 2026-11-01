// Runs after `vite build`: writes each public page (home, shop, services, every published product)
// into dist/ as its own index.html with its title, description, canonical address, link preview and
// structured data already in the <head>, plus its words and links in the page, so search engines
// and link previews (Facebook, WhatsApp, Messages) read it without running the app. Then writes
// sitemap.xml, robots.txt and Netlify's _redirects (everything else loads the app).
//
// Products come from the database with the public (anon) key, as visitors see them. Without the
// Supabase settings (or if it can't be reached) the products are left out and the rest still built.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BRAND } from '../src/lib/brand'
import { DEFAULT_SITE_URL, HOME_META, pageTitle, productMeta, productPath, STORE_META, breadcrumbJsonLd, businessJsonLd, type PageMeta, type ProductForSeo } from '../src/lib/seo'
import { SERVICE_PAGES, servicePath } from '../src/lib/services'

const DIST = 'dist'
const SITE = (process.env.VITE_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '')
const template = readFileSync(join(DIST, 'index.html'), 'utf8')

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// JSON inside <script>: no closing tags or HTML comments can sneak out.
const ldJson = (o: object) => JSON.stringify(o).replace(/</g, '\\u003c')

async function products(): Promise<ProductForSeo[]> {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.log('prerender: no Supabase settings, so no product pages')
    return []
  }
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/products?status=eq.published&select=id,title,description,category,brand,sku,price,images,stock,options&order=title`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
    const rows = (await res.json()) as (ProductForSeo & { price: number | string })[]
    return rows.map((r) => ({
      ...r,
      price: Number(r.price),
      images: r.images ?? [],
      options: (r.options ?? []).map((g) => ({ values: g.values.map((v) => ({ price: Number(v.price), available: v.available !== false })) })),
    }))
  } catch (e) {
    console.warn(`prerender: couldn't load products (${(e as Error).message}); building without them`)
    return []
  }
}

/** The page's own <head> tags, and its words and links for crawlers (the app replaces them when it starts). */
function render(m: PageMeta, body: string): string {
  const url = `${SITE}${m.path}`
  const title = pageTitle(m.title)
  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:site_name" content="${esc(BRAND.name)}" />`,
    `<meta property="og:locale" content="en_AU" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:type" content="${m.type ?? 'website'}" />`,
    ...(m.image ? [`<meta property="og:image" content="${esc(m.image)}" />`] : []),
    `<meta name="twitter:card" content="${m.image ? 'summary_large_image' : 'summary'}" />`,
    ...(m.jsonLd ?? []).map((ld) => `<script type="application/ld+json" data-page-ld>${ldJson(ld)}</script>`),
  ].join('\n    ')
  return template
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/<meta name="description"[^>]*>/, '')
    .replace('</head>', `    ${head}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`)
}

function write(path: string, html: string) {
  const file = join(DIST, path === '/' ? 'index.html' : join(path.replace(/^\//, ''), 'index.html'))
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, html)
}

const link = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`
const list = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
const nav = `<nav>${link('/', 'Home')} · ${link('/store', 'Shop')} · ${SERVICE_PAGES.map((s) => link(servicePath(s), s.name)).join(' · ')}</nav>`

const all = await products()
const pages: { path: string; lastmod?: string }[] = []

// Home
const home = HOME_META(SITE)
write('/', render(home, `<main><h1>${esc(BRAND.name)}</h1><p>${esc(home.description)}</p>${nav}</main>`))
pages.push({ path: '/' })

// Shop
const store = STORE_META(SITE)
write(
  '/store',
  render(
    { ...store, jsonLd: [...(store.jsonLd ?? []), { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: all.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}${productPath(p)}`, name: p.title })) }] },
    `<main><h1>Shop</h1><p>${esc(store.description)}</p>${list(all.map((p) => link(productPath(p), p.title)))}${nav}</main>`,
  ),
)
pages.push({ path: '/store' })

// Services
for (const s of SERVICE_PAGES) {
  const meta: PageMeta = {
    title: s.title,
    description: s.description,
    path: servicePath(s),
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'Service', name: s.title, serviceType: s.name, description: s.description, url: `${SITE}${servicePath(s)}`, provider: businessJsonLd(SITE), areaServed: { '@type': 'City', name: 'Melbourne' } },
      breadcrumbJsonLd(SITE, [
        { name: 'Home', path: '/' },
        { name: s.name, path: servicePath(s) },
      ]),
    ],
  }
  write(
    servicePath(s),
    render(meta, `<main><h1>${esc(s.title)}</h1><p>${esc(s.intro)}</p>${list(s.jobs.map(esc))}${s.details.map((d) => `<h2>${esc(d.heading)}</h2><p>${esc(d.body)}</p>`).join('')}${nav}</main>`),
  )
  pages.push({ path: servicePath(s) })
}

// Products
for (const p of all) {
  const meta = productMeta(p, SITE)
  write(
    productPath(p),
    render(meta, `<main><h1>${esc(p.title)}</h1><p>${esc(meta.description)}</p>${p.images[0] ? `<img src="${esc(p.images[0])}" alt="${esc(p.title)}" />` : ''}<p>${esc(p.description)}</p>${link('/store', 'Back to the shop')}${nav}</main>`),
  )
  pages.push({ path: productPath(p) })
}

const today = new Date().toISOString().slice(0, 10)
writeFileSync(
  join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${esc(`${SITE}${p.path}`)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`,
)
writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`)
// Netlify: pages written above are served as they are; any other address loads the app.
writeFileSync(join(DIST, '_redirects'), '/*  /index.html  200\n')
console.log(`prerender: ${pages.length} pages (${all.length} products) for ${SITE}`)
