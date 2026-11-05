// Supabase Edge Function: the AI quote drafter (admins with "Manage projects & quotes").
//
//   { projectId, notes?, title?, description?, scope? }  Claude reads the quote request (title, description, scope, the
//       property), the office's notes from the site visit, and the job's photos (photos on the
//       project, and photos the client sent with their website enquiry), and drafts an itemised
//       quote: sections and lines (labour, materials, subcontract, hire), quantities, units and
//       rates excluding GST, inclusions, exclusions, what it assumed, and what to check on site.
//       Rates come from the business's own past quotes and templates where a line is like one of
//       them; otherwise they're marked as estimates for the office to check.
//
// Answers as lines of JSON: { type: 'progress', text } while working, then { type: 'result', data }
// or { type: 'error', error }. Nothing is saved here: the app adds the lines to the quote, and the
// office checks and edits them before issuing it. Needs the ANTHROPIC_API_KEY secret.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0'
import { encodeBase64 } from 'jsr:@std/encoding@1.0.10/base64'
import { cleanDraft, priceBook, type Draft } from './draft.ts'

/** Whether the login has done its second sign-in step (its token, already checked by getUser, says "aal2"). Admin powers need it. */
function secondStep(jwt: string): boolean {
  try {
    const p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4))).aal === 'aal2'
  } catch {
    return false
  }
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

// Pricing a job from photos and notes is careful work: the most capable model, thinking as it needs.
const MODEL = 'claude-opus-5-5'
const MAX_PHOTOS = 6
// The API takes images up to 5 MB once encoded.
const MAX_PHOTO_BYTES = 3_700_000
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
// Supabase stops a function after 400 s (150 s on the free plan): give up in time to say so.
const DEADLINE_MS = 330_000

const SYSTEM = `Next Phase Maintenance is a property maintenance and renovation business in Melbourne, Australia. It does plastering and ceiling repairs, painting, plumbing, electrical, carpentry, tiling, handyman work, emergency repairs and bathroom and kitchen renovations, using its own team and licensed subcontractors where the law requires (plumbing, electrical, gas).

You draft quotes for the owner to check before they go to the client. From the request, the owner's site notes and the photos, write an itemised quote and call save_quote once:
- Sections in the order the work happens (e.g. "Preparation and protection", "Demolition", "Plumbing", "Waterproofing", "Tiling", "Fit-off", "Clean-up and waste").
- Lines a client can follow: what is done or supplied, with qty, unit (hr, day, m², lm, each, item, allow) and rate.
- Rates exclude GST, in AUD at Melbourne trade rates for a small business doing quality work. kind is labour, materials, subcontract (licensed trades such as plumbers and electricians), hire (skip bins, scaffolding, equipment) or other.
- The price book lists rates from this business's own past quotes and templates. When a line is like one there, use its rate and set basis to "price_book"; otherwise set basis to "estimate" and give your best rate.
- Fixtures the client will choose (tapware, tiles, vanities and the like) go in as allowances (unit "allow", basis "allowance") with a sensible amount, and say so in the exclusions or assumptions.
- Only quote what the request, notes and photos call for. Use measurements from the notes; if none are given, estimate from the photos or from typical sizes and put that in assumptions. Never claim you saw something the photos don't show.
- inclusions and exclusions: short plain lines, one per line, as the client will read them.
- assumptions: what you assumed that changes the price (sizes, condition behind walls, access, number of coats).
- questions: what the owner should check on site or ask the client before issuing the quote.
Don't add GST, a margin or a total: the quote adds GST, and the owner sets the final price.`

const SAVE_TOOL = {
  name: 'save_quote',
  description: 'Save the drafted quote for the owner to review. Call once.',
  strict: true,
  input_schema: {
    type: 'object' as const,
    properties: {
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            section: { type: 'string' },
            description: { type: 'string' },
            kind: { type: 'string', enum: ['labour', 'materials', 'subcontract', 'hire', 'other'] },
            qty: { type: 'number' },
            unit: { type: 'string' },
            rate: { type: 'number', description: 'AUD, excluding GST' },
            basis: { type: 'string', enum: ['price_book', 'estimate', 'allowance'] },
          },
          required: ['section', 'description', 'kind', 'qty', 'unit', 'rate', 'basis'],
          additionalProperties: false,
        },
      },
      inclusions: { type: 'string' },
      exclusions: { type: 'string' },
      assumptions: { type: 'array', items: { type: 'string' } },
      questions: { type: 'array', items: { type: 'string' } },
    },
    required: ['lines', 'inclusions', 'exclusions', 'assumptions', 'questions'],
    additionalProperties: false,
  },
}

