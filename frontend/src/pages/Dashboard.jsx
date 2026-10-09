import { useEffect, useState } from 'react'
import { TankGauge, TachoGauge } from '../components/Gauges.jsx'
import TelemetryChart, { MarkSwatch } from '../components/TelemetryChart.jsx'
import { api } from '../api.js'

export default function Dashboard({ nodeContext, nodes, liveByNode, thresholdsByNode, nodeStatus, onExpandedChange }) {
  if (nodeContext === 'all') {
    return <AllNodesGrid nodes={nodes} liveByNode={liveByNode} nodeStatus={nodeStatus} />
  }
  return <NodeDashboard nodeId={Number(nodeContext)} nodes={nodes} live={liveByNode[nodeContext]}
    limits={thresholdsByNode[nodeContext]} status={nodeStatus?.[nodeContext]} onExpandedChange={onExpandedChange} />
}

// Inline dashboard charts are a quick-glance overview, not the analysis
// view -- capped to a fixed point count (not a time window) so they never
// look overcrowded regardless of how dense the data is. Click a chart to
// open the full expanded view with real timeframe controls (see
// ExpandedChartModal below).
const INLINE_RANGE = '1h'   // fixed underlying fetch window for the compact view; no longer user-facing
const MAX_INLINE_POINTS = 50

