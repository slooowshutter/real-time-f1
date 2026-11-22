import type { NextRequest } from 'next/server'
import { seasonParam } from '@/lib/openf1'
import { sessionsOf } from '@/lib/redis'

export async function GET(req: NextRequest) {
  const year = seasonParam(req.nextUrl.searchParams.get('year'))
  if (year == null) return new Response('year must be a season from 2023 to now', { status: 400 })
  try {
    return Response.json(await sessionsOf(year))
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 })
  }
}
