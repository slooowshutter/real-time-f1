# Pitwall

Live Formula 1 dashboard on [OpenF1](https://openf1.org): timing tower, track map, gap chart, race control, team radio with transcripts, car telemetry and the championship. You can scrub to any moment of any session and replay it at up to 32×.

```
OpenF1 MQTT ──► worker (pnpm worker) ──► Redis ──pub/sub──► Next.js ──SSE──► browser
                 batches every 50 ms      log per        stateAt(t)      patches only
                                          session/topic
```

- **One engine for live and replay.** `lib/state.ts` computes the whole dashboard from a session's event log at an instant `t`. Live means `t = now`; replay and scrubbing use any other `t`. Lap and sector times only appear once the car has crossed that line at `t`.
- **Latency.** OpenF1 runs about 3 s behind the track. Pitwall adds the 50 ms batch window, two Redis hops and one SSE push, typically 50 to 300 ms with Upstash. The header shows both numbers live.
- **Championship.** The Standings page shows the drivers' and constructors' tables, points per round and running totals as of the session on screen. A race or sprint in progress is scored as it stands at `t`, and its official result (with the stewards' later decisions) replaces that 4 hours after the start.
- **Team radio.** OpenF1 only links each clip's MP3, and in-car audio is too noisy for any one speech-to-text model. ElevenLabs Scribe, Mistral Voxtral and Groq Whisper each transcribe the clip, then Gemini Pro listens to it, reads their three versions and the race situation at that moment (position, gaps, race control, the driver's earlier radio), and writes what was said, split between driver and engineer, with "inaudible" where nobody can tell. Live, the clip plays at once and its words follow 10 to 15 s later; past sessions are transcribed the first time they are opened, newest first. About 2 cents a clip. With only some keys it uses what it has: without Gemini, Scribe's text alone; with none, the clips play without text.
- **Past sessions** are pulled once from the OpenF1 REST API, then stay in Redis. Laps, positions and race control are kept forever. Car position and telemetry (about 60 MB per race) expire after 14 days and are fetched again when needed. The first open of a race takes about 2 minutes on the free tier (30 requests/min), and the tower fills in within the first ~20 seconds.

## Run

```bash
cp .env.example .env.local   # Upstash URL, OpenF1 credentials, team radio keys
pnpm install
pnpm dev                     # http://localhost:3000 opens the live or latest session
pnpm worker                  # live ingest; leave it running 24/7
pnpm test                    # stateAt self-check
```

Live data needs the OpenF1 sponsor tier (€9.90/month). While any session is live, OpenF1 also locks its free API (past sessions included) until 30 minutes after the session ends.

## Deploy

Both processes need a long-lived Node host (Railway, Fly.io, a VPS): `pnpm build && pnpm start` and `pnpm worker`. On Vercel, the web app works with SSE on Fluid compute, but the worker has to run somewhere else. Behind nginx, turn proxy buffering off for `/api/stream`.

## Redis layout

| Key | Contents |
| --- | --- |
| `f1:<session>:<topic>` | List of chunks, newline-joined events (append-only log) |
| `f1:<session>:info` | Session and meeting names |
| `f1:<session>:radio_turns` | Team radio transcripts: recording URL → `[{ speaker, text }]` (`[]` = no speech) |
| `f1:sessions:<year>` | Session picker cache (1 h) |
| `f1:standings:<year>` | Championship totals after every race and sprint (10 min, kept for good once the season is over) |
| `f1:live` | Session the worker is streaming (expires 2 min after the last message) |
| channel `f1:<session>` | Live batches `{ at, src, d: [topic, lines][] }`, transcripts as `{ radio: [url, text][] }` |

Keyboard: <kbd>Space</kbd> play/pause, <kbd>←</kbd>/<kbd>→</kbd> seek 10 s, with <kbd>Shift</kbd> 60 s.
