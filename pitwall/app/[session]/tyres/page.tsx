'use client'

import { memo, useState } from 'react'
import type { Frame, Row } from '@/lib/state'
import { useFrame } from '../dashboard'
import { compound, tyreOf } from '../format'
import { Empty, useSize } from '../ui'

type Tyres = Frame['tyres']
type Stint = Tyres['stints'][number][number]

const PAD = { l: 104, r: 48, t: 28, b: 30 }
const NONE: never[] = []
const NEUTRAL = {
  sc: { label: 'SC', name: 'Safety car', color: 'var(--color-flag-sc)' },
  vsc: { label: 'VSC', name: 'Virtual safety car', color: 'var(--color-flag-sc)' },
  red: { label: 'RED', name: 'Red flag', color: 'var(--color-flag-red)' },
}

export default function TyresPage() {
  const { f, sel, select } = useFrame()
  return (
    <main className="flex min-h-[560px] flex-1 flex-col rounded-md bg-screen xl:min-h-0">
      <Strategy tyres={f.tyres} rows={f.tower ?? NONE} race={!!f.meta?.race} status={f.meta?.status} sel={sel} onSelect={select} />
    </main>
  )
}

/** Lollipop chart, one row per car in running order: a stick for each stint across the laps it ran,
 *  the head on the lap it ended (the pit stop, or the lap in progress). Filled head = new set. */
