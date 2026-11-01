// Keeps the page's <head> (title, description, canonical address, link preview and structured data)
// in step with the public page being shown, for search engines that run the app. The built site
// also has each public page's <head> written in by scripts/prerender.mts.
import { useEffect } from 'react'
import { DEFAULT_SITE_URL, pageTitle, type PageMeta } from './seo'

export const SITE_URL = ((import.meta.env.VITE_SITE_URL as string | undefined) || DEFAULT_SITE_URL).replace(/\/+$/, '')

function setMeta(attr: 'name' | 'property', key: string, content: string | undefined) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!content) return el?.remove()
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.rel = 'canonical'
    document.head.appendChild(el)
  }
  el.href = href
}

export function applyMeta(m: PageMeta) {
  const url = `${SITE_URL}${m.path}`
  document.title = pageTitle(m.title)
  setMeta('name', 'description', m.description)
  setMeta('name', 'robots', undefined)
  setCanonical(url)
  setMeta('property', 'og:title', pageTitle(m.title))
  setMeta('property', 'og:description', m.description)
  setMeta('property', 'og:url', url)
  setMeta('property', 'og:type', m.type ?? 'website')
  setMeta('property', 'og:image', m.image)
  setMeta('name', 'twitter:card', m.image ? 'summary_large_image' : 'summary')
  document.head.querySelectorAll('script[data-page-ld]').forEach((s) => s.remove())
  for (const ld of m.jsonLd ?? []) {
    const s = document.createElement('script')
    s.type = 'application/ld+json'
    s.dataset.pageLd = ''
    s.textContent = JSON.stringify(ld)
    document.head.appendChild(s)
  }
}

/** Sets the public page's <head>; null leaves it as it is (e.g. while the page's data loads). */
export function usePageMeta(m: PageMeta | null) {
  const key = m ? JSON.stringify(m) : ''
  useEffect(() => {
    if (m) applyMeta(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/** Portal pages: never indexed. */
export function useNoIndex(active: boolean) {
  useEffect(() => {
    if (!active) return
    setMeta('name', 'robots', 'noindex')
    document.head.querySelector('link[rel="canonical"]')?.remove()
    document.head.querySelectorAll('script[data-page-ld]').forEach((s) => s.remove())
  }, [active])
}
