// New product photos for a listing, made by Google's Gemini image model from the supplier's photos:
// the same product, photographed afresh (new angle, background, lighting and setting), so the store
// doesn't republish the supplier's own pictures. Needs the GEMINI_API_KEY secret; GEMINI_IMAGE_MODEL
// picks the model (default below).
import { pagePhotos, safeFetch } from './photo.ts'

const DEFAULT_MODEL = 'gemini-2.5-flash-image'

const KEEP = `Reproduce the product itself faithfully: the same design, shape and proportions, colours, finishes and materials, handles and hardware, and the same number of doors, drawers and shelves.
Do not reuse anything else from the reference photos: no part of their background, composition, camera angle, lighting, props or styling, and no text, logos, watermarks, labels, price tags or people.
Photorealistic, sharp, true-to-life colours. Square image.`

const SHOTS = [
  {
    name: 'studio',
    prompt: (title: string) => `Create a brand-new, original e-commerce product photograph of ${title || 'the product shown in the reference photos'}.
${KEEP}
Shoot it from a three-quarter front view, centred and filling about 80% of the frame, on a seamless soft warm-grey studio background with soft, even lighting and a gentle shadow on the floor.`,
  },
  {
    name: 'room',
    prompt: (title: string) => `Create a brand-new, original lifestyle photograph of ${title || 'the product shown in the reference photos'}, installed where it belongs (a bright, modern Australian bathroom, kitchen or laundry, whichever suits it).
${KEEP}
Use a new room, styling and camera angle of your own, in natural daylight, with the product as the clear focus.`,
  },
]

const toBase64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

type Part = { text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }

/** One new photo from the reference photos. */
async function generate(refs: { type: string; b64: string }[], prompt: string, signal: AbortSignal): Promise<{ type: string; bytes: Uint8Array }> {
  const model = Deno.env.get('GEMINI_IMAGE_MODEL') || DEFAULT_MODEL
  const base = Deno.env.get('GEMINI_API_URL') ?? 'https://generativelanguage.googleapis.com'
  const res = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [...refs.map((r) => ({ inline_data: { mime_type: r.type, data: r.b64 } })), { text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (res.status === 400 && /api key/i.test(JSON.stringify(body))) throw new Error('The Gemini API key was rejected. Check the GEMINI_API_KEY secret.')
  if (res.status === 403) throw new Error('Gemini refused the request: check the API key and that billing is set up for image generation.')
  if (res.status === 429) throw new Error('Gemini is busy or out of quota. Try again in a minute.')
  if (!res.ok) throw new Error(`Gemini returned an error (${res.status}${body?.error?.message ? `: ${String(body.error.message).slice(0, 160)}` : ''}).`)
  const parts: Part[] = body?.candidates?.[0]?.content?.parts ?? []
  for (const p of parts) {
    const data = p.inlineData?.data ?? p.inline_data?.data
    const type = p.inlineData?.mimeType ?? p.inline_data?.mime_type ?? 'image/png'
    if (data && type.startsWith('image/')) return { type, bytes: fromBase64(data) }
  }
  const said = parts.map((p) => p.text ?? '').join(' ').trim()
  const why = body?.candidates?.[0]?.finishReason ?? body?.promptFeedback?.blockReason
  throw new Error(`Gemini didn't return a photo${why ? ` (${why})` : ''}${said ? `: ${said.slice(0, 160)}` : ''}.`)
}

/**
 * Makes new photos (a studio shot and one in a room) of the product on `pageUrl`, from up to two of
 * the supplier's photos, and stores them in the public "photos" bucket. Returns their links.
 */
export async function recreatePhotos(
  pageUrl: string,
  title: string,
  upload: (bytes: Uint8Array, type: string) => Promise<string>,
  signal: AbortSignal,
  progress: (text: string) => void,
): Promise<{ images: string[]; references: string[] }> {
  progress('Finding the supplier’s photos…')
  const found = await pagePhotos(pageUrl, signal)
  const refs: { type: string; b64: string; url: string }[] = []
  for (const url of found) {
    if (refs.length === 2) break
    try {
      const img = await safeFetch(url, AbortSignal.any([signal, AbortSignal.timeout(15000)]), 'image/*', 8_000_000)
      if (/^image\/(jpeg|png|webp)$/.test(img.type) && img.bytes.length > 2000) refs.push({ type: img.type, b64: toBase64(img.bytes), url })
    } catch {
      /* try the next one */
    }
  }
  if (!refs.length) throw new Error('No product photo could be found on that page, so there’s nothing to work from. Add photos by hand.')
  const images: string[] = []
  for (const [i, shot] of SHOTS.entries()) {
    progress(`Creating new photo ${i + 1} of ${SHOTS.length} (${shot.name === 'studio' ? 'studio shot' : 'in a room'})…`)
    const made = await generate(refs, shot.prompt(title), signal)
    images.push(await upload(made.bytes, made.type))
  }
  return { images, references: refs.map((r) => r.url) }
}
