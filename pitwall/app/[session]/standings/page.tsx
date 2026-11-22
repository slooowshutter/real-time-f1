'use client'

import { Fragment, memo, useEffect, useMemo, useState } from 'react'
import { standingsAt, type Entry, type Standings, type Table } from '@/lib/standings'
import { useFrame } from '../dashboard'
import { Empty, useSize } from '../ui'

type Kind = 'drivers' | 'teams'
type View = 'points' | 'gap'
type Cells = 'round' | 'total'

export default function StandingsPage() {
  const { f, sel, select } = useFrame()
  const { meta, clock, tower } = f
  const year = meta?.year
  const [got, setGot] = useState<{ year: number; s?: Standings; error?: string }>()
  const [kind, setKind] = useState<Kind>('drivers')
  const [view, setView] = useState<View>('points')
  const [cells, setCells] = useState<Cells>('round')
  const [team, setTeam] = useState<string | null>(null)
  const [peek, setPeek] = useState<string | null>(null)

  useEffect(() => {
    if (!year) return
    let gone = false
    fetch(`/api/standings?year=${year}`)
      .then((r) => r.json())
      .catch((e: Error) => ({ error: e.message }))
      .then((j) => !gone && setGot(j.error ? { year, error: j.error } : { year, s: j }))
    return () => {
      gone = true
    }
  }, [year])

  // The session on screen scores as it stands once its race or sprint is under way.
  const running = meta?.race && clock && clock.lap > 0 ? tower : undefined
  const final = clock?.status === 'chequered' || (meta?.live === false && !!clock && clock.t >= clock.edge - 1000) // past session at its end
  const order = running?.map((r) => `${r.n}:${r.pos}${r.best?.c === 'p' ? 'f' : ''}`).join() ?? ''
  const s = got && got.year === year ? got.s : undefined
  const table = useMemo(
    () => (s && meta ? standingsAt(s, { sk: meta.sk, start: meta.start, final }, running ?? null) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `order` is the part of the tower that scores, the rest changes every frame
    [s, meta?.sk, meta?.start, final, order],
  )

  const teams = kind === 'teams'
  const list = table ? (teams ? table.teams : table.drivers) : []
  const selTeam = team ?? table?.drivers.find((e) => e.id === String(sel))?.team ?? null
  const hi = teams ? selTeam : sel != null ? String(sel) : null
  const pick = (id: string) => (teams ? setTeam(id) : select(Number(id)))

  const failed = got && got.year === year && got.error
  const note = !meta
    ? 'Connecting…'
    : failed
      ? failed.includes('401')
        ? 'OpenF1 is locked while a session is live. Add OPENF1_USERNAME and OPENF1_PASSWORD to .env.local to load the championship now.'
        : `OpenF1 request failed: ${failed}`
      : !table
        ? `Loading the ${year} championship…`
        : !table.rounds.length
          ? `OpenF1 has no races for ${year}.`
          : !table.done
            ? `Points appear after round 1, the ${table.rounds[0].name}.`
            : null

  return (
    <main className="flex flex-1 flex-col gap-1.5 xl:min-h-0">
      <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-screen px-4 py-2.5" aria-label="Championship">
        <Segmented label="Championship" value={kind} onChange={setKind} options={[['drivers', 'Drivers'], ['teams', 'Constructors']]} />
        <h2 className="wide text-base font-bold">
          {year} {teams ? 'Constructors’' : 'Drivers’'} Championship
        </h2>
        {table && table.rounds.length > 0 && <Summary table={table} list={list} teams={teams} lap={clock?.lap ?? 0} sprint={meta?.name === 'Sprint'} />}
      </section>

      {note || !table ? (
        <section className="min-h-[320px] flex-1 rounded-md bg-screen">
          <Empty>{note}</Empty>
        </section>
      ) : (
        <>
          <section className="flex h-[380px] shrink-0 flex-col rounded-md bg-screen xl:h-auto xl:min-h-[260px] xl:flex-[4] xl:shrink">
            <Chart table={table} list={list} teams={teams} view={view} setView={setView} hi={hi} peek={peek} />
          </section>
          <section className="flex max-h-[80dvh] flex-col rounded-md bg-screen xl:max-h-none xl:min-h-0 xl:flex-[5]">
            <Grid table={table} list={list} teams={teams} cells={cells} setCells={setCells} hi={hi} onPick={pick} onPeek={setPeek} />
          </section>
        </>
      )}
    </main>
  )
}

function Summary({ table, list, teams, lap, sprint }: { table: Table; list: Entry[]; teams: boolean; lap: number; sprint: boolean }) {
  const { rounds, done, live } = table
  const R = rounds.length
  const left = table.left[teams ? 't' : 'd'][done]
  const [a, b] = list
  const who = (e: Entry) => (teams ? e.name : e.code)
  const alive = list.filter((e) => e.alive).length
  const over = done === R && !live
  const when = !done
    ? `${R} rounds and ${left} points to play for`
    : live
      ? null
      : over
        ? `Final standings after ${R} rounds`
        : `After round ${done} of ${R}, the ${rounds[done - 1].name}`
  const fight = !a
    ? null
    : over
      ? `${a.name} ${live ? 'would be' : 'is'} champion${b ? `, ${a.pts - b.pts} points clear` : ''}`
      : alive === 1
        ? `${who(a)} ${live ? 'would clinch' : 'has clinched'} the title: ${b ? a.pts - b.pts : a.pts} clear with ${left} left`
        : `${who(a)} leads ${b ? `${who(b)} by ${a.pts - b.pts}` : ''} · ${left} points left · ${alive} ${teams ? 'teams' : 'drivers'} can still win`
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fog">
      {live && (
        <span className="flex items-center gap-2 font-semibold text-chalk">
          <span className="pulse size-2 rounded-full bg-live" />
          {sprint ? 'Sprint' : 'Race'} as it stands{lap ? `, lap ${lap}` : ''} · round {done} of {R}
        </span>
      )}
      {when && <span>{when}</span>}
      {fight && done > 0 && <span className="tnum">{fight}</span>}
    </p>
  )
}

