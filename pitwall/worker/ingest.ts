// Live ingest: OpenF1 MQTT (every topic) →
//   Postgres  openf1_raw: every message verbatim, with our receive time (the archive)
//   Redis     log + pub/sub for the dashboard topics (the fast path)
//   and team radio to text (lib/radio.ts), against a copy of the session kept here without car data
// On start it also pulls the current session so far over REST, so a late start loses nothing.
// Needs a long-lived host: `pnpm worker`.
import mqtt from 'mqtt'
import postgres from 'postgres'
import { api, getToken, HEAVY, pack, TOPICS, utc, type Topic } from '../lib/openf1'
import { transcribe } from '../lib/radio'
import { channel, key, redis, sessionInfo } from '../lib/redis'
import { Store } from '../lib/store'

const FLUSH_MS = 50 // Redis batching window: adds ≤ 50 ms to the live path
const ARCHIVE_MS = 500 // Postgres is off the latency path
const HEAVY_TTL = 14 * 86400
// Every REST endpoint, for the catch-up (dashboard topics are a subset).
const ENDPOINTS = [...TOPICS, 'sessions', 'meetings', 'overtakes', 'session_result', 'starting_grid', 'championship_drivers', 'championship_teams']

const sql = postgres(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/pitwall', { onnotice: () => {} })

type Raw = { topic: string; sk: number | null; at: number; ev: string | null; source: 'mqtt' | 'rest'; payload: string }
let raw: Raw[] = []
let buf = new Map<number, Map<Topic, string[]>>()
let firstAt = 0 // arrival of the oldest buffered message (latency is measured from here)
let src = 0 // OpenF1's own delay on the latest dated message
const known = new Set<number>()
const stats = new Map<string, number>()

const isTopic = (t: string): t is Topic => (TOPICS as readonly string[]).includes(t)

// The session so far, minus car data: the race situation team radio is transcribed against.
const sessions = new Map<number, Store>()
function session(sk: number) {
  let s = sessions.get(sk)
  if (!s) {
    const fresh = (s = new Store(sk))
    fresh.ready = sessionInfo(sk).then((info) => void (fresh.info = info))
    sessions.set(sk, s)
    for (const old of [...sessions.keys()].slice(0, -2)) sessions.delete(old) // the live one and the one before
  }
  return s
}
function keep(sk: number, t: Topic, lines: string[]) {
  if (HEAVY.includes(t)) return
  const s = session(sk)
  for (const l of lines) s.add(t, l)
  if (t === 'team_radio') transcribe(s).catch((e) => console.error('transcribe', e.message)) // words follow the clip by ~9 s
}

function onMessage(topic: string, payload: Buffer) {
  const now = Date.now()
  const text = payload.toString()
  const t = topic.replace(/^v1\//, '')
  stats.set(t, (stats.get(t) ?? 0) + 1)
  let e: Record<string, unknown>
  try {
    e = JSON.parse(text)
  } catch {
    raw.push({ topic: t, sk: null, at: now, ev: null, source: 'mqtt', payload: JSON.stringify({ unparsed: text }) })
    return
  }
  const sk = typeof e.session_key === 'number' ? e.session_key : null
  const ev = (e.date ?? e.date_start ?? null) as string | null
  raw.push({ topic: t, sk, at: now, ev, source: 'mqtt', payload: text })
  if (ev && (t === 'location' || t === 'car_data')) src = now - utc(ev)
  if (!sk || !isTopic(t)) return
  if (!firstAt) firstAt = now
  let topics = buf.get(sk)
  if (!topics) buf.set(sk, (topics = new Map()))
  const lines = topics.get(t) ?? []
  const line = pack(t, e)
  lines.push(line)
  topics.set(t, lines)
  keep(sk, t, [line])
  if (!known.has(sk)) {
    known.add(sk)
    sessionInfo(sk).then((s) => console.log(`streaming ${s.meeting_name} · ${s.session_name} (${sk})`), console.error)
  }
}

async function flush() {
  if (!buf.size) return
  const batch = buf
  const at = firstAt
  buf = new Map()
  firstAt = 0
  const p = redis.pipeline()
  for (const [sk, topics] of batch) {
    const d = [...topics]
    for (const [t, lines] of d) {
      p.rpush(key(sk, t), lines.join('\n'))
      if (HEAVY.includes(t)) p.expire(key(sk, t), HEAVY_TTL)
    }
    p.publish(channel(sk), JSON.stringify({ at, src, d }))
    p.set('f1:live', sk, 'EX', 120)
  }
  for (const [err] of (await p.exec()) ?? []) if (err) console.error('redis', err.message)
}

async function archive() {
  if (!raw.length) return
  const rows = raw
  raw = []
  try {
    await sql`
      insert into openf1_raw (topic, session_key, received_at, event_at, source, payload)
      select topic, sk, at, ev, source, payload::jsonb from unnest(
        ${rows.map((r) => r.topic)}::text[], ${rows.map((r) => r.sk)}::int[],
        ${rows.map((r) => new Date(r.at).toISOString())}::timestamptz[], ${rows.map((r) => r.ev)}::timestamptz[],
        ${rows.map((r) => r.source)}::text[], ${rows.map((r) => r.payload)}::text[]
      ) as r(topic, sk, at, ev, source, payload)` // text[] then ::jsonb: a jsonb[] param would store strings
  } catch (e) {
    raw = rows.concat(raw) // keep them for the next attempt
    console.error('postgres', (e as Error).message)
  }
}

/** Everything OpenF1 already has for the live session: archive it, and feed the dashboard topics to Redis. */
async function catchUp() {
  const [s] = await api<{ session_key: number; session_name: string }>('sessions?session_key=latest')
  if (!s) return
  const sk = s.session_key
  const drivers = (await api<{ driver_number: number }>(`drivers?session_key=${sk}`)).map((d) => d.driver_number)
  console.log(`catch-up: session ${sk} (${s.session_name}), ${drivers.length} drivers`)
  for (const t of ENDPOINTS) {
    const heavy = (HEAVY as readonly string[]).includes(t)
    const q = t === 'meetings' ? `meeting_key=latest` : `session_key=${sk}`
    for (const d of heavy ? drivers : [undefined]) {
      const events = await api(`${t}?${q}${d ? `&driver_number=${d}` : ''}`).catch((e) => {
        console.error(`catch-up ${t}:`, e.message)
        return []
      })
      const now = Date.now()
      for (const e of events)
        raw.push({ topic: t, sk, at: now, ev: (e.date ?? e.date_start ?? null) as string | null, source: 'rest', payload: JSON.stringify(e) })
      if (!isTopic(t) || !events.length) continue
      const lines = events.map((e) => pack(t, e))
      keep(sk, t, lines)
      const chunk = lines.join('\n')
      // Live batches carry `at`; at 0 marks a catch-up so the latency readout ignores it.
      await redis.pipeline().rpush(key(sk, t), chunk).publish(channel(sk), JSON.stringify({ at: 0, src: 0, d: [[t, lines]] })).exec()
    }
    console.log(`catch-up: ${t} done`)
  }
  console.log('catch-up complete')
}

async function main() {
  await sql`
    create table if not exists openf1_raw (
      id bigserial primary key,
      topic text not null,
      session_key int,
      received_at timestamptz not null,
      event_at timestamptz,
      source text not null,
      payload jsonb not null
    )`
  await sql`create index if not exists openf1_raw_session_topic_event on openf1_raw (session_key, topic, event_at)`

  const username = process.env.OPENF1_USERNAME
  const password = await getToken()
  if (!password) throw new Error('Live data needs an OpenF1 sponsor account: set OPENF1_USERNAME and OPENF1_PASSWORD in .env.local')
  const client = mqtt.connect('mqtts://mqtt.openf1.org:8883', { username, password, reconnectPeriod: 2000 })
  client.on('connect', () => {
    console.log('mqtt connected, subscribing to every topic')
    client.subscribe('#')
  })
  client.on('message', onMessage)
  client.on('error', (e) => console.error('mqtt', e.message))
  client.on('close', () => console.log('mqtt closed, reconnecting'))
  // Tokens last an hour: keep the one reconnects use fresh.
  setInterval(() => getToken().then((tok) => void (client.options.password = tok), console.error), 60_000)
  setInterval(() => flush().catch(console.error), FLUSH_MS)
  setInterval(() => void archive(), ARCHIVE_MS)
  setInterval(() => {
    const total = [...stats.values()].reduce((a, b) => a + b, 0)
    console.log(`last 10 s: ${total} msgs, OpenF1 delay ${(src / 1000).toFixed(1)} s ·`, Object.fromEntries(stats))
    stats.clear()
  }, 10_000)
  process.on('SIGINT', () => Promise.all([flush(), archive()]).finally(() => process.exit(0)))
  catchUp().catch((e) => console.error('catch-up', e.message))
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
