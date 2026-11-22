// pnpm test: stateAt never reveals what hasn't happened yet at t.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { seasonParam } from './openf1'
import { situation } from './radio'
import { stateAt } from './state'
import { Store } from './store'

const T0 = Date.parse('2026-11-01T20:00:00Z')
const iso = (s: number) => new Date(T0 + s * 1000).toISOString()

function race() {
  const s = new Store(1)
  s.info = {
    session_key: 1, meeting_key: 1, session_name: 'Race', session_type: 'Race', date_start: iso(0),
    date_end: iso(7200), circuit_short_name: 'Mexico City', country_name: 'Mexico', location: 'Mexico City', year: 2026,
  }
  const add = (topic: Parameters<Store['add']>[0], e: object) => s.add(topic, JSON.stringify(e))
  add('drivers', { driver_number: 1, name_acronym: 'VER', team_colour: '3671C6' })
  add('drivers', { driver_number: 44, name_acronym: 'HAM', team_colour: 'E8002D' })
  const lap = (d: number, n: number, start: number, s1: number, s2: number, s3: number) =>
    add('laps', {
      driver_number: d, lap_number: n, date_start: iso(start), lap_duration: s1 + s2 + s3,
      duration_sector_1: s1, duration_sector_2: s2, duration_sector_3: s3,
    })
  lap(1, 1, 0, 30, 30, 30)
  lap(1, 2, 90, 29, 30, 30)
  lap(44, 1, 0, 30.5, 30, 30.5)
  lap(44, 2, 91, 30, 30, 30)
  add('stints', { driver_number: 1, stint_number: 1, compound: 'SOFT', lap_start: 1, lap_end: 2, tyre_age_at_start: 0 })
  add('position', { driver_number: 1, position: 1, date: iso(-60) })
  add('position', { driver_number: 44, position: 2, date: iso(-60) })
  add('race_control', { category: 'SafetyCar', message: 'SAFETY CAR DEPLOYED', date: iso(50) })
  add('race_control', { category: 'Flag', flag: 'CLEAR', scope: 'Track', message: 'TRACK CLEAR', date: iso(100) })
  add('location', [T0, 1, 0, 100])
  s.add('location', JSON.stringify([T0 + 1000, 1, 100, 100]))
  return s
}

test('mid-lap: only completed sectors are visible', () => {
  const st = stateAt(race(), T0 + 45_000)
  const ver = st.tower.find((r) => r.n === 1)!
  assert.equal(ver.lap, 1)
  assert.equal(ver.last, null)
  assert.deepEqual(ver.sectors, [{ v: 30, c: 'p' }, null, null])
  assert.equal(st.clock.status, 'none')
})

test('after the line: last lap, colours, gap history, tyre age, safety car', () => {
  const st = stateAt(race(), T0 + 92_000)
  const [ver, ham] = st.tower
  assert.equal(ver.code, 'VER')
  assert.deepEqual(ver.last, { v: 90, c: 'p' })
  assert.deepEqual(ham.last, { v: 91, c: 'g' })
  assert.deepEqual(ver.sectors, [{ v: 30, c: 'p' }, { v: 30, c: 'p' }, { v: 30, c: 'p' }]) // lap 2 has no sector yet
  assert.deepEqual(ver.tyre, { compound: 'SOFT', age: 1, fresh: true })
  assert.deepEqual(st.history.series[44], [1])
  assert.equal(st.clock.status, 'sc')
  assert.equal(stateAt(race(), T0 + 101_000).clock.status, 'green')
})

test('car position is interpolated between samples', () => {
  assert.deepEqual(stateAt(race(), T0 + 500).cars[1].xy, [50, 100])
})

test('qualifying: a green light after a chequered flag reopens the session', () => {
  const s = race()
  s.add('race_control', JSON.stringify({ category: 'Flag', flag: 'CHEQUERED', scope: 'Track', message: 'CHEQUERED FLAG', date: iso(200) }))
  s.add('race_control', JSON.stringify({ category: 'Flag', flag: 'GREEN', scope: 'Track', message: 'GREEN LIGHT - PIT EXIT OPEN', date: iso(300) }))
  assert.equal(stateAt(s, T0 + 250_000).clock.status, 'chequered')
  assert.equal(stateAt(s, T0 + 301_000).clock.status, 'green')
})

test('MQTT dates without an offset are UTC', () => {
  const s = race()
  s.add('race_control', JSON.stringify({ category: 'Flag', flag: 'RED', scope: 'Track', message: 'RED FLAG', date: iso(400).replace('Z', '') }))
  assert.equal(stateAt(s, T0 + 401_000).clock.status, 'red')
})

test('a car that stops starting laps is out of the race and off the map', () => {
  const s = race()
  s.add('laps', JSON.stringify({ driver_number: 1, lap_number: 5, date_start: iso(400) }))
  s.add('location', JSON.stringify([T0 + 399_000, 44, 10, 10]))
  const st = stateAt(s, T0 + 400_000)
  assert.equal(st.tower.find((r) => r.n === 44)!.out, true)
  assert.equal(st.tower.at(-1)!.n, 44)
  assert.equal(st.cars[44], undefined)
  assert.equal(stateAt(s, T0 + 92_000).tower.find((r) => r.n === 44)!.out, false)
})

