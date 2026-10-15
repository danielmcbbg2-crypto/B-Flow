import { Status, type Tone } from './ui'
import type { InvoiceStatus, ProjectStatus, RequestStatus } from '../lib/types'
import { PROJECT_STATUS_LABEL, REQUEST_STATUS_LABEL } from '../lib/types'

const REQ_TONE: Record<RequestStatus, Tone> = {
  pending: 'orange',
  assigned: 'dark',
  in_progress: 'amber',
  awaiting_parts: 'slate',
  completed: 'green',
}

const PROJ_TONE: Record<ProjectStatus, Tone> = {
  quote_requested: 'orange',
  quoted: 'dark',
  approved: 'dark',
  in_progress: 'amber',
  completed: 'green',
  rejected: 'red',
}

const INV_TONE: Record<InvoiceStatus, Tone> = { draft: 'slate', sent: 'amber', paid: 'green' }
const INV_LABEL: Record<InvoiceStatus, string> = { draft: 'Draft', sent: 'Invoiced', paid: 'Paid · bank transfer' }

export const RequestStatusText = ({ s }: { s: RequestStatus }) => <Status tone={REQ_TONE[s]}>{REQUEST_STATUS_LABEL[s]}</Status>
export const ProjectStatusText = ({ s }: { s: ProjectStatus }) => <Status tone={PROJ_TONE[s]}>{PROJECT_STATUS_LABEL[s]}</Status>
export const InvoiceStatusText = ({ s }: { s: InvoiceStatus }) => <Status tone={INV_TONE[s]}>{INV_LABEL[s]}</Status>

export function Urgency({ u }: { u: 'urgent' | 'standard' }) {
  return u === 'urgent' ? (
    <span className="text-xs font-bold uppercase tracking-wide text-accent-ink">Urgent</span>
  ) : (
    <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Standard</span>
  )
}
