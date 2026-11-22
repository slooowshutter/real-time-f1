import type { Row } from './state'

// The championship at a moment of the season: the official tally after every race and sprint that
// started before the session on screen, plus that session itself while it runs, scored as it stands at t.

export type Standings = {
  year: number
  /** Race and sprint sessions of the season in date order, the ones still to come included. */
  sessions: { sk: number; mk: number; sprint: boolean; start: number; meeting: string; code: string }[]
  /** Latest code, name, team and colour of everyone who scored or raced. */
  drivers: Record<number, { code: string; name: string; team: string; color: string }>
  colors: Record<string, string>
  /** Official totals after each finished session: [driver, points, position, team that day] and [team, points, position]. */
  after: Record<number, { d: [number, number, number | null, string][]; t: [string, number, number | null][] }>
}

export type Round = { mk: number; name: string; code: string; sprint: boolean }
export type Entry = {
  id: string
  code: string
  name: string
  /** Drivers: their team. Teams: the drivers who raced for it last time out. */
  team: string
  color: string
  pos: number
  /** Position before the latest round. */
  prev: number | null
  pts: number
  wins: number
  podiums: number
  /** Per round with points in: points scored (null = didn't take part), of which in the sprint, and race wins. */
  got: (number | null)[]
  sprint: (number | null)[]
  won: boolean[]
  /** Running total after each round with points in. */
  cum: number[]
  /** Can still mathematically take the title. */
  alive: boolean
}
export type Table = {
  rounds: Round[]
  /** Rounds with points in. With `live`, the last one is the session on screen, scored as it stands. */
  done: number
  live: boolean
  /** Most points one driver / team can still score after k rounds (k = 0 … rounds; at `done`, after the sessions in so far). */
  left: { d: number[]; t: number[] }
  drivers: Entry[]
  teams: Entry[]
}
export type Now = { sk: number; start: number; final: boolean }

export const RACE = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
export const SPRINT = [8, 7, 6, 5, 4, 3, 2, 1]

/** `running`: the tower of the session on screen while it is a race or sprint under way, else null.
 *  It is scored as it stands until the official result for it is in and the flag has fallen. */
