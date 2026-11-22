'use client'

import { Fragment, memo, useRef, useState } from 'react'
import type { Frame } from '@/lib/state'
import { clockTime, flagColor, gap, lapTime, timingClass, tyreOf } from './format'
import { Empty } from './ui'

export const RaceControl = memo(function RaceControl({ rc, race }: { rc: Frame['rc']; race: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="px-4 pt-3 pb-2 text-sm font-semibold">Race control</h2>
      {!rc.length ? (
        <Empty>Messages from the stewards appear here.</Empty>
      ) : (
        <ol className="narrow min-h-0 flex-1 overflow-y-auto pb-2" aria-live="polite">
          {rc.map((m) => (
            <li key={`${m.t}${m.message}`} className="grid grid-cols-[3px_1fr] gap-x-3 border-t border-rule/60 px-4 py-2">
              <span className="rounded-full" style={{ background: flagColor(m.flag) ?? (m.category === 'SafetyCar' ? 'var(--color-flag-sc)' : 'var(--color-rule)') }} />
              <div>
                <p className="tnum mb-0.5 text-[11px] text-dim">
                  {clockTime(m.t)}
                  {race && m.lap_number ? `, lap ${m.lap_number}` : ''}
                </p>
                <p className="text-[13px] leading-snug">{m.message}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
})

/** Driver ↔ engineer radio, transcribed. One clip plays at a time; the ring shows how far through it is. */
export const TeamRadio = memo(function TeamRadio({ radio, race }: { radio: Frame['radio']; race: boolean }) {
  const audio = useRef<HTMLAudioElement>(null)
  const src = useRef('')
  const [on, setOn] = useState<string | null>(null)
  const [p, setP] = useState(0)
  const toggle = (url: string) => {
    const a = audio.current!
    if (src.current === url && !a.paused) return a.pause()
    if (src.current !== url) {
      a.src = src.current = url
      setP(0)
    }
    a.play().catch(() => setOn(null))
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="px-4 pt-3 pb-2 text-sm font-semibold">Team radio</h2>
      <audio
        ref={audio}
        preload="none"
        onPlay={() => setOn(src.current)}
        onPause={(e) => e.currentTarget.paused && setOn(null)} // switching clips pauses the old one after the new one starts
        onEnded={() => setOn(null)}
        onTimeUpdate={(e) => setP(e.currentTarget.currentTime / (e.currentTarget.duration || 1))}
      />
      {!radio.length ? (
        <Empty>Drivers and their engineers, as they talk.</Empty>
      ) : (
        <ol className="narrow min-h-0 flex-1 overflow-y-auto pb-2" aria-live="polite">
          {radio.map((r) => {
            const playing = on === r.url
            return (
              <li key={r.url} className={`grid grid-cols-[3px_1fr_auto] gap-x-3 border-t border-rule/60 px-4 py-2 ${playing ? 'bg-raised/50' : ''}`}>
                <span className="rounded-full" style={{ background: r.color }} />
                <div className="min-w-0">
                  <p className="tnum mb-0.5 text-[11px] text-dim">
                    <span className="wide mr-1.5 text-xs font-bold text-chalk">{r.code}</span>
                    {clockTime(r.t)}
                    {race && r.lap ? `, lap ${r.lap}` : ''}
                  </p>
                  {r.pending && (
                    <p className="flex items-center gap-1.5 text-xs text-dim">
                      <span className="pulse size-1.5 rounded-full bg-dim" />
                      Transcribing
                    </p>
                  )}
                  {r.turns && !r.turns.length && <p className="text-[13px] text-dim">No speech</p>}
                  {!!r.turns?.length && (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[13px] leading-snug">
                      {r.turns.map((t, i) => (
                        <Fragment key={i}>
                          <dt className={`wide pt-px text-[10px] font-bold ${t.speaker === 'driver' ? 'text-chalk' : 'text-dim'}`}>
                            {t.speaker === 'driver' ? r.code : t.speaker === 'engineer' ? 'ENG' : ''}
                          </dt>
                          <dd>{said(t.text)}</dd>
                        </Fragment>
                      ))}
                    </dl>
                  )}
                </div>
                <button
                  onClick={() => toggle(r.url)}
                  aria-label={`${playing ? 'Pause' : 'Play'} ${r.name}'s radio from ${clockTime(r.t)}`}
                  className={`relative mt-0.5 grid size-8 place-items-center rounded-full ${playing ? 'bg-chalk text-wall' : 'bg-raised text-chalk hover:bg-rule'}`}
                >
                  {playing ? (
                    <>
                      <svg viewBox="0 0 40 40" className="absolute -inset-1 size-10 -rotate-90 text-chalk" aria-hidden>
                        <circle cx="20" cy="20" r="19" fill="none" stroke="var(--color-rule)" strokeWidth="2" />
                        <circle cx="20" cy="20" r="19" fill="none" stroke="currentColor" strokeWidth="2" pathLength={1} strokeDasharray={`${p} 1`} />
                      </svg>
                      <svg viewBox="0 0 12 12" className="size-3" aria-hidden><rect x="2" y="1" width="3" height="10" rx="0.5" fill="currentColor" /><rect x="7" y="1" width="3" height="10" rx="0.5" fill="currentColor" /></svg>
                    </>
                  ) : (
                    <svg viewBox="0 0 12 12" className="ml-0.5 size-3" aria-hidden><path d="M2.5 1.2v9.6a.5.5 0 0 0 .77.42l7.4-4.8a.5.5 0 0 0 0-.84l-7.4-4.8a.5.5 0 0 0-.77.42Z" fill="currentColor" /></svg>
                  )}
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
})

/** "[inaudible]" and "[bleep]" from the transcriber, muted so they don't read as words. */
const said = (text: string) =>
  text.split(/(\[(?:inaudible|bleep)\])/).map((part, i) => (i % 2 ? <span key={i} className="text-dim italic">{part.slice(1, -1)}</span> : part))

/** The selected car: who, where, and what it is doing right now (and, with the forecast on, next). */
export function Focus({ f, sel, forecast }: { f: Partial<Frame>; sel: number | null; forecast?: boolean }) {
  const r = f.tower?.find((x) => x.n === sel)
  if (!r) return <Empty>Select a driver to follow their car.</Empty>
  const [speed, rpm, gear, throttle, brake, drs] = f.cars?.[r.n]?.tel ?? []
  const has = speed != null
  const tyre = r.tyre && tyreOf(r.tyre.compound)
  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-3">
        {r.photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote F1 headshots, no optimisation needed
          <img src={r.photo} alt="" className="size-12 rounded-full object-cover object-top" style={{ background: r.color }} />
        ) : (
          <span className="size-12 rounded-full" style={{ background: r.color }} />
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold">
            <span className="wide mr-2">{r.code}</span>
            <span className="text-fog">{r.name}</span>
          </p>
          <p className="truncate text-sm text-fog">
            <span className="mr-1.5 inline-block h-2.5 w-[3px] rounded-full align-middle" style={{ background: r.color }} />
            {r.team}
          </p>
        </div>
        <p className="wide ml-auto text-2xl font-extrabold">{r.pos ? `P${r.pos}` : ''}</p>
      </div>

      {has ? (
        <>
          <div className="mb-3 flex items-end gap-5">
            <p>
              <span className="wide text-4xl leading-none font-extrabold">{speed}</span>
              <span className="ml-1 text-sm text-fog">km/h</span>
            </p>
            <dl className="flex gap-5">
              <Stat label="Gear" value={gear === 0 ? 'N' : String(gear ?? '–')} />
              <Stat label="DRS" value={(drs ?? 0) >= 10 ? 'Open' : (drs ?? 0) === 8 ? 'Armed' : 'Off'} tone={(drs ?? 0) >= 10 ? 'text-personal' : undefined} />
            </dl>
          </div>
          <Bar label="Throttle" value={throttle ?? 0} color="var(--color-personal)" />
          <Bar label="Brake" value={brake ?? 0} color="var(--color-flag-red)" />
          <Bar label="RPM" value={((rpm ?? 0) / 13000) * 100} color="var(--color-fog)" text={(rpm ?? 0).toLocaleString()} />
        </>
      ) : (
        <p className="py-2 text-sm text-fog">{f.meta?.status ? 'Telemetry appears once car data has loaded.' : 'No car data at this moment.'}</p>
      )}

      <dl className="tnum mt-4 grid grid-cols-4 gap-2 border-t border-rule/60 pt-3 text-sm">
        <Stat label="Last lap" value={lapTime(r.last?.v) || '–'} tone={r.last ? timingClass[r.last.c] : undefined} />
        <Stat label="Best" value={lapTime(r.best?.v) || '–'} tone={r.best?.c === 'p' ? 'text-overall' : undefined} />
        <Stat label={f.meta?.race ? 'Interval' : 'Gap'} value={(r.pos !== 1 && (f.meta?.race ? gap(r.int) : gap(r.gap))) || '–'} />
        <Stat label="Tyre" value={tyre && r.tyre ? `${tyre.name}, ${r.tyre.age}` : '–'} />
      </dl>

      {forecast && <Outlook f={f} n={r.n} />}
    </div>
  )
}

function Outlook({ f, n }: { f: Partial<Frame>; n: number }) {
  const c = f.forecast?.cars[n]
  if (!c) return null
  const code = (m: number | null) => f.tower?.find((x) => x.n === m)?.code
  const pos = f.tower?.find((x) => x.n === n)?.pos
  const d = pos ? pos - c.finish : 0
  const j = c.rejoin
  return (
    <div className="mt-3 border-t border-rule/60 pt-3">
      <dl className="tnum grid grid-cols-4 gap-2 text-sm">
        <Stat label={c.laps ? `Pace, ${c.laps} laps` : 'Pace, est.'} value={lapTime(c.pace) || '–'} />
        <div title="Lap time change per lap: + is slowing as the tyres wear, − is getting quicker">
          <dt className="text-xs text-dim">Trend</dt>
          <dd className={`font-semibold ${c.trend > 0.05 ? 'text-flag-red' : ''}`}>{`${c.trend >= 0 ? '+' : '−'}${Math.abs(c.trend).toFixed(2)} s`}</dd>
        </div>
        <Stat label="Next stop" value={c.stop ? (c.stop === f.forecast?.lap ? 'This lap' : `Lap ${c.stop}`) : c.owes ? 'Owed' : 'None'} />
        <Stat label="Finish" value={`P${c.finish}${d ? ` ${d > 0 ? '▲' : '▼'}${Math.abs(d)}` : ''}`} tone={d > 0 ? 'text-personal' : d < 0 ? 'text-flag-red' : undefined} />
      </dl>
      {j && (
        <p className="mt-2 text-xs text-fog">
          <span className="font-semibold text-chalk">Box now:</span> rejoins P{j.pos}
          {j.ahead != null && `, ${j.gapAhead?.toFixed(1)} s behind ${code(j.ahead)}`}
          {j.behind != null && `, ${j.gapBehind?.toFixed(1)} s ahead of ${code(j.behind)}`}
          {c.owes && !c.stop && '. Still owes a stop.'}
        </p>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-xs text-dim">{label}</dt>
      <dd className={`font-semibold ${tone ?? ''}`}>{value}</dd>
    </div>
  )
}

function Bar({ label, value, color, text }: { label: string; value: number; color: string; text?: string }) {
  const v = Math.min(100, Math.max(0, value))
  return (
    <div className="tnum mb-1.5 grid grid-cols-[64px_1fr_52px] items-center gap-2 text-xs">
      <span className="text-dim">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-raised" role="meter" aria-label={label} aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
        <span className="meter block h-full rounded-full" style={{ width: `${v}%`, background: color }} />
      </span>
      <span className="text-right text-fog">{text ?? `${Math.round(v)}%`}</span>
    </div>
  )
}
