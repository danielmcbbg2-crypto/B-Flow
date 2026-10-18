import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DbAdapter, Row, TableName } from './db'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Null when the app runs in local demo mode (no Supabase project configured). */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null
export const CLOUD = supabase !== null
/**
 * Demo mode (sample data kept in the browser) only runs in local development or in a build made
 * with VITE_DEMO=true (`npm run build:demo`). DEMO_BUILD is fixed when the app is built, so a normal
 * production build leaves the sample data out of the bundle entirely; without Supabase settings it
 * shows a setup notice instead, so a live site can never fall back to sample data.
 */
export const DEMO_BUILD = import.meta.env.DEV || import.meta.env.VITE_DEMO === 'true'
export const DEMO = !CLOUD && DEMO_BUILD

const PAGE = 1000

export function supabaseAdapter(client: SupabaseClient): DbAdapter {
  return {
    async select(table: TableName) {
      // The API returns at most 1,000 rows per request, so read in pages until a short one.
      const rows: Row[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await client.from(table).select('*').order('id').range(from, from + PAGE - 1)
        if (error) throw new Error(`${table}: ${error.message}`)
        rows.push(...((data ?? []) as Row[]))
        if (!data || data.length < PAGE) return rows
      }
    },
    async insert(table: TableName, rows: Row[]) {
      const { error } = await client.from(table).insert(rows)
      if (error) throw new Error(`${table}: ${error.message}`)
    },
    async update(table: TableName, id: string | number, patch: Row) {
      // Ask for the id back: an update that row-level security filters out returns no rows rather than an error.
      const { data, error } = await client.from(table).update(patch).eq('id', id).select('id')
      if (error) throw new Error(`${table}: ${error.message}`)
      if (!data?.length) throw new Error(`${table}: you don't have permission to change this record`)
    },
    async remove(table: TableName, id: string | number) {
      const { error } = await client.from(table).delete().eq('id', id)
      if (error) throw new Error(`${table}: ${error.message}`)
    },
  }
}

/** Uploads a data-URL image to the public "photos" bucket and returns its URL. */
export async function uploadPhoto(client: SupabaseClient, dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob()
  const path = `${crypto.randomUUID()}.jpg`
  const { error } = await client.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw new Error(`Photo upload failed: ${error.message}`)
  return client.storage.from('photos').getPublicUrl(path).data.publicUrl
}
