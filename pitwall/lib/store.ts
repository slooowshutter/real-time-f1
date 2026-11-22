import { api, HEAVY, pack, TOPICS, utc, type Session, type Topic } from './openf1'
import { transcribe, type Turn } from './radio'
import { channel, key, redis, sessionInfo, subscriber } from './redis'

// In-memory copy of one session's event log. Filled from Redis, then kept current by
// live batches (pub/sub) or by a one-off REST backfill for past sessions.

export type Driver = {
  driver_number: number
  name_acronym: string
  full_name: string
  first_name?: string
  last_name?: string
  broadcast_name: string
  team_name: string | null
  team_colour: string | null
  headshot_url: string | null
}
export type Lap = {
  driver_number: number
  lap_number: number
  date_start: string | null
  lap_duration: number | null
  duration_sector_1: number | null
  duration_sector_2: number | null
  duration_sector_3: number | null
  is_pit_out_lap: boolean | null
  start: number | null // date_start as ms
}
export type Stint = {
  driver_number: number
  stint_number: number
  compound: string | null
  lap_start: number | null
  lap_end: number | null
  tyre_age_at_start: number | null
}
type Timed = { t: number }
export type Pit = Timed & {
  driver_number: number
  lap_number?: number | null // the in-lap
  lane_duration?: number | null
  pit_duration?: number | null
  stop_duration?: number | null
}
export type Position = Timed & { driver_number: number; position: number }
export type Interval = Timed & { driver_number: number; gap_to_leader: number | string | null; interval: number | string | null }
export type RaceControl = Timed & {
  category: string
  flag: string | null
  message: string
  scope: string | null
  sector: number | null
  lap_number: number | null
}
export type Weather = Timed & {
  air_temperature: number
  track_temperature: number
  humidity: number
  rainfall: number
  wind_direction: number
  wind_speed: number
}
export type Radio = Timed & { driver_number: number; recording_url: string }
/** radio: transcripts as they come back, [recording_url, turns] */
export type Batch = { at: number; src: number; d: [Topic, string[]][]; radio?: [string, Turn[]][] }

const HEAVY_TTL = 14 * 86400 // seconds; telemetry is re-fetchable from OpenF1, the rest is kept

export const upper = (a: number[], x: number) => {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (a[m] <= x) lo = m + 1
    else hi = m
  }
  return lo
}

/** Time-sorted columns for one car: t[i], cols[j][i]. Appends are O(1); late or repeated samples
 *  (REST catch-up after live data) are sorted and de-duplicated once, on the next read. */
export class Series {
  t: number[] = []
  cols: (number | null)[][]
  private sorted = true
  constructor(width: number) {
    this.cols = Array.from({ length: width }, () => [])
  }
  add(t: number, values: (number | null)[]) {
    if (this.t.length && t <= this.t[this.t.length - 1]) this.sorted = false
    this.t.push(t)
    this.cols.forEach((c, j) => c.push(values[j]))
  }
  /** Index of the last sample at or before t, -1 if none. */
  before(t: number) {
    if (!this.sorted) this.sort()
    return upper(this.t, t) - 1
  }
  private sort() {
    const idx = this.t.map((_, i) => i).sort((a, b) => this.t[a] - this.t[b])
    const keep = idx.filter((i, k) => k === 0 || this.t[i] !== this.t[idx[k - 1]])
    this.t = keep.map((i) => this.t[i])
    this.cols = this.cols.map((c) => keep.map((i) => c[i]))
    this.sorted = true
  }
}

function merge<T extends object>(m: Map<string, T>, k: string, e: T) {
  const cur = m.get(k) as Record<string, unknown> | undefined
  if (!cur) return void m.set(k, e)
  for (const [f, v] of Object.entries(e)) if (v != null) cur[f] = v // later versions fill in sectors
}