type Photo = { type: string; b64: string }

/** The job's photos: on the project, then from the client's website enquiries; newest first. */
async function jobPhotos(projectId: string, clientId: string, progress: (t: string) => void): Promise<Photo[]> {
  const wanted: { bucket: string; path: string }[] = []
  const { data: docs } = await db
    .from('project_documents')
    .select('path, content_type, category, size_bytes')
    .eq('project_id', projectId)
    .order('uploaded_at', { ascending: false })
  for (const d of docs ?? []) {
    if (IMAGE_TYPES.includes(String(d.content_type)) && Number(d.size_bytes) <= MAX_PHOTO_BYTES) wanted.push({ bucket: 'project-docs', path: d.path as string })
  }
  const { data: leads } = await db.from('leads').select('photos').eq('client_id', clientId).order('created_at', { ascending: false }).limit(3)
  for (const l of leads ?? []) for (const path of (l.photos as string[]) ?? []) wanted.push({ bucket: 'lead-photos', path })
  const out: Photo[] = []
  if (wanted.length) progress(`Looking at ${Math.min(wanted.length, MAX_PHOTOS)} photo${Math.min(wanted.length, MAX_PHOTOS) > 1 ? 's' : ''}…`)
  for (const w of wanted) {
    if (out.length >= MAX_PHOTOS) break
    const { data, error } = await db.storage.from(w.bucket).download(w.path)
    if (error || !data) continue
    const type = (data.type || '').split(';')[0] || (/\.png$/i.test(w.path) ? 'image/png' : 'image/jpeg')
    if (!IMAGE_TYPES.includes(type) || data.size > MAX_PHOTO_BYTES) continue
    out.push({ type, b64: encodeBase64(new Uint8Array(await data.arrayBuffer())) })
  }
  return out
}

