// Locking the QuickBooks connection's tokens before they're saved in the database, so reading the
// table (a query, a backup, a leaked database key) gives nothing usable. The key lives only in the
// function's secrets: QBO_TOKEN_KEY (32 random bytes, base64) if set, otherwise one derived from
// QBO_CLIENT_SECRET. AES-256-GCM, with the field's name bound in, so a token can't be moved to
// another field either.

const enc = new TextEncoder()
const dec = new TextDecoder()

const toB64 = (b: Uint8Array) => btoa(Array.from(b, (c) => String.fromCharCode(c)).join(''))
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export async function tokenKey(clientSecret: string, override = ''): Promise<CryptoKey> {
  if (override) {
    const raw = fromB64(override.trim())
    if (raw.length !== 32) throw new Error('QBO_TOKEN_KEY must be 32 bytes, base64 encoded')
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
  }
  if (!clientSecret) throw new Error('QBO_CLIENT_SECRET isn’t set')
  const base = await crypto.subtle.importKey('raw', enc.encode(clientSecret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('npm-quickbooks-tokens'), info: enc.encode('v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** "v1.<iv>.<ciphertext>" */
export async function seal(key: CryptoKey, field: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(field) }, key, enc.encode(plain)))
  return `v1.${toB64(iv)}.${toB64(ct)}`
}

/** The token, or an error if it wasn't sealed with this key (or for this field). */
export async function unseal(key: CryptoKey, field: string, sealed: string): Promise<string> {
  const [v, iv, ct] = sealed.split('.')
  if (v !== 'v1' || !iv || !ct) throw new Error('not a sealed token')
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: enc.encode(field) }, key, fromB64(ct)))
}
