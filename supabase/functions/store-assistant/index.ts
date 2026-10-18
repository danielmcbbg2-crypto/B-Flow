// Supabase Edge Function: the store's AI product assistant (store managers only).
//
//   { action: 'find', query }  searches the web for products matching the request that are sold in
//       Australia, and returns up to 6 candidates with supplier links and prices.
//   { action: 'draft', product, instructions? }  reads the product's page and drafts an original
//       listing (title, description, specs, category, suggested price) for the admin to review.
//
// Nothing is saved or published here: the app opens the draft in the product editor, and the admin
// decides. Needs the ANTHROPIC_API_KEY secret; without it every call explains how to set it up.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const MODEL = 'claude-opus-5-5'
// Same list as the app's STORE_CATEGORIES.
const CATEGORIES = ['Vanities', 'Shower screens', 'Tapware', 'Basins', 'Toilets', 'Baths', 'Mirrors & cabinets', 'Accessories', 'Hardware', 'Other']
const MELBOURNE = { type: 'approximate' as const, city: 'Melbourne', region: 'Victoria', country: 'AU', timezone: 'Australia/Melbourne' }

const BUSINESS = `Next Phase Maintenance is a property maintenance and renovation business in Melbourne, Australia. Its online store sells bathroom and kitchen fixtures (vanities, shower screens, tapware, basins, toilets, baths, mirrors and cabinets, accessories, hardware) to homeowners, property managers and trades, and it can install what it sells.`

const FIND_SYSTEM = `${BUSINESS}

You help the owner find products to list in the store. Search the web for products that match the request and are sold in Australia by reputable suppliers, wholesalers or manufacturers, ideally with a product page that states specifications and an Australian price. Prefer a range of options (brands, price points) over several listings of the same item.

When you have found up to 6 good candidates, call report_products once. Use only what the pages say: leave a field as an empty string rather than guessing, and give prices in AUD as shown (say whether GST is included if the page does). If nothing suitable turns up, call report_products with an empty list and explain why in the note.`

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

/**
 * Runs a request that uses web tools and should end with a call to `tool`: resumes if the server
 * pauses a long search, and asks once more if the model stops without calling it (tool choice
 * can't be forced on this model). The conversation is only ever appended to, never edited.
 */
async function run(client: Anthropic, params: Omit<Params, 'model' | 'max_tokens' | 'messages'>, prompt: string, tool: string) {
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: 'user', content: prompt }]
  let nudged = false
  for (let i = 0; i < 5; i++) {
    const message = await client.beta.messages
      .stream({
        model: MODEL,
        // Thinking (always on) counts towards this as well as the reply.
        max_tokens: 32000,
        // If a safety check declines the request, the API retries it on a suitable model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        messages,
        ...params,
      })
      .finalMessage()
    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: message.content })
      continue
    }
    if (message.stop_reason === 'end_turn' && !nudged && !toolInput(message, tool)) {
      nudged = true
      messages.push({ role: 'assistant', content: message.content }, { role: 'user', content: `Call ${tool} now with what you have.` })
      continue
    }
    return message
  }
  throw new Error('The search took too long. Try a more specific request.')
}

function toolInput<T>(message: Anthropic.Beta.Messages.BetaMessage, name: string): T | null {
  if (message.stop_reason === 'refusal') return null
  for (const block of message.content) if (block.type === 'tool_use' && block.name === name) return block.input as T
  return null
}

function apiError(e: unknown): Response {
  if (e instanceof Anthropic.AuthenticationError) return json({ error: 'The Anthropic API key was rejected. Check the ANTHROPIC_API_KEY secret.' }, 502)
  if (e instanceof Anthropic.PermissionDeniedError) return json({ error: 'The Anthropic account doesn’t allow this request. Check its settings and credit.' }, 502)
  if (e instanceof Anthropic.RateLimitError) return json({ error: 'The AI service is busy. Try again in a minute.' }, 429)
  if (e instanceof Anthropic.APIError) return json({ error: `The AI service returned an error (${e.status ?? 'network'}). Try again shortly.` }, 502)
  return json({ error: (e as Error).message }, 500)
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

  try {
    if (body.action === 'find') {
      const query = String(body.query ?? '').trim().slice(0, 300)
      if (!query) return json({ error: 'Describe what you’re looking for.' }, 400)
      const message = await run(
        client,
        {
          system: FIND_SYSTEM,
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6, user_location: MELBOURNE }, FIND_TOOL],
        },
        `Find products for our store: ${query}`,
        FIND_TOOL.name,
      )
      const found = toolInput<{ products: unknown[]; note: string }>(message, FIND_TOOL.name)
      if (!found) return json({ error: 'The assistant couldn’t complete this search. Try rewording it.' }, 422)
      return json(found)
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
      const message = await run(
        client,
        { system: DRAFT_SYSTEM, tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 }, DRAFT_TOOL] },
        `Draft a store listing for this product.\n\n${details}`,
        DRAFT_TOOL.name,
      )
      const listing = toolInput(message, DRAFT_TOOL.name)
      if (!listing) return json({ error: 'The assistant couldn’t draft this listing. Try again or add it by hand.' }, 422)
      return json({ listing })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return apiError(e)
  }
})
