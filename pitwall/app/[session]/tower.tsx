'use client'

import { memo, useState } from 'react'
import type { Row } from '@/lib/state'
import { gap, lapTime, timingClass, tyreOf } from './format'

export const Tower = memo(function Tower({ rows, race, sel, onSelect }: { rows: Row[]; race: boolean; sel: number | null; onSelect: (n: number) => void }) {
  // Light a row up when its car changes position (derived while rendering, no effect needed).
  // The class stays after the animation ends; alternating names restart it on the next change.
  const [seen, setSeen] = useState({ rows, flash: {} as Record<number, string> })
  if (seen.rows !== rows) {
    const before = new Map(seen.rows.map((r) => [r.n, r.pos]))
    const flash = { ...seen.flash }
    for (const r of rows) {
      const p = before.get(r.n)
      if (!p || !r.pos || p === r.pos) continue
      const cls = r.pos < p ? 'gained' : 'lost'
      flash[r.n] = flash[r.n] === cls ? `${cls}-again` : cls
    }
    setSeen({ rows, flash })
  }

  const th = 'sticky top-0 z-10 bg-screen px-1.5 pt-3 pb-2 text-left font-medium text-dim'
  return (
    <table className="narrow tnum w-full border-separate border-spacing-0 text-[13px]">
      <thead>
        <tr>
          <th className={`${th} w-9 pl-3 text-right`}>Pos</th>
          <th className={th}>Driver</th>
          <th className={`${th} text-right`}>Gap</th>
          <th className={`${th} text-right`}>Int</th>
          <th className={`${th} text-right`}>Last lap</th>
          <th className={`${th} text-right`}>Best</th>
          <th className={`${th} text-right`}>S1</th>
          <th className={`${th} text-right`}>S2</th>
          <th className={`${th} text-right`}>S3</th>
          <th className={th}>Tyre</th>
          <th className={`${th} pr-3 text-right`}>{race ? 'Pits' : 'Laps'}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const tyre = r.tyre && tyreOf(r.tyre.compound)
          const delta = r.grid && r.pos ? r.grid - r.pos : 0
          const on = r.n === sel
          const td = `border-t border-rule/60 px-1.5 py-[5px] ${on ? 'bg-raised' : ''}`
          return (
            <tr key={r.n} onClick={() => onSelect(r.n)} className={`cursor-pointer hover:[&>td]:bg-raised/70 ${r.out ? 'opacity-40' : ''} ${seen.flash[r.n] ?? ''}`}>
              <td className={`${td} pl-3 text-right font-bold`}>{r.pos ?? '–'}</td>
              <td className={td}>
                <button
                  onClick={() => onSelect(r.n)}
                  aria-pressed={on}
                  title={`${r.name}, ${r.team}`}
                  className="flex items-center gap-2 text-left outline-offset-1"
                >
                  <span className="h-4 w-[3px] rounded-full" style={{ background: r.color }} />
                  <span className="w-9 text-[14px] font-semibold [font-variation-settings:'wdth'_100]">{r.code}</span>
                  {delta !== 0 && (
                    <span className={`text-[11px] ${delta > 0 ? 'text-personal' : 'text-flag-red'}`} aria-label={`${Math.abs(delta)} place${Math.abs(delta) === 1 ? '' : 's'} ${delta > 0 ? 'gained' : 'lost'} since the start`}>
                      {delta > 0 ? '▲' : '▼'}
                      {Math.abs(delta)}
                    </span>
                  )}
                  {r.inPit && <span className="rounded-sm bg-chalk px-1 text-[10px] leading-4 font-bold text-wall">Pit</span>}
                  {r.penalty && (
                    <span className="rounded-sm bg-flag-red/20 px-1 text-[10px] leading-4 font-bold text-flag-red" title="Penalty from the stewards, not yet served">
                      {r.penalty}
                    </span>
                  )}
                  {r.investigated && (
                    <span className="rounded-sm bg-flag-yellow/15 px-1 text-[10px] leading-4 font-semibold text-flag-yellow" title="Under investigation by the stewards">
                      Inv
                    </span>
                  )}
                </button>
              </td>
              <td className={`${td} text-right ${i && !r.out ? '' : 'text-fog'}`}>{r.out ? 'Out' : i ? gap(r.gap) : race ? 'Leader' : ''}</td>
              <td className={`${td} text-right text-fog`}>{i && !r.out ? gap(r.int) : ''}</td>
              <td className={`${td} text-right ${r.last ? timingClass[r.last.c] : ''}`}>{lapTime(r.last?.v)}</td>
              <td className={`${td} text-right ${r.best?.c === 'p' ? 'text-overall' : 'text-fog'}`}>{lapTime(r.best?.v)}</td>
              {r.sectors.map((s, j) => (
                <td key={j} className={`${td} text-right ${s ? timingClass[s.c] : ''}`}>
                  {s ? s.v.toFixed(3) : <span className="text-dim">·</span>}
                </td>
              ))}
              <td className={td}>
                {tyre && r.tyre && (
                  <span className="flex items-center gap-1.5" title={`${tyre.name}, ${r.tyre.age} laps old${r.tyre.fresh ? ', new set' : ''}. Stints: ${r.stints.map((c) => tyreOf(c).name).join(' → ')}`}>
                    <span className="flex gap-0.5" aria-hidden>
                      {r.stints.slice(0, -1).map((c, j) => (
                        <span key={j} className="size-1.5 rounded-full" style={{ background: tyreOf(c).color }} />
                      ))}
                    </span>
                    <span className="grid size-[18px] place-items-center rounded-full border-2 text-[10px] font-bold [font-variation-settings:'wdth'_100]" style={{ borderColor: tyre.color, color: tyre.color }}>
                      {tyre.letter}
                    </span>
                    <span className="w-4 text-fog">{r.tyre.age}</span>
                  </span>
                )}
              </td>
              <td className={`${td} pr-3 text-right text-fog`}>{race ? r.pits || '' : r.lap || ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
})
