import { useCallback, useEffect, useRef, useState } from 'react'

const CART_KEY = 'npm.cart.v1'

export interface CartLine {
  productId: string
  qty: number
}

function read(): CartLine[] {
  try {
    const v = JSON.parse(localStorage.getItem(CART_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((l) => typeof l?.productId === 'string' && Number.isInteger(l?.qty) && l.qty > 0) : []
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

  const setQty = useCallback(
    (productId: string, qty: number) => {
      const q = Math.max(0, Math.min(99, Math.floor(qty) || 0))
      const rest = current.current.filter((l) => l.productId !== productId)
      save(q > 0 ? [...rest, { productId, qty: q }] : rest)
    },
    [save],
  )
  const add = useCallback(
    (productId: string, qty = 1) => setQty(productId, (current.current.find((l) => l.productId === productId)?.qty ?? 0) + qty),
    [setQty],
  )
  const clear = useCallback(() => save([]), [save])

  return { lines, add, setQty, clear, count: lines.reduce((s, l) => s + l.qty, 0) }
}
