import { useEffect, useState } from 'react'

function matches(query: string): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(query).matches
  }
  const minWidth = query.match(/min-width:\s*(\d+)px/)
  return minWidth ? window.innerWidth >= Number(minWidth[1]) : false
}

export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query))

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(query)
    const update = () => setValue(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])

  return value
}