test('stewards: investigation, then a time penalty, then served', () => {
  const s = race()
  const rc = (sec: number, message: string) => s.add('race_control', JSON.stringify({ category: 'Other', message, date: iso(sec) }))
  rc(10, 'FIA STEWARDS: TURN 6 INCIDENT INVOLVING CAR 44 (HAM) UNDER INVESTIGATION - CAUSING A COLLISION')
  rc(20, 'FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 44 (HAM) - CAUSING A COLLISION')
  rc(30, 'FIA STEWARDS: PENALTY SERVED - 5 SECOND TIME PENALTY FOR CAR 44 (HAM) (14:03:57)')
  const ham = (sec: number) => stateAt(s, T0 + sec * 1000).tower.find((r) => r.n === 44)!
  assert.deepEqual([ham(15).investigated, ham(15).penalty], [true, null])
  assert.deepEqual([ham(25).investigated, ham(25).penalty], [false, '+5s'])
  assert.equal(ham(35).penalty, null)
})

test('tyres: stints end at t, a stop shows before its stint data, neutralised laps', () => {
  const s = race()
  const add = (topic: Parameters<Store['add']>[0], e: object) => s.add(topic, JSON.stringify(e))
  const lap = (d: number, n: number, start: number) =>
    add('laps', { driver_number: d, lap_number: n, date_start: iso(start), lap_duration: 90, duration_sector_1: 30, duration_sector_2: 30, duration_sector_3: 30 })
  lap(1, 3, 180)
  lap(1, 4, 270)
  lap(44, 3, 182)
  add('stints', { driver_number: 1, stint_number: 2, compound: 'MEDIUM', lap_start: 3, lap_end: 4, tyre_age_at_start: 0 })
  add('stints', { driver_number: 44, stint_number: 1, compound: 'HARD', lap_start: 1, lap_end: 2, tyre_age_at_start: 2 })
  add('pit', { driver_number: 1, lap_number: 2, lane_duration: 22.5, date: iso(170) })
  add('pit', { driver_number: 44, lap_number: 2, lane_duration: 23.1, date: iso(172) }) // its next stint hasn't arrived
  add('race_control', { category: 'SafetyCar', message: 'VSC DEPLOYED', lap_number: 3, date: iso(190) })
  add('race_control', { category: 'Other', message: 'RED FLAG - RACE SUSPENDED', lap_number: 4, date: iso(280) })

  assert.deepEqual(stateAt(s, T0 + 150_000).tyres.stints[1], [{ c: 'SOFT', from: 1, to: 2, age: 0, pit: null }])
  const st = stateAt(s, T0 + 300_000)
  assert.equal(st.clock.status, 'red')
  assert.deepEqual(st.tyres.stints[1], [
    { c: 'SOFT', from: 1, to: 2, age: 0, pit: 22.5 },
    { c: 'MEDIUM', from: 3, to: 4, age: 0, pit: null },
  ])
  assert.deepEqual(st.tyres.stints[44], [
    { c: 'HARD', from: 1, to: 2, age: 2, pit: 23.1 },
    { c: 'UNKNOWN', from: 3, to: 3, age: null, pit: null },
  ])
  assert.deepEqual(st.tyres.neutral, [
    { kind: 'sc', from: 1, to: 2 },
    { kind: 'vsc', from: 3, to: 3 },
    { kind: 'red', from: 4, to: 4 },
  ])
})

test('team radio: clips sent by t, newest first, with the transcript once it is back', () => {
  const s = race()
  s.add('team_radio', JSON.stringify({ driver_number: 44, recording_url: 'ham.mp3', date: iso(95) }))
  s.add('team_radio', JSON.stringify({ driver_number: 1, recording_url: 'ver.mp3', date: iso(40) }))
  s.ingest({ at: 0, src: 0, d: [], radio: [['ham.mp3', [{ speaker: 'engineer', text: 'Box, box.' }]]] })
  assert.deepEqual(stateAt(s, T0 + 60_000).radio.map((r) => r.url), ['ver.mp3'])
  const [ham, ver] = stateAt(s, T0 + 100_000).radio
  assert.deepEqual([ham.code, ham.lap, ham.turns], ['HAM', 2, [{ speaker: 'engineer', text: 'Box, box.' }]])
  assert.deepEqual([ver.code, ver.lap, ver.turns], ['VER', 1, undefined])
})

test('radio situation: what Gemini is told is what was known when the clip was sent', () => {
  const s = race()
  s.add('drivers', JSON.stringify({ driver_number: 44, first_name: 'Lewis', last_name: 'Hamilton', team_name: 'Ferrari' }))
  s.add('team_radio', JSON.stringify({ driver_number: 44, recording_url: 'a.mp3', date: iso(60) }))
  s.add('team_radio', JSON.stringify({ driver_number: 44, recording_url: 'b.mp3', date: iso(95) }))
  s.ingest({ at: 0, src: 0, d: [], radio: [['a.mp3', [{ speaker: 'driver', text: 'Tyres are gone.' }]]] })
  const text = situation(s, s.radio[1])
  assert.match(text, /Race, lap 2, safety car\./)
  assert.match(text, /Lewis Hamilton drives car 44 for Ferrari, running P2\./)
  assert.match(text, /Car ahead: car 1\./)
  assert.match(text, /SAFETY CAR DEPLOYED/)
  assert.doesNotMatch(text, /TRACK CLEAR/) // sent 5 s later
  assert.match(text, /driver: Tyres are gone\./)
})

test('season param: current year by default, 2023 to now only', () => {
  const now = new Date().getUTCFullYear()
  assert.deepEqual([seasonParam(null), seasonParam('2023'), seasonParam(String(now))], [now, 2023, now])
  for (const bad of ['2022', String(now + 1), '2024.5', 'abc', '', '1e9']) assert.equal(seasonParam(bad), null, bad)
})
