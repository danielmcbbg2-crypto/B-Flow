// Finds the product photo on a supplier's page, so the AI product finder can show it without the
// admin opening the site: the image the page declares for sharing (og:image and similar).

/** Only public web addresses: no IP addresses, local names or logins in the link. */
export function fetchable(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.+$/, '')
  return (
    host.length > 0 &&
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    !url.username &&
    !url.password &&
    host.includes('.') &&
    !host.includes(':') &&
    !/^[\d.]+$/.test(host) &&
    !/(^|\.)(localhost|localdomain|local|internal|lan|home|arpa)$/.test(host)
  )
}

/** A private, local or reserved address (IPv4 or IPv6, including IPv4 inside IPv6). */
export function privateAddress(ip: string): boolean {
  const a = ip.toLowerCase().replace(/^\[|\]$/g, '')
  const v4 = a.match(/(?:^|:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [b0, b1] = [Number(v4[1]), Number(v4[2])]
    return (
      b0 === 0 || b0 === 10 || b0 === 127 || b0 >= 224 ||
      (b0 === 100 && b1 >= 64 && b1 <= 127) ||
      (b0 === 169 && b1 === 254) ||
      (b0 === 172 && b1 >= 16 && b1 <= 31) ||
      (b0 === 192 && b1 === 168) ||
      (b0 === 198 && (b1 === 18 || b1 === 19))
    )
  }
  return a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || a.startsWith('::ffff:')
}

/** Where a name really points: refuses names that lead to private addresses (or can't be looked up). */
async function resolvesPublic(host: string): Promise<boolean> {
  const dns = (globalThis as { Deno?: { resolveDns?: (h: string, t: 'A' | 'AAAA') => Promise<string[]> } }).Deno?.resolveDns
  if (!dns) return true // not available here: the name checks still apply
  const found = (await Promise.all([dns(host, 'A').catch(() => []), dns(host, 'AAAA').catch(() => [])])).flat()
  return found.length > 0 && !found.some(privateAddress)
}

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&#x2f;|&#0*47;/gi, '/')

/** The main image a page declares for sharing (og:image and friends), as an absolute web address. */
export function findImage(html: string, base: string): string {
  const attrs = (tag: string) => {
    const out: Record<string, string> = {}
    for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
    return out
  }
  const metas = (html.match(/<meta\b[^>]*>/gi) ?? []).map(attrs)
  const candidates: string[] = []
  for (const key of ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']) {
    for (const m of metas) if ((m.property ?? m.name ?? '').toLowerCase() === key && m.content) candidates.push(m.content)
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const l = attrs(tag)
    if ((l.rel ?? '').toLowerCase() === 'image_src' && l.href) candidates.push(l.href)
  }
  // Product details for search engines (JSON-LD) often list the photo too.
  const ld = html.match(/"image"\s*:\s*(?:\[\s*)?(?:\{[^{}]*?"(?:url|contentUrl)"\s*:\s*)?"([^"]+)"/)
  if (ld) {
    try {
      candidates.push(JSON.parse(`"${ld[1]}"`))
    } catch {
      /* not a usable value */
    }
  }
  for (const c of candidates) {
    try {
      const url = new URL(decodeEntities(c.trim()), base)
      if ((url.protocol === 'https:' || url.protocol === 'http:') && fetchable(url)) return url.href
    } catch {
      /* not a usable address */
    }
  }
  return ''
}

/** The photo from a product page, or '' (quickly: a few seconds at most, and only the page's start). */
export async function pagePhoto(pageUrl: string, signal: AbortSignal): Promise<string> {
  try {
    let url = new URL(pageUrl)
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(6000)])
    for (let hop = 0; hop < 4; hop++) {
      if (!fetchable(url) || !(await resolvesPublic(url.hostname.replace(/\.+$/, '')))) return ''
      const res = await fetch(url, {
        signal: timeout,
        redirect: 'manual',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; NextPhaseStore/1.0; +https://portal.nextphasemaintenance.com.au)', accept: 'text/html' },
      })
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel()
        url = new URL(res.headers.get('location')!, url)
        continue
      }
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html') || !res.body) {
        await res.body?.cancel()
        return ''
      }
      // The image tags are in the page's head: 300 kB is plenty.
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let html = ''
      while (html.length < 300_000) {
        const { value, done } = await reader.read()
        if (done) break
        html += value
        if (/<\/head>/i.test(html)) break
      }
      await reader.cancel().catch(() => {})
      return findImage(html, url.href)
    }
  } catch {
    /* no photo, then */
  }
  return ''
}
