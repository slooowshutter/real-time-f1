// pnpm test: standings add up per round, and the session on screen is scored as it stands at t.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { standingsAt, type Standings } from './standings'
import type { Row } from './state'

const season: Standings = {
  year: 2026,
  sessions: [
    { sk: 1, mk: 10, sprint: false, start: 1000, meeting: 'Australian Grand Prix', code: 'AUS' },
    { sk: 2, mk: 20, sprint: true, start: 2000, meeting: 'Chinese Grand Prix', code: 'CHN' },
    { sk: 3, mk: 20, sprint: false, start: 3000, meeting: 'Chinese Grand Prix', code: 'CHN' },
    { sk: 4, mk: 30, sprint: false, start: 4000, meeting: 'Japanese Grand Prix', code: 'JPN' },
  ],
  drivers: {
    1: { code: 'NOR', name: 'Lando Norris', team: 'McLaren', color: '#F47600' },
    81: { code: 'PIA', name: 'Oscar Piastri', team: 'McLaren', color: '#F47600' },
    63: { code: 'RUS', name: 'George Russell', team: 'Mercedes', color: '#00D7B6' },
  },
  colors: { McLaren: '#F47600', Mercedes: '#00D7B6' },
  after: {
    1: { d: [[63, 25, 1, 'Mercedes'], [1, 18, 2, 'McLaren'], [81, 15, 3, 'McLaren']], t: [['McLaren', 33, 1], ['Mercedes', 25, 2]] },
    2: { d: [[1, 26, 1, 'McLaren'], [81, 22, 3, 'McLaren'], [63, 32, 2, 'Mercedes']], t: [['McLaren', 48, 1], ['Mercedes', 32, 2]] },
    3: { d: [[81, 47, 2, 'McLaren'], [1, 44, 3, 'McLaren'], [63, 47, 1, 'Mercedes']], t: [['McLaren', 91, 1], ['Mercedes', 47, 2]] },
  },
}

test('official rounds: sprint and race merge, ties go to the official order', () => {
  const t = standingsAt(season, { sk: 99, start: 9999, final: false }, null)
  assert.equal(t.done, 2) // Japan has no result yet
  assert.equal(t.live, false)
  assert.deepEqual(t.drivers.map((e) => [e.code, e.pts, e.pos]), [['RUS', 47, 1], ['PIA', 47, 2], ['NOR', 44, 3]])
  const pia = t.drivers[1]
  assert.deepEqual(pia.got, [15, 7 + 25])
  assert.deepEqual(pia.sprint, [null, 7])
  assert.deepEqual(pia.cum, [15, 47])
  assert.deepEqual([pia.wins, pia.podiums, pia.prev], [1, 2, 3])
  assert.deepEqual(t.teams.map((e) => [e.id, e.pts, e.wins, e.podiums, e.team]), [['McLaren', 91, 1, 4, 'PIA · NOR'], ['Mercedes', 47, 1, 2, 'RUS']])
  assert.deepEqual([t.left.d[2], t.left.d[0]], [25, 25 + 8 + 25 + 25])
})

test('the session on screen counts only what has happened by t', () => {
  const rows = [
    { n: 63, pos: 2, team: 'Mercedes', best: null },
    { n: 1, pos: 1, team: 'McLaren', best: null },
    { n: 81, pos: null, team: 'McLaren', best: null },
  ] as unknown as Row[]
  // On the grid of round 2's sprint: round 1 only, and two races and a sprint still to score.
  const before = standingsAt(season, { sk: 2, start: 2000, final: false }, null)
  assert.equal(before.done, 1)
  assert.equal(before.left.d[before.done], 8 + 25 + 25)
  // The Japanese race running: NOR leads, so he takes 25 as it stands.
  const t = standingsAt(season, { sk: 4, start: 4000, final: false }, rows)
  assert.deepEqual([t.done, t.live], [3, true])
  assert.deepEqual(t.drivers.map((e) => [e.code, e.pts, e.got[2]]), [['NOR', 69, 25], ['RUS', 65, 18], ['PIA', 47, null]])
  assert.deepEqual([t.drivers[0].wins, t.drivers[0].prev], [1, 3])
  assert.equal(t.teams[0].pts, 91 + 25)
  assert.equal(t.left.d[t.done], 0)
  assert.deepEqual(t.drivers.map((e) => e.alive), [true, false, false])
})
