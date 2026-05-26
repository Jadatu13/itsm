import styles from './PageHeader.module.css'

export default function PageHeader({ title, action }) {
  return (
    <div className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}
