import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Logo } from '../components/Logo'
import { SignInModal } from '../components/SignInModal'
import { PaymentSafety } from '../components/PaymentSafety'
import { BRAND } from '../lib/brand'
import { SITE_URL, usePageMeta } from '../lib/head'
import { breadcrumbJsonLd } from '../lib/seo'
import { navigate } from '../lib/router'
import { useStore } from '../lib/store'
import { LEGAL_LINKS, LEGAL_PAGES, legalSections, type LegalSlug } from '../lib/legal'
import { ServiceLinks } from './ServicePage'

const TOKENS = new RegExp(`(${Object.keys(LEGAL_LINKS).map((k) => `\\{${k}\\}`).join('|')})`)

/** A paragraph whose {tokens} become links. External links open in a new tab. */
function Paragraph({ text }: { text: string }) {
  const cls = 'font-semibold text-accent-ink underline-offset-2 hover:underline'
  return (
    <p>
      {text.split(TOKENS).map((part, i) => {
        const link = part.startsWith('{') && LEGAL_LINKS[part.slice(1, -1)]
        if (!link) return part
        const external = /^https?:\/\//.test(link.href)
        return (
          <a key={i} className={cls} href={link.href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {link.label}
          </a>
        )
      })}
    </p>
  )
}

/** A top-level legal page (/privacy, /terms): public, indexed, with the site header and footer. */
export function LegalPage({ slug }: { slug: LegalSlug }) {
  const { user } = useStore()
  const [signIn, setSignIn] = useState(false)
  const page = LEGAL_PAGES.find((p) => p.slug === slug)!
  usePageMeta({
    title: page.title,
    description: page.description,
    path: `/${slug}`,
    jsonLd: [
      breadcrumbJsonLd(SITE_URL, [
        { name: 'Home', path: '/' },
        { name: page.name, path: `/${slug}` },
      ]),
    ],
  })

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-6 text-[15px] md:flex">
            <a href="/" className="hover:text-accent-ink">Home</a>
            <a href="/store" className="font-semibold hover:text-accent-ink">Shop</a>
          </nav>
          {user ? (
            <button className="btn-accent text-[15px] font-normal" onClick={() => navigate(`/${user.role}`)}>
              Open portal <ArrowRight size={16} />
            </button>
          ) : (
            <button className="btn-accent text-[15px] font-normal" onClick={() => setSignIn(true)}>Sign in</button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
          <a href="/" className="hover:text-slate-900 hover:underline">Home</a> <span aria-hidden="true">/</span>{' '}
          <span className="text-slate-700">{page.name}</span>
        </nav>
        <h1 className="mt-4 font-display text-3xl font-bold sm:text-4xl">{page.title}</h1>
        <div className="mt-10 space-y-8">
          {legalSections(slug).map((sec) => (
            <section key={sec.title} className="space-y-3">
              <h2 className="font-display text-xl font-bold">{sec.title}</h2>
              <div className="space-y-3 text-[15px] leading-relaxed text-slate-700">
                {sec.paragraphs.map((t, i) => <Paragraph key={i} text={t} />)}
              </div>
            </section>
          ))}
        </div>
      </main>

      <footer className="bg-slate-900 text-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <ServiceLinks className="text-white/80" />
          <PaymentSafety inverted className="mt-8" />
          <div className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <Logo inverted />
            <div className="text-sm text-white/70 sm:text-right">
              <nav aria-label="Legal" className="mb-2 flex gap-4 sm:justify-end">
                <a href="/privacy" className="hover:text-white hover:underline">Privacy Policy</a>
                <a href="/terms" className="hover:text-white hover:underline">Terms of Use</a>
              </nav>
              <p>© {new Date().getFullYear()} {BRAND.name} · {BRAND.city}</p>
              <p className="mt-1">ABN <span className="text-white">{BRAND.abn}</span></p>
            </div>
          </div>
        </div>
      </footer>

      <SignInModal open={signIn} onClose={() => setSignIn(false)} />
    </div>
  )
}
