import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { StoreProvider } from './lib/store'
import { CLOUD, DEMO } from './lib/supabase'
import { NotConfigured } from './components/NotConfigured'

// Invite and password-reset links carry their sign-in tokens after the "#". If one is
// opened in a tab already showing the app, only the hash changes, so reload to let the
// Supabase client pick the tokens up.
window.addEventListener('hashchange', () => {
  if (window.location.hash.includes('access_token=')) window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {CLOUD || DEMO ? (
      <StoreProvider>
        <App />
      </StoreProvider>
    ) : (
      <NotConfigured />
    )}
  </StrictMode>,
)
