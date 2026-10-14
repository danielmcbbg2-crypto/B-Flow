import { useState, type MouseEvent } from 'react'
import {
  ArrowRight,
  CalendarClock,
  Hammer,
  Mail,
  PaintRoller,
  Phone,
  PlugZap,
  Repeat,
  ShieldCheck,
  Siren,
  Wrench,
  Droplets,
  Layers,
  type LucideIcon,
} from 'lucide-react'
import { Logo } from '../components/Logo'
import { SignInModal } from '../components/SignInModal'
import { BRAND, SERVICE_DETAILS } from '../lib/brand'
import { TRADES, type Trade } from '../lib/types'
import { useStore } from '../lib/store'
import { navigate } from '../lib/router'

const ICONS: Record<Trade, LucideIcon> = {
  Carpentry: Hammer,
  Painting: PaintRoller,
  Plastering: Layers,
  Handyman: Wrench,
  Plumbing: Droplets,
  Electrical: PlugZap,
  'Emergency Repairs': Siren,
  'Subscription Maintenance': Repeat,
}

function HeroDrawing() {
  // Architectural line drawing: a Melbourne terrace elevation with framing grid.
  return (
    <svg viewBox="0 0 480 360" className="h-full w-full" role="img" aria-label="Line drawing of a terrace house elevation">
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="#E2E8F0" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="480" height="360" fill="url(#grid)" />
      <g fill="none" stroke="#0F172A" strokeWidth="2" strokeLinejoin="round">
        <path d="M60 320V150l90-70 90 70v170" />
        <path d="M240 320V150l90-70 90 70v170" />
        <path d="M40 320h400" />
        <rect x="90" y="190" width="40" height="60" />
        <rect x="170" y="190" width="40" height="60" />
        <rect x="270" y="190" width="40" height="60" />
        <path d="M350 320v-90h40v90" />
        <path d="M60 170h180M240 170h180" strokeWidth="1" />
      </g>
      <g fill="none" stroke="#EA580C" strokeWidth="2">
        <path d="M110 320v-50h40v50" />
        <circle cx="143" cy="297" r="2" fill="#EA580C" />
        <path d="M60 150 150 80l90 70" strokeDasharray="6 6" />
      </g>
      <g fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#64748B">
        <text x="250" y="70">RL 6.20</text>
        <text x="44" y="340">0</text>
        <text x="424" y="340">12.0 m</text>
      </g>
    </svg>
  )
}

function jump(id: string) {
  return (e: MouseEvent) => {
    e.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }
}

