import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api.js'
import { formatDbTime, localDateToDb } from '../time.js'
import FlagBadges from '../components/FlagBadges.jsx'
import DownloadQr from '../components/DownloadQr.jsx'
import FilePreview from '../components/FilePreview.jsx'

const PAGE_SIZE = 50
const AUTO_REFRESH_MS = 5000

// threshold / ml include readings flagged by both (see TELEMETRY_FLAG_FILTERS in server.py)
export const FLAG_OPTIONS = [
  { value: 'all', label: 'All Readings' },
  { value: 'none', label: 'No Alerts' },
  { value: 'flagged', label: 'With Alerts only' },
  { value: 'threshold', label: 'Threshold breach' },
  { value: 'ml', label: 'Anomaly' },
]

const SELECT = 'p-2 border border-border rounded-md text-sm bg-white'
const COLUMNS = ['Node', 'Time', 'pH', 'Turbidity (NTU)', 'Temp (°C)', 'Water level (%)', 'Flow (L/min)', 'Volume (L)', 'Alert']

export default function HistoricalLogs({ nodes, liveByNode }) {
  const [nodeFilter, setNodeFilter] = useState('all')
  const [flagFilter, setFlagFilter] = useState('all')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [page, setPage] = useState(1)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [data, setData] = useState({ total: 0, rows: [] })
  const [exported, setExported] = useState(null)   // { filename, download_url, rows } from the server
  const [exportError, setExportError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [previewing, setPreviewing] = useState(false)

  const load = useCallback(() => {
    api.telemetryRows({
      nodeId: nodeFilter === 'all' ? undefined : Number(nodeFilter),
      start: localDateToDb(start),
      end: localDateToDb(end, true),
      flag: flagFilter,
      page,
      pageSize: PAGE_SIZE,
    }).then(setData).catch(() => {})
  }, [nodeFilter, flagFilter, start, end, page])

  useEffect(() => { load() }, [load])
  // Auto-refresh reloads when a new reading arrives, at most once per AUTO_REFRESH_MS --
  // a node sends every ~1.5 s, faster than the table is worth redrawing
  const lastLoad = useRef(0)
  useEffect(() => {
    if (!autoRefresh) return undefined
    const wait = Math.max(0, lastLoad.current + AUTO_REFRESH_MS - Date.now())
    const t = setTimeout(() => { lastLoad.current = Date.now(); load() }, wait)
    return () => clearTimeout(t)
  }, [autoRefresh, load, liveByNode])

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  const nodeLabel = (id) => nodes.find((n) => n.node_id === id)?.label || `Node ${id}`

  // The server writes every row matching the filters (not just this page) to a CSV, so a phone
  // can fetch it from the same QR download link as a PDF report.
  const exportCsv = async () => {
    setExportError('')
    setExported(null)
    setExporting(true)
    try {
      setExported(await api.exportCsv({
        node_id: nodeFilter === 'all' ? null : Number(nodeFilter),
        start: localDateToDb(start) ?? null,
        end: localDateToDb(end, true) ?? null,
        flag: flagFilter,
        tz_offset: new Date().getTimezoneOffset(),
      }))
    } catch (e) {
      setExportError(e.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <div className="bg-white border border-border rounded-lg px-5 py-3.5 mb-5 font-bold text-accentDeep">
        Historical Logs
      </div>

      <div className="bg-white border border-border rounded-lg p-4">
        <div className="flex flex-wrap gap-2.5 items-center mb-3.5">
          <select
            className={SELECT} aria-label="Node" value={nodeFilter}
            onChange={(e) => { setNodeFilter(e.target.value); setPage(1) }}
          >
            <option value="all">All nodes</option>
            {nodes.map((n) => <option key={n.node_id} value={n.node_id}>{n.label}</option>)}
          </select>
          <select
            className={SELECT} aria-label="Alert type" value={flagFilter}
            onChange={(e) => { setFlagFilter(e.target.value); setPage(1) }}
          >
            {FLAG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input type="date" aria-label="From date" className={SELECT} value={start}
            onChange={(e) => { setStart(e.target.value); setPage(1) }} />
          <input type="date" aria-label="To date" className={SELECT} value={end}
            onChange={(e) => { setEnd(e.target.value); setPage(1) }} />
          <label className="text-sm flex items-center gap-1.5">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Update automatically
          </label>
          <button className="ml-auto px-4 py-1.5 border border-accentDeep text-accentDeep rounded-md text-sm bg-white disabled:opacity-50" onClick={exportCsv} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export to spreadsheet (CSV)'}
          </button>
        </div>

        {exportError && <div className="mb-3 text-sm text-alert">{exportError}</div>}
        {exported && (
          <div className="mb-4">
            <div className="flex items-center gap-3 text-sm text-dark2">
              <span>Exported {exported.rows} rows to {exported.filename}.</span>
              <button className="text-accentDeep underline" onClick={() => setPreviewing(true)}>Preview</button>
              <button className="ml-auto px-3 py-1 border border-border rounded-md" onClick={() => setExported(null)}>Close</button>
            </div>
            <DownloadQr downloadUrl={exported.download_url} filename={exported.filename} title="Download the CSV" />
            {previewing && <FilePreview filename={exported.filename} downloadUrl={exported.download_url} onClose={() => setPreviewing(false)} />}
          </div>
        )}

        <div className="max-h-[520px] overflow-auto border border-border rounded-lg">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-canvas2 text-dark2 text-[11px] uppercase sticky top-0 z-10">
                {COLUMNS.map((h) => (
                  <th key={h} className="text-left px-2.5 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <tr><td colSpan={COLUMNS.length} className="px-2.5 py-6 text-center text-dark2">No readings match these filters.</td></tr>
              )}
              {data.rows.map((r) => (
                <tr key={r.id} className={r.is_anomaly ? 'bg-red-50/60' : ''}>
                  <td className="px-2.5 py-2 border-b border-border whitespace-nowrap">{nodeLabel(r.node_id)}</td>
                  <td className="px-2.5 py-2 border-b border-border whitespace-nowrap">{formatDbTime(r.timestamp)}</td>
                  <td className="px-2.5 py-2 border-b border-border whitespace-nowrap">{r.ph}</td>
                  <td className="px-2.5 py-2 border-b border-border whitespace-nowrap">{r.turbidity}</td>
                  <td className="px-2.5 py-2 border-b border-border whitespace-nowrap">{r.temperature}</td>
                  <td className="px-2.5 py-2 border-b border-border whitespace-nowrap">{r.water_level}</td>
                  <td className="px-2.5 py-2 border-b border-border whitespace-nowrap">{r.flowrate}</td>
                  <td className="px-2.5 py-2 border-b border-border whitespace-nowrap">{r.interval_volume}</td>
                  <td className="px-2.5 py-2 border-b border-border"><FlagBadges row={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex gap-2 items-center mt-3 text-sm">
          <button className="px-3 py-1.5 border border-border rounded-md" onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
          <span>Page {page} of {totalPages} · {data.total} rows</span>
          <button className="px-3 py-1.5 border border-border rounded-md" onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
        </div>
      </div>
    </div>
  )
}
