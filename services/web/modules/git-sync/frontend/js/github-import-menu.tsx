import getMeta from '@/utils/meta'
import { DropdownItem } from '@/shared/components/dropdown/dropdown-menu'
import { useTranslation } from 'react-i18next'

export default function GithubImportMenu({
  onClick,
}: {
  onClick: (event: React.MouseEvent) => void
}) {
  const { t } = useTranslation()
  if (!getMeta('ol-ExposedSettings').enableGitSync) return null
  return (
    <DropdownItem as="button" onClick={onClick}>
      {t('import_from_github')}
    </DropdownItem>
  )
}
