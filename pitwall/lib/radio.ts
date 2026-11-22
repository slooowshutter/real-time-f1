import { channel, key, redis } from './redis'
import { stateAt, type Status } from './state'
import type { Radio, Store } from './store'

// Team radio comes from OpenF1 as an MP3 link only, and in-car audio is noisy enough that every
// speech-to-text model mishears it, each in its own way. So three of them transcribe each clip
// (ElevenLabs Scribe, Mistral Voxtral, Groq Whisper), then Gemini Pro listens to it, reads their
// versions and the race situation at that moment, and writes what was said turn by turn, with
// [inaudible] where nobody can tell. On 63 clips from Austin and Mexico 2026 it fixed what no single
// model got ("We did it", not "We need it"; "I've seen the cord on the tyre" during Leclerc's flat
// spot). Gemini alone is no substitute: on silent clips it invents whole lines, and the three
// transcripts are what stop it. 10 to 15 s and 2 cents a clip; the clip itself plays at once.
// Transcripts: a hash per session (url → turns, [] = no speech), announced on the session channel.
// The worker transcribes live sessions; the web server does past ones the worker never heard.

export type Turn = { speaker: 'driver' | 'engineer' | null; text: string } // null: no Gemini to tell who speaks

const env = process.env
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const busy = new Set<string>() // ponytail: per process; the worker and the web server could each do one clip, costing 2 cents

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}
async function retry<T>(f: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await f()
    } catch (e) {
      if (i >= tries) throw e
      await sleep(2000 * i) // mostly 429s (concurrency caps on smaller plans) and network blips
    }
  }
}
const upload = (audio: Blob, fields: Record<string, string | string[]>) => {
  const form = new FormData()
  form.set('file', audio, 'radio.mp3')
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) form.append(k, x)
  return form
}

