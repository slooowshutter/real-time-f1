// OpenF1 REST access + the compact line format we store in Redis.
// Shared by the Next.js server and the ingest worker.

export const TOPICS = [
  'drivers', 'laps', 'stints', 'pit', 'position', 'intervals', 'race_control', 'weather', 'team_radio',
  'location', 'car_data',
] as const
export type Topic = (typeof TOPICS)[number]
// ~3.7 Hz per car: fetched per driver, packed as arrays, expire from Redis (always re-fetchable).
export const HEAVY: readonly Topic[] = ['location', 'car_data']

export type Session = {
  session_key: number
  meeting_key: number
  session_name: string
  session_type: string
  date_start: string
  date_end: string
  circuit_short_name: string
  country_name: string
  country_code?: string
  location: string
  year: number
  meeting_name?: string
  is_cancelled?: boolean
}

const BASE = 'https://api.openf1.org'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let token: { value: string; exp: number } | undefined

/** Sponsor-tier OAuth token (1h). Undefined when no credentials are configured. */
export async function getToken() {
  const { OPENF1_USERNAME: username, OPENF1_PASSWORD: password } = process.env
  if (!username || !password) return undefined
  if (token && token.exp - Date.now() > 5 * 60_000) return token.value
  const res = await fetch(`${BASE}/token`, { method: 'POST', body: new URLSearchParams({ username, password }) })
  if (!res.ok) throw new Error(`OpenF1 token ${res.status}: ${await res.text()}`)
  const j = await res.json()
  token = { value: j.access_token, exp: Date.now() + Number(j.expires_in) * 1000 }
  return token.value
}

// ponytail: per-process request spacing (30/min free, 60/min sponsor); 429s from other processes are retried.
let slot = 0

export async function api<T = Record<string, unknown>>(path: string): Promise<T[]> {
  for (let attempt = 0; ; attempt++) {
    const tok = await getToken()
    const at = Math.max(slot, Date.now())
    slot = at + (tok ? 1050 : 2050)
    await sleep(at - Date.now())
    const res = await fetch(`${BASE}/v1/${path}`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      cache: 'no-store',
    })
    if (res.ok) return res.json()
    if (res.status === 404) return [] // OpenF1 answers "No results found" with a 404
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(10_000 * (attempt + 1))
      continue
    }
    const body = (await res.text()).slice(0, 300)
    throw new Error(`OpenF1 /v1/${path} → ${res.status} ${body}`)
  }
}

/** OpenF1 timestamps are UTC, but MQTT sends some without an offset ("2026-11-01T20:32:54.107000"),
 *  which JavaScript would read as local time. */
export const utc = (s: unknown) => (typeof s === 'string' ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`) : NaN)

/** One event → one line. Heavy topics become `[ms, driver, ...values]`, the rest stay OpenF1-shaped. */
export function pack(topic: Topic, e: Record<string, unknown>): string {
  const ms = utc(e.date)
  if (topic === 'location') return JSON.stringify([ms, e.driver_number, e.x, e.y])
  if (topic === 'car_data')
    return JSON.stringify([ms, e.driver_number, e.speed, e.rpm, e.n_gear, e.throttle, e.brake, e.drs])
  const o = { ...e }
  delete o.meeting_key
  delete o.session_key
  delete o._id
  delete o._key
  return JSON.stringify(o)
}
