import { BRAND } from '../lib/brand'

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="#0F172A" />
      <path d="M8 23V9l8 8 8-8v14" fill="none" stroke="#EA580C" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  )
}

export function Logo({ sub }: { sub?: string }) {
  return (
    <a href="#/" className="flex items-center gap-2.5">
      <LogoMark />
      <span className="leading-tight">
        <span className="block text-[15px] font-extrabold tracking-tight text-slate-900">{BRAND.name}</span>
        {sub && <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">{sub}</span>}
      </span>
    </a>
  )
}
