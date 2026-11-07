import { useEffect } from 'react'
import { labelLayer } from './components/office/labelLayer'
import { OfficeScene } from './components/office/OfficeScene'
import { ActivityFeed } from './components/panels/ActivityFeed'
import { AgentInspector } from './components/panels/AgentInspector'
import { EvidenceViewer } from './components/panels/EvidenceViewer'
import { LibraryPanel } from './components/panels/LibraryPanel'
import { MissionPanel } from './components/panels/MissionPanel'
import { ReportModal } from './components/panels/ReportModal'
import { AgentRoster } from './components/ui/AgentRoster'
import { MissionDock } from './components/ui/MissionDock'
import { TopBar } from './components/ui/TopBar'
import { useVisualDirector } from './hooks/useVisualDirector'
import { useLibraryStore } from './stores/libraryStore'
import { useRunStore } from './stores/runStore'
import { useUiStore } from './stores/uiStore'

export default function App() {
  useVisualDirector()
  const refreshHealth = useRunStore((s) => s.refreshHealth)
  const resume = useRunStore((s) => s.resume)
  const setFeedOpen = useUiStore((s) => s.setFeedOpen)

  useEffect(() => {
    if (window.innerWidth < 1024) setFeedOpen(false)
    void refreshHealth().then(resume)
    const t = setInterval(() => void refreshHealth(), 15000)
    return () => clearInterval(t)
  }, [refreshHealth, resume, setFeedOpen])

  useEffect(() => useLibraryStore.getState().connect(), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const ui = useUiStore.getState()
      if (ui.evidence) ui.openEvidence(null)
      else if (ui.reportOpen) ui.setReportOpen(false)
      else if (ui.missionOpen) ui.setMissionOpen(false)
      else if (ui.libraryOpen) ui.setLibraryOpen(false)
      else ui.select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app-bg relative h-full w-full overflow-hidden">
      <div className="absolute inset-0">
        <OfficeScene />
      </div>
      <div ref={labelLayer} className="pointer-events-none absolute inset-0 z-0 overflow-hidden" />
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-2 p-2 sm:p-3">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <TopBar />
          <AgentRoster />
        </header>
        {/* Panels are bounded by this region, so they never extend past the header or the dock. */}
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-x-0 bottom-0 flex max-h-[55%] md:inset-x-auto md:top-0 md:bottom-auto md:left-0 md:max-h-[min(100%,520px)] md:w-[300px]">
            <ActivityFeed />
          </div>
          <div className="absolute inset-0 z-10 flex flex-col items-end gap-2 empty:hidden md:left-auto md:w-[340px] [&>*]:pointer-events-auto">
            <AgentInspector />
            <MissionPanel />
            <LibraryPanel />
          </div>
        </div>
        <footer className="flex justify-center">
          <div className="w-full max-w-[640px]">
            <MissionDock />
          </div>
        </footer>
      </div>
      <ReportModal />
      <EvidenceViewer />
    </div>
  )
}
