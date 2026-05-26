import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import ContactForm from '../components/ContactForm'
import { formatDate } from '../utils/format'
import { apiFetch } from '../utils/api'
import styles from './Contacts.module.css'

export default function Contacts() {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const navigate = useNavigate()

  function load() {
    setLoading(true)
    apiFetch('/api/contacts')
      .then(r => r.json())
      .then(data => { setContacts(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => { setError('Failed to load contacts'); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  return (
    <div className={styles.page}>
      <PageHeader
        title="Contacts"
        action={
          <button className={styles.btnNew} onClick={() => setShowModal(true)}>+ New Contact</button>
        }
      />
      <div className={styles.content}>
        {loading && <div className={styles.state}>Loading…</div>}
        {error && <div className={`${styles.state} ${styles.err}`}>{error}</div>}
        {!loading && !error && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Organisation</th>
                  <th>Tickets</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {contacts.length === 0 && (
                  <tr><td colSpan={5} className={styles.empty}>No contacts yet.</td></tr>
                )}
                {contacts.map(c => (
                  <tr key={c.id} className={styles.row} onClick={() => navigate(`/contacts/${c.id}`)}>
                    <td className={styles.name}>{c.full_name}</td>
                    <td className={styles.email}>{c.email}</td>
                    <td>{c.organisation_name ?? <span className={styles.none}>—</span>}</td>
                    <td className={styles.count}>{c.ticket_count}</td>
                    <td className={styles.muted}>{formatDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <NewContactModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); load() }}
        />
      )}
    </div>
  )
}

// ─── New Contact Modal ────────────────────────────────────────────────────────

function NewContactModal({ onClose, onCreated }) {
  const [organisations, setOrganisations] = useState([])

  useEffect(() => {
    apiFetch('/api/organisations')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setOrganisations(d) })
      .catch(() => {}) // silently ignore — user can still create contact without org list
  }, [])

  return (
    <Modal title="New Contact" onClose={onClose}>
      <ContactForm
        organisations={organisations}
        onOrgsUpdated={setOrganisations}
        onCreated={onCreated}
        onBack={null}
      />
    </Modal>
  )
}
