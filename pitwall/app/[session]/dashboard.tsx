'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, use, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@/lib/openf1'
import type { Frame } from '@/lib/state'
import { GapChart } from './chart'
import { Focus, RaceControl, TeamRadio } from './feed'
import { ForecastPanel } from './forecast'
import { clockTime, duration, statusLook } from './format'
import { TrackMap } from './track'
import { Tower } from './tower'
import { Empty } from './ui'

// t undefined = follow the live edge; delay = follow it that far behind (synced to the TV)
type Mode = { t?: number; speed: number; delay?: number }
const NONE: never[] = [] // stable empty list so memoised panels don't re-render

/** Subscribes to the server's computed race state; reconnects from where it was. */
function useRace(sk: number) {
  const [f, setF] = useState<Partial<Frame>>({})
  const tvKey = `pitwall:tv-delay:${sk}`
  const [mode, setMode] = useState<Mode>(() => {
    const d = typeof window === 'undefined' ? null : localStorage.getItem(tvKey)
    return d ? { speed: 1, delay: Number(d) } : { speed: 1 }
  })
  const [pipe, setPipe] = useState<number | null>(null)
  const tRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (mode.delay === undefined) localStorage.removeItem(tvKey)
    else localStorage.setItem(tvKey, String(mode.delay)) // the broadcast delay holds for the whole session
    const qs =
      mode.delay !== undefined
        ? `&delay=${Math.round(mode.delay)}`
        : mode.t === undefined
          ? ''
          : `&t=${Math.round(mode.t)}&speed=${mode.speed}`
    const es = new EventSource(`/api/stream?session=${sk}${qs}`)
    const samples: number[] = []
    let feedAt = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    es.onmessage = (e) => {
      const patch = JSON.parse(e.data) as Partial<Frame>
      const feed = patch.clock?.feed
      if (feed && feed.at !== feedAt) {
        // Worker receipt → this browser. The first frame replays an old batch, so skip it.
        if (feedAt) {
          samples.push(Date.now() - feed.at)
          if (samples.length > 25) samples.shift()
          setPipe([...samples].sort((a, b) => a - b)[samples.length >> 1])
        }
        feedAt = feed.at
      }
      if (patch.clock) tRef.current = patch.clock.t
      setF((prev) => ({ ...prev, ...patch }))
    }
    es.onerror = () => {
      es.close()
      retry = setTimeout(() => setMode((m) => (m.t === undefined ? { ...m } : { ...m, t: tRef.current })), 1500)
    }
    return () => {
      es.close()
      clearTimeout(retry)
    }
  }, [sk, mode, tvKey])

  return { f, mode, setMode, pipe }
}

type Shared = { f: Partial<Frame>; sel: number | null; select: (n: number) => void; forecast: boolean }
const RaceContext = createContext<Shared>({ f: {}, sel: null, select: () => {}, forecast: false })
/** The race state and selected driver, shared by every page of a session. */
export const useFrame = () => use(RaceContext)

/** Shell around every page of a session (mounted by its layout), so the stream, replay position and
 *  selected driver carry over when switching pages. */
