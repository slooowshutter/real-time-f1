import { forecast, type Forecast } from './forecast'
import { utc } from './openf1'
import type { Turn } from './radio'
import type { Lap, RaceControl, Store, Weather } from './store'

// The whole dashboard is a pure function of (session log, instant t).
// Live is t = now; replay and scrubbing are any other t. Nothing after t leaks in:
// lap and sector times only appear once the car has actually crossed that line.

export type Color = 'p' | 'g' | 'y' // overall best · personal best · neither
export type Timing = { v: number; c: Color }
export type Status = 'none' | 'green' | 'yellow' | 'sc' | 'vsc' | 'sc-ending' | 'vsc-ending' | 'red' | 'chequered'
export type Row = {
  n: number
  code: string
  name: string
  team: string
  color: string
  photo: string | null
  pos: number | null
  grid: number | null
  gap: number | string | null
  int: number | string | null
  lap: number
  last: Timing | null
  best: Timing | null
  sectors: (Timing | null)[]
  tyre: { compound: string; age: number; fresh: boolean } | null
  stints: string[]
  pits: number
  inPit: boolean
  /** Retired: OpenF1 sends no retirement message, and a parked car's transponder keeps reporting. */
  out: boolean
  /** Unserved penalty from the stewards ('+5s', 'Drive-through', 'Stop-go'), and open investigations. */
  penalty: string | null
  investigated: boolean
}
/** xy: track position; tel: [speed, rpm, gear, throttle, brake, drs] */
export type Car = { xy?: [number, number]; tel?: (number | null)[] }
export type State = {
  meta: {
    sk: number
    name: string
    type: string
    meeting: string
    circuit: string
    country: string
    year: number
    start: number
    end: number
    race: boolean
    live: boolean
    status?: string
    error?: string
  }
  clock: {
    t: number
    from: number
    edge: number
    lap: number
    status: Status
    remaining: number | null
    feed: { at: number; src: number } | null
    /** Newest time the leader crossed the line in the data received so far (anchor for TV sync). */
    lineAt: number | null
    /** Newest lap, gap, position or race control event. OpenF1 sometimes pauses these while positions keep flowing. */
    timingAt: number | null
  }
  tower: Row[]
  cars: Record<number, Car>
  rc: Omit<RaceControl, 'scope' | 'sector'>[]
  /** Newest first. lap: the driver's own lap; turns: undefined until transcribed, [] when there are no words;
   *  pending: live and sent in the last 30 s, so its words are most likely on the way (10 to 15 s). */
  radio: { t: number; n: number; code: string; name: string; color: string; lap: number | null; url: string; turns?: Turn[]; pending?: true }[]
  weather: Weather | null
  history: { kind: 'gap' | 'lap'; series: Record<number, (number | null)[]> }
  track: [number, number][] | null
  /** Each car's stints up to t (age: laps on the set when fitted, pit: lane time of the stop that ended it),
   *  and the laps run neutralised, when cheap stops happen. */
  tyres: {
    stints: Record<number, { c: string; from: number; to: number; age: number | null; pit: number | null }[]>
    neutral: { kind: 'sc' | 'vsc' | 'red'; from: number; to: number }[]
  }
  /** Races only: projected passes, stops and finishing order from here to the flag. */
  forecast: Forecast | null
}

/** What the stream sends: State plus the playback the server is running. */
export type Frame = State & { play: { live: boolean; rate: number; delay?: number } }

const RETIRED = 180_000
const STALE = 10_000 // a car with no position for 10 s is off track / in the garage
const r3 = (v: number) => Math.round(v * 1000) / 1000
const NEUTRAL: Partial<Record<Status, 'sc' | 'vsc' | 'red'>> = { sc: 'sc', 'sc-ending': 'sc', vsc: 'vsc', 'vsc-ending': 'vsc', red: 'red' }

