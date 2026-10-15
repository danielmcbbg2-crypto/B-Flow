import { useState, type MouseEvent } from 'react'
import {
  ArrowRight,
  BrickWall,
  CalendarCheck,
  Cog,
  Hammer,
  HardHat,
  Mail,
  MapPin,
  Paintbrush,
  Phone,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { Logo } from '../components/Logo'
import { SignInModal } from '../components/SignInModal'
import { BRAND, SITE_COPY, SITE_SERVICES } from '../lib/brand'
import { useStore } from '../lib/store'
import { navigate } from '../lib/router'
import interiorPhoto from '../assets/photos/interior.webp'
import residentialPhoto from '../assets/photos/residential.webp'
import commercialPhoto from '../assets/photos/commercial.webp'
import conciergePhoto from '../assets/photos/concierge.webp'

const SERVICE_ICONS: Record<(typeof SITE_SERVICES)[number], LucideIcon> = {
  'Plumbing Services': Wrench,
  'Electrical Services': Zap,
  'Painting and Decorating': Paintbrush,
  'Handyman Services': HardHat,
  'Carpentry Services': Hammer,
  'Plastering Services': BrickWall,
  'Emergency Repairs': Cog,
  'Subscription Packages': CalendarCheck,
}

function jump(id: string) {
  return (e: MouseEvent) => {
    e.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }
}

const NAV = [
  ['about', 'About'],
  ['services', 'Services'],
  ['portal', 'Client portal'],
  ['coverage', 'Coverage'],
  ['contact', 'Contact'],
] as const

/** Text-and-photo block in the website's alternating layout. */
function Feature({ title, body, photo, alt, flip }: { title: string; body: string; photo: string; alt: string; flip?: boolean }) {
  return (
    <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
      <div className={flip ? 'md:order-2' : undefined}>
        <h2 className="rule-above text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
        <p className="mt-6 max-w-md text-lg font-light leading-loose text-slate-900">{body}</p>
      </div>
      <img src={photo} alt={alt} className={`aspect-[16/13] w-full object-cover ${flip ? 'md:order-1' : ''}`} loading="lazy" />
    </div>
  )
}

export function PublicHome() {
  const { user, authNotice } = useStore()
  const [signIn, setSignIn] = useState(false)
  const openPortal = () => (user ? navigate(`/${user.role}`) : setSignIn(true))

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-7 text-[15px] text-slate-900 lg:flex">
            {NAV.map(([id, label]) => (
              <a key={id} href={`#${id}`} onClick={jump(id)} className="hover:text-accent-ink">
                {label}
              </a>
            ))}
          </nav>
          {user ? (
            <button className="btn-accent" onClick={() => navigate(`/${user.role}`)}>
              Open portal <ArrowRight size={16} />
            </button>
          ) : (
            <button className="btn-accent" onClick={() => setSignIn(true)}>
              Sign in
            </button>
          )}
        </div>
      </header>

      {authNotice && !user && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-center text-sm text-red-700">{authNotice}</div>
      )}

      {/* Hero: full-bleed interior photo with the website's headline */}
      <section className="relative isolate overflow-hidden bg-[#3d342d]">
        <img src={interiorPhoto} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover object-[70%_50%]" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/60 via-black/35 to-black/10" />
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32 lg:py-40">
          <h1 className="max-w-4xl text-[2.75rem] font-bold leading-[1.02] tracking-tight text-white sm:text-6xl lg:text-[5.5rem]">
            {SITE_COPY.heroTitle}
          </h1>
          <p className="mt-6 text-xl font-light text-white sm:text-2xl">{SITE_COPY.heroSubtitle}</p>
          <div className="mt-10 flex flex-wrap gap-4">
            <a href="#about" onClick={jump('about')} className="btn-accent px-7 py-3.5 text-base font-normal">
              Learn More About Us
            </a>
            <a
              href="#contact"
              onClick={jump('contact')}
              className="btn border border-white px-7 py-3.5 text-base font-light text-white hover:bg-white hover:text-slate-900"
            >
              Get in Touch
            </a>
          </div>
          <p className="mt-10 text-sm text-white/80">
            Melbourne, VIC <span className="mx-2 text-white/40">/</span> ABN <span className="num">{BRAND.abn}</span>
          </p>
        </div>
      </section>

      {/* Residential, commercial and specialised services, as on the website */}
      <section id="about" className="scroll-mt-16">
        <div className="mx-auto grid max-w-7xl gap-20 px-4 py-20 sm:px-6 sm:py-28">
          <Feature title={SITE_COPY.residential.title} body={SITE_COPY.residential.body} photo={residentialPhoto} alt="Open-plan home with timber stairs and dining area" />
          <Feature title={SITE_COPY.commercial.title} body={SITE_COPY.commercial.body} photo={commercialPhoto} alt="Team meeting in a glass-walled office" flip />
          <Feature title={SITE_COPY.specialized.title} body={SITE_COPY.specialized.body} photo={conciergePhoto} alt="Hotel concierge at a reception desk" />
        </div>
      </section>

      <section id="services" className="scroll-mt-16 border-t border-slate-200">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-lg text-slate-900">{SITE_COPY.servicesEyebrow}</p>
              <h2 className="mt-2 text-4xl font-bold leading-tight tracking-tight text-accent sm:text-5xl">{SITE_COPY.servicesTitle}</h2>
              <p className="mt-6 max-w-lg text-lg font-light leading-loose">{SITE_COPY.servicesIntro}</p>
            </div>
            <button className="btn-accent shrink-0 self-start px-7 py-3.5 text-base font-normal" onClick={openPortal}>
              Request a Service
            </button>
          </div>
          <ul className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SITE_SERVICES.map((name) => {
              const Icon = SERVICE_ICONS[name]
              return (
                <li key={name} className="flex min-h-[220px] flex-col bg-white p-8 sm:p-10">
                  <Icon size={52} strokeWidth={1.25} className="text-accent" aria-hidden="true" />
                  <span className="mt-6 text-[22px] leading-snug text-slate-900">{name}</span>
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      <section id="portal" className="scroll-mt-16 bg-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-3">
          <div>
            <h2 className="rule-above text-3xl font-bold tracking-tight sm:text-4xl">One portal for every job</h2>
            <p className="mt-6 text-lg font-light leading-loose">
              Clients, trades and our office work from the same live record, from the first photo to the final invoice.
            </p>
            <button className="btn-primary mt-8 px-6 py-3" onClick={openPortal}>
              {user ? 'Open your portal' : 'Client & trade sign in'}
            </button>
          </div>
          <ol className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:col-span-2">
            {[
              ['Lodge a request', 'Submit jobs with photos from the client portal. Urgent jobs alert our team by SMS straight away.'],
              ['We triage & dispatch', 'We assign the right licensed tradesperson, confirm the visit and keep you updated.'],
              ['Track it live', 'Follow progress, completion photos and project milestones in your Maintenance Hub.'],
              ['Invoiced & recorded', 'Invoices are issued through QuickBooks, and paint colours and finishes are kept on your property record.'],
            ].map(([title, body], i) => (
              <li key={title} className="border-t-2 border-slate-900 pt-5">
                <span className="num text-sm text-accent-ink">Step {i + 1}</span>
                <h3 className="mt-1 text-xl font-bold">{title}</h3>
                <p className="mt-2 font-light leading-relaxed">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="coverage" className="scroll-mt-16">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-24">
          <h2 className="rule-above text-3xl font-bold tracking-tight sm:text-4xl">Melbourne coverage</h2>
          <p className="mt-6 max-w-xl text-lg font-light leading-loose">Metropolitan Melbourne. Ask us about properties outside these areas.</p>
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {BRAND.coverage.map((c) => (
              <div key={c.region} className="bg-white p-7">
                <MapPin size={28} strokeWidth={1.25} className="text-accent" aria-hidden="true" />
                <h3 className="mt-4 text-lg font-bold">{c.region}</h3>
                <p className="mt-2 font-light leading-relaxed">{c.suburbs}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="scroll-mt-16 bg-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 sm:py-24 md:grid-cols-2">
          <div>
            <h2 className="rule-above text-3xl font-bold tracking-tight sm:text-4xl">Get in Touch</h2>
            <p className="mt-6 text-lg font-light leading-loose">Quotes, subscription maintenance plans and urgent repairs.</p>
            <ul className="mt-6 space-y-4 text-lg">
              {BRAND.phone && (
                <li className="flex items-center gap-3">
                  <Phone size={20} strokeWidth={1.5} className="text-accent" />
                  <span className="num select-all">{BRAND.phone}</span>
                </li>
              )}
              <li className="flex items-center gap-3">
                <Mail size={20} strokeWidth={1.5} className="text-accent" />
                <span className="select-all break-all">{BRAND.email}</span>
              </li>
              <li className="flex items-center gap-3">
                <MapPin size={20} strokeWidth={1.5} className="text-accent" />
                <span>{BRAND.city}</span>
              </li>
            </ul>
          </div>
          <div className="self-start bg-slate-50">
            <p className="border-b border-slate-200 px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Business hours</p>
            {BRAND.hours.map((h) => (
              <div key={h.days} className="flex justify-between gap-4 border-b border-slate-200 px-6 py-4 last:border-b-0">
                <span className="font-semibold">{h.days}</span>
                <span className="text-right font-light">{h.time}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-12 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <Logo inverted />
          <div className="text-sm text-white/70 sm:text-right">
            <p>
              © {new Date().getFullYear()} {BRAND.name} · {BRAND.city}
            </p>
            <p className="mt-1">
              ABN <span className="num text-white">{BRAND.abn}</span>
            </p>
          </div>
        </div>
      </footer>

      <SignInModal open={signIn} onClose={() => setSignIn(false)} />
    </div>
  )
}