const Strategy = memo(function Strategy({
  tyres,
  rows,
  race,
  status,
  sel,
  onSelect,
}: {
  tyres?: Tyres
  rows: Row[]
  race: boolean
  status?: string
  sel: number | null
  onSelect: (n: number) => void
}) {
  const [ref, { w, h }] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<{ n: number; i: number } | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const stints = tyres?.stints ?? {}
  const shown = rows.filter((r) => stints[r.n]?.length)
  const neutral = race ? (tyres?.neutral ?? NONE) : NONE
  const used = new Set(shown.flatMap((r) => stints[r.n].map((s) => s.c)))

  const laps = Math.max(1, ...shown.flatMap((r) => stints[r.n].map((s) => s.to)))
  const rh = Math.min(44, Math.max(24, (h - PAD.t - PAD.b) / Math.max(1, shown.length)))
  const H = PAD.t + PAD.b + shown.length * rh
  const pw = w - PAD.l - PAD.r
  const X = (lap: number) => PAD.l + (lap / laps) * pw // lap boundaries: 0 is the start, n the end of lap n
  const Y = (i: number) => PAD.t + (i + 0.5) * rh
  const r = Math.min(10, Math.max(6, rh * 0.3))

  const step = laps > 50 ? 10 : laps > 20 ? 5 : laps > 8 ? 2 : 1
  const ticks = Array.from({ length: Math.floor(laps / step) }, (_, i) => (i + 1) * step)
  if (laps - (ticks.at(-1) ?? 0) > step * 0.4) ticks.push(laps)

  // Row highlights go under the safety car bands, so they are drawn first.
  const mark = (n: number | null, opacity: number) => {
    const i = shown.findIndex((row) => row.n === n)
    return i < 0 ? null : <rect x={0} y={Y(i) - rh / 2} width={w} height={rh} fill="var(--color-raised)" fillOpacity={opacity} />
  }
  // Band labels that would overlap the previous one are left out (the band keeps its title).
  const bands: ((typeof neutral)[number] & { x0: number; x1: number; labelled: boolean })[] = []
  let labelEnd = -Infinity
  for (const p of neutral) {
    const [x0, x1] = [X(p.from - 1), X(p.to)]
    const half = NEUTRAL[p.kind].label.length * 3.5
    const labelled = (x0 + x1) / 2 - half > labelEnd + 4
    if (labelled) labelEnd = (x0 + x1) / 2 + half
    bands.push({ ...p, x0, x1, labelled })
  }
  const tip = hover && shown.find((row) => row.n === hover.n)
  const tipStint = tip && stints[tip.n][hover.i]

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3 pb-1">
        <h2 className="shrink-0 text-sm font-semibold">{race ? 'Tyre strategy' : 'Tyre runs'}</h2>
        <p className="truncate text-xs text-dim">One stick per set of tyres, its head on the lap it came off. Drivers in running order.</p>
        {shown.length > 0 && <Legend used={used} neutral={neutral.length > 0} />}
      </div>
      <div ref={ref} className="min-h-0 flex-1 overflow-y-auto">
        {!shown.length ? (
          <Empty>{status ?? 'Tyre stints appear once the cars start their first lap.'}</Empty>
        ) : (
          w > 0 && (
            <div className="relative" style={{ width: w, height: H }}>
              <svg width={w} height={H} className="tnum narrow block select-none" role="group" aria-label={`${race ? 'Tyre strategy' : 'Tyre runs'}, lap 1 to ${laps}`}>
                {over !== sel && mark(over, 0.5)}
                {mark(sel, 1)}
                {bands.map(({ x0, x1, labelled, ...p }) => {
                  const look = NEUTRAL[p.kind]
                  return (
                    <g key={`${p.kind}${p.from}`}>
                      <title>{`${look.name}, ${p.from === p.to ? `lap ${p.from}` : `laps ${p.from}–${p.to}`}`}</title>
                      <rect x={x0} y={PAD.t - 8} width={x1 - x0} height={H - PAD.t - PAD.b + 8} fill={look.color} fillOpacity={0.1} />
                      {labelled && (
                        <text x={(x0 + x1) / 2} y={PAD.t - 13} textAnchor="middle" fontSize={10} fontWeight={700} fill={look.color}>
                          {look.label}
                        </text>
                      )}
                    </g>
                  )
                })}
                {ticks.map((l, i) => (
                  <g key={l}>
                    <line x1={X(l)} x2={X(l)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-rule)" strokeDasharray="2 3" />
                    <text x={X(l)} y={H - 10} textAnchor="middle" fontSize={11} fill={l === laps ? 'var(--color-fog)' : 'var(--color-dim)'}>
                      {i ? l : `Lap ${l}`}
                    </text>
                  </g>
                ))}

                {shown.map((row, i) => {
                  const y = Y(i)
                  const list = stints[row.n]
                  const now = list.at(-1)!
                  const age = now.age == null ? null : now.age + now.to - now.from // as in the timing tower
                  const tail = row.out ? 'Out' : row.inPit ? 'Pit' : age == null ? '' : String(age)
                  return (
                    <g
                      key={row.n}
                      className="cursor-pointer"
                      opacity={row.out ? 0.45 : 1}
                      onClick={() => onSelect(row.n)}
                      onPointerEnter={() => setOver(row.n)}
                      onPointerLeave={() => setOver(null)}
                    >
                      <rect x={0} y={y - rh / 2} width={w} height={rh} fill="transparent" />
                      {i > 0 && <line x1={8} x2={w - 8} y1={y - rh / 2} y2={y - rh / 2} stroke="var(--color-rule)" strokeOpacity={0.6} />}
                      <text x={30} y={y} dy="0.35em" textAnchor="end" fontSize={13} fontWeight={700} fill="var(--color-chalk)">
                        {row.pos ?? '–'}
                      </text>
                      <rect x={40} y={y - 8} width={3} height={16} rx={1.5} fill={row.color} />
                      <text x={51} y={y} dy="0.35em" fontSize={14} fontWeight={600} fill="var(--color-chalk)" style={{ fontVariationSettings: "'wdth' 100" }}>
                        {row.code}
                      </text>

                      {list.map((s, j) => (
                        <line
                          key={j}
                          x1={X(s.from - 1)}
                          x2={X(s.to)}
                          y1={y}
                          y2={y}
                          stroke={tyreOf(s.c).color}
                          strokeOpacity={0.75}
                          strokeWidth={hover?.n === row.n && hover.i === j ? 5 : 3}
                        />
                      ))}
                      {list.map((s, j) => (
                        <g
                          key={j}
                          tabIndex={0}
                          role="img"
                          aria-label={`${row.code}: ${describe(s, j === list.length - 1, row, race).join('. ')}`}
                          className="outline-none focus-visible:[&>circle]:stroke-chalk"
                          onPointerEnter={() => setHover({ n: row.n, i: j })}
                          onPointerLeave={() => setHover(null)}
                          onFocus={() => setHover({ n: row.n, i: j })}
                          onBlur={() => setHover(null)}
                          onKeyDown={(e) => e.key === 'Enter' && onSelect(row.n)}
                        >
                          {/* wide invisible hit area along the stick, so the whole stint is hoverable */}
                          <rect x={X(s.from - 1)} y={y - rh / 2} width={X(s.to) - X(s.from - 1)} height={rh} fill="transparent" />
                          <Head c={s.c} fresh={s.age === 0} x={X(s.to)} y={y} r={r} />
                        </g>
                      ))}
                      {tail && (
                        <text x={X(now.to) + r + 6} y={y} dy="0.35em" fontSize={12} fontWeight={tail === 'Pit' ? 700 : 500} fill={tail === 'Pit' ? 'var(--color-chalk)' : 'var(--color-fog)'}>
                          {tail}
                        </text>
                      )}
                    </g>
                  )
                })}
              </svg>

              {tip && tipStint && (
                <Tip
                  stint={tipStint}
                  row={tip}
                  last={hover.i === stints[tip.n].length - 1}
                  race={race}
                  style={{
                    top: Math.min(Math.max(4, Y(shown.indexOf(tip)) - 20), H - 120),
                    // right of the head, else left of the stick, kept on screen (w-60 = 240 px)
                    left: X(tipStint.to) + r + 250 <= w ? X(tipStint.to) + r + 10 : Math.max(4, X(tipStint.from - 1) - 248),
                  }}
                />
              )}
            </div>
          )
        )}
      </div>
    </>
  )
})

