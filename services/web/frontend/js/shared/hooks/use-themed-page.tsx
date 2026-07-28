import { useLayoutEffect } from 'react'
import { useActiveOverallTheme } from './use-active-overall-theme'
import { useUserSettingsContext } from '@/shared/context/user-settings-context'
import {
  applyOverallTheme,
  persistOverallTheme,
} from '@/shared/utils/overall-theme'

export default function useThemedPage(featureFlag?: string) {
  const activeOverallTheme = useActiveOverallTheme(featureFlag)
  const {
    userSettings: { overallTheme },
  } = useUserSettingsContext()

  useLayoutEffect(() => {
    applyOverallTheme(activeOverallTheme)
    persistOverallTheme(overallTheme)
  }, [activeOverallTheme, overallTheme])
}
