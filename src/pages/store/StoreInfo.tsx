import type { ReactNode } from 'react'
import { BRAND } from '../../lib/brand'
import { SITE_URL, usePageMeta } from '../../lib/head'
import { breadcrumbJsonLd } from '../../lib/seo'
import { ACL_GUARANTEE, STORE_INFO_PAGES, STORE_POLICY, type StoreInfoSlug } from '../../lib/storePolicy'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-slate-700">{children}</div>
    </section>
  )
}

const Email = () => (
  <a className="font-semibold text-accent-ink underline-offset-2 hover:underline" href={`mailto:${BRAND.email}`}>
    {BRAND.email}
  </a>
)

const CONTENT: Record<StoreInfoSlug, () => ReactNode> = {
  delivery: () => (
    <>
      <Section title="Pickup">
        <p>Choose pickup at checkout and we'll contact you to arrange a time once your order is ready.</p>
      </Section>
      <Section title="Delivery in Melbourne">
        <p>
          We deliver across Melbourne. Delivery costs depend on the size of the order and where it's going, so we confirm the cost with you before you pay.
        </p>
        <p>Please check your order when it arrives and let us know straight away about anything damaged in transit, with a photo if you can.</p>
      </Section>
      <Section title="Supply and install">
        <p>
          Most products can be supplied and installed by our team. Mention it in your order notes, or ask for an install quote from the product page, and we'll
          quote the job before any work starts.
        </p>
      </Section>
    </>
  ),
  returns: () => (
    <>
      <Section title="Your rights under the Australian Consumer Law">
        <p>{ACL_GUARANTEE}</p>
        <p>
          If something you bought from us is faulty, doesn't match its description, or isn't fit for its purpose, contact us at <Email /> with your order number and,
          if you can, a photo. We'll arrange a repair, replacement or refund as the law requires. Please don't install an item you can see is damaged.
        </p>
      </Section>
      <Section title="Change of mind">
        {STORE_POLICY.changeOfMindDays ? (
          <p>
            You can return an unused item in its original packaging within {STORE_POLICY.changeOfMindDays} days of delivery or pickup for a change of mind. Return
            transport is at your cost. Items ordered in specially for you, and items that have been installed, can't be returned for a change of mind.
          </p>
        ) : (
          <p>Changed your mind? Contact us before returning anything and we'll tell you what's possible for that item. This doesn't affect your rights for faulty items above.</p>
        )}
      </Section>
      <Section title="Manufacturer warranties">
        <p>
          Many products come with a manufacturer's warranty, shown on the product page (for example, 5 years on a shower screen). These warranties are in addition to
          your rights under the Australian Consumer Law, not instead of them. To make a claim, contact us and we'll help you with it.
        </p>
      </Section>
    </>
  ),
  privacy: () => (
    <>
      <Section title="What we collect">
        <p>
          When you order or send an enquiry we collect your name, email, phone number, your delivery address if you choose delivery, and anything you write in the
          notes. We use these details to handle your order or enquiry: to confirm availability and costs, invoice you, arrange pickup, delivery or installation, and
          contact you about it.
        </p>
      </Section>
      <Section title="Where it's kept and who sees it">
        <p>
          Your details are stored securely with our database provider and are seen only by our team, and by the delivery company or trade doing your job when they
          need them. We don't sell your personal information.
        </p>
      </Section>
      <Section title="Website analytics">
        <p>
          We may use Google Analytics to understand how people use the site, such as which pages are viewed and when something is added to the cart. It uses cookies
          and doesn't tell us who you are.
        </p>
      </Section>
      <Section title="Seeing or correcting your information">
        <p>
          You can ask to see or correct the information we hold about you, or ask a question about privacy, by emailing <Email />. We handle personal information in line
          with the Australian Privacy Principles.
        </p>
      </Section>
    </>
  ),
  contact: () => (
    <Section title={BRAND.name}>
      <p>
        Questions about a product, an order or an installation? Email <Email />
        {BRAND.phone ? (
          <>
            {' '}
            or call{' '}
            <a className="num font-semibold text-accent-ink underline-offset-2 hover:underline" href={`tel:${BRAND.phone.replace(/\s/g, '')}`}>
              {BRAND.phone}
            </a>
          </>
        ) : null}
        .
      </p>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
        <dt className="font-semibold text-slate-900">Hours</dt>
        <dd>{BRAND.hours.map((h) => `${h.days}: ${h.time}`).join(' · ')}</dd>
        <dt className="font-semibold text-slate-900">Based in</dt>
        <dd>{BRAND.city}</dd>
        <dt className="font-semibold text-slate-900">ABN</dt>
        <dd className="num">{BRAND.abn}</dd>
      </dl>
    </Section>
  ),
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
  const Body = CONTENT[slug]
  return (
    <article className="mx-auto max-w-3xl space-y-8 py-4">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
        <a href="/store" className="hover:text-slate-900 hover:underline">Shop</a> <span aria-hidden="true">/</span> <span className="text-slate-700">{page.name}</span>
      </nav>
      <h1 className="font-display text-3xl font-bold sm:text-4xl">{page.title}</h1>
      <Body />
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
