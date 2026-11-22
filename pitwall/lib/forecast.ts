import type { Row, Status } from './state'
import type { Lap, Pit } from './store'

// Race forecast from what is known at t, never after it. Every car runs the remaining laps at the pace
// of its last few green-flag laps, drifting with the field (tyres wearing, fuel burning off). Cars that
// still owe a stop make it; an extra stop is taken only when it gains places. A car that catches one it
// can't out-pace by `pass` s/lap sits FOLLOW behind it, so trains form the way they do on track.
// Tuned on seven 2025-26 races: from any lap, the projected finish beats "the order now" (1.8 vs 2.1
// places off), and about two in three passes it calls for the next five laps happen. Individual lap-time
// trends made it worse (they're mostly traffic noise), so only the field's is projected.

/** Lap length (km), and the pace edge needed to pass on track (s/lap) where it differs from PASS. */
const CIRCUITS: Record<string, [km: number, pass?: number]> = {
  Sakhir: [5.412], Jeddah: [6.174], Melbourne: [5.278], Suzuka: [5.807, 1.4], Shanghai: [5.451], Miami: [5.412],
  Imola: [4.909, 1.6], 'Monte Carlo': [3.337, 2.5], Montreal: [4.361], Catalunya: [4.657, 1.4], Spielberg: [4.318],
  Silverstone: [5.891], Hungaroring: [4.381, 1.6], 'Spa-Francorchamps': [7.004], Zandvoort: [4.259, 1.6],
  Monza: [5.793], Baku: [6.003], Singapore: [4.94, 1.6], Austin: [5.513], 'Mexico City': [4.304],
  Interlagos: [4.309], 'Las Vegas': [6.201], Lusail: [5.419], 'Yas Marina Circuit': [5.281, 1.4],
}
const PASS = 1.2 // backtested: lower calls passes that don't happen, higher stops calling real ones
const FOLLOW = 0.7 // s: where a car that can't pass settles behind the one ahead
const WINDOW = 5 // green laps the pace is read from, about the last seven minutes
const WEAR = 0.04 // s/lap of pace a set loses per lap of age, until this race's stops say otherwise
const MAX_FRESH = 2 // s/lap: the most a new set can be worth
const CHEAP = 0.55 // pit loss under a safety car or VSC, as a share of a green-flag stop
const DRY = ['SOFT', 'MEDIUM', 'HARD']

export type Rejoin = { pos: number; ahead: number | null; gapAhead: number | null; behind: number | null; gapBehind: number | null }
export type CarForecast = {
  /** Expected time of the lap in progress (s), from the last few green laps on these tyres. */
  pace: number | null
  /** Lap time change per lap over this stint (s): tyre wear minus fuel burn. Shown, not projected. */
  trend: number
  /** Green laps behind the pace (0 = estimated from the previous stint). */
  laps: number
  /** Still has to fit a second dry compound. */
  owes: boolean
  /** Lap the model pits it on. */
  stop: number | null
  /** Where it would rejoin if it pitted this lap. */
  rejoin: Rejoin | null
  finish: number
}
export type ForecastEvent = { lap: number; n: number; pos: number } & (
  | { kind: 'pass'; other: number; edge: number }
  | { kind: 'stuck'; other: number; edge: number }
  | { kind: 'pit'; lost: number }
  | { kind: 'penalty'; lost: number; what: string }
)
export type Forecast = {
  /** First projected lap: the leader's lap in progress. */
  lap: number
  total: number
  pitLoss: number
  /** Pace a new set is worth per lap of age on the old one (s). */
  wear: number
  pass: number
  neutral: boolean
  cars: Record<number, CarForecast>
  events: ForecastEvent[]
  /** Projected gap to the leader at the end of each lap from `lap` to `total`. */
  trace: Record<number, number[]>
}
export type ForecastIn = {
  circuit: string
  sprint: boolean
  status: Status
  track: [number, number][] | null
  rows: Row[]
  /** Completed laps per car, in order. */
  laps: Map<number, Lap[]>
  /** Race pit stops known at t. */
  pits: Pit[]
  /** Numeric gap to the leader at an earlier instant (just before a car pitted). */
  gapBefore: (n: number, t: number) => number | null
  /** Gap at the car's last line crossing, for lapped cars the timing feed shows as "+1 LAP". */
  lapGap: (n: number) => number | null
}

