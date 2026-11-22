'use client'

import { memo, useState } from 'react'
import type { Forecast } from '@/lib/forecast'
import type { Frame } from '@/lib/state'
import { lapTime } from './format'
import { Empty, useSize } from './ui'

const PAD = { l: 52, r: 44, t: 12, b: 26 }

/** Race: seconds behind the leader at every line crossing, and with a forecast, projected to the flag.
 *  Other sessions: lap times. Better is always up. */
export const GapChart = memo(function GapChart({
  history,
  rows,
  sel,
  forecast,
}: {
  history?: Frame['history']
  rows: Frame['tower']
  sel: number | null
  forecast?: Forecast | null
}) {
  const [ref, { w, h }] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const race = history?.kind !== 'lap'
  const series = history?.series ?? {}
  const fc = race ? forecast : null
  const byN = new Map(rows.map((r) => [r.n, r]))
  const laps = Math.max(0, fc?.total ?? 0, ...Object.values(series).map((a) => a.length))
  const from = fc ? fc.lap - 1 : laps // index of the first projected lap
  const at = (n: number, i: number) => (i >= from ? fc?.trace[n]?.[i - from] : series[n]?.[i]) ?? null
  const focus = new Set([...rows.slice(0, 3).map((r) => r.n), ...(sel != null ? [sel] : [])])

  const title = race ? 'Gap to leader' : 'Lap times'
  const header = (
    <div className="flex items-baseline gap-3 px-4 pt-3">
      <h2 className="shrink-0 text-sm font-semibold">{title}</h2>
      <p className="truncate text-xs text-dim">
        Top three and selected driver in team colour, rest of the field in grey{fc ? ', forecast dashed' : ''}
      </p>
    </div>
  )

  // y domain
  const lastOf = (a: (number | null)[]) => a.findLast((v) => v != null) ?? null
  let lo = 0
  let hi = 10
  if (race) {
    const ref10 = rows.slice(0, 10).map((r) => lastOf(series[r.n] ?? [])).filter((v): v is number => v != null)
    const s = sel != null ? lastOf(series[sel] ?? []) : null
    // With a forecast, also where the highlighted cars go, stops included.
    const ahead = fc ? [...focus].flatMap((n) => fc.trace[n] ?? []) : []
    hi = Math.max(5, ...ref10, s ?? 0, ...ahead) * 1.1
  } else {
    const all = Object.values(series).flat().filter((v): v is number => v != null)
    if (all.length) {
      const best = Math.min(...all)
      lo = best - 0.4
      hi = best * 1.07
    }
  }
  const pw = Math.max(1, w - PAD.l - PAD.r)
  const ph = Math.max(1, h - PAD.t - PAD.b)
  const X = (i: number) => PAD.l + (laps > 1 ? (i / (laps - 1)) * pw : pw / 2)
  const Y = (v: number) => PAD.t + ((v - lo) / (hi - lo)) * ph

  const step = niceStep((hi - lo) / 5, race)
  const yTicks: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) yTicks.push(v)
  const xStep = laps > 50 ? 10 : laps > 20 ? 5 : laps > 8 ? 2 : 1
  const xTicks = Array.from({ length: laps }, (_, i) => i + 1).filter((l) => l === 1 || l % xStep === 0)

  const pathOf = (a: (number | null)[], start = 0) => {
    let d = ''
    let pen = false
    a.forEach((v, k) => {
      if (v == null) return void (pen = false)
      d += `${pen ? 'L' : 'M'}${X(start + k).toFixed(1)},${Y(v).toFixed(1)}`
      pen = true
    })
    return d
  }
  // Projection: picks up from the car's last crossing so the dashed line continues the solid one.
  const projOf = (n: number) => pathOf([series[n]?.[from - 1] ?? null, ...(fc?.trace[n] ?? [])], from - 1)

  // End labels for highlighted lines, nudged apart so they never overlap.
  const labels = [...focus]
    .map((n) => {
      const a = fc?.trace[n]?.length ? Array.from({ length: laps }, (_, i) => at(n, i)) : (series[n] ?? [])
      const i = a.findLastIndex((v) => v != null)
      return i < 0 ? null : { n, x: X(i), y: Math.min(Math.max(Y(a[i]!), PAD.t), PAD.t + ph) }
    })
    .filter((v) => v != null)
    .sort((a, b) => a.y - b.y)
  labels.forEach((l, i) => i && (l.y = Math.max(l.y, labels[i - 1].y + 12)))

  const tip =
    hover != null
      ? [...new Set([...Object.keys(series), ...Object.keys(fc?.trace ?? {})])]
          .map((n) => ({ n: Number(n), v: at(Number(n), hover) }))
          .filter((e): e is { n: number; v: number } => e.v != null)
          .sort((a, b) => a.v - b.v)
      : []
  const tipRows = [...tip.slice(0, 8), ...tip.slice(8).filter((e) => e.n === sel)]

  const move = (e: React.PointerEvent) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left
    setHover(Math.min(laps - 1, Math.max(0, Math.round(((x - PAD.l) / pw) * (laps - 1)))))
  }

  return (
    <div className="flex h-full flex-col">
      {header}
      <div
        ref={ref}
        className="relative min-h-0 flex-1 outline-none focus-visible:outline-2"
        tabIndex={laps ? 0 : -1}
        aria-label={`${title} chart. Use the arrow keys to read values lap by lap.`}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            e.stopPropagation()
            const d = e.key === 'ArrowLeft' ? -1 : 1
            setHover((v) => Math.min(laps - 1, Math.max(0, (v ?? laps - 1) + d)))
          } else if (e.key === 'Escape') setHover(null)
        }}
        onBlur={() => setHover(null)}
      >
        {!laps ? (
          <Empty>{race ? 'Gaps appear once the leader completes a lap.' : 'Lap times appear once a timed lap is completed.'}</Empty>
        ) : (
          w > 0 && (
            <svg width={w} height={h} className="tnum block" onPointerMove={move} onPointerLeave={() => setHover(null)}>
              <defs>
                <clipPath id="plot">
                  <rect x={PAD.l - 2} y={PAD.t - 2} width={pw + 4} height={ph + 4} />
                </clipPath>
              </defs>
              {fc && (
                <g>
                  <rect x={X(from - 1)} y={PAD.t} width={X(laps - 1) - X(from - 1)} height={ph} fill="var(--color-raised)" fillOpacity={0.45} />
                  <line x1={X(from - 1)} x2={X(from - 1)} y1={PAD.t} y2={PAD.t + ph} stroke="var(--color-fog)" strokeDasharray="2 3" />
                  <text x={X(from - 1) + 6} y={PAD.t + ph - 6} fontSize={11} fill="var(--color-fog)">
                    Now · forecast to lap {fc.total}
                  </text>
                </g>
              )}
              {yTicks.map((v) => (
                <g key={v}>
                  <line x1={PAD.l} x2={PAD.l + pw} y1={Y(v)} y2={Y(v)} stroke="var(--color-rule)" />
                  <text x={PAD.l - 8} y={Y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-dim)">
                    {race ? (v ? `+${v}s` : 'Leader') : lapTime(v).replace(/(\.\d)\d\d$/, '$1')}
                  </text>
                </g>
              ))}
              {xTicks.map((l) => (
                <text key={l} x={X(l - 1)} y={h - 8} textAnchor="middle" fontSize={11} fill="var(--color-dim)">
                  {l === 1 ? 'Lap 1' : l}
                </text>
              ))}
              <g clipPath="url(#plot)" fill="none" strokeLinejoin="round" strokeLinecap="round">
                {Object.entries(series).map(([n, a]) =>
                  focus.has(Number(n)) ? null : <path key={n} d={pathOf(a)} stroke="var(--color-dim)" strokeOpacity={0.55} strokeWidth={1} />,
                )}
                {fc &&
                  Object.keys(fc.trace).map((k) =>
                    focus.has(Number(k)) ? null : (
                      <path key={`p${k}`} d={projOf(Number(k))} stroke="var(--color-dim)" strokeOpacity={0.45} strokeWidth={1} strokeDasharray="3 3" />
                    ),
                  )}
                {[...focus].map((n) => (
                  <path key={n} d={pathOf(series[n] ?? [])} stroke={byN.get(n)?.color} strokeWidth={n === sel ? 2.5 : 2} />
                ))}
                {fc &&
                  [...focus].map((n) => (
                    <path key={`p${n}`} d={projOf(n)} stroke={byN.get(n)?.color} strokeWidth={n === sel ? 2.5 : 2} strokeDasharray="5 4" strokeOpacity={0.9} />
                  ))}
                {fc &&
                  [...focus].map((n) => {
                    const stop = fc.cars[n]?.stop
                    const v = stop ? at(n, stop - 1) : null
                    return v == null ? null : (
                      <circle key={`s${n}`} cx={X(stop! - 1)} cy={Y(v)} r={4} fill="var(--color-screen)" stroke={byN.get(n)?.color} strokeWidth={2}>
                        <title>{`${byN.get(n)?.code} pits on lap ${stop}`}</title>
                      </circle>
                    )
                  })}
                {!race &&
                  [...focus].flatMap((n) =>
                    (series[n] ?? []).map((v, i) =>
                      v == null ? null : <circle key={`${n}-${i}`} cx={X(i)} cy={Y(v)} r={3} fill={byN.get(n)?.color} stroke="var(--color-screen)" strokeWidth={2} />,
                    ),
                  )}
              </g>
              {labels.map((l) => (
                <text key={l.n} x={l.x + 6} y={l.y + 4} fontSize={11} fontWeight={600} fill="var(--color-chalk)">
                  {byN.get(l.n)?.code}
                </text>
              ))}
              {hover != null && <line x1={X(hover)} x2={X(hover)} y1={PAD.t} y2={PAD.t + ph} stroke="var(--color-fog)" />}
            </svg>
          )
        )}
        {hover != null && tipRows.length > 0 && (
          <div
            className="tnum pointer-events-none absolute top-2 z-10 min-w-36 rounded bg-raised p-2.5 text-xs shadow-lg shadow-black/40"
            style={X(hover) > w / 2 ? { right: w - X(hover) + 10 } : { left: X(hover) + 10 }}
          >
            <p className="mb-1.5 text-dim">
              Lap {hover + 1}
              {hover >= from && ', forecast'}
            </p>
            {tipRows.map((e) => {
              const r = byN.get(e.n)
              return (
                <p key={e.n} className="flex items-center gap-2 py-px">
                  <span className="h-0.5 w-3 rounded" style={{ background: r?.color }} />
                  <span className="font-semibold">{race ? (e.v ? `+${e.v.toFixed(3)}` : 'Leader') : lapTime(e.v)}</span>
                  <span className={e.n === sel ? 'text-chalk' : 'text-fog'}>{r?.code ?? e.n}</span>
                </p>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
})

function niceStep(raw: number, race: boolean) {
  const steps = race ? [1, 2, 5, 10, 15, 20, 30, 60, 120] : [0.25, 0.5, 1, 2, 5, 10]
  return steps.find((s) => s >= raw) ?? steps.at(-1)!
}
