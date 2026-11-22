// pnpm test: the forecast passes, traps and pits cars the way the model says it should.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { forecast, type ForecastIn } from './forecast'
import type { Row } from './state'
import type { Lap } from './store'

const row = (n: number, pos: number, gap: number, stints = ['SOFT', 'MEDIUM']): Row => ({
  n, code: `C${n}`, name: '', team: '', color: '', photo: null, pos, grid: pos, gap, int: null, lap: 10, last: null, best: null,
  sectors: [], tyre: { compound: stints.at(-1)!, age: 9, fresh: true }, stints, pits: 0, inPit: false, out: false, penalty: null,
  investigated: false,
})
const laps = (n: number, time: number): Lap[] =>
  Array.from({ length: 9 }, (_, i) => ({
    driver_number: n, lap_number: i + 1, lap_duration: time, date_start: null, start: null, is_pit_out_lap: false,
    duration_sector_1: null, duration_sector_2: null, duration_sector_3: null,
  }))
const race = (cars: [Row, number][]): ForecastIn => ({
  circuit: 'Mexico City', sprint: false, status: 'green', track: null, pits: [],
  rows: cars.map(([r]) => r),
  laps: new Map(cars.map(([r, pace]) => [r.n, laps(r.n, pace)])),
  gapBefore: () => null,
  lapGap: () => null,
})

test('a car 1.5 s a lap faster passes when it reaches the car ahead', () => {
  const f = forecast(race([[row(1, 1, 0), 81], [row(2, 2, 3.5), 79.5]]))!
  assert.equal(f.total, 71)
  assert.deepEqual(f.events.find((e) => e.kind === 'pass'), { lap: 12, kind: 'pass', n: 2, other: 1, pos: 1, edge: 1.5 })
  assert.equal(f.cars[2].finish, 1)
})

test('a car without the edge to pass gets stuck behind', () => {
  const f = forecast(race([[row(1, 1, 0), 81], [row(2, 2, 2), 80.8]]))!
  assert.deepEqual(f.events.find((e) => e.kind === 'stuck'), { lap: 16, kind: 'stuck', n: 2, other: 1, pos: 2, edge: 0.2 })
  assert.equal(f.events.some((e) => e.kind === 'pass'), false)
  assert.equal(f.cars[2].finish, 2)
})

test('a car on one compound still owes a stop, and knows where it would rejoin', () => {
  const f = forecast(race([[row(1, 1, 0, ['SOFT']), 81], [row(2, 2, 10), 81], [row(3, 3, 30), 81]]))!
  assert.equal(f.cars[1].owes, true)
  assert.equal(f.cars[1].stop, 10 + Math.round((62 - 9) / 2) - 1)
  assert.deepEqual(f.cars[1].rejoin, { pos: 2, ahead: 2, gapAhead: 12, behind: 3, gapBehind: 8 })
  assert.equal(f.events.find((e) => e.kind === 'pit')?.n, 1)
})

test('a 5 s penalty with no stop left to serve it at is added at the flag', () => {
  const f = forecast(race([[{ ...row(1, 1, 0), lap: 68, penalty: '+5s' }, 81], [{ ...row(2, 2, 3), lap: 68 }, 81]]))!
  assert.deepEqual(f.events.find((e) => e.kind === 'penalty'), { lap: 71, kind: 'penalty', n: 1, pos: 2, lost: 1, what: '+5s' })
  assert.equal(f.events.some((e) => e.kind === 'pass'), false)
  assert.deepEqual([f.cars[1].finish, f.cars[2].finish], [2, 1])
})
