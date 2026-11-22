import type { NextRequest } from 'next/server'
import { api, type Session } from '@/lib/openf1'
import { redis, sessionsOf } from '@/lib/redis'
import type { Standings } from '@/lib/standings'

const FRESH = 600_000 // the season is fetched again after 10 minutes
const SETTLED = 4 * 3600_000 // a race's official tally is used from 4 h after its start (red flags, stewards)

type Tally = {
  session_key: number
  points_start: number | null
  points_current: number
  position_start: number | null
  position_current: number | null
}
type Driver = {
  session_key: number
  driver_number: number
  name_acronym: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  team_name: string | null
  team_colour: string | null
}

export async function GET(req: NextRequest) {
  const year = Number(req.nextUrl.searchParams.get('year')) || new Date().getUTCFullYear()
  try {
    return Response.json(await standingsOf(year))
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 })
  }
}

const refreshing = new Map<number, Promise<Standings>>()

/** A season, cached for 10 minutes (for good once fetched after it ended). A stale copy is served at once while
 *  it refreshes: the refresh can queue behind another session's backfill in the OpenF1 request spacing. */
async function standingsOf(year: number): Promise<Standings> {
  const cached = JSON.parse((await redis.get(`f1:standings:${year}`)) ?? 'null') as { at: number; data: Standings } | null
  if (cached && (Date.now() - cached.at < FRESH || cached.at > Date.UTC(year + 1, 0, 1))) return cached.data
  const job = refreshing.get(year) ?? fetchSeason(year).finally(() => refreshing.delete(year))
  refreshing.set(year, job)
  if (!cached) return job
  job.catch(() => {}) // keep serving the stale copy
  return cached.data
}

/** The whole season in three OpenF1 requests. */
async function fetchSeason(year: number): Promise<Standings> {
  const all = await sessionsOf(year)
  const races = all.filter((s) => s.session_type === 'Race' && !s.is_cancelled)
  // Countries with two rounds go by circuit (MIA, LAS, CAT, MAD) unless that is another country's code (Austin: AUS).
  const codes = new Set(races.map((s) => s.country_code))
  const shared = (s: Session) => races.some((o) => o.country_code === s.country_code && o.meeting_key !== s.meeting_key)
  const codeOf = (s: Session) => {
    const short = s.circuit_short_name.slice(0, 3).toUpperCase()
    return shared(s) && !codes.has(short) ? short : (s.country_code ?? s.country_name.slice(0, 3).toUpperCase())
  }
  const data: Standings = {
    year,
    sessions: races.map((s) => ({
      sk: s.session_key,
      mk: s.meeting_key,
      sprint: s.session_name === 'Sprint',
      start: Date.parse(s.date_start),
      meeting: s.meeting_name ?? s.location,
      code: codeOf(s),
    })),
    drivers: {},
    colors: {},
    after: {},
  }
  if (races.length) {
    const sks = races.map((s) => s.session_key)
    const range = `session_key>=${Math.min(...sks)}&session_key<=${Math.max(...sks)}`
    const [cd, ct, dr] = await Promise.all([
      api<Tally & { driver_number: number }>(`championship_drivers?${range}`),
      api<Tally & { team_name: string }>(`championship_teams?${range}`),
      api<Driver>(`drivers?${range}`), // every session of the season, practice included
    ])
    const season = new Set(all.map((s) => s.session_key)) // the range can reach into sessions added for other years
    const raced = new Set(sks)
    const racing = new Set(cd.filter((e) => raced.has(e.session_key)).map((e) => e.driver_number))
    const teamThen = new Map<string, string>()
    for (const d of dr.sort((a, b) => a.session_key - b.session_key)) {
      if (!racing.has(d.driver_number) || !season.has(d.session_key)) continue // practice-only drivers
      const was = data.drivers[d.driver_number]
      const team = d.team_name ?? was?.team ?? ''
      if (d.team_name) teamThen.set(`${d.session_key}:${d.driver_number}`, d.team_name)
      data.drivers[d.driver_number] = {
        code: d.name_acronym ?? was?.code ?? String(d.driver_number),
        name: d.first_name && d.last_name ? `${d.first_name} ${d.last_name}` : (d.full_name ?? was?.name ?? ''),
        team,
        color: d.team_colour ? `#${d.team_colour}` : (was?.color ?? '#888888'),
      }
      if (d.team_name && d.team_colour) data.colors[d.team_name] = `#${d.team_colour}`
    }
    // A session's total is taken from the next session's start when there is one: that has the stewards'
    // later decisions in, and OpenF1's own end-of-session figure is sometimes wrong (2024 China: VER 100, not 110).
    const rows = <R extends Tally>(list: R[], id: (e: R) => string | number) => {
      const by = new Map<string, R>(list.map((e) => [`${e.session_key}:${id(e)}`, e]))
      return (i: number, e: R): [number, number | null] => {
        const next = races[i + 1] && by.get(`${races[i + 1].session_key}:${id(e)}`)
        return next?.points_start != null ? [next.points_start, next.position_start] : [e.points_current, e.position_current]
      }
    }
    const driverAt = rows(cd, (e) => e.driver_number)
    const teamAt = rows(ct, (e) => e.team_name)
    // In-progress and freshly finished races are left out: the page scores those from the live order.
    races.forEach((s, i) => {
      if (Date.parse(s.date_start) + SETTLED > Date.now()) return
      const sk = s.session_key
      const d = cd.filter((e) => e.session_key === sk)
      if (!d.length) return
      data.after[sk] = {
        d: d.map((e) => [e.driver_number, ...driverAt(i, e), teamThen.get(`${sk}:${e.driver_number}`) ?? data.drivers[e.driver_number]?.team ?? '']),
        t: ct.filter((e) => e.session_key === sk).map((e) => [e.team_name, ...teamAt(i, e)]),
      }
    })
  }
  await redis.set(`f1:standings:${year}`, JSON.stringify({ at: Date.now(), data }))
  return data
}