export function PublicHome() {
  const { user } = useStore()
  const [signIn, setSignIn] = useState(false)

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-7 text-sm font-semibold text-slate-600 md:flex">
            <a href="#services" onClick={jump('services')} className="hover:text-slate-900">Services</a>
            <a href="#about" onClick={jump('about')} className="hover:text-slate-900">About</a>
            <a href="#coverage" onClick={jump('coverage')} className="hover:text-slate-900">Coverage</a>
            <a href="#contact" onClick={jump('contact')} className="hover:text-slate-900">Contact</a>
          </nav>
          {user ? (
            <button className="btn-primary" onClick={() => navigate(`/${user.role}`)}>
              Open portal <ArrowRight size={16} />
            </button>
          ) : (
            <button className="btn-primary" onClick={() => setSignIn(true)}>
              Sign in
            </button>
          )}
        </div>
      </header>

      <section className="border-b border-slate-200">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 md:py-20">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">Melbourne · Residential & Commercial</p>
            <h1 className="mt-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-slate-900 sm:text-5xl">
              Property maintenance, managed properly.
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-slate-600">
              Next Phase Maintenance looks after homes, rentals and commercial spaces across Melbourne. Licensed trades, one point of contact,
              and a live client portal for every job from request to invoice.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#contact" onClick={jump('contact')} className="btn-accent px-5 py-2.5">
                Request a quote
              </a>
              <button className="btn-ghost px-5 py-2.5" onClick={() => (user ? navigate(`/${user.role}`) : setSignIn(true))}>
                Client & trade portal
              </button>
            </div>
            <p className="mt-8 flex items-center gap-2 text-sm text-slate-500">
              <ShieldCheck size={16} className="text-slate-700" />
              ABN <span className="num text-slate-700">{BRAND.abn}</span>
              <span className="text-slate-300">/</span> {BRAND.city}
            </p>
          </div>
          <div className="card aspect-[4/3] overflow-hidden">
            <HeroDrawing />
          </div>
        </div>
      </section>

      <section id="services" className="scroll-mt-16 border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight">Services</h2>
            <p className="mt-2 text-slate-600">One team for the day-to-day and the next phase of your property.</p>
          </div>
          <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
            {TRADES.map((t) => {
              const Icon = ICONS[t]
              return (
                <div key={t} className="bg-white p-6">
                  <Icon size={22} className={t === 'Emergency Repairs' ? 'text-accent' : 'text-slate-800'} />
                  <h3 className="mt-4 font-bold">{t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{SERVICE_DETAILS[t]}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section id="about" className="scroll-mt-16 border-b border-slate-200">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-3">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">How it works</h2>
            <p className="mt-2 text-slate-600">Every job is tracked in one system, so owners, managers and trades see the same information.</p>
          </div>
          <ol className="grid gap-6 sm:grid-cols-2 md:col-span-2">
            {[
              ['01', 'Lodge a request', 'Clients submit jobs with photos from the portal. Urgent jobs alert our team by SMS straight away.'],
              ['02', 'We triage & dispatch', 'We assign the right licensed trade, confirm the schedule and keep you updated.'],
              ['03', 'Work is tracked live', 'Follow progress, completion photos and project milestones in your Maintenance Hub.'],
              ['04', 'Invoiced & recorded', 'Invoices are issued through QuickBooks, and paint colours and finishes are kept on your property record.'],
            ].map(([n, title, body]) => (
              <li key={n} className="border-t border-slate-200 pt-4">
                <span className="num text-sm text-accent">{n}</span>
                <h3 className="mt-1 font-bold">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="coverage" className="scroll-mt-16 border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight">Melbourne coverage</h2>
          <p className="mt-2 text-slate-600">Metropolitan Melbourne. Ask us about properties outside these areas.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {BRAND.coverage.map((c) => (
              <div key={c.region} className="card p-5">
                <h3 className="font-bold">{c.region}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{c.suburbs}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="scroll-mt-16">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Get in touch</h2>
            <p className="mt-2 text-slate-600">Quotes, scheduled maintenance plans and urgent repairs.</p>
            <ul className="mt-6 space-y-3 text-sm">
              {BRAND.phone && (
                <li className="flex items-center gap-3">
                  <Phone size={16} className="text-slate-500" />
                  <a href={`tel:${BRAND.phone.replace(/\s/g, '')}`} className="num font-semibold hover:underline">{BRAND.phone}</a>
                </li>
              )}
              <li className="flex items-center gap-3">
                <Mail size={16} className="text-slate-500" />
                <a href={`mailto:${BRAND.email}`} className="font-semibold hover:underline">{BRAND.email}</a>
              </li>
              <li className="flex items-center gap-3">
                <CalendarClock size={16} className="text-slate-500" />
                <span>{BRAND.city}</span>
              </li>
            </ul>
          </div>
          <div className="card divide-y divide-slate-200">
            <p className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Business hours</p>
            {BRAND.hours.map((h) => (
              <div key={h.days} className="flex justify-between px-5 py-3 text-sm">
                <span className="font-medium">{h.days}</span>
                <span className="num text-slate-600">{h.time}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-slate-900 text-slate-400">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm sm:flex-row sm:justify-between sm:px-6">
          <span>© {new Date().getFullYear()} {BRAND.name} · {BRAND.city}</span>
          <span>
            ABN <span className="num text-slate-300">{BRAND.abn}</span>
          </span>
        </div>
      </footer>

      <SignInModal open={signIn} onClose={() => setSignIn(false)} />
    </div>
  )
}
