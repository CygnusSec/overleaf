import { useEffect } from 'react'
import {
  ProjectListProvider,
  useProjectListContext,
} from '../context/project-list-context'
import { SplitTestProvider } from '@/shared/context/split-test-context'
import { ColorPickerProvider } from '../context/color-picker-context'
import * as eventTracking from '../../../infrastructure/event-tracking'
import { useTranslation } from 'react-i18next'
import useWaitForI18n from '../../../shared/hooks/use-wait-for-i18n'
import LoadingBranded from '../../../shared/components/loading-branded'
import withErrorBoundary from '../../../infrastructure/error-boundary'
import { GenericErrorBoundaryFallback } from '@/shared/components/generic-error-boundary-fallback'
import { ProjectListDsNav } from '@/features/project-list/components/project-list-ds-nav'
import { DsNavStyleProvider } from '@/features/project-list/components/use-is-ds-nav'
import useThemedPage from '@/shared/hooks/use-themed-page'
import { UserSettingsProvider } from '@/shared/context/user-settings-context'
import { TutorialProvider } from '@/shared/context/tutorial-context'

function ProjectListRoot() {
  const { isReady } = useWaitForI18n()

  if (!isReady) {
    return null
  }

  return <ProjectListRootInner />
}

export function ProjectListRootInner() {
  return (
    <ProjectListProvider>
      <ColorPickerProvider>
        <SplitTestProvider>
          <TutorialProvider>
            <UserSettingsProvider>
              <ProjectListPageContent />
            </UserSettingsProvider>
          </TutorialProvider>
        </SplitTestProvider>
      </ColorPickerProvider>
    </ProjectListProvider>
  )
}

function ProjectListPageContent() {
  useThemedPage()
  const { isLoading, loadProgress } = useProjectListContext()

  useEffect(() => {
    eventTracking.sendMB('loads_v2_dash', { page: 'projects' })
  }, [])

  const { t } = useTranslation()

  if (isLoading) {
    const loadingComponent = (
      <LoadingBranded loadProgress={loadProgress} label={t('loading')} />
    )

    return loadingComponent
  }

  return (
    <DsNavStyleProvider>
      <ProjectListDsNav />
    </DsNavStyleProvider>
  )
}

export default withErrorBoundary(ProjectListRoot, () => (
  <GenericErrorBoundaryFallback />
))
