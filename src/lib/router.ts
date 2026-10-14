import { useEffect, useState } from 'react'

/** Minimal hash router: "#/client/hub" -> ["client", "hub"]. */
export function useHashRoute(): string[] {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash)
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean)
}

export function navigate(path: string) {
  window.location.hash = path.startsWith('/') ? path : `/${path}`
}
