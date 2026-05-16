import DissertationTab from './dissertation/DissertationTab'
import JobsTab from './jobs/JobsTab'
import LearningTab from './learning/LearningTab'
import ThinkersTab from './thinkers/ThinkersTab'

// listUrl is the GET endpoint that returns this tab's full item list. The
// landing page hits all of these in parallel to compute aggregate progress
// (unless progress: false, used for tabs whose items don't have a done state).
export const tabs = [
  {
    name: 'Dissertation',
    icon: '📚',
    path: '/dissertation',
    listUrl: '/api/dissertation/tasks',
    Component: DissertationTab,
  },
  {
    name: 'Jobs',
    icon: '💼',
    path: '/jobs',
    listUrl: '/api/jobs/applications',
    Component: JobsTab,
  },
  {
    name: 'Thinkers',
    icon: 'ti-bulb',
    path: '/thinkers',
    listUrl: '/api/thinkers/entries',
    Component: ThinkersTab,
    progress: false as const,
  },
  {
    name: 'Learning',
    icon: 'ti-stack-2',
    path: '/learning',
    listUrl: '/api/learning/items',
    Component: LearningTab,
  },
]
