import { create } from 'zustand'
import type { AgentId } from '../types'

/** What the evidence viewer shows: a passage by document + chunk, optionally labeled with its citation ID. */
export interface EvidenceTarget {
  documentId: string | null
  chunkId: string | null
  /** e.g. "D2" when opened from a report citation or the mission evidence list */
  evidenceId?: string
  runId?: string
}

/** Right-hand panels are mutually exclusive so they never stack past the viewport. */
interface UiStore {
  selectedAgent: AgentId | null
  missionOpen: boolean
  libraryOpen: boolean
  reportOpen: boolean
  feedOpen: boolean
  evidence: EvidenceTarget | null
  focusNonce: number
  select: (id: AgentId | null) => void
  setMissionOpen: (v: boolean) => void
  setLibraryOpen: (v: boolean) => void
  setReportOpen: (v: boolean) => void
  setFeedOpen: (v: boolean) => void
  openEvidence: (t: EvidenceTarget | null) => void
  resetCamera: () => void
}

export const useUiStore = create<UiStore>((set) => ({
  selectedAgent: null,
  missionOpen: false,
  libraryOpen: false,
  reportOpen: false,
  feedOpen: true,
  evidence: null,
  focusNonce: 0,
  select: (id) => set((s) => ({
    selectedAgent: id, focusNonce: s.focusNonce + 1,
    missionOpen: id ? false : s.missionOpen, libraryOpen: id ? false : s.libraryOpen,
  })),
  setMissionOpen: (v) => set({ missionOpen: v, selectedAgent: null, libraryOpen: false }),
  setLibraryOpen: (v) => set({ libraryOpen: v, selectedAgent: null, missionOpen: false }),
  setReportOpen: (v) => set({ reportOpen: v }),
  setFeedOpen: (v) => set({ feedOpen: v }),
  openEvidence: (t) => set({ evidence: t }),
  resetCamera: () => set((s) => ({ selectedAgent: null, focusNonce: s.focusNonce + 1 })),
}))
