'use client'

import { memo, useState } from 'react'
import type { Forecast, ForecastEvent } from '@/lib/forecast'
import type { Row, Status } from '@/lib/state'
import { Empty } from './ui'

const when = (lap: number, now: number) => (lap === now ? 'This lap' : lap === now + 1 ? 'Next lap' : `In ${lap - now} laps`)
const edge = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} s/lap`

/** Predicted passes and stops lap by lap, and the order they lead to at the flag. */
export const ForecastPanel = memo(function ForecastPanel({
  fc,
  rows,
  status,
  sel,
  onSelect,
}: {
  fc: Forecast | null | undefined
  rows: Row[]
  status?: Status
  sel: number | null
  onSelect: (n: number) => void
}) {
  const [tab, setTab] = useState<'events' | 'finish'>('events')
  const byN = new Map(rows.map((r) => [r.n, r]))

  if (!fc)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <h2 className="px-4 pt-3 pb-2 text-sm font-semibold">Forecast</h2>
        <Empty>
          {status === 'red'
            ? 'Red flag. The forecast picks up again at the restart.'
            : status === 'chequered'
              ? 'The race is over.'
              : 'The forecast starts on lap 4, once every car has a few green-flag laps.'}
        </Empty>
      </div>
    )

  const laps = Map.groupBy(fc.events, (e) => e.lap)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-4 pt-3">
        <h2 className="text-sm font-semibold">Forecast</h2>
        <p className="tnum text-xs text-dim">to lap {fc.total}</p>
        <div className="ml-auto flex rounded bg-raised p-0.5" role="tablist" aria-label="Forecast view">
          {(
            [
              ['events', 'Passes & stops'],
              ['finish', 'Finish'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`rounded px-2 py-0.5 text-xs font-semibold ${tab === k ? 'bg-chalk text-wall' : 'text-fog hover:text-chalk'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p
        className="tnum px-4 pt-1.5 pb-2 text-xs text-dim"
        title={`Each car runs at the pace of its last five green-flag laps, drifting with the field as tyres wear and fuel burns off. A stop costs ${fc.pitLoss} s here, measured from today's stops, and new tyres are worth ${fc.wear.toFixed(3)} s a lap for every lap the old set had done. A car needs ${fc.pass} s a lap more than the car ahead to pass it; otherwise it sits behind. Cars still owing their second compound pit halfway through their remaining tyre life; an extra stop is only made when it gains places.`}
      >
        {fc.neutral ? (
          <span className="font-semibold text-flag-sc">
            {status === 'vsc' || status === 'vsc-ending' ? 'VSC' : 'Safety car'}: a stop costs {(fc.pitLoss * 0.55).toFixed(1)} s, no passing until the restart
          </span>
        ) : (
          <>
            A stop costs {fc.pitLoss} s · passing takes {fc.pass} s/lap
          </>
        )}
      </p>

      {tab === 'events' ? (
        !fc.events.length ? (
          <Empty>No passes or stops predicted from here to the flag.</Empty>
        ) : (
          <ol className="narrow min-h-0 flex-1 overflow-y-auto pb-2" aria-label="Predicted passes and stops">
            {[...laps].map(([lap, events]) => (
              <li key={lap} className="border-t border-rule/60">
                <p className="tnum flex items-baseline gap-2 px-4 pt-2 pb-1 text-[11px] text-dim">
                  <span className="font-semibold text-fog">Lap {lap}</span>
                  {when(lap, fc.lap)}
                </p>
                <ul className="pb-1.5">
                  {events.map((e, i) => (
                    <EventRow key={i} e={e} byN={byN} sel={sel} onSelect={onSelect} pass={fc.pass} />
                  ))}
                </ul>
              </li>
            ))}
            <li className="border-t border-rule/60 px-4 pt-2 text-[11px] text-dim">A projection from today&apos;s pace, not a promise: incidents and team calls change it.</li>
          </ol>
        )
      ) : (
        <Finish fc={fc} byN={byN} sel={sel} onSelect={onSelect} />
      )}
    </div>
  )
})

function Driver({ r, n }: { r?: Row; n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-3 w-[3px] rounded-full" style={{ background: r?.color ?? 'var(--color-dim)' }} />
      <span className="font-semibold text-chalk [font-variation-settings:'wdth'_100]">{r?.code ?? n}</span>
    </span>
  )
}

