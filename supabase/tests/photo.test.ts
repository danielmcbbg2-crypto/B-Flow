/**
 * Picking the product photo out of a supplier's page (the store's AI product finder).
 * Run with `npm run test:unit`.
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchable, findImage, privateAddress } from '../functions/store-assistant/photo.ts'

const page = 'https://shop.example.com.au/products/matte-black-mixer'

describe('findImage', () => {
  test('uses the page’s og:image, whatever the attribute order or quoting', () => {
    assert.equal(findImage(`<head><meta property="og:image" content="https://cdn.example.com/m.jpg"></head>`, page), 'https://cdn.example.com/m.jpg')
    assert.equal(findImage(`<meta content='https://cdn.example.com/a.jpg' property='og:image' />`, page), 'https://cdn.example.com/a.jpg')
    assert.equal(findImage(`<META PROPERTY="OG:IMAGE" CONTENT="https://cdn.example.com/b.jpg">`, page), 'https://cdn.example.com/b.jpg')
  })

  test('prefers the secure og:image, then og:image, then twitter:image', () => {
    const html = `<meta name="twitter:image" content="https://x.example.com/t.jpg">
      <meta property="og:image" content="https://x.example.com/o.jpg">
      <meta property="og:image:secure_url" content="https://x.example.com/s.jpg">`
    assert.equal(findImage(html, page), 'https://x.example.com/s.jpg')
    assert.equal(findImage(`<meta name="twitter:image" content="https://x.example.com/t.jpg">`, page), 'https://x.example.com/t.jpg')
  })

  test('resolves relative addresses and HTML entities against the page', () => {
    assert.equal(findImage(`<meta property="og:image" content="/media/p.jpg?w=800&amp;h=600">`, page), 'https://shop.example.com.au/media/p.jpg?w=800&h=600')
    assert.equal(findImage(`<meta property="og:image" content="//cdn.example.com/p.png">`, page), 'https://cdn.example.com/p.png')
  })

  test('falls back to image_src and to the product details for search engines (JSON-LD)', () => {
    assert.equal(findImage(`<link rel="image_src" href="https://cdn.example.com/l.jpg">`, page), 'https://cdn.example.com/l.jpg')
    const ld = `<script type="application/ld+json">{"@type":"Product","name":"Mixer","image":["https:\\/\\/cdn.example.com\\/ld.jpg"]}</script>`
    assert.equal(findImage(ld, page), 'https://cdn.example.com/ld.jpg')
    const ldObj = `<script type="application/ld+json">{"@type":"Product","image":{"@type":"ImageObject","url":"https://cdn.example.com/obj.jpg"}}</script>`
    assert.equal(findImage(ldObj, page), 'https://cdn.example.com/obj.jpg')
    const ldEscaped = `<script type="application/ld+json">{"image":"https:\\u002F\\u002Fcdn.example.com\\u002Fu.jpg"}</script>`
    assert.equal(findImage(ldEscaped, page), 'https://cdn.example.com/u.jpg')
  })

  test('returns nothing when there is no usable photo', () => {
    assert.equal(findImage('<html><head><title>No photo</title></head></html>', page), '')
    assert.equal(findImage(`<meta property="og:image" content="javascript:alert(1)">`, page), '')
    assert.equal(findImage(`<meta property="og:image" content="data:image/png;base64,AAAA">`, page), '')
    assert.equal(findImage(`<meta property="og:image" content="http://192.168.1.10/p.jpg">`, page), '')
  })
})

describe('privateAddress', () => {
  test('flags private, local and reserved addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.9', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])
      assert.ok(privateAddress(ip), ip)
    for (const ip of ['104.16.1.1', '203.4.5.6', '2606:4700::1']) assert.ok(!privateAddress(ip), ip)
  })
})

describe('fetchable', () => {
  test('only public web addresses', () => {
    for (const ok of ['https://www.reece.com.au/p/1', 'http://shop.example.com/x']) assert.ok(fetchable(new URL(ok)), ok)
    for (const bad of [
      'http://localhost:8080/',
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'http://intranet/',
      'http://printer.local/',
      'http://db.internal/',
      'https://user:pass@example.com/',
      'ftp://example.com/file',
      'http://localhost./',
      'http://db.internal./',
    ]) assert.ok(!fetchable(new URL(bad)), bad)
  })
})
