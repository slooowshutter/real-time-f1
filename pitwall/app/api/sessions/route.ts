import type { NextRequest } from 'next/server'
import { sessionsOf } from '@/lib/redis'

export async function GET(req: NextRequest) {
  const year = Number(req.nextUrl.searchParams.get('year')) || new Date().getUTCFullYear()
  try {
    return Response.json(await sessionsOf(year))
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 })
  }
}