function NodeDashboard({ nodeId, nodes, live, limits, status, onExpandedChange }) {
  const [showMarks, setShowMarks] = useState({ threshold: true, model: true })
  const [history, setHistory] = useState([])
  const [now, setNow] = useState(new Date())
  const [expandedField, setExpandedField] = useState(null)   // null | 'ph' | 'turbidity' | 'temperature'
  const node = nodes.find((n) => n.node_id === nodeId)

  // Tell the app while the expanded chart is open (toasts shrink out of its way); also on leaving
  useEffect(() => {
    onExpandedChange?.(expandedField != null)
    return () => onExpandedChange?.(false)
  }, [expandedField, onExpandedChange])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // The last hour, or -- when the node has been quiet longer than that -- its last
  // MAX_INLINE_POINTS readings, so the charts open on the latest data either way
  useEffect(() => {
    let cancelled = false
    api.telemetryHistory(nodeId, INLINE_RANGE).then(async (rows) => {
      if (!rows.length) {
        rows = (await api.telemetryRows({ nodeId, pageSize: MAX_INLINE_POINTS })).rows.reverse()
      }
      if (!cancelled) setHistory(rows)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [nodeId])

  // Splice the live WebSocket tail onto the fetched history so charts move
  // in real time without waiting for the next timeframe re-fetch.
  useEffect(() => {
    if (live) setHistory((prev) => (prev.some((r) => r.id === live.id) ? prev : [...prev, live].slice(-500)))
  }, [live])

  const latest = live || history[history.length - 1]
  // Only the most recent N points are actually drawn inline -- `history`
  // itself stays larger so the volume total above still reflects the full
  // fetched window, not just what's visible on the small chart.
  const inlineRows = history.slice(-MAX_INLINE_POINTS)

  if (!latest || !limits) {
    return <div className="text-dark2 text-sm">Waiting for telemetry from node {nodeId}…</div>
  }

  return (
    <div>
      <Ribbon nodeLabel={node?.label || `Node ${nodeId}`} now={now} online={!!status?.is_online}
        offlineFor={status?.seconds_since_last_reading == null ? null
          : status.seconds_since_last_reading + (now - status.receivedAt) / 1000} />

      <div className="grid grid-cols-3 gap-4 mb-5">
        <Card title="Fluid Level Tracker">
          <TankGauge level={latest.water_level} minLevel={limits.min_level} maxLevel={limits.max_level} />
        </Card>
        <Card title="Discharge Velocity">
          <TachoGauge flow={latest.flowrate} maxFlow={Math.max(limits.max_flow * 1.15, latest.flowrate * 1.05, 0.1)} />
        </Card>
        <Card title="Volume (from node)">
          {/* Exactly the node's own running total from its latest packet -- same number as
              the ESP32's OLED. It's NOT summed from history, so it moves with the node:
              it resets to 0 after 60 s with no flow. null = a row from before this column existed. */}
          <div className="text-4xl font-extrabold">
            {latest.volume_total == null ? '—' : `${Number(latest.volume_total).toFixed(2)} L`}
          </div>
          <div className="text-xs text-dark2 mt-1">Running total reported by the node · resets after 60 s with no flow</div>
        </Card>
      </div>

      <div className="bg-white border border-border rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Flagged points to show">
            <span className="text-xs uppercase tracking-wide text-dark2 mr-1">Flagged by</span>
            <MarkToggle kind="threshold" label="Threshold" on={showMarks.threshold}
              onClick={() => setShowMarks((m) => ({ ...m, threshold: !m.threshold }))} />
            <MarkToggle kind="model" label="ML model" on={showMarks.model}
              onClick={() => setShowMarks((m) => ({ ...m, model: !m.model }))} />
          </div>
          <div className="text-xs text-dark2">Click a chart to expand it and choose a time range</div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <ClickableChart onExpand={() => setExpandedField('ph')}>
            <TelemetryChart rows={inlineRows} field="ph" limits={limits} show={showMarks}
              label="pH" clamp={[0, 14]} />
          </ClickableChart>
          <ClickableChart onExpand={() => setExpandedField('turbidity')}>
            <TelemetryChart rows={inlineRows} field="turbidity" limits={limits} show={showMarks}
              label="Turbidity" unit=" NTU" decimals={1} clamp={[0, Infinity]} />
          </ClickableChart>
          <ClickableChart onExpand={() => setExpandedField('temperature')}>
            <TelemetryChart rows={inlineRows} field="temperature" limits={limits} show={showMarks}
              label="Temperature" unit="°C" />
          </ClickableChart>
        </div>
      </div>

      {expandedField && (
        <ExpandedChartModal
          nodeId={nodeId} field={expandedField} limits={limits} live={live}
          showMarks={showMarks} onClose={() => setExpandedField(null)}
        />
      )}
    </div>
  )
}

// Wraps a chart to make it clickable without interfering with Recharts'
// own mouse handling (hover tooltips, etc.) -- the click handler sits on
// a transparent overlay-free wrapper, and a visible hint only shows on
// hover so the inline view doesn't look like a button by default.
function ClickableChart({ onExpand, children }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="text-left rounded-lg -m-1 p-1 transition-colors hover:bg-canvas2 focus:outline-none focus:ring-2 focus:ring-accentDeep group relative"
      title="Click to expand"
    >
      {children}
      <span className="absolute top-0 right-1 text-[10px] text-dark2 opacity-0 group-hover:opacity-100 transition-opacity">
        ⤢ Expand
      </span>
    </button>
  )
}

// Field metadata shared between the inline chart calls and the expanded
// modal, so the two stay in sync (same label/unit/decimals/clamp) without
// duplicating it in two places.
const FIELD_META = {
  ph: { label: 'pH', clamp: [0, 14] },
  turbidity: { label: 'Turbidity', unit: ' NTU', decimals: 1, clamp: [0, Infinity] },
  temperature: { label: 'Temperature', unit: '°C' },
}

function ExpandedChartModal({ nodeId, field, limits, live, showMarks, onClose }) {
  const [range, setRange] = useState('1h')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const meta = FIELD_META[field]

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.telemetryHistory(nodeId, range).then((rows) => {
      if (!cancelled) { setHistory(rows); setLoading(false) }
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [nodeId, range])

  // Keep the expanded view live too, same splicing pattern as the main dashboard
  useEffect(() => {
    if (live) setHistory((prev) => (prev.some((r) => r.id === live.id) ? prev : [...prev, live].slice(-2000)))
  }, [live])

  // The ML models' current 24 h median for each sensor, refreshed with every new packet
  const [baselines, setBaselines] = useState({})
  useEffect(() => {
    let cancelled = false
    api.telemetryBaseline(nodeId).then((b) => { if (!cancelled) setBaselines(b) }).catch(() => {})
    return () => { cancelled = true }
  }, [nodeId, live])

  // Close on Escape, for keyboard users
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    // pb-14 keeps a strip free at the bottom for the minimized toasts, so they never cover the chart
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 pb-14"
      onClick={onClose}
      role="dialog" aria-modal="true" aria-label={`${meta.label} expanded chart`}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-full overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-dark">{meta.label}</h2>
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              {['1h', '6h', '24h'].map((r) => (
                <button
                  key={r}
                  className={`px-3 py-1 rounded-full border text-xs ${
                    range === r ? 'bg-accentDeep text-white border-accentDeep' : 'bg-white text-dark2 border-border'
                  }`}
                  onClick={() => setRange(r)}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              type="button" onClick={onClose} aria-label="Close"
              className="text-dark2 hover:text-dark text-xl leading-none px-1"
            >
              ×
            </button>
          </div>
        </div>
        {loading && history.length === 0 ? (
          <div className="h-[480px] flex items-center justify-center text-sm text-dark2">Loading…</div>
        ) : (
          <TelemetryChart
            rows={history} field={field} limits={limits} show={showMarks} height={480}
            label={meta.label} unit={meta.unit} decimals={meta.decimals} clamp={meta.clamp}
            baseline={baselines[field]}
          />
        )}
      </div>
    </div>
  )
}

function AllNodesGrid({ nodes, liveByNode, nodeStatus }) {
  const anyOnline = Object.values(nodeStatus || {}).some((s) => s.is_online)
  return (
    <div>
      <Ribbon nodeLabel="All Nodes Overview" now={new Date()} online={anyOnline} />
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {nodes.map((n) => {
          const latest = liveByNode[n.node_id]
          return (
            <div key={n.node_id} className="bg-white border border-border rounded-lg p-4">
              <div className="flex justify-between items-center mb-2.5">
                <b>{n.label}</b>
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: !nodeStatus?.[n.node_id]?.is_online ? '#94a3b8' : (latest?.is_anomaly ? '#DC2626' : '#22c55e') }}
                  title={nodeStatus?.[n.node_id]?.is_online ? 'Online' : 'Offline'}
                />
              </div>
              {latest ? (
                <div className="grid grid-cols-2 gap-2 text-sm text-dark2">
                  <div>pH <b className="text-dark">{latest.ph}</b></div>
                  <div>Turbidity <b className="text-dark">{latest.turbidity} NTU</b></div>
                  <div>Temp <b className="text-dark">{latest.temperature}°C</b></div>
                  <div>Level <b className="text-dark">{latest.water_level}%</b></div>
                  <div>Flow <b className="text-dark">{latest.flowrate} L/min</b></div>
                  <div>Status <b className="text-dark">{latest.is_anomaly ? 'Anomaly' : 'Nominal'}</b></div>
                </div>
              ) : (
                <div className="text-sm text-dark2">Waiting for telemetry…</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Ribbon({ nodeLabel, now, online, offlineFor }) {
  return (
    <div className="flex justify-between items-center bg-white border border-border rounded-lg px-5 py-3.5 mb-5">
      <div className="font-bold text-accentDeep text-base">{nodeLabel}</div>
      <div className="flex items-center gap-5 text-sm text-dark2">
        <div>{now.toLocaleTimeString()}</div>
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${online ? 'bg-accentSky animate-pulse' : 'bg-alert'}`} />
          {online ? 'Live data stream active'
            : offlineFor != null ? `No packets received in ${Math.round(offlineFor)}s`
            : 'Waiting for first packet'}
        </div>
      </div>
    </div>
  )
}

function MarkToggle({ kind, label, on, onClick }) {
  return (
    <button
      type="button" aria-pressed={on} onClick={onClick}
      title={on ? `Hide points flagged by ${label.toLowerCase()}` : `Show points flagged by ${label.toLowerCase()}`}
      className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs transition-colors ${
        on ? 'bg-canvas2 border-dark2 text-dark' : 'bg-white border-border text-dark2 opacity-60'
      }`}
    >
      <MarkSwatch kind={kind} size={12} />
      {label}
      <span className={`ml-0.5 text-[10px] font-semibold ${on ? 'text-accentDeep' : 'text-dark2'}`}>{on ? 'ON' : 'OFF'}</span>
    </button>
  )
}

function Card({ title, children }) {
  return (
    <div className="bg-white border border-border rounded-lg p-4">
      <h3 className="text-xs uppercase tracking-wide text-dark2 mb-3">{title}</h3>
      {children}
    </div>
  )
}
