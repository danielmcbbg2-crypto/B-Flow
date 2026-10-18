// Supabase Edge Function: the store's AI product assistant (store managers only).
//
//   { action: 'find', query }  searches the web for products matching the request that are sold in
//       Australia, and returns up to 6 candidates with supplier links, prices and a photo from
//       each product page.
//   { action: 'draft', product, instructions? }  reads the product's page and drafts an original
//       listing (title, description, specs, category, suggested price) for the admin to review.
//
// Both answer as lines of JSON: { type: 'progress', text } while working (what it's searching for
// or reading), then { type: 'result', data } or { type: 'error', error }.
//
// Nothing is saved or published here: the app opens the draft in the product editor, and the admin
// decides. Needs the ANTHROPIC_API_KEY secret; without it every call explains how to set it up.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0'
import { pagePhoto } from './photo.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

// Fast and well suited to web search and short writing; low effort keeps thinking (and waiting) short.
const MODEL = 'claude-sonnet-5-5'
const EFFORT = 'low'
// Same list as the app's STORE_CATEGORIES.
const CATEGORIES = ['Vanities', 'Shower screens', 'Tapware', 'Basins', 'Toilets', 'Baths', 'Mirrors & cabinets', 'Accessories', 'Hardware', 'Other']
const MELBOURNE = { type: 'approximate' as const, city: 'Melbourne', region: 'Victoria', country: 'AU', timezone: 'Australia/Melbourne' }

const BUSINESS = `Next Phase Maintenance is a property maintenance and renovation business in Melbourne, Australia. Its online store sells bathroom and kitchen fixtures (vanities, shower screens, tapware, basins, toilets, baths, mirrors and cabinets, accessories, hardware) to homeowners, property managers and trades, and it can install what it sells.`

const FIND_SYSTEM = `${BUSINESS}

You help the owner find products to list in the store. Search the web for products that match the request and are sold in Australia by reputable suppliers, wholesalers or manufacturers, ideally with a product page that states specifications and an Australian price. Prefer a range of options (brands, price points) over several listings of the same item.

Be quick: a few well-aimed searches are usually enough, and you have at most 8. As soon as you have 4 to 6 good candidates, or when a search says the limit is reached, stop searching and call report_products once with what you have. Use only what the pages say: leave a field as an empty string rather than guessing, and give prices in AUD as shown (say whether GST is included if the page does). If nothing suitable turns up, call report_products with an empty list and explain why in the note.`

const DRAFT_SYSTEM = `${BUSINESS}

You draft listings for the store for the owner to review. Read the product page with web_fetch, then call save_listing once with:
- title: clear and specific (brand, product type, key size or finish), under 80 characters.
- description: 80 to 160 words in plain Australian English, written in your own words (never copy the supplier's text): what it is, who it suits, finish and materials, and what is included. End with one sentence saying Next Phase Maintenance can supply and install it.
- specs: short facts stated on the page (dimensions, material, finish, WELS or other ratings, warranty), one per item.
- category, brand and sku/model from the page.
- suggested_price: the retail price in AUD including GST as shown on the page, or an empty string if none is shown.
- notes: anything the owner should check before publishing (missing specs, price excluding GST, lead times, conflicting details).
Only state facts the page supports. If the page can't be read, draft from the details provided and say so in notes.`

const FIND_TOOL = {
  name: 'report_products',
  description: 'Report the products found for the request. Call once, when the search is done.',
  strict: true,
  input_schema: {
    type: 'object' as const,
    properties: {
      products: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Product name as sold' },
            brand: { type: 'string' },
            supplier: { type: 'string', description: 'Who sells it (store or manufacturer)' },
            url: { type: 'string', description: 'Product page URL' },
            price: { type: 'string', description: 'Price as shown, e.g. "$1,249 inc. GST", or empty if not shown' },
            category: { type: 'string', enum: CATEGORIES },
            summary: { type: 'string', description: 'One or two sentences: what it is and why it fits the request' },
          },
          required: ['name', 'brand', 'supplier', 'url', 'price', 'category', 'summary'],
          additionalProperties: false,
        },
      },
      note: { type: 'string', description: 'Anything the owner should know about these results; empty if nothing' },
    },
    required: ['products', 'note'],
    additionalProperties: false,
  },
}

