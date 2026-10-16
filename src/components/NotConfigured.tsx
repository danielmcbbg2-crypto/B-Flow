import { BRAND } from '../lib/brand'
import { Logo } from './Logo'

/** Shown by a production build that has no Supabase settings, instead of falling back to sample data. */
export function NotConfigured() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center px-4 sm:px-6">
          <Logo />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-20 sm:px-6">
        <h1 className="rule-above text-3xl font-bold">Client portal coming soon</h1>
        <p className="mt-6 text-lg font-light leading-[1.8]">
          Our online portal isn’t open yet. For maintenance requests and quotes, email{' '}
          <a className="font-normal underline-offset-4 hover:underline" href={`mailto:${BRAND.email}`}>
            {BRAND.email}
          </a>
          .
        </p>
        <p className="mt-10 border-t border-slate-200 pt-6 text-sm text-slate-500">
          Site owner: this build isn’t connected to its database. Add <code className="font-mono">VITE_SUPABASE_URL</code> and{' '}
          <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> in your hosting settings and redeploy. See the README.
        </p>
      </main>
    </div>
  )
}
