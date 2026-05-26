import styles from './Badge.module.css'

const STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  resolved: 'Resolved',
}

const PRIORITY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export const SOURCE_OPTIONS = [
  { value: 'manual', label: 'Manual'     },
  { value: 'email',  label: 'Email'      },
  { value: 'phone',  label: 'Phone Call' },
  { value: 'walkin', label: 'Walk-in'    },
  { value: 'chat',   label: 'Chat'       },
]

const SOURCE_LABELS = Object.fromEntries(SOURCE_OPTIONS.map(o => [o.value, o.label]))

export const CATEGORY_OPTIONS = [
  { value: 'general',        label: 'General' },
  { value: 'hardware',       label: 'Hardware' },
  { value: 'software',       label: 'Software' },
  { value: 'access_request', label: 'Access Request' },
  { value: 'network',        label: 'Network' },
  { value: 'other',          label: 'Other' },
]

const CATEGORY_LABELS = Object.fromEntries(CATEGORY_OPTIONS.map(o => [o.value, o.label]))

export function StatusBadge({ status }) {
  return (
    <span className={`${styles.badge} ${styles[`status_${status}`]}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

export function PriorityBadge({ priority }) {
  return (
    <span className={`${styles.badge} ${styles[`priority_${priority}`]}`}>
      {PRIORITY_LABELS[priority] ?? priority}
    </span>
  )
}

export function SourceBadge({ source }) {
  if (!source) return null
  return (
    <span className={`${styles.badge} ${styles[`source_${source}`] ?? styles.source_manual}`}>
      {SOURCE_LABELS[source] ?? source}
    </span>
  )
}

export function CategoryBadge({ category }) {
  if (!category) return null
  return (
    <span className={`${styles.badge} ${styles[`category_${category}`] ?? styles.category_general}`}>
      {CATEGORY_LABELS[category] ?? category}
    </span>
  )
}