// Forced to English: auto-detection calls noisy clips Korean or French, and radio is in English.
const EARS: { key: string; hear: (audio: Blob, names: string[]) => Promise<string> }[] = [
  {
    key: 'ELEVENLABS_API_KEY',
    hear: async (audio, names) => {
      const body = upload(audio, { model_id: 'scribe_v2', language_code: 'en', no_verbatim: 'true', tag_audio_events: 'false', keyterms: names })
      return (await call('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY! }, body })).text
    },
  },
  {
    key: 'MISTRAL_API_KEY',
    hear: async (audio) => {
      const body = upload(audio, { model: 'voxtral-small-transcribe-3', language: 'en' })
      return (await call('https://api.mistral.ai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${env.MISTRAL_API_KEY}` }, body })).text
    },
  },
  {
    key: 'GROQ_API_KEY',
    hear: async (audio) => {
      const body = upload(audio, { model: 'whisper-large-v3', language: 'en' })
      return (await call('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` }, body })).text
    },
  },
]

const STATUS: Partial<Record<Status, string>> = {
  yellow: 'yellow flag', sc: 'safety car', 'sc-ending': 'safety car in this lap', vsc: 'virtual safety car',
  'vsc-ending': 'VSC ending', red: 'red flag', chequered: 'chequered flag',
}

/** What was going on when the clip was sent, for Gemini to settle names, positions and racing terms. */
export function situation(s: Store, c: Radio) {
  const st = stateAt(s, c.t)
  const name = (n: number) => {
    const d = s.drivers.get(n)
    return d?.first_name && d.last_name ? `${d.first_name} ${d.last_name}` : (d?.full_name ?? `car ${n}`)
  }
  const gap = (v: number | string | null) => (typeof v === 'number' ? `${v.toFixed(1)} s` : v)
  const i = st.tower.findIndex((r) => r.n === c.driver_number)
  const [ahead, me, behind] = [st.tower[i - 1], st.tower[i], st.tower[i + 1]]
  const rc = st.rc.filter((m) => c.t - m.t < 15 * 60_000).slice(0, 6).reverse()
  const earlier = st.radio.filter((r) => r.n === c.driver_number && r.t < c.t && r.turns?.length).slice(0, 3).reverse()
  return [
    `- ${st.meta.meeting} ${st.meta.year}, ${st.meta.name}${st.clock.lap ? `, lap ${st.clock.lap}` : ''}${STATUS[st.clock.status] ? `, ${STATUS[st.clock.status]}` : ''}.`,
    me && `- ${name(me.n)} drives car ${me.n} for ${me.team || 'their team'}${me.pos ? `, running P${me.pos}` : ''}${me.tyre ? ` on ${me.tyre.age}-lap-old ${me.tyre.compound.toLowerCase()}s` : ''}.`,
    me?.pos && ahead && `- Car ahead: ${name(ahead.n)}${st.meta.race && me.int != null ? `, ${gap(me.int)} in front` : ''}.`,
    me?.pos && behind && `- Car behind: ${name(behind.n)}${st.meta.race && behind.int != null ? `, ${gap(behind.int)} back` : ''}.`,
    rc.length && `- Recent race control messages:\n${rc.map((m) => `    ${m.message}`).join('\n')}`,
    earlier.length && `- Earlier radio from this driver:\n${earlier.map((r) => `    ${r.turns!.map((t) => `${t.speaker ?? ''}: ${t.text}`).join(' / ')}`).join('\n')}`,
    `- Drivers: ${[...s.drivers.keys()].map(name).join(', ')}.`,
  ].filter(Boolean).join('\n')
}

const SCHEMA = {
  type: 'object',
  properties: {
    turns: { type: 'array', items: { type: 'object', properties: { speaker: { type: 'string', enum: ['driver', 'engineer'] }, text: { type: 'string' } }, required: ['speaker', 'text'] } },
  },
  required: ['turns'],
}

async function fuse(s: Store, c: Radio, mp3: ArrayBuffer, heard: string[]): Promise<Turn[]> {
  const d = s.drivers.get(c.driver_number)
  const prompt = [
    `This is a Formula 1 team radio clip between ${d?.first_name ?? 'a driver'} ${d?.last_name ?? ''} and their race engineer. In-car audio is very noisy (engine, wind, radio compression), and the clip may start or end mid-sentence.`,
    `\nThe situation when it was sent:\n${situation(s, c)}`,
    `\n${heard.length} speech-to-text systems transcribed the same clip. They often mishear names and racing terms, and make up words in the noise:\n${heard.map((h, i) => `${'ABC'[i]}: "${h}"`).join('\n')}`,
    `\nListen to the audio and write exactly what was said, in English. Use the machine transcripts and the situation only to settle words you can hear but that are ambiguous (names, positions, racing terms); never add words you cannot hear. Write "[inaudible]" for any part you cannot make out instead of guessing, and "[bleep]" for a bleeped-out word. Leave out filler like "uh". Split it into turns by speaker: the engineer usually sounds clean, the driver has engine or wind noise behind them. If there is no speech at all, return no turns.`,
  ].join('\n')
  const res = await call('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent', {
    method: 'POST',
    headers: { 'x-goog-api-key': env.GEMINI_API_KEY!, 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'audio/mp3', data: Buffer.from(mp3).toString('base64') } }, { text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA },
    }),
  })
  const json = (res.candidates?.[0]?.content?.parts ?? []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? '').join('')
  return (JSON.parse(json).turns as Turn[]).filter((t) => t.text.trim())
}

async function understand(s: Store, c: Radio): Promise<Turn[]> {
  const mp3 = await retry(async () => {
    const res = await fetch(c.recording_url)
    if (!res.ok) throw new Error(`${res.status} fetching ${c.recording_url}`)
    return res.arrayBuffer()
  })
  const names = [...new Set([...s.drivers.values()].flatMap((d) => [d.first_name, d.last_name]))].filter((x): x is string => !!x).slice(0, 100)
  const heard = (
    await Promise.all(
      EARS.filter((e) => env[e.key]).map((e) =>
        retry(() => e.hear(new Blob([mp3], { type: 'audio/mpeg' }), names)).then(
          (t) => String(t ?? '').trim(),
          (err) => void console.error('transcribe', (err as Error).message),
        ),
      ),
    )
  ).filter((t) => t !== undefined)
  if (!heard.length) throw new Error(`no transcriber answered for ${c.recording_url}`) // not stored: tried again later
  if (!heard.some(Boolean)) return [] // all heard silence
  if (!env.GEMINI_API_KEY) return [{ speaker: null, text: heard[0] }]
  try {
    return await retry(() => fuse(s, c, mp3, heard))
  } catch (e) {
    console.error('transcribe: Gemini', (e as Error).message)
    return [{ speaker: null, text: heard[0] }] // Scribe's version beats nothing
  }
}

/** Transcribe the session's radio that has no transcript yet, newest first (those are on screen). */
export async function transcribe(s: Store) {
  if (!EARS.some((e) => env[e.key])) return
  await s.ready
  const done = new Set(await redis.hkeys(key(s.sk, 'radio_turns')))
  const todo = s.radio.filter((r) => !done.has(r.recording_url) && !busy.has(r.recording_url)).reverse()
  todo.forEach((r) => busy.add(r.recording_url))
  // Two clips at a time: a past race in a few minutes, under the transcribers' concurrency caps.
  await Promise.all([0, 1].map(async () => {
    for (let c; (c = todo.shift()); ) {
      try {
        const turns = await understand(s, c)
        await redis.pipeline().hset(key(s.sk, 'radio_turns'), c.recording_url, JSON.stringify(turns))
          .publish(channel(s.sk), JSON.stringify({ at: 0, src: 0, d: [], radio: [[c.recording_url, turns]] })).exec()
      } catch (e) {
        console.error('transcribe', (e as Error).message)
      } finally {
        busy.delete(c.recording_url)
      }
    }
  }))
}
