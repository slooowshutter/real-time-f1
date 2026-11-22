'use client'

import { useEffect, useRef, useState } from 'react'

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="grid h-full min-h-32 place-items-center p-6 text-center text-sm text-fog">{children}</p>
}

export function useSize<T extends Element>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}
