import { useEffect } from 'react'
import { ActingAsProvider, useStore } from './lib/store'
import { navigate, useHashRoute } from './lib/router'
import { PublicHome } from './pages/PublicHome'
import { ClientPortal } from './pages/client/ClientPortal'
import { ProviderPortal } from './pages/provider/ProviderPortal'
import { AdminPortal } from './pages/admin/AdminPortal'
import { AcceptLinkScreen, SetPasswordScreen } from './components/SignInModal'
import { LogoMark } from './components/Logo'
import { StorePage } from './pages/store/Shop'
import { ServicePage } from './pages/ServicePage'
import { LegalPage } from './pages/LegalPage'
import { isLegalPage } from './lib/legal'
import { LeadReply } from './pages/LeadReply'
import { QuoteLink } from './pages/QuoteLink'
import { useNoIndex } from './lib/head'
import { pageView } from './lib/analytics'
import { TwoStepScreen } from './components/TwoStepScreen'

export function App() {
  const { user, phase, cloud, actingAs, stopActingAs } = useStore()
  const route = useHashRoute()
  const [area = '', section = 'home'] = route
  const isPortal = area === 'client' || area === 'provider' || area === 'admin'
  // An admin who has opened a client's or trade's dashboard may also use that portal.
  const role = actingAs?.role ?? user?.role
  const allowed = !!user && (area === user.role || area === role)
  // The portals and sign-in links are private: kept out of search results.
  useNoIndex(isPortal || area.startsWith('accept') || area === 'reply' || area === 'quote')
  // Page views of the public site (the portals aren't tracked); after the page has set its title.
  const path = route.join('/')
  useEffect(() => {
    if (isPortal || area.startsWith('accept') || area === 'reply' || area === 'quote') return
    const t = setTimeout(pageView, 0)
    return () => clearTimeout(t)
  }, [path, isPortal, area])

  // Portals are role-locked: signed-out users go home, others to their own portal.
  useEffect(() => {
    if (!isPortal || phase !== 'ready') return
    if (!user) navigate('/')
    else if (!allowed) navigate(`/${role}`)
  }, [isPortal, user, allowed, role, phase])

  // Arriving in the admin portal (Back to accounts, its tabs, the browser's back button) leaves the
  // opened dashboard. Keyed on the route alone: opening a dashboard starts it just before leaving admin.
  useEffect(() => {
    if (area === 'admin') stopActingAs()
  }, [area, stopActingAs])

  // Before the set-password check, so a half-finished setup on this browser can't take over a new link.
  if (cloud && area.startsWith('accept')) {
    const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    return <AcceptLinkScreen tokenHash={q.get('token_hash') ?? ''} type={q.get('type') ?? ''} purpose={q.get('for') ?? ''} />
  }
  // A Service.com.au lead's reply page, from the link texted to the office (the link is the key).
  if (area === 'reply' && route[1]) return <LeadReply token={route[1]} />
  // A client's quote, from the private link sent with it (the link is the key).
  if (area === 'quote' && route[1]) return <QuoteLink token={route[1]} />
  if (phase === 'set-password') return <SetPasswordScreen />
  // The shop is open to everyone, signed in or not.
  if (area === 'store') return <StorePage productId={route[1]} />
  if (area === 'services') return <ServicePage slug={route[1] ?? ''} />
  // Privacy Policy and Terms of Use: public, indexed pages.
  if (isLegalPage(area)) return <LegalPage slug={area} />
  // An admin who has only entered their password: the second step, before anything else of theirs.
  if (phase === 'two-step') return <TwoStepScreen />
  if (isPortal && phase === 'loading') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-slate-500">
        <LogoMark size={36} />
        Loading your portal…
      </div>
    )
  }
  if (!isPortal || !allowed) return <PublicHome />
  if (area === 'admin') return <AdminPortal section={section} />
  return <ActingAsProvider>{area === 'client' ? <ClientPortal section={section} /> : <ProviderPortal section={section} />}</ActingAsProvider>
}
