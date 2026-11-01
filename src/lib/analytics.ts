// Visitor analytics (Google Analytics 4), only when VITE_GA_MEASUREMENT_ID is set at build time:
// page views as people move around the public site, and the moments that make money (a request
// sent, something added to the cart, an order placed). The portals aren't tracked.
const ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined

type Gtag = (...args: unknown[]) => void
declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: Gtag
  }
}

let started = false

function start() {
  if (started || !ID || !/^G-[A-Z0-9]+$/.test(ID)) return false
  started = true
  window.dataLayer = window.dataLayer ?? []
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments)
  }
  window.gtag('js', new Date())
  // Page views are sent by pageView() as the route changes (the site doesn't reload between pages).
  window.gtag('config', ID, { send_page_view: false })
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${ID}`
  document.head.appendChild(s)
  return true
}

/** A public page was shown. */
export function pageView() {
  if (!start()) return
  window.gtag!('event', 'page_view', { page_location: window.location.href, page_path: window.location.pathname, page_title: document.title })
}

/** Something worth counting happened (GA4's recommended event names: generate_lead, add_to_cart, purchase). */
export function track(event: string, params: Record<string, unknown> = {}) {
  if (!start()) return
  window.gtag!('event', event, params)
}
