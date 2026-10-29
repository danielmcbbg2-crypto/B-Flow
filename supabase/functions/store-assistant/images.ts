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
/** What an image really is, from its first bytes (some servers label everything octet-stream). */
function imageType(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && b[11] === 0x66) return 'image/avif'
  return null
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
  if (!res.ok) console.error(`Gemini ${res.status} for ${model}:`, JSON.stringify(body).slice(0, 500))
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

/** A studio shot of the product in one of its colours or finishes (the same product otherwise). */
const colourShot = (title: string, colour: string) => `Create a brand-new, original e-commerce product photograph of ${title || 'the product shown in the reference photos'} in the colour or finish "${colour}".
Show exactly the same product, changing only its colour or finish to ${colour} (keep any parts that clearly stay the same, such as a basin, glass or chrome hardware, unless the colour names them).
${KEEP}
Shoot it from a three-quarter front view, centred and filling about 80% of the frame, on a seamless soft warm-grey studio background with soft, even lighting and a gentle shadow on the floor.`

/** At most this many colour photos per product (each takes Gemini 10 to 20 seconds). */
export const MAX_COLOURS = 6

/** Up to two of the supplier's photos (from their page, plus `extra` links), ready to send to Gemini. */
export async function referencePhotos(pageUrl: string, extra: string[], signal: AbortSignal): Promise<{ type: string; b64: string; url: string }[]> {
  const found = [...new Set([...(await pagePhotos(pageUrl, signal)), ...extra])]
  const refs: { type: string; b64: string; url: string }[] = []
  const skipped: string[] = []
  for (const url of found.slice(0, 8)) {
    if (refs.length === 2) break
    try {
      // Ask for formats Gemini reads (many image servers would otherwise send AVIF).
      const img = await safeFetch(url, AbortSignal.any([signal, AbortSignal.timeout(15000)]), 'image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.5', 8_000_000)
      const type = imageType(img.bytes) ?? img.type
      if (/^image\/(jpeg|png|webp)$/.test(type) && img.bytes.length > 2000) refs.push({ type, b64: toBase64(img.bytes), url })
      else skipped.push(`${type || 'unknown type'}, ${img.bytes.length} bytes`)
    } catch (e) {
      skipped.push((e as Error).message)
    }
  }
  console.log(`store-assistant photos for ${pageUrl}: ${found.length} found, ${refs.length} usable${skipped.length ? `; skipped: ${skipped.join(' | ')}` : ''}`)
  if (!refs.length) {
    throw new Error(
      found.length
        ? `The supplier’s photos couldn’t be downloaded (${skipped[0] ?? 'unknown reason'}), so there’s nothing to work from. Add photos by hand.`
        : 'No product photo could be found on that page (the site may block automatic visits), so there’s nothing to work from. Add photos by hand.',
    )
  }
  return refs
}

/**
 * A studio shot of the product in each of `colours` (up to MAX_COLOURS), by name. A colour that
 * fails doesn't stop the others: its error is listed instead.
 */
export async function colourPhotos(
  refs: { type: string; b64: string }[],
  title: string,
  colours: string[],
  upload: (bytes: Uint8Array, type: string) => Promise<string>,
  signal: AbortSignal,
  progress: (colour: string, i: number) => void,
): Promise<{ colourImages: Record<string, string>; colourErrors: string[] }> {
  const colourImages: Record<string, string> = {}
  const colourErrors: string[] = []
  for (const [i, colour] of colours.slice(0, MAX_COLOURS).entries()) {
    progress(colour, i)
    try {
      const made = await generate(refs, colourShot(title, colour), signal)
      colourImages[colour] = await upload(made.bytes, made.type)
    } catch (e) {
      if (signal.aborted) throw e
      console.error(`store-assistant colour photo "${colour}" failed:`, (e as Error).message)
      colourErrors.push(`${colour}: ${(e as Error).message}`)
    }
  }
  return { colourImages, colourErrors }
}

/**
 * Makes new photos (a studio shot and one in a room) of the product on `pageUrl`, from up to two of
 * the supplier's photos, and a studio shot in each of `colours` (its colour or finish choices), and
 * stores them in the public "photos" bucket. Returns their links (the colours' by name).
 */
export async function recreatePhotos(
  pageUrl: string,
  title: string,
  extra: string[],
  upload: (bytes: Uint8Array, type: string) => Promise<string>,
  signal: AbortSignal,
  progress: (text: string) => void,
  colours: string[] = [],
): Promise<{ images: string[]; references: string[]; colourImages: Record<string, string>; colourErrors: string[] }> {
  progress('Finding the supplier’s photos…')
  const refs = await referencePhotos(pageUrl, extra, signal)
  const images: string[] = []
  const wanted = colours.slice(0, MAX_COLOURS)
  const total = SHOTS.length + wanted.length
  for (const [i, shot] of SHOTS.entries()) {
    progress(`Creating new photo ${i + 1} of ${total} (${shot.name === 'studio' ? 'studio shot' : 'in a room'})…`)
    const made = await generate(refs, shot.prompt(title), signal)
    images.push(await upload(made.bytes, made.type))
  }
  const made = await colourPhotos(refs, title, wanted, upload, signal, (colour, i) => progress(`Creating new photo ${SHOTS.length + i + 1} of ${total} (${colour})…`))
  return { images, references: refs.map((r) => r.url), ...made }
}
