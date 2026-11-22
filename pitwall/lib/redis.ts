import Redis from 'ioredis'
import { api, type Session } from './openf1'

// Key layout
//   f1:live              session_key currently streaming from the worker (expires 2 min after the last message)
//   f1:<sk>:<topic>      LIST of chunks, each chunk = newline-joined packed events (append-only log)
//   f1:<sk>:info         session JSON
//   f1:<sk>:radio_turns  HASH recording_url → transcript turns (JSON)
//   f1:sessions:<year>   { at, sessions } picker cache
//   channel f1:<sk>      live batches { at, src, d: [topic, lines[]][] }

const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379' // not localhost: ::1 first stalls 10 s on IPv4-only Redis
const g = globalThis as unknown as { redis?: Redis; sub?: Redis }

// One connection per process (survives Next.js dev reloads), opened on first use.
// Upstash: rediss://default:<password>@<host>:6379
export const redis = (g.redis ??= new Redis(url, { lazyConnect: true }))
export const subscriber = () => (g.sub ??= new Redis(url, { lazyConnect: true }))

export const key = (sk: number, part: string) => `f1:${sk}:${part}`
export const channel = (sk: number) => `f1:${sk}`

export async function sessionInfo(sk: number): Promise<Session> {
  const cached = await redis.get(key(sk, 'info'))
  if (cached) return JSON.parse(cached)
  const [s] = await api<Session>(`sessions?session_key=${sk}`)
  if (!s) throw new Error(`Unknown session ${sk}`)
  const [m] = await api<{ meeting_name: string }>(`meetings?meeting_key=${s.meeting_key}`)
  const info = { ...s, meeting_name: m?.meeting_name }
  await redis.set(key(sk, 'info'), JSON.stringify(info))
  return info
}

/** Sessions of a season with meeting names, cached for an hour (stale copy is served if OpenF1 refuses). */
export async function sessionsOf(year: number): Promise<Session[]> {
  const cacheKey = `f1:sessions:${year}`
  const cached = JSON.parse((await redis.get(cacheKey)) ?? 'null') as { at: number; sessions: Session[] } | null
  if (cached && Date.now() - cached.at < 3600_000) return cached.sessions
  try {
    const [sessions, meetings] = await Promise.all([
      api<Session>(`sessions?year=${year}`),
      api<{ meeting_key: number; meeting_name: string }>(`meetings?year=${year}`),
    ])
    const names = new Map(meetings.map((m) => [m.meeting_key, m.meeting_name]))
    const list = sessions
      .map((s) => ({ ...s, meeting_name: names.get(s.meeting_key) }))
      .sort((a, b) => a.date_start.localeCompare(b.date_start))
    await redis.set(cacheKey, JSON.stringify({ at: Date.now(), sessions: list }))
    return list
  } catch (e) {
    if (cached) return cached.sessions
    throw e
  }
}