const DRAFT_TOOL = {
  name: 'save_listing',
  description: 'Save the drafted store listing for the owner to review. Call once.',
  strict: true,
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      specs: { type: 'array', items: { type: 'string' } },
      category: { type: 'string', enum: CATEGORIES },
      brand: { type: 'string' },
      sku: { type: 'string' },
      suggested_price: { type: 'string', description: 'Retail price in AUD inc. GST as shown on the page, e.g. "1249.00", or empty' },
      notes: { type: 'string' },
    },
    required: ['title', 'description', 'specs', 'category', 'brand', 'sku', 'suggested_price', 'notes'],
    additionalProperties: false,
  },
}

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming
type Block = Anthropic.Beta.Messages.BetaContentBlock

// Supabase stops a function after 400 s (150 s on the free plan): give up in time to say so.
const DEADLINE_MS = 330_000

/**
 * After a fallback to another model mid-reply, a `fallback` block marks where the new model took
 * over: only what comes after the last one is its answer.
 */
const lastFallback = (content: Block[]) => content.findLastIndex((b) => (b as { type: string }).type === 'fallback')

/** A reply as it can be sent back: before a fallback, only its text is kept (as the API asks). */
const echo = (content: Block[]) => {
  const at = lastFallback(content)
  return content.filter((b, i) => i >= at || b.type === 'text')
}

/**
 * Runs a request that uses web tools and should end with a call to `tool`: resumes if the server
 * pauses a long search, and asks once more if the model stops without calling it (tool choice
 * can't be forced on this model). The conversation is only ever appended to, never edited.
 */
async function run(
  client: Anthropic,
  params: Omit<Params, 'model' | 'max_tokens' | 'messages'>,
  prompt: string,
  tool: string,
  signal: AbortSignal,
  progress: (text: string) => void,
) {
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: 'user', content: prompt }]
  let container: string | undefined
  let nudged = false
  for (let i = 0; i < 5; i++) {
    const stream = client.beta.messages.stream(
        {
          model: MODEL,
          // Thinking (always on) counts towards this as well as the reply.
          max_tokens: 32000,
          // If a safety check declines the request, the API retries it on a suitable model.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: EFFORT },
          // The web tools filter results with code; a resumed turn carries on in the same container.
          ...(container ? { container } : {}),
          messages,
          ...params,
        },
        { signal },
      )
    // Say what it's doing as each search or page read starts.
    stream.on('contentBlock', (block) => {
      if (block.type !== 'server_tool_use') return
      const input = block.input as { query?: unknown; url?: unknown }
      if (block.name === 'web_search' && typeof input.query === 'string') progress(`Searching: ${input.query}`)
      else if (block.name === 'web_fetch' && typeof input.url === 'string') progress(`Reading ${hostOf(input.url)}`)
    })
    const message = await stream.finalMessage()
    container = message.container?.id ?? container
    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: echo(message.content) })
      continue
    }
    if (message.stop_reason === 'end_turn' && !nudged) {
      nudged = true
      messages.push({ role: 'assistant', content: echo(message.content) }, { role: 'user', content: `Don't search any more. Call ${tool} now with what you have found so far (an empty list is fine).` })
      continue
    }
    return message
  }
  throw new Error('The search took too long. Try a more specific request.')
}

/** The finished call to `name`, if the reply ended with one (not cut off, not declined). */
function toolInput<T>(message: Anthropic.Beta.Messages.BetaMessage, name: string): T | null {
  if (message.stop_reason !== 'tool_use') return null
  const at = lastFallback(message.content)
  for (const block of message.content.slice(at + 1)) if (block.type === 'tool_use' && block.name === name) return block.input as T
  return null
}

