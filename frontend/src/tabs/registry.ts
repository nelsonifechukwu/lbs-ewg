import DissertationTab from './dissertation/DissertationTab'
import JobsTab from './jobs/JobsTab'

// listUrl is the GET endpoint that returns this tab's full item list. The
// landing page hits all of these in parallel to compute aggregate progress.
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
]