export function Race({ sk, children }: { sk: number; children: React.ReactNode }) {
  const { f, mode, setMode, pipe } = useRace(sk)
  const [picked, setPicked] = useState<number | null>(null)
  const [forecast, setForecast] = useState(false)
  const sel = picked ?? f.tower?.[0]?.n ?? null
  const { meta, clock, play } = f

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input, select, textarea')) return
      if (e.key === 'f' || e.key === 'F') setForecast((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex min-h-dvh flex-col gap-1.5 p-1.5 xl:h-dvh">
      <Header f={f} pipe={pipe} forecast={forecast} onForecast={() => setForecast((v) => !v)} />
      <RaceContext value={{ f, sel, select: setPicked, forecast }}>{children}</RaceContext>
      {meta && clock && play && <Timeline f={f as Frame} mode={mode} setMode={setMode} />}
    </div>
  )
}

export default function Dashboard() {
  const { f, sel, select, forecast } = useFrame()
  const { meta } = f
  const ahead = forecast && !!meta?.race // the forecast swaps in for race control and extends the gap chart

  return (
    <main className="grid flex-1 grid-cols-1 gap-1.5 lg:grid-cols-[minmax(560px,640px)_1fr] xl:min-h-0 xl:grid-cols-[minmax(560px,640px)_1fr_340px] xl:grid-rows-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <section className="max-h-[80dvh] overflow-auto rounded-md bg-screen lg:row-span-2 lg:max-h-none xl:min-h-0" aria-label="Timing">
        {meta?.error && <ErrorNote error={meta.error} />}
        {f.tower?.length ? (
          <Tower rows={f.tower} race={!!meta?.race} sel={sel} onSelect={select} />
        ) : (
          <Empty>
            {meta?.error
              ? 'No timing data yet.'
              : meta?.live
                ? 'Waiting for live data. Start the ingest worker with pnpm worker.'
                : (meta?.status ?? 'Connecting…')}
          </Empty>
        )}
      </section>

      <section className="relative h-[420px] rounded-md bg-screen lg:col-start-2 lg:row-start-1 xl:h-auto xl:min-h-0" aria-label="Track map">
        <TrackMap f={f} sel={sel} onSelect={select} />
      </section>

      <section className="h-[320px] rounded-md bg-screen lg:col-start-2 lg:row-start-2 xl:h-auto xl:min-h-0">
        <GapChart history={f.history} rows={f.tower ?? NONE} sel={sel} forecast={ahead ? f.forecast : null} />
      </section>

      <aside className="grid min-h-0 gap-1.5 md:grid-cols-2 lg:col-span-full xl:col-span-1 xl:col-start-3 xl:row-span-2 xl:row-start-1 xl:flex xl:flex-col">
        <section className="flex h-[360px] flex-col rounded-md bg-screen xl:h-auto xl:min-h-0 xl:flex-1" aria-label={ahead ? 'Forecast' : 'Race control'}>
          {ahead ? (
            <ForecastPanel fc={f.forecast} rows={f.tower ?? NONE} status={f.clock?.status} sel={sel} onSelect={select} />
          ) : (
            <RaceControl rc={f.rc ?? NONE} race={!!meta?.race} />
          )}
        </section>
        <section className="flex h-[360px] flex-col rounded-md bg-screen xl:h-auto xl:min-h-0 xl:flex-1" aria-label="Team radio">
          <TeamRadio radio={f.radio ?? NONE} race={!!meta?.race} />
        </section>
        <section className="rounded-md bg-screen md:col-span-2 xl:col-span-1" aria-label="Selected driver">
          <Focus f={f} sel={sel} forecast={ahead} />
        </section>
      </aside>
    </main>
  )
}

function Header({ f, pipe, forecast, onForecast }: { f: Partial<Frame>; pipe: number | null; forecast: boolean; onForecast: () => void }) {
  const { meta, clock, play } = f
  const timing = /^\/[^/]+$/.test(usePathname()) // the forecast lives on the timing page
  const look = clock ? statusLook[clock.status] : null
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md bg-screen px-4 py-3">
      <div className="min-w-0">
        <h1 className="wide truncate text-xl leading-tight font-extrabold">{meta?.meeting ?? 'Pitwall'}</h1>
        <p className="text-sm text-fog">
          {meta ? `${meta.name}, ${meta.circuit} ${meta.year}` : 'Connecting to the timing feed'}
        </p>
      </div>

      <Pages />

      {clock && meta && (
        <p className="wide tnum text-lg font-bold">
          {meta.race ? (clock.lap ? `Lap ${clock.lap}` : 'Pre-race') : `${duration(clock.remaining ?? 0)} left`}
        </p>
      )}

      {look && (
        <p className="flex items-center gap-2 rounded px-2.5 py-1 text-sm font-semibold" style={{ background: `color-mix(in srgb, ${look.color} 16%, transparent)`, color: look.color }}>
          {clock?.status === 'chequered' ? <Checker /> : <span className="size-2.5 rounded-sm" style={{ background: look.color }} />}
          {look.label}
        </p>
      )}

      {meta?.live && play?.live && clock?.timingAt && clock.t - clock.timingAt > 30_000 && (
        <p
          className="flex items-center gap-2 rounded bg-flag-sc/15 px-2.5 py-1 text-sm font-semibold text-flag-sc"
          title="OpenF1 has sent no laps, gaps or race control messages for a while; car positions are still live. Usually a red flag or a break in the official timing feed."
        >
          <span className="size-2.5 rounded-sm bg-flag-sc" />
          Timing feed paused {duration(clock.t - clock.timingAt)}
        </p>
      )}

      {meta?.status && (
        <p className="flex items-center gap-2 text-sm text-fog">
          <span className="pulse size-1.5 rounded-full bg-fog" />
          {meta.status}
        </p>
      )}

      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        {meta?.race && timing && (
          <button
            onClick={onForecast}
            aria-pressed={forecast}
            title="Predicted passes, pit stops and finishing order, from each car's recent pace (F)"
            className={`flex items-center gap-2 rounded px-3 py-1.5 text-sm font-semibold ${forecast ? 'bg-chalk text-wall hover:bg-white' : 'bg-raised text-chalk hover:bg-rule'}`}
          >
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 12.5 4.5 9l2.5 2 3-4.5" />
              <path d="M10 6.5 14.5 2" strokeDasharray="1.2 2.2" />
            </svg>
            Forecast
          </button>
        )}
        {play?.live && clock && (
          <p className="flex items-center gap-2 text-sm" title="How far behind the track OpenF1 is, and how long Pitwall adds on top (worker → Redis → server → this browser).">
            <span className="pulse size-2 rounded-full bg-live" />
            <span className="font-semibold">Live</span>
            {clock.feed && (
              <span className="tnum whitespace-nowrap text-fog">
                OpenF1 {(clock.feed.src / 1000).toFixed(1)} s · Pitwall {pipe == null ? '…' : `${pipe} ms`}
              </span>
            )}
          </p>
        )}
        {play?.delay !== undefined && (
          <p className="flex items-center gap-2 text-sm" title="Held behind live by your TV's delay. Sync again or go live from the bar below.">
            <span className="size-2 rounded-full bg-chalk" />
            <span className="font-semibold">Synced to TV</span>
            <span className="tnum text-fog">{(play.delay / 1000).toFixed(1)} s behind live</span>
          </p>
        )}
        {meta && <SessionPicker sk={meta.sk} year={meta.year} />}
      </div>
    </header>
  )
}

