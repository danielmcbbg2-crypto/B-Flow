import { useEffect } from 'react'
import { useStore } from './lib/store'
import { navigate, useHashRoute } from './lib/router'
import { PublicHome } from './pages/PublicHome'
import { ClientPortal } from './pages/client/ClientPortal'
import { ProviderPortal } from './pages/provider/ProviderPortal'
import { AdminPortal } from './pages/admin/AdminPortal'
import { AcceptLinkScreen, SetPasswordScreen } from './components/SignInModal'
import { LogoMark } from './components/Logo'

export function App() {
  const { user, phase, cloud } = useStore()
  const [area = '', section = 'home'] = useHashRoute()
  const isPortal = area === 'client' || area === 'provider' || area === 'admin'

  // Portals are role-locked: signed-out users go home, others to their own portal.
  useEffect(() => {
    if (!isPortal || phase !== 'ready') return
    if (!user) navigate('/')
    else if (user.role !== area) navigate(`/${user.role}`)
  }, [isPortal, user, area, phase])

  // Before the set-password check, so a half-finished setup on this browser can't take over a new link.
  if (cloud && area.startsWith('accept')) {
    const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    return <AcceptLinkScreen tokenHash={q.get('token_hash') ?? ''} type={q.get('type') ?? ''} purpose={q.get('for') ?? ''} />
  }
  if (phase === 'set-password') return <SetPasswordScreen />
  if (isPortal && phase === 'loading') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-slate-500">
        <LogoMark size={36} />
        Loading your portal…
      </div>
    )
  }
  if (!isPortal || !user || user.role !== area) return <PublicHome />
  if (area === 'client') return <ClientPortal section={section} />
  if (area === 'provider') return <ProviderPortal section={section} />
  return <AdminPortal section={section} />
}