/** carsAt: when to place the cars (live draws them slightly behind the newest sample so they can be interpolated). */
export function stateAt(s: Store, t: number, carsAt = t): State {
  const info = s.info!
  const race = info.session_type === 'Race' // includes Sprint
  const start = utc(info.date_start)
  const end = utc(info.date_end)

  // ── Laps: when each lap and sector became known ──
  const lapsBy = new Map<number, Lap[]>()
  for (const l of s.laps.values()) {
    const arr = lapsBy.get(l.driver_number) ?? []
    arr.push(l)
    lapsBy.set(l.driver_number, arr)
  }
  const endOf = new Map<Lap, number | null>()
  for (const arr of lapsBy.values()) {
    arr.sort((a, b) => a.lap_number - b.lap_number)
    arr.forEach((l, i) => {
      const next = arr[i + 1]
      endOf.set(
        l,
        next?.lap_number === l.lap_number + 1 && next.start != null
          ? next.start // crossing the line ends one lap and starts the next
          : l.start != null && l.lap_duration != null
            ? l.start + l.lap_duration * 1000
            : null,
      )
    })
  }
  const ended = (l: Lap) => (endOf.get(l) ?? Infinity) <= t
  const started = (l: Lap) => (l.start != null ? l.start <= t : ended(l))
  const sectorsOf = (l: Lap) => [l.duration_sector_1, l.duration_sector_2, l.duration_sector_3]
  const sectorKnown = (l: Lap, i: number) => {
    const secs = sectorsOf(l)
    if (secs[i] == null) return false
    if (ended(l)) return true
    if (l.start == null) return false
    let cum = 0
    for (let j = 0; j <= i; j++) cum += secs[j] ?? NaN
    return l.start + cum * 1000 <= t
  }
  const timed = (l: Lap) => ended(l) && l.lap_duration != null

  let bestLap = Infinity
  const bestSec = [Infinity, Infinity, Infinity]
  const pbLap = new Map<number, number>()
  const pbSec = new Map<number, number[]>()
  for (const l of s.laps.values()) {
    const d = l.driver_number
    const pb = pbSec.get(d) ?? [Infinity, Infinity, Infinity]
    pbSec.set(d, pb)
    sectorsOf(l).forEach((v, i) => {
      if (v == null || !sectorKnown(l, i)) return
      pb[i] = Math.min(pb[i], v)
      bestSec[i] = Math.min(bestSec[i], v)
    })
    if (timed(l)) {
      pbLap.set(d, Math.min(pbLap.get(d) ?? Infinity, l.lap_duration!))
      bestLap = Math.min(bestLap, l.lap_duration!)
    }
  }
  const color = (v: number, pb: number, best: number): Color => (v <= best ? 'p' : v <= pb ? 'g' : 'y')

  // ── Latest value per driver at t ──
  const latest = <E extends { t: number; driver_number: number }>(evs: E[]) => {
    const m = new Map<number, E>()
    for (const e of evs) {
      const cur = m.get(e.driver_number)
      if (e.t <= t && (!cur || e.t >= cur.t)) m.set(e.driver_number, e)
    }
    return m
  }
  const pos = latest(s.position)
  const ints = latest(s.intervals)
  const grid = new Map<number, number>()
  if (race) {
    const first = new Map<number, { t: number; p: number }>()
    for (const e of s.position) {
      const cur = first.get(e.driver_number)
      if (!cur || e.t < cur.t) first.set(e.driver_number, { t: e.t, p: e.position })
    }
    for (const [d, v] of first) grid.set(d, v.p)
  }

  // ── Tower ──
  const racePits = s.pit.filter((p) => p.t <= t && p.t >= start) // before the start, cars leave the pit lane for the grid
  const numbers = new Set([...s.drivers.keys(), ...lapsBy.keys(), ...pos.keys(), ...s.loc.keys()])
  // Race only: a car that hasn't started a lap for 3 minutes while the field has is out of the race.
  const lastStart = (n: number) => Math.max(0, ...(lapsBy.get(n) ?? []).filter(started).map((l) => l.start ?? 0))
  const fieldStart = Math.max(0, ...[...numbers].map(lastStart))
  const isOut = (n: number) => race && fieldStart > 0 && fieldStart - lastStart(n) > RETIRED
  const stintsOf: State['tyres']['stints'] = {}
  const tower: Row[] = [...numbers].map((n) => {
    const drv = s.drivers.get(n)
    const laps = lapsBy.get(n) ?? []
    const cur = laps.filter(started).at(-1)
    const lap = cur?.lap_number ?? 0
    const done = laps.filter(timed)
    const lastLap = done.at(-1)
    const pb = pbLap.get(n) ?? Infinity
    const pbs = pbSec.get(n) ?? [Infinity, Infinity, Infinity]
    // Sectors of the lap in progress; until its first sector is in, the previous lap's.
    const sl = cur && sectorKnown(cur, 0) ? cur : laps.filter(ended).at(-1)
    const stints = [...s.stints.values()]
      .filter((x) => x.driver_number === n && (x.lap_start ?? 1) <= Math.max(lap, 1))
      .sort((a, b) => a.stint_number - b.stint_number)
    const st = stints.at(-1)
    const pits = racePits.filter((p) => p.driver_number === n)
    const lane = (lap: number) => {
      const p = pits.find((p) => p.lap_number === lap)
      return p ? (p.lane_duration ?? p.pit_duration ?? null) : null
    }
    // A stint ends where the next begins; the current one runs to the lap in progress.
    const ts = (stintsOf[n] = stints.map((x, i) => {
      const from = x.lap_start ?? 1
      const to = Math.max(from, i < stints.length - 1 ? (stints[i + 1].lap_start ?? from) - 1 : lap)
      return { c: x.compound ?? 'UNKNOWN', from, to, age: x.tyre_age_at_start, pit: i < stints.length - 1 ? lane(to) : null }
    }))
    // Stint data lags a stop by a lap or two: end the stint at the stop, on an unknown set until it arrives.
    const stop = pits.at(-1)?.lap_number
    const now = ts.at(-1)
    if (now && stop && stop >= Math.max(now.from, lap - 3) && stop < lap) {
      ;[now.to, now.pit] = [stop, lane(stop)]
      ts.push({ c: 'UNKNOWN', from: stop + 1, to: lap, age: null, pit: null })
    }
    const iv = ints.get(n)
    return {
      n,
      code: drv?.name_acronym ?? String(n),
      name: drv?.broadcast_name ?? drv?.full_name ?? `#${n}`,
      team: drv?.team_name ?? '',
      color: `#${drv?.team_colour ?? '888888'}`,
      photo: drv?.headshot_url ?? null,
      pos: pos.get(n)?.position ?? null,
      grid: grid.get(n) ?? null,
      gap: iv?.gap_to_leader ?? null,
      int: iv?.interval ?? null,
      lap,
      last: lastLap ? { v: lastLap.lap_duration!, c: color(lastLap.lap_duration!, pb, bestLap) } : null,
      best: pb < Infinity ? { v: pb, c: pb <= bestLap ? 'p' : 'g' } : null,
      sectors: [0, 1, 2].map((i) => {
        const v = sl && sectorKnown(sl, i) ? sectorsOf(sl)[i]! : null
        return v == null ? null : { v, c: color(v, pbs[i], bestSec[i]) }
      }),
      tyre: st
        ? {
            compound: st.compound ?? 'UNKNOWN',
            age: (st.tyre_age_at_start ?? 0) + Math.max(0, lap - (st.lap_start ?? 1)),
            fresh: st.tyre_age_at_start === 0,
          }
        : null,
      stints: stints.map((x) => x.compound ?? 'UNKNOWN'),
      pits: pits.length,
      inPit: pits.some((p) => t < p.t + 1000 * (p.lane_duration ?? p.pit_duration ?? 25)),
      out: isOut(n),
      penalty: null,
      investigated: false,
    }
  })
  tower.sort(
    (a, b) =>
      Number(a.out) - Number(b.out) ||
      (a.pos ?? 99) - (b.pos ?? 99) || (a.best?.v ?? Infinity) - (b.best?.v ?? Infinity) || a.n - b.n,
  )
  if (!race) {
    // Practice / qualifying: gaps are on best lap.
    tower.forEach((row, i) => {
      const lead = tower[0].best?.v
      const ahead = tower[i - 1]?.best?.v
      row.gap = i && row.best && lead ? r3(row.best.v - lead) : null
      row.int = i && row.best && ahead ? r3(row.best.v - ahead) : null
    })
  }

  // ── Track status from race control ──
  let status: Status = 'none'
  const yellows = new Set<number>()
  const rc: State['rc'] = []
  const timePen = new Map<number, number>()
  const otherPen = new Map<number, string>()
  const probes = new Set<number>()
  const neutral: State['tyres']['neutral'] = []
  let held: State['tyres']['neutral'][number] | undefined
  for (const m of s.rc) {
    if (m.t > t) break
    rc.push({ t: m.t, category: m.category, flag: m.flag, message: m.message, lap_number: m.lap_number })
    const msg = m.message.toUpperCase()
    stewards(msg, timePen, otherPen, probes)
    if (msg.startsWith('RED FLAG')) status = 'red' // races send it as "RED FLAG - RACE SUSPENDED", category Other
    else if (m.category === 'SafetyCar') {
      const vsc = msg.includes('VIRTUAL') || msg.includes('VSC') // "VSC DEPLOYED" in 2026
      if (msg.includes('DEPLOYED')) status = vsc ? 'vsc' : 'sc'
      else if (msg.includes('ENDING') || msg.includes('IN THIS LAP')) status = vsc ? 'vsc-ending' : 'sc-ending'
    } else if (m.category === 'Flag') {
      if (m.scope === 'Track' || !m.scope) {
        if (m.flag === 'RED') status = 'red'
        else if (m.flag === 'CHEQUERED') status = 'chequered'
        else if (m.flag === 'GREEN' || (m.flag === 'CLEAR' && status !== 'chequered' && status !== 'red')) {
          status = 'green' // a green light also reopens qualifying after a chequered Q1/Q2
          yellows.clear()
        }
      } else if (m.scope === 'Sector' && m.sector != null) {
        if (m.flag?.includes('YELLOW')) yellows.add(m.sector)
        else if (m.flag === 'CLEAR' || m.flag === 'GREEN') yellows.delete(m.sector)
      }
    }
    const kind = race ? NEUTRAL[status] : undefined
    if (kind !== held?.kind) {
      const lap = m.lap_number ?? Math.max(1, ...[...s.laps.values()].filter((l) => l.start != null && l.start <= m.t).map((l) => l.lap_number))
      if (held) held.to = kind && lap > held.from ? lap - 1 : lap // SC → red flag: hand over on the lap it happened
      held = kind && { kind, from: lap, to: lap }
      if (held) neutral.push(held)
    }
  }
  if (held) held.to = Math.max(held.to, tower[0]?.lap ?? 0) // still neutralised: runs to the lap in progress
  if (status === 'green' && yellows.size) status = 'yellow'
  for (const row of tower) {
    const sec = timePen.get(row.n)
    row.penalty = otherPen.get(row.n) ?? (sec ? `+${sec}s` : null)
    row.investigated = probes.has(row.n)
  }

  // ── Cars: interpolated between samples so replay moves smoothly at any tick rate ──
  const cars: State['cars'] = {}
  for (const n of numbers) {
    if (isOut(n)) continue // parked: its transponder still reports, but it's not racing
    const car: Car = {}
    const L = s.loc.get(n)
    const i = L?.before(carsAt) ?? -1
    if (L && i >= 0 && carsAt - L.t[i] < STALE) {
      const [xs, ys] = L.cols as number[][]
      let x = xs[i]
      let y = ys[i]
      const j = i + 1
      if (j < L.t.length && L.t[j] - L.t[i] < 2000 && (xs[j] || ys[j])) {
        const f = (carsAt - L.t[i]) / (L.t[j] - L.t[i])
        x += f * (xs[j] - x)
        y += f * (ys[j] - y)
      }
      if (x || y) car.xy = [Math.round(x), Math.round(y)]
    }
    const C = s.car.get(n)
    const k = C?.before(carsAt) ?? -1
    if (C && k >= 0 && carsAt - C.t[k] < STALE) car.tel = C.cols.map((c) => c[k])
    if (car.xy || car.tel) cars[n] = car
  }

  // ── History: race → gap to leader at each line crossing; otherwise lap times ──
  const series: Record<number, (number | null)[]> = {}
  if (race) {
    const leaderAt: number[] = []
    for (const arr of lapsBy.values())
      for (const l of arr) {
        const e = endOf.get(l)
        if (e != null && e <= t) leaderAt[l.lap_number] = Math.min(leaderAt[l.lap_number] ?? Infinity, e)
      }
    for (const [n, arr] of lapsBy) {
      series[n] = []
      for (const l of arr) {
        const e = endOf.get(l)
        if (e != null && e <= t) series[n][l.lap_number - 1] = r3((e - leaderAt[l.lap_number]) / 1000)
      }
    }
  } else {
    for (const [n, arr] of lapsBy) {
      series[n] = []
      for (const l of arr) if (timed(l)) series[n][l.lap_number - 1] = l.lap_duration
    }
  }
  for (const n in series) series[n] = Array.from(series[n], (v) => v ?? null) // holes → null for JSON

  const track = outline(s)
  const fc = race
    ? forecast({
        circuit: info.circuit_short_name,
        sprint: info.session_name === 'Sprint',
        status,
        track,
        rows: tower,
        laps: new Map([...lapsBy].map(([n, arr]) => [n, arr.filter(timed)])),
        pits: racePits,
        gapBefore: (n, at) => {
          for (let i = s.intervals.length - 1; i >= 0; i--) {
            const e = s.intervals[i]
            if (e.driver_number === n && e.t <= at && typeof e.gap_to_leader === 'number') return e.gap_to_leader
          }
          return null
        },
        lapGap: (n) => series[n]?.findLast((v) => v != null) ?? null,
      })
    : null

  const radio = s.radio
    .filter((r) => r.t <= t)
    .slice(-50)
    .reverse()
    .map((r): State['radio'][number] => {
      const n = r.driver_number
      const row = tower.find((x) => x.n === n)
      const lap = lapsBy.get(n)?.findLast((l) => l.start != null && l.start <= r.t)?.lap_number ?? null
      const turns = s.transcripts.get(r.recording_url)
      const pending = !turns && s.live && t - r.t < 30_000 ? (true as const) : undefined
      return { t: r.t, n, code: row?.code ?? String(n), name: row?.name ?? `#${n}`, color: row?.color ?? '#888888', lap, url: r.recording_url, turns, pending }
    })

  let weather: Weather | null = null
  for (const w of s.weather) if (w.t <= t && w.t > (weather?.t ?? -Infinity)) weather = w

  const edge = s.live ? Math.max(Date.now(), s.last) : s.last || end
  return {
    meta: {
      sk: s.sk,
      name: info.session_name,
      type: info.session_type,
      meeting: info.meeting_name ?? `${info.country_name} Grand Prix`,
      circuit: info.circuit_short_name,
      country: info.country_name,
      year: info.year,
      start,
      end,
      race,
      live: s.live,
      status: s.status,
      error: s.error,
    },
    clock: {
      t,
      from: Math.min(start - 10 * 60_000, edge),
      edge,
      lap: tower[0]?.lap ?? 0,
      status,
      remaining: race ? null : Math.max(0, end - t),
      feed: s.feed ?? null,
      timingAt: s.lastTiming || null,
      lineAt: Math.max(...(lapsBy.get(tower[0]?.n)?.map((l) => l.start ?? 0) ?? [0])) || null,
    },
    tower,
    cars,
    rc: rc.slice(-50).reverse(),
    radio,
    weather,
    history: { kind: race ? 'gap' : 'lap', series },
    track,
    tyres: { stints: stintsOf, neutral },
    forecast: fc,
  }
}

