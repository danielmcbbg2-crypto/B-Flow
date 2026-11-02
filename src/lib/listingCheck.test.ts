import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkListing, cleanCompliance, needsWels, toSpec } from './listingCheck'
import { EMPTY_LISTING, type Product } from './types'

const product = (patch: Partial<Product> = {}): Product => ({
  id: 'sp-1',
  title: 'Brushed Gold Round Basin Mixer Tap, Single Hole',
  description: Array.from({ length: 120 }, (_, i) => `word${i}`).join(' '),
  category: 'Tapware',
  brand: 'Acme',
  sku: '81H13',
  price: 113,
  images: ['https://example.com/a.png', 'https://example.com/b.png'],
  options: [],
  ...EMPTY_LISTING(),
  specs: ['Dimensions: 220 x 100 mm', 'Finish: Brushed gold', 'Body: Solid brass', 'Cartridge: Ceramic disc', 'Includes: 2 hoses'].map(toSpec),
  highlights: ['WELS 5 star', 'Solid brass', 'Hoses included'],
  seoTitle: 'Brushed Gold Basin Mixer Tap, WELS 5 Star, WaterMark',
  metaDescription: 'Brushed gold round basin mixer, solid brass, WELS 5 star (6.0 L/min) and WaterMark certified, with hoses and fittings. Melbourne supply and install.',
  imageAlt: ['Tap, front', 'Tap in a bathroom'],
  gtin: '9300000000001',
  compliance: { welsStars: 5, welsWater: '6.0 L/min', welsReg: 'T31433', watermark: 'WM74514' },
  status: 'published',
  stock: 'in_stock',
  createdAt: '2026-11-01T00:00:00Z',
  ...patch,
})

test('a complete, compliant tap listing scores 100 with nothing to fix', () => {
  const r = checkListing(product())
  assert.deepEqual(r.issues, [])
  assert.equal(r.score, 100)
})

test('taps without WELS details or a WaterMark number are flagged as required', () => {
  const r = checkListing(product({ compliance: {} }))
  const must = r.issues.filter((i) => i.level === 'must').map((i) => i.message)
  assert.ok(must.some((m) => m.includes('star rating')))
  assert.ok(must.some((m) => m.includes('registration number')))
  assert.ok(must.some((m) => m.startsWith('WaterMark')))
  assert.ok(r.score < 90)
})

test('shower screens must state AS/NZS 2208 safety glass', () => {
  const screen = product({ category: 'Shower screens', title: '1000mm Frameless Corner Shower Screen, Reversible', compliance: {} })
  assert.ok(checkListing(screen).issues.some((i) => i.message.includes('AS/NZS 2208')))
  const ok = { ...screen, compliance: { standards: ['AS/NZS 2208:2023 safety glazing'] }, description: `${screen.description} 10 mm toughened glass` }
  assert.ok(!checkListing(ok).issues.some((i) => i.field === 'compliance'))
})

test('claims the consumer law would need proof of are flagged', () => {
  const r = checkListing(product({ description: `${product().description} The cheapest tap in Melbourne.` }))
  assert.ok(r.issues.some((i) => i.level === 'must' && i.message.includes('cheapest')))
})

test('drafting leftovers are flagged', () => {
  assert.ok(checkListing(product({ description: `${product().description} Spout: ABS plastic (per page)` })).issues.some((i) => i.message.includes('leftovers')))
})

test('WELS applies to taps, showers and toilets but not bath spouts or vanities', () => {
  assert.equal(needsWels({ category: 'Tapware', title: 'Basin Mixer Tap' }), true)
  assert.equal(needsWels({ category: 'Tapware', title: 'Wall Bath Spout' }), false)
  assert.equal(needsWels({ category: 'Toilets', title: 'Rimless Toilet Suite' }), true)
  assert.equal(needsWels({ category: 'Vanities', title: '750mm Vanity' }), false)
})

test('specs and compliance details are tidied', () => {
  assert.deepEqual(toSpec('• Size: 610 x 360 mm'), { label: 'Size', value: '610 x 360 mm' })
  assert.deepEqual(toSpec('Soft close seat'), { label: 'Feature', value: 'Soft close seat' })
  assert.deepEqual(cleanCompliance({ welsStars: 0, welsWater: ' ', watermark: ' WMK 1 ', standards: ['', 'AS/NZS 2208'] }), { watermark: 'WMK 1', standards: ['AS/NZS 2208'] })
})
