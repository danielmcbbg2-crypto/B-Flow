import { useEffect } from 'react'
import { useStore } from './lib/store'
import { navigate, useHashRoute } from './lib/router'
import { PublicHome } from './pages/PublicHome'
import { ClientPortal } from './pages/client/ClientPortal'
import { ProviderPortal } from './pages/provider/ProviderPortal'
import { AdminPortal } from './pages/admin/AdminPortal'

export function App() {
  const { user } = useStore()
  const [area, section = 'home'] = useHashRoute()
  const isPortal = area === 'client' || area === 'provider' || area === 'admin'

  // Portals are role-locked: signed-out users go home, others to their own portal.
  useEffect(() => {
    if (!isPortal) return
    if (!user) navigate('/')
    else if (user.role !== area) navigate(`/${user.role}`)
  }, [isPortal, user, area])

  if (!isPortal || !user || user.role !== area) return <PublicHome />
  if (area === 'client') return <ClientPortal section={section} />
  if (area === 'provider') return <ProviderPortal section={section} />
  return <AdminPortal section={section} />
}
