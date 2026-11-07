/**
 * Splits a rendered AgentOS report (backend agents/reviewer.py::render_report) into the parts the
 * viewer lays out separately. The Markdown export itself is never modified. Reports that do not
 * follow the layout (older runs) fall back to `body = whole markdown`.
 */
export type ReportKind = 'comparison' | 'study_plan' | 'research' | 'how_to' | 'explanation' | 'summary'

export interface ReportSection {
  title: string
  markdown: string
  /** Supporting detail the viewer shows collapsed (evidence, limitations, deeper notes). */
  collapsible: boolean
  /** Number of top-level list items, shown next to a collapsed section's title. */
  items: number
}

export interface ParsedReport {
  title: string | null
  request: string | null
  /** The direct answer (older reports: the executive summary). */
  summary: string | null
  /** Assumptions and "tell us" questions that follow the answer. */
  preface: string | null
  body: string
  sections: ReportSection[]
  footer: string | null
  kind: ReportKind | null
  structured: boolean
}

const KIND_FROM_FOOTER: Record<string, ReportKind> = {
  Comparison: 'comparison', 'Study plan': 'study_plan', Research: 'research', 'How-to': 'how_to',
  Explanation: 'explanation', 'Document summary': 'summary',
}

/** Sections with supporting detail rather than the answer itself. */
const COLLAPSIBLE = new Set(['Evidence', 'Evidence behind the plan', 'Limitations', 'Limitations and open questions', 'More detail', 'Details'])

export function splitSections(body: string): ReportSection[] {
  const out: ReportSection[] = []
  const lines = body.split('\n')
  let title = ''
  let buf: string[] = []
  const flush = () => {
    const markdown = buf.join('\n').trim()
    if (title || markdown) {
      out.push({ title, markdown, collapsible: COLLAPSIBLE.has(title), items: (markdown.match(/^- /gm) ?? []).length })
    }
  }
  let inFence = false
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence
    const m = !inFence && line.match(/^## (.+?)\s*$/)
    if (m) {
      flush()
      title = m[1]
      buf = []
    } else buf.push(line)
  }
  flush()
  return out
}

export function parseReport(md: string): ParsedReport {
  const fallback: ParsedReport = { title: null, request: null, summary: null, preface: null, body: md, sections: [], footer: null, kind: null, structured: false }
  const text = md.replace(/\r\n/g, '\n')
  const titleM = text.match(/^# (.+)$/m)
  const sumIdx = text.search(/^## (Answer|Summary|Executive summary)\s*$/m)
  if (!titleM || sumIdx < 0) return fallback

  const requestM = text.slice(0, sumIdx).match(/^> \*\*Request:\*\* (.+)$/m)
  const afterSum = text.slice(sumIdx).replace(/^## [^\n]+\n/, '')
  const nextH2 = afterSum.search(/^## /m)
  const summaryBlock = (nextH2 < 0 ? afterSum : afterSum.slice(0, nextH2)).trim()
  let rest = nextH2 < 0 ? '' : afterSum.slice(nextH2)

  // Sources are rendered natively by the viewer; drop the Markdown copy from the body.
  const srcIdx = rest.search(/^## Sources\s*$/m)
  let footer: string | null = null
  if (srcIdx >= 0) {
    const tail = rest.slice(srcIdx)
    const hr = tail.search(/^---\s*$/m)
    if (hr >= 0) footer = tail.slice(hr).replace(/^---\s*\n/, '').trim() || null
    rest = rest.slice(0, srcIdx)
  } else {
    const hr = rest.search(/^---\s*$/m)
    if (hr >= 0) {
      footer = rest.slice(hr).replace(/^---\s*\n/, '').trim() || null
      rest = rest.slice(0, hr)
    }
  }

  const prefIdx = summaryBlock.search(/^\*\*(Assumptions|To tailor this further)/m)
  const summary = (prefIdx < 0 ? summaryBlock : summaryBlock.slice(0, prefIdx)).trim()
  const preface = prefIdx < 0 ? null : summaryBlock.slice(prefIdx).trim()

  const kindM = footer?.match(/^_(Comparison|Study plan|Research|How-to|Explanation|Document summary) report generated/)
  const body = rest.trim()
  return {
    title: titleM[1].trim(), request: requestM?.[1].trim() ?? null, summary: summary || null, preface,
    body, sections: splitSections(body), footer, kind: kindM ? KIND_FROM_FOOTER[kindM[1]] : null, structured: true,
  }
}

/**
 * Viewer-only: merge citation chips that sit next to each other ("[[1]](a)[[2]](b)") into one chip
 * ("[[1, 2]](a)"), so a sentence carries one compact marker. The export keeps every link.
 */
export function mergeAdjacentCitations(md: string): string {
  return md.replace(/\[\[\d+\]\]\([^)\s]*\)(?:\s?\[\[\d+\]\]\([^)\s]*\))+/g, (run) => {
    const nums = [...run.matchAll(/\[\[(\d+)\]\]\(([^)\s]*)\)/g)]
    return `[[${nums.map((m) => m[1]).join(', ')}]](${nums[0][2]})`
  })
}

/** Labels of a simple flow diagram ("flowchart LR" with s1["..."] --> s2 lines), in order. */
export function parseFlow(code: string): string[] | null {
  if (!/^\s*flowchart\s+(LR|TD|TB)\b/.test(code)) return null
  const labels = [...code.matchAll(/^\s*s\d+\["(.*)"\]/gm)].map((m) => m[1])
  return labels.length >= 2 ? labels : null
}

export const KIND_LABEL: Record<ReportKind, string> = {
  comparison: 'Comparison', study_plan: 'Study plan', research: 'Research', how_to: 'How-to',
  explanation: 'Explanation', summary: 'Document summary',
}
