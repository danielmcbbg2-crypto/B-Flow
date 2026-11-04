import { useState } from 'react'
import { ArrowRight, Check, MapPin } from 'lucide-react'
import { Logo } from '../components/Logo'
import { SignInModal } from '../components/SignInModal'
import { BRAND } from '../lib/brand'
import { SITE_URL, usePageMeta } from '../lib/head'
import { navigate } from '../lib/router'
import { breadcrumbJsonLd, businessJsonLd } from '../lib/seo'
import { SERVICE_PAGES, servicePath } from '../lib/services'
import { useStore } from '../lib/store'
import { REQUEST_SERVICES, RequestMaintenanceModal, SERVICE_ICONS } from './LeadCapture'
import { PaymentSafety } from '../components/PaymentSafety'

/** Links to every service page, for the footer of the public pages. */
export function ServiceLinks({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="Services" className={className}>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        {SERVICE_PAGES.map((s) => (
          <li key={s.slug}>
            <a href={servicePath(s)} className="hover:underline">
              {s.name}
            </a>
          </li>
        ))}
        <li>
          <a href="/store" className="hover:underline">
            Shop fixtures
          </a>
        </li>
      </ul>
    </nav>
  )
}

/** A service's own page (/services/<slug>): what it covers, where, and a button to request it. */
export function ServicePage({ slug }: { slug: string }) {
  const { user } = useStore()
  const s = SERVICE_PAGES.find((x) => x.slug === slug)
  const [signIn, setSignIn] = useState(false)
  const [request, setRequest] = useState<number | null>(null)
  usePageMeta(
    s
      ? {
          title: s.title,
          description: s.description,
          path: servicePath(s),
          jsonLd: [
            {
              '@context': 'https://schema.org',
              '@type': 'Service',
              name: s.title,
              serviceType: s.name,
              description: s.description,
              url: `${SITE_URL}${servicePath(s)}`,
              provider: businessJsonLd(SITE_URL),
              areaServed: { '@type': 'City', name: 'Melbourne' },
            },
            breadcrumbJsonLd(SITE_URL, [
              { name: 'Home', path: '/' },
              { name: s.name, path: servicePath(s) },
            ]),
          ],
        }
      : null,
  )
  // Signed-in clients lodge it in their portal; everyone else gets the request pop-up.
  const ask = () => (user ? navigate(`/${user.role}`) : setRequest(Date.now()))
  const requestable = s ? (REQUEST_SERVICES as readonly string[]).includes(s.name) : false
  const Icon = s ? SERVICE_ICONS[s.name] : null

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

      {!s ? (
        <main className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
          <h1 className="text-3xl font-bold">We couldn’t find that page</h1>
          <p className="mt-4 font-light">Here’s everything we do:</p>
          <ServiceLinks className="mt-6" />
        </main>
      ) : (
        <main>
          <section className="bg-white">
            <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
              <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
                <a href="/" className="hover:underline">Home</a> <span aria-hidden="true">/</span> {s.name}
              </nav>
              <div className="mt-6 flex items-start gap-5">
                {Icon && <Icon strokeWidth={1.25} className="hidden h-14 w-14 shrink-0 text-accent sm:block" aria-hidden="true" />}
                <div>
                  <h1 className="text-4xl font-bold leading-tight text-accent-heading sm:text-5xl">{s.title}</h1>
                  <p className="mt-6 max-w-2xl text-lg font-light leading-[1.8]">{s.intro}</p>
                  <div className="mt-8 flex flex-wrap gap-3">
                    {requestable ? (
                      <button className="btn-accent px-7 py-3.5 text-base font-normal" onClick={ask}>
                        Request {s.name.replace(/ Services$/, '').toLowerCase()} <ArrowRight size={16} />
                      </button>
                    ) : (
                      <a href={`mailto:${BRAND.email}?subject=${encodeURIComponent(s.name)}`} className="btn-accent px-7 py-3.5 text-base font-normal">
                        Ask us about packages <ArrowRight size={16} />
                      </a>
                    )}
                    {BRAND.phone && (
                      <a href={`tel:${BRAND.phone.replace(/\s/g, '')}`} className="btn-ghost px-7 py-3.5 text-base">
                        Call {BRAND.phone}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2">
            <div>
              <h2 className="rule-above text-2xl font-bold">What we do</h2>
              <ul className="mt-6 space-y-3">
                {s.jobs.map((j) => (
                  <li key={j} className="flex gap-3">
                    <Check size={20} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                    <span className="font-light">{j}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-8">
              {s.details.map((d) => (
                <div key={d.heading}>
                  <h2 className="text-xl font-bold">{d.heading}</h2>
                  <p className="mt-2 font-light leading-[1.8]">{d.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white">
            <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
              <h2 className="rule-above text-2xl font-bold">Where we work</h2>
              <p className="mt-6 max-w-xl font-light leading-[1.8]">{s.name} across metropolitan Melbourne, including:</p>
              <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {BRAND.coverage.map((c) => (
                  <div key={c.region} className="bg-slate-50 p-6">
                    <MapPin size={24} strokeWidth={1.25} className="text-accent" aria-hidden="true" />
                    <h3 className="mt-3 font-bold">{c.region}</h3>
                    <p className="mt-1 text-sm font-light leading-relaxed">{c.suburbs}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </main>
      )}

      <footer className="bg-slate-900 text-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <ServiceLinks className="text-white/80" />
          <PaymentSafety inverted className="mt-8" />
          <div className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <Logo inverted />
            <div className="text-sm text-white/70 sm:text-right">
              <p>© {new Date().getFullYear()} {BRAND.name} · {BRAND.city}</p>
              <p className="mt-1">ABN <span className="text-white">{BRAND.abn}</span></p>
            </div>
          </div>
        </div>
      </footer>

      <SignInModal open={signIn} onClose={() => setSignIn(false)} />
      {s && request && <RequestMaintenanceModal key={request} open service={s.name} onClose={() => setRequest(null)} />}
    </div>
  )
}