function Segmented<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex shrink-0 rounded bg-raised p-0.5" role="radiogroup" aria-label={label}>
      {options.map(([k, text]) => (
        <button
          key={k}
          role="radio"
          aria-checked={value === k}
          onClick={() => onChange(k)}
          className={`rounded px-2.5 py-1 text-xs font-semibold ${value === k ? 'bg-chalk text-wall' : 'text-fog hover:text-chalk'}`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

const PAD = { l: 44, t: 18, b: 26 }

/** Running total (or gap to the leader) after every round, the rounds still to come shaded.
 *  With the gap view, the dashed line is the most a car can still score: below it the title is gone. */
const Chart = memo(function Chart({
  table,
  list,
  teams,
  view,
  setView,
  hi,
  peek,
}: {
  table: Table
  list: Entry[]
  teams: boolean
  view: View
  setView: (v: View) => void
  hi: string | null
  peek: string | null
}) {
  const [ref, { w, h }] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const { rounds, done, live } = table
  const R = rounds.length
  const left = table.left[teams ? 't' : 'd']
  const gap = view === 'gap'
  const at = (e: Entry, k: number) => (k ? e.cum[k - 1] : 0) // k = rounds in, 0 = before the season
  const lead = Array.from({ length: done + 1 }, (_, k) => Math.max(0, ...list.map((e) => at(e, k))))
  const val = (e: Entry, k: number) => (gap ? lead[k] - at(e, k) : at(e, k))
  const focus = new Set(teams ? list.map((e) => e.id) : [...list.slice(0, 5).map((e) => e.id), ...(hi ? [hi] : []), ...(peek ? [peek] : [])])
  const ks = Array.from({ length: done + 1 }, (_, k) => k)

  // The gap view zooms on the title fight (top four, anyone still in it, the selected); the rest run off the bottom.
  const scope = gap ? list.filter((e, i) => i < 4 || e.alive || e.id === hi) : list
  const raw = Math.max(10, ...scope.flatMap((e) => ks.map((k) => val(e, k))))
  const step = [5, 10, 20, 25, 50, 100, 200, 250, 500].find((v) => v >= raw / 5) ?? 1000
  const top = Math.ceil((raw * 1.04) / step) * step
  const padR = done >= R - 1 ? 84 : 16 // end labels need room once the season is (nearly) run
  const pw = Math.max(1, w - PAD.l - padR)
  const ph = Math.max(1, h - PAD.t - PAD.b)
  const X = (k: number) => PAD.l + (k / Math.max(1, R)) * pw
  const Y = (v: number) => (gap ? PAD.t + (v / top) * ph : PAD.t + ph - (v / top) * ph)
  const yTicks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step)
  const every = pw / R >= 32 ? 1 : pw / R >= 16 ? 2 : 4

  const path = (e: Entry, from: number, to: number) =>
    ks
      .slice(from, to + 1)
      .map((k, i) => `${i ? 'L' : 'M'}${X(k).toFixed(1)},${Y(val(e, k)).toFixed(1)}`)
      .join('')
  const solid = live ? done - 1 : done
  const line = (e: Entry, color: string, width: number, opacity = 1) => (
    <g key={e.id} stroke={color} strokeWidth={width} strokeOpacity={opacity}>
      <path d={path(e, 0, solid)} />
      {live && <path d={path(e, solid, done)} strokeDasharray="4 4" />}
    </g>
  )

  // End labels for the coloured lines, stacked so they never overlap, with a leader back to the line.
  const labels = list
    .filter((e) => focus.has(e.id))
    .map((e) => ({ e, y0: Math.min(Math.max(Y(val(e, done)), PAD.t), PAD.t + ph), y: 0 }))
    .sort((a, b) => a.y0 - b.y0)
  labels.forEach((l, i) => (l.y = Math.max(l.y0, i ? labels[i - 1].y + 13 : PAD.t)))
  for (let i = labels.length - 1; i >= 0; i--) labels[i].y = Math.min(labels[i].y, i < labels.length - 1 ? labels[i + 1].y - 13 : PAD.t + ph)

  const fmt = (e: Entry, k: number) => {
    const v = val(e, k)
    return gap ? (v ? `−${v}` : 'Leader') : String(v)
  }
  const tip = hover == null ? [] : [...list].sort((a, b) => (gap ? val(a, hover) - val(b, hover) : val(b, hover) - val(a, hover)))
  const tipRows = teams ? tip : [...tip.slice(0, 10), ...tip.slice(10).filter((e) => focus.has(e.id))]
  const move = (e: React.PointerEvent) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left
    setHover(Math.min(done, Math.max(1, Math.round(((x - PAD.l) / pw) * R))))
  }
  const title = gap ? 'Gap to the leader' : 'Points'

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
        <h2 className="shrink-0 text-sm font-semibold">{title}</h2>
        <p className="truncate text-xs text-dim">
          {teams ? 'Every team in its colour' : 'Top five and selected in team colour, the rest in grey'}
          {live ? ', live round dashed' : ''}
          {gap && left[done] > 0 ? `. Below the dashed line (${left[done]} points left) the title is out of reach` : ''}
        </p>
        <div className="ml-auto">
          <Segmented label="Chart" value={view} onChange={setView} options={[['points', 'Points'], ['gap', 'Gap to leader']]} />
        </div>
      </div>
      <div
        ref={ref}
        className="relative min-h-0 flex-1 outline-none focus-visible:outline-2"
        tabIndex={0}
        aria-label={`${title} after each round. Use the arrow keys to read the standings round by round; the table below has every value.`}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            e.stopPropagation()
            const d = e.key === 'ArrowLeft' ? -1 : 1
            setHover((v) => Math.min(done, Math.max(1, (v ?? done) + d)))
          } else if (e.key === 'Escape') setHover(null)
        }}
        onBlur={() => setHover(null)}
      >
        {w > 0 && (
          <svg width={w} height={h} className="tnum block select-none" onPointerMove={move} onPointerLeave={() => setHover(null)}>
            <defs>
              <clipPath id="standings-plot">
                <rect x={PAD.l - 2} y={PAD.t - 2} width={pw + 4} height={ph + 4} />
              </clipPath>
            </defs>
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={PAD.l + pw} y1={Y(v)} y2={Y(v)} stroke="var(--color-rule)" />
                <text x={PAD.l - 8} y={Y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-dim)">
                  {gap ? (v ? `−${v}` : 'Leader') : v}
                </text>
              </g>
            ))}
            {rounds.map((r, i) =>
              i % every ? null : (
                <text key={r.mk} x={X(i + 1)} y={h - 8} textAnchor="middle" fontSize={10.5} fill={i < done ? 'var(--color-fog)' : 'var(--color-dim)'}>
                  {r.code}
                </text>
              ),
            )}
            {done < R && (
              <g>
                <rect x={X(done)} y={PAD.t} width={X(R) - X(done)} height={ph} fill="var(--color-raised)" fillOpacity={0.45} />
                {X(R) - X(done) > 96 && (
                  <text x={X(R) - 8} y={PAD.t + ph - 8} textAnchor="end" fontSize={11} fill="var(--color-fog)">
                    {R - done} round{R - done > 1 ? 's' : ''} to go
                  </text>
                )}
              </g>
            )}
            {live && (
              <text x={X(done)} y={PAD.t - 6} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--color-live)">
                LIVE
              </text>
            )}
            <g clipPath="url(#standings-plot)" fill="none" strokeLinejoin="round" strokeLinecap="round">
              {gap && (
                <path
                  d={ks.map((k) => `${k ? 'L' : 'M'}${X(k).toFixed(1)},${Y(left[k]).toFixed(1)}`).join('')}
                  stroke="var(--color-fog)"
                  strokeWidth={1.5}
                  strokeDasharray="2 4"
                >
                  <title>Most points one {teams ? 'team' : 'driver'} can still score</title>
                </path>
              )}
              {list.map((e) => (focus.has(e.id) ? null : line(e, 'var(--color-dim)', 1, 0.6)))}
              {list
                .filter((e) => focus.has(e.id))
                .sort((a, b) => Number(a.id === hi) - Number(b.id === hi) || Number(a.id === peek) - Number(b.id === peek))
                .map((e) => line(e, e.color, e.id === hi || e.id === peek ? 3 : 2))}
            </g>
            {labels.map(({ e, y, y0 }) => (
              <g key={e.id}>
                {Math.abs(y - y0) > 2 && <path d={`M${X(done) + 3},${y0}L${X(done) + 8},${y}`} stroke="var(--color-dim)" fill="none" />}
                <text x={X(done) + 10} y={y + 4} fontSize={11}>
                  <tspan fontWeight={600} fill="var(--color-chalk)">
                    {teams ? e.name : e.code}
                  </tspan>
                  <tspan dx={5} fill="var(--color-fog)">
                    {fmt(e, done)}
                  </tspan>
                </text>
              </g>
            ))}
            {hover != null && (
              <g>
                <line x1={X(hover)} x2={X(hover)} y1={PAD.t} y2={PAD.t + ph} stroke="var(--color-fog)" />
                {list
                  .filter((e) => focus.has(e.id))
                  .map((e) => (
                    <circle key={e.id} cx={X(hover)} cy={Y(val(e, hover))} r={4} fill={e.color} stroke="var(--color-screen)" strokeWidth={2} />
                  ))}
              </g>
            )}
          </svg>
        )}
        {hover != null && (
          <div
            className="tnum pointer-events-none absolute top-2 z-10 min-w-44 rounded bg-raised p-2.5 text-xs shadow-lg shadow-black/40"
            style={X(hover) > w / 2 ? { right: w - X(hover) + 12 } : { left: X(hover) + 12 }}
          >
            <p className="mb-1.5 text-dim">
              Round {hover} · {rounds[hover - 1].name}
              {live && hover === done && ', as it stands'}
            </p>
            {tipRows.map((e) => (
              <p key={e.id} className="flex items-center gap-2 py-px">
                <span className="h-0.5 w-3 shrink-0 rounded" style={{ background: e.color }} />
                <span className="w-12 font-semibold">{fmt(e, hover)}</span>
                <span className={`${e.id === hi ? 'text-chalk' : 'text-fog'} truncate`}>{teams ? e.name : e.code}</span>
                {!!e.got[hover - 1] && <span className="ml-auto pl-2 text-dim">+{e.got[hover - 1]}</span>}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})

/** Standings with every round's points (or the running total), the title cut-off drawn across. */
const Grid = memo(function Grid({
  table,
  list,
  teams,
  cells,
  setCells,
  hi,
  onPick,
  onPeek,
}: {
  table: Table
  list: Entry[]
  teams: boolean
  cells: Cells
  setCells: (c: Cells) => void
  hi: string | null
  onPick: (id: string) => void
  onPeek: (id: string | null) => void
}) {
  const { rounds, done, live } = table
  const most = teams ? 58 : 33 // a sprint weekend's best haul: the cell shading tops out there
  const lead = list[0]?.pts ?? 0
  const out = table.left[teams ? 't' : 'd'][done] > 0 ? list.findIndex((e) => !e.alive) : -1
  const cols = 6 + rounds.length
  const th = 'px-2 py-1.5 font-medium'

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3 pb-2">
        <h2 className="shrink-0 text-sm font-semibold">Standings</h2>
        <p className="truncate text-xs text-dim">
          {cells === 'round' ? 'Points scored each round, sprint included (S: sprint weekend). Bold: race win' : 'Running total after each round'}
          {live ? '. Live round in italics' : ''}
        </p>
        <div className="ml-auto">
          <Segmented label="Round columns" value={cells} onChange={setCells} options={[['round', 'Per round'], ['total', 'Running total']]} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="tnum w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20 bg-screen text-[11px] text-dim">
            <tr>
              <th scope="col" className={`${th} sticky left-0 z-10 bg-screen pl-4 text-left`}>
                {teams ? 'Team' : 'Driver'}
              </th>
              <th scope="col" className={`${th} text-left`}>{teams ? 'Drivers' : 'Team'}</th>
              <th scope="col" className={`${th} text-right`}>Points</th>
              <th scope="col" className={`${th} text-right`}>Gap</th>
              <th scope="col" className={`${th} text-right`}>Wins</th>
              <th scope="col" className={`${th} text-right`}>Podiums</th>
              {rounds.map((r, i) => (
                <th
                  key={r.mk}
                  scope="col"
                  title={`Round ${i + 1}: ${r.name}${r.sprint ? ', sprint weekend' : ''}`}
                  className={`min-w-9 px-0.5 py-1.5 text-center font-medium leading-tight last:pr-4 ${i < done ? '' : 'opacity-50'}`}
                >
                  <span className={`block ${i < done ? 'text-fog' : ''}`}>{r.code}</span>
                  <span className="block">
                    {live && i === done - 1 ? <span className="font-bold text-live">LIVE</span> : i + 1}
                    {r.sprint && <span className="ml-0.5 rounded-sm bg-rule px-0.5 text-[9px] font-bold text-fog">S</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((e, i) => {
              const on = e.id === hi
              const move = e.prev == null ? 0 : e.prev - e.pos
              return (
                <Fragment key={e.id}>
                  {i === out && (
                    <tr aria-hidden>
                      <td colSpan={cols} className="border-t border-dashed border-fog/40 p-0">
                        <span className="sticky left-0 block px-4 py-0.5 text-[11px] text-dim">Can no longer win the title</span>
                      </td>
                    </tr>
                  )}
                  <tr
                    tabIndex={0}
                    aria-selected={on}
                    onClick={() => onPick(e.id)}
                    onKeyDown={(k) => k.key === 'Enter' && onPick(e.id)}
                    onPointerEnter={() => onPeek(e.id)}
                    onPointerLeave={() => onPeek(null)}
                    className={`cursor-pointer outline-none focus-visible:bg-raised ${on ? 'bg-raised' : 'bg-screen hover:bg-raised'}`}
                  >
                    <th scope="row" className="sticky left-0 z-[1] bg-inherit py-1 pr-3 pl-4 text-left font-normal whitespace-nowrap">
                      <span className="flex items-center gap-2">
                        <span className="w-5 text-right font-bold">{e.pos}</span>
                        <span
                          className={`w-6 text-[11px] font-semibold ${move > 0 ? 'text-personal' : 'text-soft'}`}
                          title={move ? `${move > 0 ? 'Up' : 'Down'} ${Math.abs(move)} since the round before` : undefined}
                        >
                          {move ? `${move > 0 ? '▲' : '▼'}${Math.abs(move)}` : ''}
                        </span>
                        <span className="h-4 w-[3px] shrink-0 rounded-full" style={{ background: e.color }} />
                        <span className="font-semibold">{teams ? e.name : e.code}</span>
                        {!teams && <span className="narrow hidden text-fog sm:inline">{e.name}</span>}
                      </span>
                    </th>
                    <td className="max-w-40 truncate px-2 text-fog">{e.team}</td>
                    <td className="px-2 text-right font-bold">{e.pts}</td>
                    <td className="px-2 text-right text-fog">{i ? `−${lead - e.pts}` : ''}</td>
                    <td className={`px-2 text-right ${e.wins ? 'text-fog' : 'text-dim'}`}>{e.wins}</td>
                    <td className={`px-2 text-right ${e.podiums ? 'text-fog' : 'text-dim'}`}>{e.podiums}</td>
                    {rounds.map((r, k) => {
                      if (k >= done) return <td key={r.mk} className="last:pr-4" />
                      const v = e.got[k]
                      const sp = e.sprint[k]
                      const now = live && k === done - 1
                      const total = cells === 'total'
                      const text = total ? (v == null && !e.cum[k] ? '' : e.cum[k]) : (v ?? '')
                      return (
                        <td
                          key={r.mk}
                          title={
                            v == null
                              ? `${r.name}: did not take part`
                              : `${r.name}${now ? ' (as it stands)' : ''}: ${sp != null ? `sprint ${sp} + race ${v - sp} = ` : ''}${v} point${v === 1 ? '' : 's'}${e.won[k] ? ', race win' : ''}. ${e.cum[k]} in total`
                          }
                          className={`border-[1.5px] border-transparent bg-clip-padding px-0.5 text-center last:pr-4 ${now ? 'italic' : ''} ${e.won[k] && !total ? 'font-bold' : ''} ${
                            (total ? v == null : !v) ? 'text-dim' : now ? 'text-fog' : ''
                          }`}
                          style={!total && v ? { background: `color-mix(in srgb, var(--color-chalk) ${Math.round(5 + (22 * v) / most)}%, transparent)` } : undefined}
                        >
                          {text}
                        </td>
                      )
                    })}
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
})