type Car = {
  n: number
  T: number
  pace: number
  trend: number
  age: number
  lapped: boolean
  /** Unserved penalty: seconds it costs, and whether it is a drive-through or stop-go (served within two laps). */
  pen: number
  penNow: boolean
  penText: string
}

const r1 = (v: number) => Math.round(v * 10) / 10
const r3 = (v: number) => Math.round(v * 1000) / 1000
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

/** Race distance: the fewest laps over 305 km (Monaco 260, sprints 100). Unknown circuits are measured off the map. */
export function raceLaps(circuit: string, sprint: boolean, track: [number, number][] | null) {
  let km = CIRCUITS[circuit]?.[0]
  if (!km && track?.length) {
    // ponytail: map units are 0.1 m and the racing line runs ~1.5% short of the official length; add a circuit above if a count is off.
    km = (track.reduce((s, [x, y], i) => s + Math.hypot(track[(i + 1) % track.length][0] - x, track[(i + 1) % track.length][1] - y), 0) * 1.015) / 10_000
  }
  return km ? Math.ceil((sprint ? 100 : circuit === 'Monte Carlo' ? 260 : 305) / km) : null
}

/** Mean and slope of a run of laps, ignoring ones over a second off its median (traffic, mistakes). */
function read(laps: Lap[]) {
  const recent = laps.slice(-20)
  const cut = median(recent.map((l) => l.lap_duration!)) + 1
  const kept = recent.filter((l) => l.lap_duration! <= cut)
  const last = kept.slice(-WINDOW)
  let trend: number | null = null
  if (kept.length >= 6) {
    const mx = avg(kept.map((l) => l.lap_number))
    const my = avg(kept.map((l) => l.lap_duration!))
    const sxy = kept.reduce((s, l) => s + (l.lap_number - mx) * (l.lap_duration! - my), 0)
    const sxx = kept.reduce((s, l) => s + (l.lap_number - mx) ** 2, 0)
    trend = sxy / sxx
  }
  return { mean: avg(last.map((l) => l.lap_duration!)), at: avg(last.map((l) => l.lap_number)), n: last.length, trend }
}