/** New set: solid. Used (or not known yet): a ring around a tint of the compound. */
function Head({ c, fresh, x, y, r }: { c: string; fresh: boolean; x: number; y: number; r: number }) {
  const t = tyreOf(c)
  return (
    <>
      <circle cx={x} cy={y} r={r} fill={fresh ? t.color : `color-mix(in srgb, ${t.color} 22%, var(--color-screen))`} stroke={t.color} strokeWidth={2} />
      <text x={x} y={y} dy="0.36em" textAnchor="middle" fontSize={r * 1.15} fontWeight={800} fill={fresh ? 'var(--color-wall)' : t.color} style={{ fontVariationSettings: "'wdth' 100" }}>
        {t.letter}
      </text>
    </>
  )
}

function describe(s: Stint, last: boolean, row: Row, race: boolean) {
  const n = s.to - s.from + 1
  const lines = [
    `${s.from === s.to ? `Lap ${s.from}` : `Laps ${s.from}–${s.to}`}, ${n} lap${n === 1 ? '' : 's'}${last && !row.out ? ' so far' : ''}`,
    s.age == null ? 'Set not reported yet' : s.age === 0 ? 'New set' : `Used set, ${s.age} lap${s.age === 1 ? '' : 's'} old when fitted`,
  ]
  if (last) {
    if (row.out) lines.push('Retired on this set')
    else if (row.inPit) lines.push('In the pit lane now')
  } else lines.push(`${race ? 'Pitted' : 'Back in'} after lap ${s.to}${s.pit != null ? `, ${s.pit.toFixed(1)} s in the pit lane` : ''}`)
  return lines
}

function Tip({ stint, row, last, race, style }: { stint: Stint; row: Row; last: boolean; race: boolean; style: React.CSSProperties }) {
  const t = tyreOf(stint.c)
  return (
    <div className="tnum pointer-events-none absolute z-10 w-60 rounded bg-raised p-2.5 text-xs shadow-lg shadow-black/40" style={style}>
      <p className="mb-1.5 flex items-center gap-2">
        <span className="h-3 w-[3px] rounded-full" style={{ background: row.color }} />
        <span className="font-semibold">{row.code}</span>
        <span className="ml-auto font-semibold" style={{ color: t.color }}>
          {t.name}
        </span>
      </p>
      {describe(stint, last, row, race).map((l) => (
        <p key={l} className="py-px text-fog">
          {l}
        </p>
      ))}
    </div>
  )
}

function Legend({ used, neutral }: { used: Set<string>; neutral: boolean }) {
  const item = 'flex items-center gap-1.5'
  return (
    <ul className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fog">
      {[...Object.keys(compound), 'UNKNOWN']
        .filter((c) => used.has(c))
        .map((c) => (
          <li key={c} className={item}>
            <span className="size-2.5 rounded-full" style={{ background: tyreOf(c).color }} />
            {tyreOf(c).name}
          </li>
        ))}
      <li className={item}>
        <span className="size-3 rounded-full bg-fog" />
        New set
      </li>
      <li className={item}>
        <span className="size-3 rounded-full border-2 border-fog bg-fog/20" />
        Used set
      </li>
      {neutral && (
        <li className={item}>
          <span className="h-3 w-2.5 rounded-sm bg-flag-sc/30" />
          Safety car, VSC, red flag
        </li>
      )}
    </ul>
  )
}
