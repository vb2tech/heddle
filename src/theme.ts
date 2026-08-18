import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const KEY = 'orchestration.theme.v1'

function savedTheme(): Theme | null {
  const saved = localStorage.getItem(KEY)
  return saved === 'dark' || saved === 'light' ? saved : null
}

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** Theme state, persisted and reflected onto <html data-theme> for the CSS. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => savedTheme() ?? systemTheme())
  // Captured once at mount: persisting the theme below would otherwise make it
  // look as though the user had always had an explicit preference.
  const [userChose, setUserChose] = useState(() => savedTheme() !== null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(KEY, theme)
  }, [theme])

  // Follow the OS only until the user picks a theme themselves.
  useEffect(() => {
    if (userChose) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (e: MediaQueryListEvent) => setTheme(e.matches ? 'light' : 'dark')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [userChose])

  const toggle = useCallback(() => {
    setUserChose(true)
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return [theme, toggle]
}
