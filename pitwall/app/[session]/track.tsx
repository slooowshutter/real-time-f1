'use client'

import { useMemo } from 'react'
import type { Frame } from '@/lib/state'
import { Empty, useSize } from './ui'

export function TrackMap({ f, sel, onSelect }: { f: Partial<Frame>; sel: number | null; onSelect: (n: number) => void }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>()
  const track = f.track
  const box = useMemo(() => {
    if (!track?.length) return null
    const xs = track.map((p) => p[0])
    const ys = track.map((p) => -p[1]) // OpenF1 y points up, SVG y points down
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const pad = Math.max(x1 - x0, y1 - y0) * 0.06
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad }
  }, [track])
  const path = useMemo(() => track?.map(([x, y]) => `${x},${-y}`).join(' '), [track])

  const rows = f.tower ?? []
  const k = box && w ? Math.max(box.w / w, box.h / h) : 1 // track units per screen pixel
  const order = [...rows].reverse().sort((a, b) => Number(a.n === sel) - Number(b.n === sel)) // leader and selection on top

  return (
    <div ref={ref} className="absolute inset-0">
      {f.weather && <Weather w={f.weather} />}
      {!box ? (
        <Empty>{f.meta?.live ? 'The track map appears once a car completes a lap.' : 'The track map appears once position data has loaded.'}</Empty>
      ) : (
        <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="size-full" role="img" aria-label={`Track map of ${f.meta?.circuit ?? 'the circuit'} with car positions`}>
          <polygon points={path} fill="none" stroke="var(--color-raised)" strokeWidth={k * 16} strokeLinejoin="round" />
          <polygon points={path} fill="none" stroke="var(--color-rule)" strokeWidth={k * 2} strokeLinejoin="round" />
          <StartLine track={track!} k={k} />
          {order.map((r) => {
            const xy = f.cars?.[r.n]?.xy
            if (!xy) return null
            const on = r.n === sel
            return (
              <g
                key={r.n}
                className="car cursor-pointer"
                style={{ transform: `translate(${xy[0]}px, ${-xy[1]}px)` }}
                onClick={() => onSelect(r.n)}
              >
                <title>{`P${r.pos ?? '–'} ${r.name}`}</title>
                <circle r={k * 14} fill="transparent" />
                {on && <circle r={k * 11} fill="none" stroke="var(--color-chalk)" strokeWidth={k * 1.5} />}
                <circle r={k * (on ? 7 : 5.5)} fill={r.color} stroke="var(--color-screen)" strokeWidth={k * 2} />
                <text
                  x={k * 10}
                  y={k * 4}
                  fontSize={k * (on ? 13 : 11)}
                  fontWeight={on ? 700 : 600}
                  fill={on ? 'var(--color-chalk)' : 'var(--color-fog)'}
                  paintOrder="stroke"
                  stroke="var(--color-screen)"
                  strokeWidth={k * 3}
                >
                  {r.code}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

/** The outline starts at the line (it is a lap), so a tick across its first segment marks start/finish. */
function StartLine({ track, k }: { track: [number, number][]; k: number }) {
  const [x0, y0] = track[0]
  const [x1, y1] = track[Math.min(3, track.length - 1)]
  const len = Math.hypot(x1 - x0, y1 - y0) || 1
  const [nx, ny] = [-(y1 - y0) / len, (x1 - x0) / len]
  const r = k * 11
  return <line x1={x0 - nx * r} y1={-(y0 - ny * r)} x2={x0 + nx * r} y2={-(y0 + ny * r)} stroke="var(--color-chalk)" strokeWidth={k * 3} />
}

function Weather({ w }: { w: NonNullable<Frame['weather']> }) {
  const items: [string, string][] = [
    ['Air', `${w.air_temperature.toFixed(1)}°`],
    ['Track', `${w.track_temperature.toFixed(1)}°`],
    ['Humidity', `${Math.round(w.humidity)}%`],
    ['Wind', `${w.wind_speed.toFixed(1)} m/s`],
    ['Rain', w.rainfall ? 'Yes' : 'No'],
  ]
  return (
    <dl className="tnum absolute bottom-3 left-3 z-10 flex gap-4 rounded bg-screen/85 px-2.5 py-1.5 text-xs">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-dim">{k}</dt>
          <dd className={`font-semibold ${k === 'Rain' && w.rainfall ? 'text-wet' : ''}`}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}
