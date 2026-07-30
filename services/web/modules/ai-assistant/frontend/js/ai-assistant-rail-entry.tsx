import getMeta from '@/utils/meta'
import { RailElement } from '@/features/ide-react/util/rail-types'
import AiAssistantPanel from './ai-assistant-panel'

const aiAssistantRailEntry: RailElement = {
  key: 'ai-assistant',
  icon: 'smart_toy',
  title: 'AI Assistant',
  component: <AiAssistantPanel />,
  hide: () => !getMeta('ol-aiAssistantEnabled'),
}

export default aiAssistantRailEntry
