// The AI quote drafter's price book (from templates and past quotes) and the tidying of its draft.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanDraft, priceBook, type Draft } from '../functions/quote-assistant/draft.ts'

test('the price book: templates first, then the newest quote with each item; one line per item and unit', () => {
  const book = priceBook(
    [{ name: 'Bathroom reno', items: [{ description: 'Strip out bathroom', kind: 'labour', unit: 'day', rate: 640 }] }],
    [
      { id: 'q2', title: 'Ensuite' },
      { id: 'q1', title: 'Old job' },
    ],
    [
      { project_id: 'q1', description: 'Waterproof shower base', kind: 'subcontract', unit: 'item', rate: 650 },
      { project_id: 'q2', description: 'waterproof  shower base', kind: 'subcontract', unit: 'item', rate: 720 },
      { project_id: 'q2', description: 'Strip out bathroom', kind: 'labour', unit: 'day', rate: 600 },
      { project_id: 'q2', description: 'Free inspection', kind: 'other', unit: 'item', rate: 0 },
    ],
  )
  assert.equal(book.count, 2)
  assert.equal(
    book.text,
    ['- Strip out bathroom | labour | $640 per day | template "Bathroom reno"', '- waterproof shower base | subcontract | $720 per item | past quote "Ensuite"'].join('\n'),
  )
})

test('the draft is tidied: known kinds and bases, no negative or empty lines, rounded numbers', () => {
  const d = cleanDraft({
    lines: [
      { section: ' Tiling ', description: 'Lay  floor tiles', kind: 'labour', qty: 4.456, unit: 'm²', rate: 85.555, basis: 'price_book' },
      { section: '', description: 'Mystery', kind: 'magic' as never, qty: 1, unit: '', rate: -5, basis: 'guess' as never },
      { section: '', description: '', kind: 'labour', qty: 1, unit: '', rate: 10, basis: 'estimate' },
      { section: '', description: 'Nothing', kind: 'labour', qty: 0, unit: '', rate: 10, basis: 'estimate' },
    ],
    inclusions: ' All labour ',
    exclusions: '',
    assumptions: ['Floor is level', ''],
    questions: 'not a list' as never,
  } as Draft)
  assert.deepEqual(d.lines, [
    { section: 'Tiling', description: 'Lay floor tiles', kind: 'labour', qty: 4.46, unit: 'm²', rate: 85.56, basis: 'price_book' },
    { section: '', description: 'Mystery', kind: 'other', qty: 1, unit: '', rate: 0, basis: 'estimate' },
  ])
  assert.equal(d.inclusions, 'All labour')
  assert.deepEqual(d.assumptions, ['Floor is level'])
  assert.deepEqual(d.questions, [])
})