function apiError(e: unknown): string {
  if (e instanceof Anthropic.APIUserAbortError) return 'The search took too long. Try a more specific request.'
  if (e instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check the ANTHROPIC_API_KEY secret.'
  if (e instanceof Anthropic.PermissionDeniedError) return 'The Anthropic account doesn’t allow this request. Check its settings and credit.'
  if (e instanceof Anthropic.RateLimitError) return 'The AI service is busy. Try again in a minute.'
  if (e instanceof Anthropic.APIError) return `The AI service returned an error (${e.status ?? 'network'}). Try again shortly.`
  return (e as Error).message
}

/**
 * Answers as lines of JSON while `work` runs: progress as it goes, then the result or the error. A
 * search can take a minute or more, and Supabase closes a request that sends nothing for 150
 * seconds, so a blank line also goes out every 10 seconds.
 */
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
          /* the app went away (Stop) */
        }
      }
      const send = (msg: unknown) => write(JSON.stringify(msg) + '\n')
      const keepAlive = setInterval(() => write('\n'), 10_000)
      try {
        send({ type: 'result', data: await work(abort.signal, (text) => send({ type: 'progress', text })) })
      } catch (e) {
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

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'the page'
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
  const { data: auth } = await db.auth.getUser(jwt)
  if (!auth.user) return json({ error: 'Not signed in' }, 401)
  const { data: me } = await db.from('profiles').select('id, role, permissions').eq('auth_id', auth.user.id).eq('status', 'active').maybeSingle()
  if (!me || me.role !== 'admin' || !me.permissions.includes('canManageStore')) {
    return json({ error: 'You need the “Manage store & orders” permission' }, 403)
  }
  if (!Deno.env.get('ANTHROPIC_API_KEY')) {
    return json({ error: 'The AI assistant isn’t set up yet: add an Anthropic API key to the Supabase secrets as ANTHROPIC_API_KEY.', code: 'not_configured' }, 503)
  }
  const client = new Anthropic()
  const body = await req.json().catch(() => ({}))

  if (body.action === 'find') {
    const query = String(body.query ?? '').trim().slice(0, 300)
    if (!query) return json({ error: 'Describe what you’re looking for.' }, 400)
    return streamed(async (signal, progress) => {
      progress('Starting the search…')
      const message = await run(
        client,
        {
          system: FIND_SYSTEM,
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8, user_location: MELBOURNE }, FIND_TOOL],
        },
        `Find products for our store: ${query}`,
        FIND_TOOL.name,
        signal,
        progress,
      )
      const found = toolInput<{ products: { url: string }[]; note: string }>(message, FIND_TOOL.name)
      if (!found) throw new Error('The assistant couldn’t complete this search. Try rewording it.')
      if (found.products.length) progress(`Found ${found.products.length}. Getting photos…`)
      const photos = await Promise.all(found.products.map((p) => pagePhoto(p.url, signal)))
      return { ...found, products: found.products.map((p, i) => ({ ...p, image: photos[i] })) }
    })
  }

  if (body.action === 'draft') {
    const p = body.product ?? {}
    const url = String(p.url ?? '')
    if (!/^https?:\/\/\S+$/.test(url)) return json({ error: 'The product needs a web link to draft from.' }, 400)
    const details = [
      `Product: ${String(p.name ?? '').slice(0, 200)}`,
      `Brand: ${String(p.brand ?? '').slice(0, 100)}`,
      `Supplier: ${String(p.supplier ?? '').slice(0, 100)}`,
      `Price shown: ${String(p.price ?? '').slice(0, 60)}`,
      `Product page: ${url}`,
      String(body.instructions ?? '').trim() ? `Owner's instructions: ${String(body.instructions).slice(0, 1000)}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    return streamed(async (signal, progress) => {
      progress(`Reading ${hostOf(url)}…`)
      const message = await run(
        client,
        { system: DRAFT_SYSTEM, tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 2 }, DRAFT_TOOL] },
        `Draft a store listing for this product.\n\n${details}`,
        DRAFT_TOOL.name,
        signal,
        progress,
      )
      const listing = toolInput(message, DRAFT_TOOL.name)
      if (!listing) throw new Error('The assistant couldn’t draft this listing. Try again or add it by hand.')
      return { listing }
    })
  }

  return json({ error: 'Unknown action' }, 400)
})
