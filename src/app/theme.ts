/**
 * الوضع (فاتح/داكن) — يُحفظ محليًا ويُطبَّق على <html>
 */

import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'

const KEY = 'dafatar.theme'

function applyTheme(mode: ThemeMode): void {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  const dark = mode === 'dark' || (mode === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', dark)
}

function readInitial(): ThemeMode {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  } catch {
    /* ignore */
  }
  return 'system'
}

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

export const useTheme = create<ThemeState>((set) => ({
  mode: readInitial(),
  setMode: (mode) => {
    try {
      localStorage.setItem(KEY, mode)
    } catch {
      /* ignore */
    }
    applyTheme(mode)
    set({ mode })
  },
}))

if (typeof window !== 'undefined') {
  applyTheme(readInitial())
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useTheme.getState().mode === 'system') applyTheme('system')
  })
}