export class Store {
  info?: Session
  drivers = new Map<number, Driver>()
  laps = new Map<string, Lap>()
  stints = new Map<string, Stint>()
  pit: Pit[] = []
  position: Position[] = []
  intervals: Interval[] = []
  rc: RaceControl[] = []
  weather: Weather[] = []
  radio: Radio[] = []
  transcripts = new Map<string, Turn[]>() // recording_url → turns ([] = no speech)
  loc = new Map<number, Series>() // x, y
  car = new Map<number, Series>() // speed, rpm, gear, throttle, brake, drs
  last = 0 // newest event time
  lastLoc = 0 // newest car position
  lastTiming = 0 // newest lap, interval, position or race control event
  private waits: [number, number][] = [] // [arrival, how stale positions had become just before it]
  feed?: { at: number; src: number } // last live batch: worker receive time, OpenF1's own delay
  status?: string
  error?: string
  track?: [number, number][] | null
  listeners = new Set<() => void>()
  users = 0
  ready: Promise<void> = Promise.resolve()
  private seen = new Set<string>()
  private fetched = new Set<Topic>()
  private filling = false
  private lastTry = 0

  constructor(readonly sk: number) {}

  /** Live window per OpenF1 (30 min either side, REST locked for free users), or the worker is still streaming. */
  get live() {
    if (this.feed && Date.now() - this.feed.at < 120_000) return true
    if (!this.info) return false
    const now = Date.now()
    return now > utc(this.info.date_start) - 1800_000 && now < utc(this.info.date_end) + 1800_000
  }

  add(topic: Topic, line: string) {
    if (!line) return
    if (topic === 'location' || topic === 'car_data') {
      const [t, d, ...values] = JSON.parse(line) as number[]
      const map = topic === 'location' ? this.loc : this.car
      let s = map.get(d)
      if (!s) map.set(d, (s = new Series(values.length)))
      s.add(t, values)
      if (t > this.last) this.last = t
      if (topic === 'location' && t > this.lastLoc) this.lastLoc = t
      return
    }
    const e = JSON.parse(line)
    const t = utc(e.date ?? e.date_start) || 0
    // Pub/sub, the Redis log and REST catch-up can overlap. Laps/stints/drivers merge idempotently;
    // timed events are identified by what they are, not by how the JSON happened to be serialised.
    const id = topic === 'laps' || topic === 'stints' || topic === 'drivers' ? '' : `${topic}|${t}|${e.driver_number ?? ''}|${e.message ?? ''}`
    if (id && this.seen.has(id)) return
    if (id) this.seen.add(id)
    if (t > this.last) this.last = t
    if (topic !== 'weather' && topic !== 'drivers' && topic !== 'team_radio' && t > this.lastTiming) this.lastTiming = t
    switch (topic) {
      case 'drivers':
        this.drivers.set(e.driver_number, { ...this.drivers.get(e.driver_number), ...e })
        break
      case 'laps': {
        const k = `${e.driver_number}:${e.lap_number}`
        merge(this.laps, k, e)
        const lap = this.laps.get(k)!
        lap.start = lap.date_start ? utc(lap.date_start) : null
        break
      }
      case 'stints':
        merge(this.stints, `${e.driver_number}:${e.stint_number}`, e)
        break
      case 'race_control':
      case 'team_radio': {
        const list = (topic === 'race_control' ? this.rc : this.radio) as Timed[]
        list.push({ ...e, t })
        if (list.length > 1 && t < list[list.length - 2].t) list.sort((a, b) => a.t - b.t)
        break
      }
      case 'pit':
      case 'position':
      case 'intervals':
      case 'weather':
        ;(this[topic] as Timed[]).push({ ...e, t })
    }
  }

  ingest(b: Batch) {
    const before = this.lastLoc
    for (const [topic, lines] of b.d) for (const l of lines) this.add(topic, l)
    for (const [url, turns] of b.radio ?? []) this.transcripts.set(url, turns)
    if (!b.at) return this.emit() // at 0 = REST catch-up, not a live batch
    this.feed = { at: b.at, src: b.src }
    const now = Date.now()
    if (before && this.lastLoc > before) this.waits.push([now, now - before])
    this.waits = this.waits.filter(([at]) => now - at < 15_000)
    this.emit()
  }

  /** How far behind now to draw cars live so there is always a next sample to glide to.
   *  OpenF1 sends every car's position in bursts up to ~1 s apart: cover the longest recent wait. */
  get carDelay() {
    return this.waits.length ? Math.max(...this.waits.map(([, w]) => w)) + 150 : 0
  }

  emit() {
    for (const f of this.listeners) f()
  }

