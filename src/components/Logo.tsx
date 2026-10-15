import { BRAND } from '../lib/brand'

/** Small square brand mark (loading screens, favicon). Replace with the real logo file when available. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" fill="#FE5520" />
      <text x="16" y="22" textAnchor="middle" fontFamily="Roboto, Arial, sans-serif" fontWeight="900" fontSize="15" fill="#000">
        NP
      </text>
    </svg>
  )
}

/** Wordmark in the website's heading face. */
export function Logo({ sub, inverted }: { sub?: string; inverted?: boolean }) {
  return (
    <a href="#/" className="flex flex-col leading-none" aria-label={`${BRAND.name} home`}>
      <span className={`font-display text-[19px] font-black uppercase tracking-tight ${inverted ? 'text-white' : 'text-slate-900'}`}>
        Next Phase
        <span className="text-accent">.</span>
      </span>
      <span className={`mt-1 text-[10.5px] font-semibold uppercase tracking-[0.28em] ${inverted ? 'text-white/80' : 'text-slate-500'}`}>
        {sub ?? 'Maintenance'}
      </span>
    </a>
  )
}