export function forecast(x: ForecastIn): Forecast | null {
  const lead = x.rows[0]
  const total = raceLaps(x.circuit, x.sprint, x.track)
  if (!lead || !total || lead.lap < 4 || x.status === 'red' || x.status === 'chequered') return null
  const R = total - lead.lap + 1 // laps left, the one in progress included
  if (R < 1) return null
  const pass = CIRCUITS[x.circuit]?.[1] ?? PASS
  // Laps still to run behind the safety car (a guess: it rarely stays out more than two more): no passing, cheap stops.
  const slow = x.status === 'sc' ? 2 : x.status === 'sc-ending' || x.status === 'vsc' || x.status === 'vsc-ending' ? 1 : 0
  const neutral = slow > 0

  // ── Green laps per car: not lap 1, not an in- or out-lap, within 4% of its best (drops SC/VSC laps) ──
  const pitsOf = new Map<number, Pit[]>()
  for (const p of [...x.pits].sort((a, b) => a.t - b.t)) pitsOf.set(p.driver_number, [...(pitsOf.get(p.driver_number) ?? []), p])
  const green = new Map<number, Lap[]>()
  for (const [n, laps] of x.laps) {
    const pitLaps = new Set((pitsOf.get(n) ?? []).map((p) => p.lap_number))
    const timed = laps.filter((l) => l.lap_duration != null && l.lap_number > 1)
    const best = Math.min(...timed.map((l) => l.lap_duration!))
    green.set(
      n,
      timed.filter((l) => !l.is_pit_out_lap && !pitLaps.has(l.lap_number) && !pitLaps.has(l.lap_number - 1) && l.lap_duration! < best * 1.04),
    )
  }

  // ── Pit loss, measured here: in-lap + out-lap against two green laps around the stop ──
  const losses: number[] = []
  for (const p of x.pits) {
    const laps = x.laps.get(p.driver_number) ?? []
    const lapIn = laps.find((l) => l.lap_number === p.lap_number)?.lap_duration
    const lapOut = laps.find((l) => l.lap_number === (p.lap_number ?? 0) + 1)?.lap_duration
    const near = (green.get(p.driver_number) ?? []).filter((l) => Math.abs(l.lap_number - (p.lap_number ?? 0)) <= 6)
    if (lapIn == null || lapOut == null || !near.length) continue
    const loss = lapIn + lapOut - 2 * median(near.map((l) => l.lap_duration!))
    if (loss > 12 && loss < 40) losses.push(loss) // outside that, a slow stop, damage or a neutralised lap
  }
  const lanes = x.pits.map((p) => p.lane_duration).filter((v): v is number => v != null && v > 12)
  const P = losses.length ? median(losses) : lanes.length ? median(lanes) : 22
  const lossAt = (s: number) => (s <= slow ? P * CHEAP : P)

  // ── Fresh tyres, also measured here: pace gained across each stop, per lap of age on the old set ──
  let gained = 0
  let aged = 0
  for (const [n, pits] of pitsOf)
    pits.forEach((p, k) => {
      const L = p.lap_number ?? 0
      const age = L - (pits[k - 1]?.lap_number ?? 0)
      const g = green.get(n) ?? []
      const pre = g.filter((l) => l.lap_number < L && l.lap_number >= L - 4).slice(-3)
      const post = g.filter((l) => l.lap_number > L + 1 && l.lap_number <= L + 5).slice(0, 3)
      if (age < 10 || pre.length < 2 || post.length < 2) return // short stints: compound and fuel swamp the wear
      gained += avg(pre.map((l) => l.lap_duration!)) - avg(post.map((l) => l.lap_duration!))
      aged += age
    })

  // ── Pace and trend per running car ──
  const reads = new Map<number, ReturnType<typeof read> & { prev?: ReturnType<typeof read>; prevLen: number }>()
  for (const r of x.rows) {
    const pits = pitsOf.get(r.n) ?? []
    const last = pits.at(-1)?.lap_number ?? 0
    const before = pits.at(-2)?.lap_number ?? 0
    const laps = green.get(r.n) ?? []
    const stint = laps.filter((l) => l.lap_number > last)
    const prev = laps.filter((l) => l.lap_number < last && l.lap_number > before)
    reads.set(r.n, { ...read(stint), prev: prev.length ? read(prev) : undefined, prevLen: last - before })
  }
  const trends = [...reads.values()].map((v) => v.trend).filter((v): v is number => v != null)
  const fieldTrend = trends.length >= 3 ? median(trends) : 0.02
  // Weighed against WEAR as if it were 60 laps of evidence, so the first stop or two can't swing it.
  const wear = clamp((gained + WEAR * 60) / (aged + 60), 0.005, 0.08)
  const fresh = (age: number) => Math.min(wear * age, MAX_FRESH)

  const cars: Car[] = []
  const meta = new Map<number, { pace: number | null; laps: number; owes: boolean; pitting: boolean }>()
  for (const r of x.rows) {
    if (r.out || r.pos == null) continue
    const rd = reads.get(r.n)!
    const trend = clamp(rd.trend ?? fieldTrend, -0.05, 0.15)
    let pace: number | null = null
    if (rd.n) pace = rd.mean + fieldTrend * (r.lap - rd.at)
    else if (rd.prev?.n) pace = rd.prev.mean - fresh(rd.prevLen) // just stopped: the last stint's pace on new tyres

    const pit = pitsOf.get(r.n)?.at(-1)
    const stopping = pit != null && (r.inPit || (pit.lap_number ?? 0) >= r.lap - 1) // in the lane or on the out-lap
    const pitting = stopping || (r.tyre?.age === 0 && r.stints.length > 1) // a new stint can show up before its pit event
    let T = typeof r.gap === 'number' ? r.gap : r.pos === 1 ? 0 : x.lapGap(r.n)
    // The timing feed only books the stop at the next timing loop.
    if (stopping) T = Math.max(T ?? 0, (x.gapBefore(r.n, pit.t) ?? T ?? 0) + lossAt(1))
    if (T == null) continue

    const used = new Set(r.stints)
    const wet = used.has('INTERMEDIATE') || used.has('WET')
    const recent = pit != null && (pit.lap_number ?? 0) >= r.lap - 2 // stint data lags the stop by a lap or two
    const owes = !x.sprint && !wet && !used.has('UNKNOWN') && !recent && DRY.filter((c) => used.has(c)).length < 2
    meta.set(r.n, { pace, laps: rd.n, owes, pitting })
    // A time penalty is added at its next stop or to its race time; a drive-through costs the pit lane.
    const penNow = r.penalty === 'Drive-through' || r.penalty === 'Stop-go'
    const pen = r.penalty === 'Drive-through' ? P - 2 : r.penalty === 'Stop-go' ? P + 8 : Number(r.penalty?.match(/\d+/)?.[0]) || 0
    cars.push({
      n: r.n, T, pace: pace ?? NaN, trend, age: r.tyre?.age ?? 0, lapped: r.pos !== 1 && typeof r.gap !== 'number',
      pen, penNow, penText: r.penalty ?? '',
    })
  }
  if (cars.length < 2) return null
  const known = cars.filter((c) => !Number.isNaN(c.pace))
  if (!known.length) return null
  const fieldPace = median(known.map((c) => c.pace))
  for (const c of cars) if (Number.isNaN(c.pace)) c.pace = fieldPace // no green laps yet: runs with the pack

  if (x.status === 'sc' || x.status === 'sc-ending') {
    // Behind the safety car the lead lap closes up nose to tail; lapped cars stay a lap down.
    cars.filter((c) => !c.lapped).sort((a, b) => a.T - b.T).forEach((c, i) => (c.T = i * FOLLOW))
  }

  // ── Stops: a car that owes one makes it halfway through its remaining tyre life ──
  // (the time-optimal lap when old and new sets wear alike; under a safety car, now, at a discount)
  const half = (age: number) => clamp(Math.round((R - age) / 2), 1, Math.max(1, R - 1))
  const plan = new Map<number, number>()
  cars.forEach((c, i) => {
    const m = meta.get(c.n)!
    if (m.owes && !m.pitting) plan.set(i, neutral ? 1 : half(c.age))
  })
  const model: Model = { R, lap0: lead.lap, slow, field: fieldTrend, pass, lossAt, fresh }
  let sim = simulate(cars, plan, model)
  // An extra stop: only if fresh tyres beat the pit loss by 5 s (teams keep track position on a coin flip)
  // and the sim says it gains places. A second round lets the car it would beat cover it by stopping too.
  for (let round = 0; round < 3; round++) {
    let changed = false
    cars.forEach((c, i) => {
      const m = meta.get(c.n)!
      if (m.owes || m.pitting || plan.has(i)) return
      const s = neutral ? 1 : half(c.age)
      if (R - s < 3 || fresh(c.age + s) * (R - s) <= lossAt(s) + 5) return
      const trial = simulate(cars, new Map([...plan, [i, s]]), model)
      if (trial.rank[i] < sim.rank[i]) {
        plan.set(i, s)
        sim = trial
        changed = true
      }
    })
    if (!changed) break
  }

  // ── If it pitted this lap: where it would rejoin on today's gaps ──
  const byT = cars.map((c, i) => i).sort((a, b) => cars[a].T - cars[b].T)
  const out: Forecast['cars'] = {}
  cars.forEach((c, i) => {
    const m = meta.get(c.n)!
    let rejoin: Rejoin | null = null
    if (!m.pitting) {
      const X = c.T + lossAt(1)
      const others = byT.filter((j) => j !== i)
      const k = others.findIndex((j) => cars[j].T > X)
      const a = k < 0 ? others.at(-1) : others[k - 1]
      const b = k < 0 ? undefined : others[k]
      rejoin = {
        pos: (k < 0 ? others.length : k) + 1,
        ahead: a != null ? cars[a].n : null,
        gapAhead: a != null ? r1(X - cars[a].T) : null,
        behind: b != null ? cars[b].n : null,
        gapBehind: b != null ? r1(cars[b].T - X) : null,
      }
    }
    const s = plan.get(i)
    out[c.n] = {
      pace: m.pace == null ? null : r3(m.pace),
      trend: r3(c.trend),
      laps: m.laps,
      owes: m.owes,
      stop: s == null ? null : lead.lap + s - 1,
      rejoin,
      finish: sim.rank[i] + 1,
    }
  })

  return {
    lap: lead.lap,
    total,
    pitLoss: r1(P),
    wear: r3(wear),
    pass,
    neutral,
    cars: out,
    events: sim.events,
    trace: Object.fromEntries(cars.map((c, i) => [c.n, sim.trace[i]])),
  }
}

