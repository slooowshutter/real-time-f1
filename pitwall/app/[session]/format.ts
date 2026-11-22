import type { Color, Status } from '@/lib/state'

export const lapTime = (v: number | null | undefined) => {
  if (v == null) return ''
  const m = Math.floor(v / 60)
  const s = (v - m * 60).toFixed(3)
  return m ? `${m}:${s.padStart(6, '0')}` : s
}

export const gap = (v: number | string | null | undefined) =>
  v == null ? '' : typeof v === 'number' ? `+${v.toFixed(3)}` : v

export const clockTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

export const duration = (ms: number) => {
  const neg = ms < 0
  const s = Math.floor(Math.abs(ms) / 1000)
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${neg ? '−' : ''}${h ? `${h}:` : ''}${mm}:${ss}`
}

// Purple and green carry meaning; everything else stays chalk so the tower isn't a wall of yellow.
export const timingClass: Record<Color, string> = { p: 'text-overall', g: 'text-personal', y: 'text-chalk' }

export const compound: Record<string, { letter: string; color: string; name: string }> = {
  SOFT: { letter: 'S', color: 'var(--color-soft)', name: 'Soft' },
  MEDIUM: { letter: 'M', color: 'var(--color-medium)', name: 'Medium' },
  HARD: { letter: 'H', color: 'var(--color-hard)', name: 'Hard' },
  INTERMEDIATE: { letter: 'I', color: 'var(--color-inter)', name: 'Intermediate' },
  WET: { letter: 'W', color: 'var(--color-wet)', name: 'Wet' },
}
export const tyreOf = (c: string) => compound[c] ?? { letter: '?', color: 'var(--color-dim)', name: 'Unknown' }

export const statusLook: Record<Status, { label: string; color: string } | null> = {
  none: null,
  green: { label: 'Green flag', color: 'var(--color-flag-green)' },
  yellow: { label: 'Yellow flag', color: 'var(--color-flag-yellow)' },
  sc: { label: 'Safety car', color: 'var(--color-flag-sc)' },
  'sc-ending': { label: 'Safety car in this lap', color: 'var(--color-flag-sc)' },
  vsc: { label: 'Virtual safety car', color: 'var(--color-flag-sc)' },
  'vsc-ending': { label: 'VSC ending', color: 'var(--color-flag-sc)' },
  red: { label: 'Red flag', color: 'var(--color-flag-red)' },
  chequered: { label: 'Chequered flag', color: 'var(--color-chalk)' },
}

export const flagColor = (flag: string | null) => {
  if (!flag) return undefined
  if (flag.includes('YELLOW')) return 'var(--color-flag-yellow)'
  if (flag === 'GREEN' || flag === 'CLEAR') return 'var(--color-flag-green)'
  if (flag === 'RED') return 'var(--color-flag-red)'
  if (flag === 'BLUE') return 'var(--color-wet)'
  if (flag === 'CHEQUERED') return 'var(--color-chalk)'
  return 'var(--color-fog)' // black and white, black, etc.
}