const PAGES = [
  ['', 'Timing'],
  ['/tyres', 'Tyres'],
  ['/standings', 'Standings'],
] as const

function Pages() {
  const path = usePathname()
  const base = path.match(/^\/[^/]+/)?.[0] ?? ''
  return (
    <nav className="flex rounded bg-raised p-0.5" aria-label="Pages">
      {PAGES.map(([p, label]) => {
        const on = path === base + p
        return (
          <Link
            key={p}
            href={base + p}
            aria-current={on ? 'page' : undefined}
            className={`rounded px-3 py-1 text-sm font-semibold ${on ? 'bg-chalk text-wall' : 'text-fog hover:text-chalk'}`}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

function Checker() {
  return (
    <svg viewBox="0 0 4 4" className="size-3" aria-hidden>
      {[0, 1, 2, 3].flatMap((y) => [0, 1, 2, 3].map((x) => ((x + y) % 2 ? null : <rect key={`${x}${y}`} x={x} y={y} width="1" height="1" fill="currentColor" />)))}
    </svg>
  )
}

function SessionPicker({ sk, year }: { sk: number; year: number }) {
  const router = useRouter()
  const path = usePathname()
  const [y, setY] = useState(year)
  const [list, setList] = useState<{ year: number; sessions: Session[] | null }>()
  useEffect(() => {
    fetch(`/api/sessions?year=${y}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((sessions) => setList({ year: y, sessions }))
  }, [y])
  const sessions = list?.year === y ? list.sessions : undefined // undefined = loading, null = failed
  const meetings = useMemo(() => {
    const m = new Map<string, Session[]>()
    for (const s of sessions ?? []) m.set(s.meeting_name ?? s.location, [...(m.get(s.meeting_name ?? s.location) ?? []), s])
    return [...m]
  }, [sessions])
  const thisYear = new Date().getUTCFullYear()
  const cls = 'rounded bg-raised px-2 py-1.5 text-sm text-chalk outline-none hover:bg-rule focus-visible:outline-2'
  return (
    <div className="flex gap-1.5">
      <label className="sr-only" htmlFor="season">Season</label>
      <select id="season" className={cls} value={y} onChange={(e) => setY(Number(e.target.value))}>
        {Array.from({ length: thisYear - 2022 }, (_, i) => thisYear - i).map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
      <label className="sr-only" htmlFor="session">Session</label>
      <select
        id="session"
        className={`${cls} max-w-64`}
        value={sessions?.some((s) => s.session_key === sk) ? sk : ''}
        onChange={(e) => router.push(path.replace(/^\/[^/]+/, `/${e.target.value}`))} // stay on the same page
        disabled={!sessions?.length}
        title={sessions === null ? 'OpenF1 refused the session list. It is locked for free users while a session is live.' : undefined}
      >
        <option value="" disabled>
          {sessions === undefined ? 'Loading sessions…' : sessions === null ? 'Session list unavailable' : 'Choose a session'}
        </option>
        {meetings.map(([name, list]) => (
          <optgroup key={name} label={name}>
            {list.map((s) => (
              <option key={s.session_key} value={s.session_key} disabled={Date.parse(s.date_start) - 1800_000 > Date.now()}>
                {s.session_name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}

const SPEEDS = [1, 2, 4, 8, 16, 32]

function Timeline({ f, mode, setMode }: { f: Frame; mode: Mode; setMode: (m: Mode) => void }) {
  const { clock, meta, play } = f
  const [drag, setDrag] = useState<number | null>(null)
  const [speed, setSpeed] = useState(mode.speed || 1)
  const lastSeek = useRef(0)
  const playing = play.live || play.rate > 0
  const t = drag ?? clock.t
  const span = Math.max(1, clock.edge - clock.from)
  const pct = Math.min(100, Math.max(0, ((t - clock.from) / span) * 100))
  const atEnd = !meta.live && clock.t >= clock.edge - 1000

  const seek = (to: number, rate = 0) => setMode({ t: Math.min(Math.max(to, clock.from), clock.edge), speed: rate })
  const toggle = () => (playing ? seek(clock.t) : seek(atEnd ? clock.from : clock.t, speed))
  // Pressed the moment the leader crosses the line on TV: hold the dashboard exactly that far behind.
  const sync = () => clock.lineAt && setMode({ speed: 1, delay: Math.max(0, Date.now() - clock.lineAt) })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return
      if (e.key === ' ') {
        e.preventDefault()
        toggle()
      } else if ((e.key === 's' || e.key === 'S') && meta.live) {
        sync()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        seek(clock.t + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 60_000 : 10_000), playing ? speed : 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <footer className="sticky bottom-1.5 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-screen px-4 py-2 shadow-[0_-6px_0_var(--color-wall)] xl:static xl:shadow-none">
      <button
        onClick={toggle}
        className="grid size-9 place-items-center rounded-full bg-chalk text-wall hover:bg-white"
        aria-label={playing ? 'Pause' : atEnd ? 'Replay from the start' : 'Play'}
        title="Space"
      >
        {playing ? (
          <svg viewBox="0 0 12 12" className="size-3.5" aria-hidden><rect x="2" y="1" width="3" height="10" rx="0.5" fill="currentColor" /><rect x="7" y="1" width="3" height="10" rx="0.5" fill="currentColor" /></svg>
        ) : (
          <svg viewBox="0 0 12 12" className="ml-0.5 size-3.5" aria-hidden><path d="M2.5 1.2v9.6a.5.5 0 0 0 .77.42l7.4-4.8a.5.5 0 0 0 0-.84l-7.4-4.8a.5.5 0 0 0-.77.42Z" fill="currentColor" /></svg>
        )}
      </button>

      <div className="flex rounded bg-raised p-0.5" role="radiogroup" aria-label="Replay speed">
        {SPEEDS.map((s) => {
          const on = !play.live && s === (play.rate || speed)
          return (
            <button
              key={s}
              role="radio"
              aria-checked={on}
              onClick={() => {
                setSpeed(s)
                if (!play.live && play.rate) seek(clock.t, s)
              }}
              className={`tnum rounded px-2 py-1 text-xs font-semibold ${on ? 'bg-chalk text-wall' : 'text-fog hover:text-chalk'}`}
            >
              {s}×
            </button>
          )
        })}
      </div>

      <p className="tnum w-20 text-right text-sm text-fog" title="Time since the scheduled session start">
        {duration(t - meta.start)}
      </p>
      <input
        type="range"
        className="scrub min-w-48 flex-1"
        style={{ '--p': `${pct}%` } as React.CSSProperties}
        min={clock.from}
        max={clock.edge}
        step={1000}
        value={t}
        aria-label="Session time"
        aria-valuetext={clockTime(t)}
        onChange={(e) => {
          const v = Number(e.target.value)
          setDrag(v)
          if (Date.now() - lastSeek.current > 150) {
            lastSeek.current = Date.now()
            seek(v)
          }
        }}
        onPointerUp={(e) => {
          seek(Number((e.target as HTMLInputElement).value), playing ? speed : 0)
          setDrag(null)
        }}
        onKeyUp={() => setDrag(null)}
      />
      <p className="tnum text-sm" title="Local time at this moment of the session">
        {clockTime(t)}
      </p>
      {meta.live && meta.race && (
        <button
          onClick={sync}
          disabled={!clock.lineAt}
          title="Press S the moment the leader crosses the line on your TV"
          className="rounded bg-raised px-3 py-1.5 text-sm font-semibold hover:bg-rule disabled:opacity-40"
        >
          {play.delay === undefined ? 'Sync to TV' : 'Sync again'}
        </button>
      )}
      {meta.live && !play.live && (
        <button onClick={() => setMode({ speed: 1 })} className="flex items-center gap-2 rounded bg-live px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110">
          Go live
        </button>
      )}
      {!meta.live && !playing && <p className="text-sm text-fog">{atEnd ? 'Final result' : 'Paused'}</p>}
      {!play.live && play.delay === undefined && play.rate > 0 && <p className="tnum text-sm text-fog">Replay {play.rate}×</p>}
    </footer>
  )
}

function ErrorNote({ error }: { error: string }) {
  const locked = error.includes('401')
  return (
    <div className="m-3 rounded border-l-2 border-flag-red bg-raised p-3 text-sm">
      <p className="mb-1 font-semibold">{locked ? 'OpenF1 is locked while a session is live' : 'OpenF1 request failed'}</p>
      <p className="text-fog">
        {locked
          ? 'The free API reopens 30 minutes after the session ends. Add OPENF1_USERNAME and OPENF1_PASSWORD to .env.local to load it now.'
          : 'Pitwall retries a minute after a failure. Reload to try again.'}
      </p>
      <p className="mt-2 truncate text-xs text-dim" title={error}>{error}</p>
    </div>
  )
}