type Model = {
  R: number
  lap0: number
  slow: number
  field: number
  pass: number
  lossAt: (step: number) => number
  fresh: (age: number) => number
}

/** Runs the remaining laps. plan: car index → step (1 = the lap in progress) at the end of which it pits. */
function simulate(cars: Car[], plan: Map<number, number>, { R, lap0, slow, field, pass, lossAt, fresh }: Model) {
  const T = cars.map((c) => c.T)
  let order = cars.map((_, i) => i).sort((a, b) => T[a] - T[b])
  const events: ForecastEvent[] = []
  const trace: number[][] = cars.map(() => [])
  const stuck = new Set<string>()
  for (let j = 1; j <= R; j++) {
    const lap = lap0 + j - 1
    const pits = cars.map((_, i) => plan.get(i) === j)
    const lt = cars.map((c, i) => {
      const s = plan.get(i) ?? Infinity
      const t = c.pace + field * (j - 1)
      return j > s ? t - fresh(c.age + s) : t
    })
    // Behind the safety car everyone circulates together: only the stops move cars around.
    const next = T.map((t, i) => t + (j <= slow ? 0 : lt[i]) + (pits[i] ? lossAt(j) : 0))
    // Traffic: in running order, a car that would close inside FOLLOW without the edge to pass stays there.
    const caught: [number, number, number][] = []
    let ahead = -1
    for (const i of j <= slow ? [] : order) {
      if (pits[i]) continue
      if (ahead >= 0 && next[i] < next[ahead] + FOLLOW && lt[ahead] - lt[i] < pass) {
        next[i] = next[ahead] + FOLLOW
        const key = `${i}:${ahead}`
        if (!stuck.has(key) && lt[ahead] - lt[i] >= 0.1) caught.push([i, ahead, lt[ahead] - lt[i]]) // closed in, not rejoined there
        stuck.add(key)
      }
      ahead = i
    }
    const served = cars.map((c, i) => c.pen > 0 && j === (c.penNow ? Math.min(2, R) : (plan.get(i) ?? R)))
    served.forEach((v, i) => v && (next[i] += cars[i].pen))
    const moved = pits.map((v, i) => v || served[i]) // places that change hands in the pit lane, not on track
    const prevRank = rankOf(order)
    order = order.slice().sort((a, b) => next[a] - next[b])
    const rank = rankOf(order)
    for (const i of order) {
      if (pits[i]) events.push({ lap, kind: 'pit', n: cars[i].n, pos: rank[i] + 1, lost: rank[i] - prevRank[i] })
      else if (served[i]) events.push({ lap, kind: 'penalty', n: cars[i].n, pos: rank[i] + 1, lost: rank[i] - prevRank[i], what: cars[i].penText })
      if (moved[i]) continue
      for (const c of order)
        if (!moved[c] && prevRank[c] < prevRank[i] && rank[c] > rank[i])
          events.push({ lap, kind: 'pass', n: cars[i].n, other: cars[c].n, pos: rank[i] + 1, edge: r1(lt[c] - lt[i]) })
    }
    for (const [i, a, edge] of caught)
      if (rank[i] > rank[a]) events.push({ lap, kind: 'stuck', n: cars[i].n, other: cars[a].n, pos: rank[i] + 1, edge: Math.floor(edge * 10) / 10 }) // never shown at the pass threshold
    const lead = Math.min(...next)
    next.forEach((t, i) => {
      T[i] = t
      trace[i].push(r1(t - lead))
    })
  }
  return { rank: rankOf(order), events, trace }
}

function rankOf(order: number[]) {
  const r: number[] = []
  order.forEach((i, k) => (r[i] = k))
  return r
}
