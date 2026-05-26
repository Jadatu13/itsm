import Modal from './Modal'
import styles from './ConfirmModal.module.css'

export default function ConfirmModal({
  title = 'Are you sure?',
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
  onClose,
}) {
  return (
    <Modal title={title} onClose={onClose}>
      {message && <p className={styles.message}>{message}</p>}
      <div className={styles.actions}>
        <button className={styles.btnCancel} onClick={onClose}>{cancelLabel}</button>
        <button
          className={danger ? styles.btnDanger : styles.btnConfirm}
          onClick={() => { onConfirm(); onClose() }}
          autoFocus
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
