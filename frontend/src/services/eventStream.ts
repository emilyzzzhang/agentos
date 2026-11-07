import type { ConnectionState, ExecutionEvent } from '../types'
import { API_BASE, api, ApiError } from './api'

interface StreamHandlers {
  getLastSeq: () => number
  onEvent: (e: ExecutionEvent) => void
  onState: (s: ConnectionState, detail?: string) => void
  onEnd: () => void
}

/**
 * Subscribes to a run's SSE stream. On any error the stream is reopened with
 * `?after=<last seq seen>`, so missed events are replayed by the server and the
 * store de-duplicates by sequence number.
 *
 * A watchdog also reopens the stream if nothing (not even the server's 10s heartbeat)
 * arrives for 25s: some proxies keep a dead upstream open without ever erroring.
 */
const WATCHDOG_MS = 25000

export function connectRunStream(runId: string, h: StreamHandlers): () => void {
  let es: EventSource | null = null
  let stopped = false
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let watchdog: ReturnType<typeof setTimeout> | undefined

  const alive = () => {
    clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      if (stopped) return
      es?.close()
      attempt += 1
      h.onState('reconnecting', 'No data from the server; reconnecting…')
      open()
    }, WATCHDOG_MS)
  }

  const open = () => {
    if (stopped) return
    h.onState(attempt === 0 ? 'connecting' : 'reconnecting')
    es = new EventSource(`${API_BASE}/runs/${runId}/events?after=${h.getLastSeq()}`)
    alive()
    es.onopen = () => {
      attempt = 0
      alive()
      h.onState('open')
    }
    es.addEventListener('heartbeat', alive)
    es.addEventListener('execution', (msg) => {
      alive()
      try {
        h.onEvent(JSON.parse((msg as MessageEvent).data) as ExecutionEvent)
      } catch (err) {
        console.error('Bad event payload', err)
      }
    })
    es.addEventListener('end', () => {
      stopped = true
      clearTimeout(watchdog)
      es?.close()
      h.onState('closed')
      h.onEnd()
    })
    es.onerror = async () => {
      if (stopped) return
      clearTimeout(watchdog)
      es?.close()
      attempt += 1
      h.onState('reconnecting')
      try {
        await api.getRun(runId)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          stopped = true
          h.onState('error', 'This run no longer exists on the server (it may have restarted).')
          return
        }
      }
      timer = setTimeout(open, Math.min(1000 * 2 ** (attempt - 1), 10000))
    }
  }

  open()
  return () => {
    stopped = true
    clearTimeout(timer)
    clearTimeout(watchdog)
    es?.close()
  }
}
