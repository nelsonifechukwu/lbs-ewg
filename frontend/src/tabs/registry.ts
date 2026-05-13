import DissertationTab from './dissertation/DissertationTab'
import JobsTab from './jobs/JobsTab'

export const tabs = [
  { name: 'Dissertation', icon: '📚', path: '/dissertation', Component: DissertationTab },
  { name: 'Jobs',         icon: '💼', path: '/jobs',         Component: JobsTab },
]
