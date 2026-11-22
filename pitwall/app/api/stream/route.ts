import type { NextRequest } from 'next/server'
import { stateAt } from '@/lib/state'
import { closeStore, openStore } from '@/lib/store'

// Server-Sent Events. Each message is a patch: only the top-level State sections that changed.
//   ?session=<sk>                 live edge (past sessions: final classification, paused)
//   ?session=<sk>&t=<ms>&speed=n  replay from t at n× (0 = paused at t)
//   ?session=<sk>&delay=<ms>      live, held a fixed distance behind (synced to a TV broadcast)

const FRAME = 100 // steady 10 fps so motion is even; the client tweens over the same interval
const MIN_GAP = 80 // floor between pushes when paused and data trickles in

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const sk = Number(q.get('session'))
  if (!Number.isInteger(sk) || sk <= 0) return new Response('session must be a session_key', { status: 400 })
  let t = q.has('t') ? Number(q.get('t')) : undefined // undefined = follow the live edge
  let rate = Math.min(Math.max(Number(q.get('speed') ?? 1) || 0, 0), 64)
  const delay = q.has('delay') ? Math.max(0, Number(q.get('delay')) || 0) : undefined
  if (delay !== undefined) rate = 1

  const store = openStore(sk)
  if (!store) return new Response('Too many sessions open at once, try again in a minute', { status: 503 })
  const enc = new TextEncoder()
  let stop = () => {}

  const body = new ReadableStream({
    start(ctl) {
      const prev: Record<string, string> = {}
      let wall = Date.now()
      let last = 0
      let pending: ReturnType<typeof setTimeout> | undefined
      let closed = false
      let ready = false
      const send = (chunk: string) => !closed && ctl.enqueue(enc.encode(chunk))

      const push = () => {
        pending = undefined
        last = Date.now()
        if (!ready || !store.info) {
          if (store.error) send(`data: ${JSON.stringify({ meta: { sk, error: store.error } })}\n\n`)
          return
        }
        try {
          const now = Date.now()
          if (delay !== undefined) t = now - delay
          else if (t === undefined && !store.live) {
            t = store.last || Date.parse(store.info.date_end) // past session: open on the result
            rate = 0
          } else if (t !== undefined) t += (now - wall) * rate
          wall = now
          const s =
            t === undefined
              ? stateAt(store, Math.max(now, store.last), now - store.carDelay) // timing is instant, cars are smoothed
              : stateAt(store, t)
          if (delay === undefined && t !== undefined && rate && t >= s.clock.edge) {
            if (store.live) t = undefined // caught up with the race: go live
            else [t, rate] = [s.clock.edge, 0]
          }
          const patch: Record<string, unknown> = {}
          for (const [k, v] of Object.entries({ ...s, play: { live: t === undefined, rate, delay } })) {
            const j = JSON.stringify(v)
            if (j !== prev[k]) patch[k] = v
            prev[k] = j
          }
          if (Object.keys(patch).length) send(`data: ${JSON.stringify(patch)}\n\n`)
        } catch (e) {
          console.error('stream', e)
          send(`data: ${JSON.stringify({ meta: { sk, error: (e as Error).message } })}\n\n`)
        }
      }
      const playing = () => t === undefined || rate > 0
      // While playing, the frame clock carries everything; extra pushes on data arrival would make motion uneven.
      const schedule = () => void (playing() || (pending ??= setTimeout(push, Math.max(0, MIN_GAP - (Date.now() - last)))))

      store.listeners.add(schedule)
      store.ready.then(() => {
        ready = true
        wall = Date.now()
        push()
      })
      const frame = setInterval(() => playing() && push(), FRAME)
      const ping = setInterval(() => send(': ping\n\n'), 15_000)
      stop = () => {
        if (closed) return
        closed = true
        clearInterval(frame)
        clearInterval(ping)
        clearTimeout(pending)
        store.listeners.delete(schedule)
        closeStore(store)
      }
      req.signal.addEventListener('abort', () => {
        stop()
        try {
          ctl.close()
        } catch {}
      })
    },
    cancel: () => stop(),
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
