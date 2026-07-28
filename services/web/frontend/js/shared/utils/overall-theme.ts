import type { ActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import type { OverallTheme } from '@/shared/utils/styles'

export const OVERALL_THEME_STORAGE_KEY = 'overleaf.overallTheme'

export function persistOverallTheme(overallTheme: OverallTheme) {
  try {
    window.localStorage.setItem(
      OVERALL_THEME_STORAGE_KEY,
      overallTheme === '' ? 'dark' : overallTheme
    )
  } catch {
    // Theme persistence is optional when storage is unavailable.
  }
}

export function applyOverallTheme(activeOverallTheme: ActiveOverallTheme) {
  const isDark = activeOverallTheme === 'dark'
  const theme = isDark ? 'default' : 'light'
  document.documentElement.dataset.theme = theme
  document.body.dataset.theme = theme
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
}
