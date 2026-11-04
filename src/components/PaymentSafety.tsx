import { ShieldCheck } from 'lucide-react'
import { cx } from '../lib/utils'

/** What a genuine invoice from us looks like, so customers can spot a fake one. */
export const PAYMENT_SAFETY =
  'Our invoices are emailed from QuickBooks (intuit.com) in the name of Next Phase Maintenance, and we never change our bank or payment details by email or text. If anything looks different, contact us before you pay.'

export function PaymentSafety({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <p className={cx('flex items-start gap-2 text-xs', inverted ? 'text-white/70' : 'text-slate-500', className)}>
      <ShieldCheck size={14} className={cx('mt-0.5 shrink-0', inverted ? 'text-white/70' : 'text-emerald-600')} aria-hidden />
      <span>
        <span className="font-semibold">Paying safely:</span> {PAYMENT_SAFETY}
      </span>
    </p>
  )
}
