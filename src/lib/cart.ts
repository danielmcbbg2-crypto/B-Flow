import { useCallback, useEffect, useRef, useState } from 'react'

const CART_KEY = 'npm.cart.v1'

export interface CartLine {
  productId: string
  qty: number
  /** The options chosen: option id → value id. */
  options?: Record<string, string>
  /** To be installed by us (quoted separately after the order). */
  install?: boolean
}

/** The same product with the same choices (and the same supply only or install) is one line. */
export const lineKey = (l: Pick<CartLine, 'productId' | 'options' | 'install'>) =>
  `${l.productId}|${Object.entries(l.options ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')}${l.install ? '|install' : ''}`

const validOptions = (o: unknown) => o === undefined || (typeof o === 'object' && o !== null && !Array.isArray(o) && Object.values(o).every((v) => typeof v === 'string'))

function read(): CartLine[] {
  try {
    const v = JSON.parse(localStorage.getItem(CART_KEY) ?? '[]')
    return Array.isArray(v)
      ? v.filter((l) => typeof l?.productId === 'string' && Number.isInteger(l?.qty) && l.qty > 0 && validOptions(l.options) && (l.install === undefined || typeof l.install === 'boolean'))
      : []
  } catch {
    return []
  }
}

/**
 * The shopping cart, kept in this browser so it survives a reload or signing in. Every open copy
 * of the shop shares it (the storage event keeps other tabs in step). Changes build on `current`,
 * which is up to date straight away (two quick clicks add two), and also works when the browser
 * won't let the site store anything.
 */
export function useCart() {
  const [lines, setLines] = useState<CartLine[]>(read)
  const current = useRef(lines)

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== CART_KEY) return
      current.current = read()
      setLines(current.current)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const save = useCallback((next: CartLine[]) => {
    current.current = next
    setLines(next)
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(next))
    } catch {
      /* the cart just won't survive a reload */
    }
  }, [])

  /** Sets the quantity of a line (0 removes it), keeping its place in the cart. */
  const setQty = useCallback(
    (line: Pick<CartLine, 'productId' | 'options' | 'install'>, qty: number) => {
      const q = Math.max(0, Math.min(99, Math.floor(qty) || 0))
      const key = lineKey(line)
      const at = current.current.findIndex((l) => lineKey(l) === key)
      const next = current.current.filter((_, i) => i !== at)
      if (q > 0)
        next.splice(at < 0 ? next.length : at, 0, {
          productId: line.productId,
          qty: q,
          ...(line.options && Object.keys(line.options).length ? { options: line.options } : {}),
          ...(line.install ? { install: true } : {}),
        })
      save(next)
    },
    [save],
  )
  const add = useCallback(
    (productId: string, qty = 1, options?: Record<string, string>, install = false) => {
      const key = lineKey({ productId, options, install })
      setQty({ productId, options, install }, (current.current.find((l) => lineKey(l) === key)?.qty ?? 0) + qty)
    },
    [setQty],
  )
  /** Switches a line between supply only and supply and install (merging with a matching line). */
  const setInstall = useCallback(
    (line: CartLine, install: boolean) => {
      const key = lineKey(line)
      const at = current.current.findIndex((l) => lineKey(l) === key)
      if (at < 0) return
      const target = { ...line, install }
      const other = current.current.findIndex((l) => lineKey(l) === lineKey(target))
      const next = current.current.map((l) => ({ ...l }))
      if (other >= 0) {
        next[other].qty = Math.min(99, next[other].qty + line.qty)
        next.splice(at, 1)
      } else {
        next[at] = { productId: line.productId, qty: line.qty, ...(line.options ? { options: line.options } : {}), ...(install ? { install: true } : {}) }
      }
      save(next)
    },
    [save],
  )
  const clear = useCallback(() => save([]), [save])

  return { lines, add, setQty, setInstall, clear, count: lines.reduce((s, l) => s + l.qty, 0) }
}