function EventRow({ e, byN, sel, onSelect, pass }: { e: ForecastEvent; byN: Map<number, Row>; sel: number | null; onSelect: (n: number) => void; pass: number }) {
  const on = e.n === sel || ('other' in e && e.other === sel)
  const me = <Driver r={byN.get(e.n)} n={e.n} />
  let text: React.ReactNode
  let right: React.ReactNode
  let title: string
  if (e.kind === 'pass') {
    text = (
      <>
        {me} passes <Driver r={byN.get(e.other)} n={e.other} /> <span className="text-fog">for P{e.pos}</span>
      </>
    )
    right = <span className="text-personal">{edge(e.edge)}</span>
    title = `${byN.get(e.n)?.code} is ${e.edge.toFixed(1)} s a lap quicker by then`
  } else if (e.kind === 'stuck') {
    text = (
      <>
        {me} catches <Driver r={byN.get(e.other)} n={e.other} /> <span className="text-fog">but can&apos;t pass</span>
      </>
    )
    right = <span className="text-fog">{edge(e.edge)}</span>
    title = `${e.edge.toFixed(1)} s a lap quicker, short of the ${pass} s it takes to pass here: it sits in the car's wake`
  } else if (e.kind === 'penalty') {
    text = (
      <>
        <span className="rounded-sm bg-flag-red/20 px-1 text-[10px] leading-4 font-bold text-flag-red">{e.what}</span> {me}{' '}
        <span className="text-fog">{e.what.startsWith('+') ? 'takes its penalty' : 'serves its penalty'}, P{e.pos}</span>
      </>
    )
    right = e.lost ? <span className="text-flag-red">−{e.lost}</span> : <span className="text-fog">±0</span>
    title = e.lost ? `The penalty costs ${e.lost} place${e.lost === 1 ? '' : 's'}` : 'The penalty costs no places'
  } else {
    text = (
      <>
        <span className="rounded-sm bg-chalk px-1 text-[10px] leading-4 font-bold text-wall">Pit</span> {me} <span className="text-fog">rejoins P{e.pos}</span>
      </>
    )
    right = e.lost ? <span className="text-flag-red">−{e.lost}</span> : <span className="text-fog">±0</span>
    title = e.lost ? `Drops ${e.lost} place${e.lost === 1 ? '' : 's'} in the stop` : 'Keeps its place through the stop'
  }
  return (
    <li>
      <button
        onClick={() => onSelect(e.n)}
        title={title}
        className={`tnum flex w-full items-center gap-2 px-4 py-1 text-left text-[13px] hover:bg-raised/70 ${on ? 'bg-raised' : ''}`}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5">{text}</span>
        <span className="shrink-0 text-xs">{right}</span>
      </button>
    </li>
  )
}

function Finish({ fc, byN, sel, onSelect }: { fc: Forecast; byN: Map<number, Row>; sel: number | null; onSelect: (n: number) => void }) {
  const lapTime = Object.values(fc.cars).find((c) => c.finish === 1)?.pace ?? 90
  const order = Object.entries(fc.cars)
    .map(([n, c]) => ({ n: Number(n), c, gap: fc.trace[Number(n)]?.at(-1) ?? null }))
    .sort((a, b) => a.c.finish - b.c.finish)
  const th = 'sticky top-0 bg-screen px-1.5 pb-1.5 text-left font-medium text-dim'
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-2">
      <table className="narrow tnum w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            <th className={`${th} w-10 pl-4 text-right`}>Pos</th>
            <th className={th}>Driver</th>
            <th className={`${th} text-right`}>Gap</th>
            <th className={`${th} pr-4 text-right`}>Stop</th>
          </tr>
        </thead>
        <tbody>
          {order.map(({ n, c, gap }) => {
            const r = byN.get(n)
            const d = r?.pos ? r.pos - c.finish : 0
            const td = `border-t border-rule/60 px-1.5 py-[5px] ${n === sel ? 'bg-raised' : ''}`
            return (
              <tr key={n} onClick={() => onSelect(n)} className="cursor-pointer hover:[&>td]:bg-raised/70">
                <td className={`${td} pl-4 text-right font-bold`}>{c.finish}</td>
                <td className={td}>
                  <span className="flex items-center gap-2">
                    <Driver r={r} n={n} />
                    {d !== 0 && (
                      <span className={`text-[11px] ${d > 0 ? 'text-personal' : 'text-flag-red'}`} aria-label={`${Math.abs(d)} place${Math.abs(d) === 1 ? '' : 's'} ${d > 0 ? 'gained' : 'lost'} from now`}>
                        {d > 0 ? '▲' : '▼'}
                        {Math.abs(d)}
                      </span>
                    )}
                  </span>
                </td>
                <td className={`${td} text-right text-fog`}>
                  {c.finish === 1 ? 'Leader' : gap == null ? '' : gap < lapTime ? `+${gap.toFixed(1)}` : `+${Math.floor(gap / lapTime)} lap${gap < 2 * lapTime ? '' : 's'}`}
                </td>
                <td className={`${td} pr-4 text-right ${c.owes ? 'text-chalk' : 'text-fog'}`} title={c.owes ? 'Still has to run a second dry compound' : undefined}>
                  {c.stop ? (c.stop === fc.lap ? 'This lap' : `Lap ${c.stop}`) : '–'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
