import { BRAND } from '../../lib/brand'
import { SITE_URL, usePageMeta } from '../../lib/head'
import { breadcrumbJsonLd } from '../../lib/seo'
import { STORE_INFO_PAGES, storeInfoSections, type StoreInfoSlug } from '../../lib/storePolicy'

/** A paragraph, with {email} and {phone} as links. */
function Paragraph({ text }: { text: string }) {
  const link = 'font-semibold text-accent-ink underline-offset-2 hover:underline'
  return (
    <p>
      {text.split(/(\{email\}|\{phone\})/).map((part, i) =>
        part === '{email}' ? (
          <a key={i} className={link} href={`mailto:${BRAND.email}`}>{BRAND.email}</a>
        ) : part === '{phone}' ? (
          <a key={i} className={`num ${link}`} href={`tel:${BRAND.phone.replace(/\s/g, '')}`}>{BRAND.phone}</a>
        ) : (
          part
        ),
      )}
    </p>
  )
}

/** One of the shop's information pages: delivery, returns, privacy, contact. */
export function StoreInfo({ slug }: { slug: StoreInfoSlug }) {
  const page = STORE_INFO_PAGES.find((p) => p.slug === slug)!
  usePageMeta({
    title: page.title,
    description: page.description,
    path: `/store/${slug}`,
    jsonLd: [
      breadcrumbJsonLd(SITE_URL, [
        { name: 'Home', path: '/' },
        { name: 'Shop', path: '/store' },
        { name: page.name, path: `/store/${slug}` },
      ]),
    ],
  })
  return (
    <article className="mx-auto max-w-3xl space-y-8 py-4">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
        <a href="/store" className="hover:text-slate-900 hover:underline">Shop</a> <span aria-hidden="true">/</span> <span className="text-slate-700">{page.name}</span>
      </nav>
      <h1 className="font-display text-3xl font-bold sm:text-4xl">{page.title}</h1>
      {storeInfoSections(slug).map((sec) => (
        <section key={sec.title} className="space-y-3">
          <h2 className="font-display text-xl font-bold">{sec.title}</h2>
          <div className="space-y-3 text-[15px] leading-relaxed text-slate-700">
            {sec.paragraphs.map((t) => <Paragraph key={t} text={t} />)}
          </div>
        </section>
      ))}
    </article>
  )
}

/** The shop's footer: its information pages and the business's details. */
export function StoreFooter() {
  return (
    <footer className="mt-16 bg-slate-900 text-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <p className="font-display text-lg font-bold">{BRAND.name}</p>
          <p className="mt-2 text-sm text-white/70">Bathroom and kitchen fixtures, supplied and installed across Melbourne.</p>
        </div>
        <nav aria-label="Shop information" className="text-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/60">Help</p>
          <ul className="space-y-1.5">
            {STORE_INFO_PAGES.map((p) => (
              <li key={p.slug}>
                <a href={`/store/${p.slug}`} className="text-white/85 hover:text-white hover:underline">{p.name}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="text-sm text-white/85">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/60">Contact</p>
          <p><a href={`mailto:${BRAND.email}`} className="hover:text-white hover:underline">{BRAND.email}</a></p>
          {BRAND.phone && <p className="num mt-1">{BRAND.phone}</p>}
          <p className="mt-1">{BRAND.hours[0] && `${BRAND.hours[0].days}, ${BRAND.hours[0].time}`}</p>
        </div>
        <div className="text-sm text-white/70">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/60">Business</p>
          <p>{BRAND.city}</p>
          <p className="mt-1">ABN <span className="num text-white">{BRAND.abn}</span></p>
          <p className="mt-1">Prices include GST.</p>
        </div>
      </div>
    </footer>
  )
}