/** Circuit shape: the fastest lap that has full position data, cached once found. */
function outline(s: Store): [number, number][] | null {
  if (s.track) return s.track
  const laps = [...s.laps.values()]
    .filter((l) => l.start != null && l.lap_duration != null && !l.is_pit_out_lap)
    .sort((a, b) => a.lap_duration! - b.lap_duration!)
  for (const l of laps.slice(0, 10)) {
    const L = s.loc.get(l.driver_number)
    if (!L) continue
    const a = L.before(l.start!) + 1
    const b = L.before(l.start! + l.lap_duration! * 1000)
    const pts: [number, number][] = []
    for (let i = a; i <= b; i++) {
      const x = L.cols[0][i]!
      const y = L.cols[1][i]!
      if (x || y) pts.push([x, y])
    }
    if (pts.length < 100) continue
    const step = Math.ceil(pts.length / 600)
    return (s.track = pts.filter((_, i) => i % step === 0))
  }
  return null
}

/** Penalties and investigations from stewards' messages, e.g.
 *  "FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 16 (LEC) - LEAVING THE TRACK…",
 *  "FIA STEWARDS: PENALTY SERVED - 5 SECOND TIME PENALTY FOR CAR 16 (LEC)",
 *  "FIA STEWARDS: TURN 6 INCIDENT INVOLVING CAR 63 (RUS) UNDER INVESTIGATION…" */
export function stewards(msg: string, time: Map<number, number>, other: Map<number, string>, probes: Set<number>) {
  if (!msg.includes('STEWARDS')) return
  const cars = [...msg.matchAll(/(\d+) \([A-Z]{3}\)/g)].map((m) => Number(m[1]))
  const sec = Number(msg.match(/(\d+) SECOND TIME PENALTY/)?.[1]) || 0
  const kind = msg.includes('DRIVE THROUGH') ? 'Drive-through' : msg.includes('STOP AND GO') ? 'Stop-go' : null
  for (const n of cars) {
    if (msg.includes('SERVED')) {
      if (sec) time.set(n, Math.max(0, (time.get(n) ?? 0) - sec))
      if (kind) other.delete(n)
    } else if (sec || kind) {
      if (sec) time.set(n, (time.get(n) ?? 0) + sec)
      if (kind) other.set(n, kind)
      probes.delete(n)
    } else if (msg.includes('UNDER INVESTIGATION')) probes.add(n)
    else if (msg.includes('NO FURTHER')) probes.delete(n)
  }
}