  async load() {
    this.info = await sessionInfo(this.sk)
    await subscriber().subscribe(channel(this.sk)) // before reading, so no batch falls in between
    const lists = await redis
      .pipeline([...TOPICS.map((t) => ['lrange', key(this.sk, t), '0', '-1']), ['hgetall', key(this.sk, 'radio_turns')]])
      .exec()
    TOPICS.forEach((topic, i) => {
      const chunks = (lists?.[i]?.[1] ?? []) as string[]
      if (chunks.length) this.fetched.add(topic)
      for (const c of chunks) for (const line of c.split('\n')) this.add(topic, line)
    })
    for (const [url, turns] of Object.entries((lists?.[TOPICS.length]?.[1] ?? {}) as Record<string, string>)) this.transcripts.set(url, JSON.parse(turns))
    this.transcribe()
    void this.backfill()
  }

  /** Past sessions: transcribe the radio the worker never heard (it does live ones itself).
   *  Transcripts come back through pub/sub like any live batch. */
  transcribe() {
    if (!this.live && this.radio.some((r) => !this.transcripts.has(r.recording_url))) transcribe(this, true).catch((e) => console.error('transcribe', e.message))
  }

  /** Past session missing from Redis: pull it from OpenF1 REST, small topics first so the UI fills in progressively. */
  async backfill() {
    const todo = TOPICS.filter((t) => !this.fetched.has(t))
    if (!todo.length || this.filling || this.live || Date.now() - this.lastTry < 60_000) return
    this.filling = true
    this.lastTry = Date.now()
    this.error = undefined
    try {
      for (const [i, topic] of todo.entries()) {
        const label = `Loading ${topic.replace('_', ' ')} (${i + 1}/${todo.length})`
        const chunks: string[] = []
        const heavy = HEAVY.includes(topic)
        const drivers = heavy ? [...this.drivers.keys()] : [undefined]
        for (const [j, d] of drivers.entries()) {
          this.status = heavy ? `${label} · car ${j + 1}/${drivers.length}` : label
          this.emit()
          const events = await api(`${topic}?session_key=${this.sk}${d ? `&driver_number=${d}` : ''}`)
          const lines = events
            .sort((a, b) => utc(a.date ?? a.date_start) - utc(b.date ?? b.date_start))
            .map((e) => pack(topic, e))
          for (const l of lines) this.add(topic, l)
          chunks.push(lines.join('\n'))
        }
        // One transaction per topic so an interrupted backfill never leaves a half-written log,
        // one chunk per command to stay under Upstash's request size limit. '' = fetched, empty.
        const tx = redis.multi()
        for (const c of chunks.length ? chunks : ['']) tx.rpush(key(this.sk, topic), c)
        if (heavy) tx.expire(key(this.sk, topic), HEAVY_TTL)
        await tx.exec()
        this.fetched.add(topic)
        if (topic === 'team_radio') this.transcribe() // drivers are in by now, for name hints
      }
    } catch (e) {
      this.error = (e as Error).message
    } finally {
      this.filling = false
      this.status = undefined
      this.emit()
    }
  }
}

// Registry: one Store per session per process, idle ones evicted beyond KEEP, never more than MAX.
const KEEP = 3
const MAX = 6 // ponytail: a race with telemetry holds a few hundred MB; per-client stream limits if this goes public
const g = globalThis as unknown as { stores?: Map<number, Store>; listening?: boolean }
const stores = (g.stores ??= new Map<number, Store>())

/** Null when MAX sessions are open and all are being watched. */
export function openStore(sk: number): Store | null {
  if (!g.listening) {
    g.listening = true
    subscriber().on('message', (ch: string, msg: string) => {
      const s = g.stores!.get(Number(ch.slice(3)))
      s?.ready.then(() => s.ingest(JSON.parse(msg)))
    })
  }
  let s = stores.get(sk)
  if (s) {
    s.ready.then(() => s!.backfill()).catch(() => {})
  } else {
    if (stores.size >= MAX && ![...stores.values()].some((o) => o.users === 0)) return null
    s = new Store(sk)
    const fresh = s
    s.ready = s.load().catch((e) => {
      fresh.error = (e as Error).message
      stores.delete(sk) // retry on next open
      fresh.emit()
    })
  }
  stores.delete(sk)
  stores.set(sk, s) // most recently used last
  s.users++
  for (const [k, o] of stores) {
    if (stores.size <= KEEP) break
    if (o.users === 0) {
      stores.delete(k)
      void subscriber().unsubscribe(channel(k))
    }
  }
  return s
}

export function closeStore(s: Store) {
  s.users--
}