export function standingsAt(s: Standings, now: Now, running: Row[] | null): Table {
  const fl = s.year < 2025 ? 1 : 0 // fastest lap in the top ten scored a point from 2019 to 2024
  const most = (sprint: boolean, team: boolean) => (sprint ? (team ? 15 : 8) : (team ? 43 : 25) + fl)

  const rounds: Round[] = []
  const roundOf = new Map<number, number>()
  for (const x of s.sessions) {
    if (!roundOf.has(x.mk)) roundOf.set(x.mk, rounds.push({ mk: x.mk, name: x.meeting, code: x.code, sprint: false }) - 1)
    if (x.sprint) rounds[roundOf.get(x.mk)!].sprint = true
  }

  type Side = {
    tot: Map<string, number>
    rank: Map<string, number>
    got: Map<string, (number | null)[]>
    sprint: Map<string, (number | null)[]>
    won: Map<string, boolean[]>
    cum: Map<string, number[]>
    wins: Map<string, number>
    podiums: Map<string, number>
    ranks: Map<string, number>[]
  }
  const side = (): Side => ({ tot: new Map(), rank: new Map(), got: new Map(), sprint: new Map(), won: new Map(), cum: new Map(), wins: new Map(), podiums: new Map(), ranks: [] })
  const D = side()
  const T = side()
  const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  const arr = <V,>(m: Map<string, V[]>, k: string) => m.get(k) ?? (m.set(k, []), m.get(k)!)

  const teamOf = new Map<string, string>() // driver → team in the latest session in
  const tally = (x: Standings['sessions'][number]) => {
    const official = s.after[x.sk]
    const mine = x.sk === now.sk
    if (official && (x.start < now.start || (mine && now.final)))
      return {
        live: false,
        d: official.d.map(([n, pts, pos, team]) => ({ id: String(n), pts, pos, team })),
        t: official.t.map(([id, pts, pos]) => ({ id, pts, pos })),
      }
    if (!mine || !running) return null
    const scale = x.sprint ? SPRINT : RACE
    const order = running.filter((r) => r.pos != null).sort((a, b) => a.pos! - b.pos!)
    const fast = !x.sprint && fl ? running.find((r) => r.best?.c === 'p') : undefined
    const gain = new Map(order.map((r, i) => [r, (scale[i] ?? 0) + (r === fast && i < 10 ? 1 : 0)]))
    const teams = new Map<string, number>()
    for (const [r, g] of gain) if (r.team) teams.set(r.team, (teams.get(r.team) ?? T.tot.get(r.team) ?? 0) + g)
    return {
      live: true,
      d: order.map((r) => ({ id: String(r.n), pts: (D.tot.get(String(r.n)) ?? 0) + gain.get(r)!, pos: null, team: r.team })),
      t: [...teams].map(([id, pts]) => ({ id, pts, pos: null })),
    }
  }

  let done = 0
  let live = false
  let last = -1 // index of the last session in
  let lineup: { id: string; team: string }[] = []
  s.sessions.forEach((x, i) => {
    const r = tally(x)
    if (!r) return
    const k = roundOf.get(x.mk)!
    done = k + 1
    live = r.live
    last = i
    lineup = r.d
    // What each driver scored here: 25+ in a race is the win, 15+ a podium (P4 with the fastest lap is 13).
    const gain = new Map(r.d.map((e) => [e.id, e.pts - (D.tot.get(e.id) ?? 0)]))
    for (const e of r.d) if (e.team) teamOf.set(e.id, e.team)
    if (!x.sprint)
      for (const e of r.d) {
        const team = teamOf.get(e.id)
        const g = gain.get(e.id)!
        if (g >= 15) {
          inc(D.podiums, e.id)
          if (team) inc(T.podiums, team)
        }
        if (g >= 25) {
          inc(D.wins, e.id)
          arr(D.won, e.id)[k] = true
          if (team) {
            inc(T.wins, team)
            arr(T.won, team)[k] = true
          }
        }
      }
    for (const [S, rows] of [
      [D, r.d],
      [T, r.t],
    ] as const) {
      for (const e of rows) {
        const g = e.pts - (S.tot.get(e.id) ?? 0)
        S.tot.set(e.id, e.pts)
        const got = arr(S.got, e.id)
        got[k] = (got[k] ?? 0) + g
        if (x.sprint) arr(S.sprint, e.id)[k] = g
      }
      // Rank by points, then the official order (count-back), then the order before this session.
      const before = S.rank
      const pos = new Map(rows.map((e) => [e.id, e.pos ?? Infinity]))
      S.rank = new Map(
        [...S.tot.keys()]
          .sort(
            (a, b) =>
              S.tot.get(b)! - S.tot.get(a)! ||
              (pos.get(a) ?? Infinity) - (pos.get(b) ?? Infinity) ||
              (before.get(a) ?? 99) - (before.get(b) ?? 99),
          )
          .map((id, j) => [id, j + 1]),
      )
      S.ranks[k] = S.rank
      for (const id of S.tot.keys()) arr(S.cum, id)[k] = S.tot.get(id)!
    }
  })

  // Points still on offer after k rounds, and at `done` after exactly the sessions in so far.
  const left = { d: [] as number[], t: [] as number[] }
  for (let k = 0; k <= rounds.length; k++) {
    const after = s.sessions.filter((x, i) => (k === done ? i > last : roundOf.get(x.mk)! >= k))
    left.d[k] = after.reduce((a, x) => a + most(x.sprint, false), 0)
    left.t[k] = after.reduce((a, x) => a + most(x.sprint, true), 0)
  }

  const fill = <V,>(a: V[] | undefined, v: V) => Array.from({ length: done }, (_, k) => a?.[k] ?? v)
  const entries = (S: Side, info: (id: string) => Pick<Entry, 'code' | 'name' | 'team' | 'color'>, rest: number) => {
    const list = [...S.rank]
      .sort((a, b) => a[1] - b[1])
      .map(([id, pos]): Entry => {
        const cum = fill(S.cum.get(id), NaN)
        cum.forEach((v, k) => Number.isNaN(v) && (cum[k] = cum[k - 1] ?? 0)) // carried until their first race
        return {
          id,
          ...info(id),
          pos,
          prev: done > 1 ? (S.ranks[done - 2]?.get(id) ?? null) : null,
          pts: S.tot.get(id)!,
          wins: S.wins.get(id) ?? 0,
          podiums: S.podiums.get(id) ?? 0,
          got: fill(S.got.get(id), null),
          sprint: fill(S.sprint.get(id), null),
          won: fill(S.won.get(id), false),
          cum,
          alive: false,
        }
      })
    for (const e of list) e.alive = e.pts + rest >= (list[0]?.pts ?? 0)
    return list
  }
  const row = (n: string) => running?.find((r) => String(r.n) === n)
  const drivers = entries(
    D,
    (id) => {
      const d = s.drivers[Number(id)]
      const r = row(id)
      return { code: d?.code ?? r?.code ?? id, name: d?.name ?? r?.name ?? '', team: d?.team ?? r?.team ?? '', color: d?.color ?? r?.color ?? '#888888' }
    },
    left.d[done],
  )
  const code = new Map(drivers.map((e) => [e.id, e.code]))
  const teams = entries(
    T,
    (id) => ({
      code: id,
      name: id,
      team: lineup.filter((e) => e.team === id).map((e) => code.get(e.id)).join(' · '),
      color: s.colors[id] ?? running?.find((r) => r.team === id)?.color ?? '#888888',
    }),
    left.t[done],
  )
  return { rounds, done, live, left, drivers, teams }
}
