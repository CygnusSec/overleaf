import { useCallback } from 'react'
import _ from 'lodash'
import { saveUserSettings } from '../utils/api'
import { UserSettings } from '../../../../../types/user-settings'
import { useUserSettingsContext } from '@/shared/context/user-settings-context'
import getMeta from '@/utils/meta'
import {
  applyOverallTheme,
  persistOverallTheme,
} from '@/shared/utils/overall-theme'

export default function useSetOverallTheme() {
  const { userSettings, setUserSettings } = useUserSettingsContext()
  const { overallTheme } = userSettings

  const setOverallTheme = useCallback(
    (overallTheme: UserSettings['overallTheme']) => {
      setUserSettings(settings => ({ ...settings, overallTheme }))
    },
    [setUserSettings]
  )

  return useCallback(
    (newOverallTheme: UserSettings['overallTheme']) => {
      if (overallTheme !== newOverallTheme) {
        const chosenTheme = _.find(
          getMeta('ol-overallThemes'),
          theme => theme.val === newOverallTheme
        )

        if (chosenTheme) {
          const prefersDark =
            window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? true
          const isDark =
            newOverallTheme === '' ||
            (newOverallTheme === 'system' && prefersDark)

          persistOverallTheme(newOverallTheme)
          applyOverallTheme(isDark ? 'dark' : 'light')
          setOverallTheme(newOverallTheme)
          saveUserSettings('overallTheme', newOverallTheme)
        }
      }
    },
    [overallTheme, setOverallTheme]
  )
}
