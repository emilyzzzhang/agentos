import {
  ArrowLeftRight, BookOpen, CircleCheck, CircleSlash, CircleX, ClipboardCheck, FilePen, FileText, Globe,
  ListChecks, Play, Search, SearchX, SendHorizontal, TriangleAlert, Undo2, Check, FileSearch, FileX, Library,
  TextQuote, type LucideIcon, type LucideProps,
} from 'lucide-react'
import type { IconKey } from '../../stores/describe'
import type { AgentStatus } from '../../types'

const ICONS: Record<IconKey, LucideIcon> = {
  start: Play, plan: ListChecks, assign: SendHorizontal, handoff: ArrowLeftRight, return: Undo2,
  research: BookOpen, review: ClipboardCheck, approve: CircleCheck, gap: TriangleAlert, write: FilePen,
  report: FileText, search: Search, sources: Globe, searchFailed: SearchX, fail: CircleX, complete: CircleCheck,
  stop: CircleSlash, done: Check, docSearch: FileSearch, passages: TextQuote, docFailed: FileX, library: Library,
}

export function EventIcon({ name, ...props }: { name: IconKey } & LucideProps) {
  const C = ICONS[name]
  return <C size={13} strokeWidth={1.9} aria-hidden {...props} />
}

/** The single status indicator used for agents across the UI. */
export function StatusDot({ status, className = '' }: { status: AgentStatus; className?: string }) {
  return <span className={`status-dot status-${status} ${className}`} aria-hidden />
}