function apiError(e: unknown): string {
  if (e instanceof Anthropic.APIUserAbortError) return 'Drafting took too long. Try again, perhaps with fewer photos.'
  if (e instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check the ANTHROPIC_API_KEY secret.'
  if (e instanceof Anthropic.PermissionDeniedError) return 'The Anthropic account doesn’t allow this request. Check its settings and credit.'
  if (e instanceof Anthropic.RateLimitError) return 'The AI service is busy. Try again in a minute.'
  if (e instanceof Anthropic.APIError) return `The AI service returned an error (${e.status ?? 'network'}). Try again shortly.`
  return (e as Error).message
}

/** Lines of JSON while `work` runs (a blank line every 10 s keeps the connection open). */
function streamed(work: (signal: AbortSignal, progress: (text: string) => void) => Promise<unknown>): Response {
  const enc = new TextEncoder()
  const abort = new AbortController()
  const deadline = setTimeout(() => abort.abort(), DEADLINE_MS)
  const body = new ReadableStream<Uint8Array>({
    async start(out) {
      const write = (text: string) => {
        try {
          out.enqueue(enc.encode(text))
        } catch {
          /* the app went away */
        }
      }
      const send = (msg: unknown) => write(JSON.stringify(msg) + '\n')
      const keepAlive = setInterval(() => write('\n'), 10_000)
      try {
        send({ type: 'result', data: await work(abort.signal, (text) => send({ type: 'progress', text })) })
      } catch (e) {
        console.error('quote-assistant failed:', (e as Error)?.message ?? e)
        send({ type: 'error', error: apiError(e) })
      } finally {
        clearInterval(keepAlive)
        clearTimeout(deadline)
      }
      try {
        out.close()
      } catch {
        /* already closed */
      }
    },
    cancel() {
      abort.abort()
    },
  })
  return new Response(body, { headers: { ...cors, 'Content-Type': 'application/x-ndjson' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
  const { data: auth } = await db.auth.getUser(jwt)
  if (!auth.user) return json({ error: 'Not signed in' }, 401)
  const { data: me } = await db.from('profiles').select('id, role, permissions').eq('auth_id', auth.user.id).eq('status', 'active').maybeSingle()
  if (!me || me.role !== 'admin' || !me.permissions.includes('canManageProjects') || !secondStep(jwt)) {
    return json({ error: 'You need the “Manage projects & quotes” permission' }, 403)
  }
  if (!Deno.env.get('ANTHROPIC_API_KEY')) {
    return json({ error: 'The AI quote drafter isn’t set up yet: add an Anthropic API key to the Supabase secrets as ANTHROPIC_API_KEY.', code: 'not_configured' }, 503)
  }
  const body = await req.json().catch(() => ({}))
  const { data: p } = await db
    .from('projects')
    .select('id, number, title, description, scope_of_works, type, budget, client_id, property_id, properties(address, suburb, postcode)')
    .eq('id', String(body.projectId ?? ''))
    .maybeSingle()
  if (!p) return json({ error: 'Quote not found' }, 404)
  const notes = String(body.notes ?? '').trim().slice(0, 4000)
  // What's in the editor now (it may not be saved yet) wins over what's saved.
  for (const [k, col, max] of [['title', 'title', 200], ['description', 'description', 4000], ['scope', 'scope_of_works', 6000]] as const) {
    if (typeof body[k] === 'string') (p as Record<string, unknown>)[col] = body[k].trim().slice(0, max)
  }

  return streamed(async (signal, progress) => {
    progress('Reading the request…')
    const photos = await jobPhotos(p.id, p.client_id, progress)
    // The business's own prices: templates and the last 40 quotes' lines.
    const { data: templates } = await db.from('quote_templates').select('name, items')
    const { data: recent } = await db.from('projects').select('id, title').neq('id', p.id).order('created_at', { ascending: false }).limit(40)
    const ids = (recent ?? []).map((r) => r.id)
    const { data: lines } = ids.length
      ? await db.from('project_quote_items').select('project_id, section, description, kind, qty, unit, rate').in('project_id', ids)
      : { data: [] }
    const book = priceBook(templates ?? [], recent ?? [], lines ?? [])
    const where = p.properties as { address?: string; suburb?: string; postcode?: string } | null
    const request = [
      `Quote request P-${p.number}: ${p.title}`,
      p.type === 'maintenance_contract' ? 'Type: maintenance contract' : 'Type: renovation or repair job',
      where?.address ? `Property: ${[where.address, where.suburb, where.postcode].filter(Boolean).join(', ')}` : '',
      p.description ? `What the client asked for:\n${p.description}` : '',
      p.scope_of_works ? `Scope of works so far:\n${p.scope_of_works}` : '',
      Number(p.budget) > 0 ? `Client's budget: $${Number(p.budget).toFixed(0)}` : '',
      notes ? `The owner's site notes:\n${notes}` : 'No site notes were given.',
      photos.length ? `${photos.length} photo${photos.length > 1 ? 's' : ''} of the job are attached.` : 'There are no photos of the job.',
      book.text ? `Price book (rates excluding GST):\n${book.text}` : 'The price book is empty: every rate is an estimate.',
    ]
      .filter(Boolean)
      .join('\n\n')
    const content: Anthropic.ContentBlockParam[] = [
      ...photos.map((ph): Anthropic.ImageBlockParam => ({ type: 'image', source: { type: 'base64', media_type: ph.type as 'image/jpeg', data: ph.b64 } })),
      { type: 'text', text: request },
    ]
    const client = new Anthropic()
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content }]
    progress('Drafting the quote…')
    for (let i = 0; i < 2; i++) {
      const message = await client.messages
        .stream(
          {
            model: MODEL,
            max_tokens: 32000,
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium' },
            system: SYSTEM,
            tools: [SAVE_TOOL],
            messages,
          },
          { signal },
        )
        .finalMessage()
      const call = message.stop_reason === 'tool_use' ? message.content.find((b) => b.type === 'tool_use' && b.name === SAVE_TOOL.name) : undefined
      if (call && call.type === 'tool_use') {
        return { ...cleanDraft(call.input as Draft), photosUsed: photos.length, priceBookLines: book.count }
      }
      if (message.stop_reason === 'refusal') throw new Error('The assistant declined to draft this quote. Draft it by hand.')
      if (message.stop_reason === 'max_tokens') throw new Error('The draft ran too long. Add notes that narrow the job down and try again.')
      messages.push({ role: 'assistant', content: message.content }, { role: 'user', content: 'Call save_quote now with the quote.' })
    }
    throw new Error('The assistant couldn’t draft this quote. Try again, or add site notes.')
  })
})
