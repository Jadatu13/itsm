import { useEffect, useRef, useState, useCallback } from 'react'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'
import { formatDate } from '../utils/format'
import { apiFetch } from '../utils/api'
import formStyles from '../styles/forms.module.css'
import styles from './KnowledgeBase.module.css'

// ─── Markdown → HTML converter ────────────────────────────────────────────────

function markdownToHtml(md) {
  if (!md) return ''

  // ① Protect fenced code blocks
  const codeBlocks = []
  let html = md.replace(/```[\w]*\r?\n?([\s\S]*?)```/g, (_, code) => {
    const safe = code.trim()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    codeBlocks.push(`<pre><code>${safe}</code></pre>`)
    return `%%CODEBLOCK${codeBlocks.length - 1}%%`
  })

  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" style="max-width:100%;height:auto;border-radius:6px;margin:8px 0;">')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm,  '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm,   '<h1>$1</h1>')
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g,     '<em>$1</em>')
  html = html.replace(/__(.+?)__/g,     '<u>$1</u>')
  html = html.replace(/^---+$/gm, '<hr>')

  // ② Line-by-line: lists + tables
  const lines = html.split('\n')
  const out   = []
  let inUl = false, inOl = false
  let inTable = false, tableHeaders = null, tableRows = []

  function flushTable() {
    if (!inTable) return
    const thead = tableHeaders.map(h => `<th>${h}</th>`).join('')
    const tbody = tableRows.map(r =>
      `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`
    ).join('')
    out.push(`<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`)
    inTable = false; tableHeaders = null; tableRows = []
  }

  for (const line of lines) {
    const t       = line.trim()
    const isRow   = t.startsWith('|') && t.endsWith('|') && t.length > 2
    const isSep   = isRow && /^\|[\s|:-]+\|$/.test(t)
    const ulMatch = !isRow && t.match(/^[-*] (.+)$/)
    const olMatch = !isRow && t.match(/^\d+\. (.+)$/)

    if (isSep) { continue }
    else if (isRow) {
      if (inUl) { out.push('</ul>'); inUl = false }
      if (inOl) { out.push('</ol>'); inOl = false }
      const cells = t.slice(1, -1).split('|').map(s => s.trim())
      if (!inTable) { tableHeaders = cells; tableRows = []; inTable = true }
      else          { tableRows.push(cells) }
    } else if (ulMatch) {
      flushTable()
      if (inOl) { out.push('</ol>'); inOl = false }
      if (!inUl) { out.push('<ul>'); inUl = true }
      out.push(`<li>${ulMatch[1]}</li>`)
    } else if (olMatch) {
      flushTable()
      if (inUl) { out.push('</ul>'); inUl = false }
      if (!inOl) { out.push('<ol>'); inOl = true }
      out.push(`<li>${olMatch[1]}</li>`)
    } else {
      flushTable()
      if (inUl) { out.push('</ul>'); inUl = false }
      if (inOl) { out.push('</ol>'); inOl = false }
      out.push(line)
    }
  }
  flushTable()
  if (inUl) out.push('</ul>')
  if (inOl) out.push('</ol>')
  html = out.join('\n')

  // ③ Paragraphs
  html = html.split(/\n{2,}/).map(part => {
    const t = part.trim()
    if (!t) return ''
    if (/^<(h[1-6]|ul|ol|hr|pre|table|blockquote|div)/i.test(t)) return t
    return `<p>${t.replace(/\n/g, '<br>')}</p>`
  }).join('\n')

  codeBlocks.forEach((block, i) => { html = html.replace(`%%CODEBLOCK${i}%%`, block) })
  return html
}

// ─── Table picker (insert grid) ───────────────────────────────────────────────

function TablePicker({ onInsert }) {
  const [hover, setHover] = useState({ r: 0, c: 0 })
  const SIZE = 8
  return (
    <div className={styles.tablePicker}>
      <div className={styles.tablePickerGrid}>
        {Array.from({ length: SIZE }, (_, r) => (
          <div key={r} className={styles.tablePickerRow}>
            {Array.from({ length: SIZE }, (_, c) => (
              <div
                key={c}
                className={`${styles.tablePickerCell} ${r <= hover.r && c <= hover.c ? styles.tablePickerCellOn : ''}`}
                onMouseEnter={() => setHover({ r, c })}
                onClick={() => onInsert(hover.r + 1, hover.c + 1)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className={styles.tablePickerLabel}>{hover.r + 1} × {hover.c + 1}</div>
    </div>
  )
}

// ─── Rich text editor ─────────────────────────────────────────────────────────

function RichEditor({ initialValue, onChange }) {
  const editorRef    = useRef(null)
  const initialized  = useRef(false)
  const pickerRef    = useRef(null)
  const resizingRef  = useRef(false)      // true while a col/row drag is live
  const [showImport,  setShowImport]  = useState(false)
  const [mdText,      setMdText]      = useState('')
  const [showPicker,  setShowPicker]  = useState(false)
  const [activeTable, setActiveTable] = useState(null)

  // Seed once on mount
  useEffect(() => {
    if (editorRef.current && !initialized.current) {
      editorRef.current.innerHTML = initialValue || ''
      initialized.current = true
    }
  }, [])

  // Detect cursor inside a table → show table toolbar
  useEffect(() => {
    function onSel() {
      if (!editorRef.current) return
      const sel = window.getSelection()
      if (!sel?.rangeCount) { setActiveTable(null); return }
      let node = sel.getRangeAt(0).commonAncestorContainer
      if (node.nodeType === Node.TEXT_NODE) node = node.parentNode
      while (node && node !== editorRef.current) {
        if (node.nodeName === 'TABLE') { setActiveTable(node); return }
        node = node.parentNode
      }
      setActiveTable(null)
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  // Close table picker on outside click
  useEffect(() => {
    if (!showPicker) return
    function onDown(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setShowPicker(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showPicker])

  const emit = () => onChange(editorRef.current?.innerHTML ?? '')

  // ── Column / row resize ──────────────────────────────────────────────────
  // Creates stable closures per drag session; no ref juggling needed.
  function startResize(type, cell, table, colIndex, startX, startY, startW, startH) {
    resizingRef.current = true
    if (editorRef.current) editorRef.current.style.userSelect = 'none'
    document.body.style.cursor = type === 'col' ? 'col-resize' : 'row-resize'

    function onMove(e) {
      if (type === 'col') {
        const w = Math.max(40, startW + e.clientX - startX)
        Array.from(table.rows).forEach(row => {
          const c = row.cells[colIndex]
          if (c) { c.style.width = w + 'px'; c.style.minWidth = w + 'px' }
        })
      } else {
        const tr = cell.closest('tr')
        if (tr) {
          const h = Math.max(26, startH + e.clientY - startY)
          tr.style.height = h + 'px'
          Array.from(tr.cells).forEach(c => { c.style.height = h + 'px' })
        }
      }
    }

    function onUp() {
      resizingRef.current = false
      if (editorRef.current) { editorRef.current.style.userSelect = ''; editorRef.current.style.cursor = '' }
      document.body.style.cursor = ''
      emit()
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }

  function onEditorMouseMove(e) {
    if (resizingRef.current || !editorRef.current) return
    const cell = e.target?.closest?.('td,th')
    if (!cell || !editorRef.current.contains(cell)) {
      editorRef.current.style.cursor = ''; return
    }
    const r = cell.getBoundingClientRect()
    const nearRight  = e.clientX >= r.right  - 6
    const nearBottom = e.clientY >= r.bottom - 6
    editorRef.current.style.cursor = nearRight ? 'col-resize' : nearBottom ? 'row-resize' : ''
  }

  function onEditorMouseDown(e) {
    const cell = e.target?.closest?.('td,th')
    if (!cell || !editorRef.current?.contains(cell)) return
    const r = cell.getBoundingClientRect()
    const nearRight  = e.clientX >= r.right  - 6
    const nearBottom = e.clientY >= r.bottom - 6
    if (!nearRight && !nearBottom) return
    e.preventDefault(); e.stopPropagation()
    startResize(
      nearRight ? 'col' : 'row',
      cell, cell.closest('table'), cell.cellIndex,
      e.clientX, e.clientY,
      r.width, r.height
    )
  }
  // ────────────────────────────────────────────────────────────────────────

  const exec = useCallback((cmd, arg) => {
    editorRef.current?.focus()
    document.execCommand(cmd, false, arg ?? null)
    emit()
  }, [])

  function insertDivider() {
    editorRef.current?.focus()
    document.execCommand('insertHTML', false, '<hr><p><br></p>')
    emit()
  }

  function insertLink() {
    const url = window.prompt('URL (e.g. https://example.com):')
    if (url) exec('createLink', url)
  }

  function insertImage() {
    const url = window.prompt('Image URL:')
    if (url) exec('insertImage', url)
  }

  function insertTable(rows, cols) {
    if (!editorRef.current) return
    editorRef.current.focus()

    // Build the table DOM directly
    const table = document.createElement('table')
    const thead  = document.createElement('thead')
    const tbody  = document.createElement('tbody')
    const hRow   = document.createElement('tr')
    for (let c = 0; c < cols; c++) {
      const th = document.createElement('th')
      th.innerHTML = `Header ${c + 1}`
      hRow.appendChild(th)
    }
    thead.appendChild(hRow)
    table.appendChild(thead)
    for (let r = 0; r < rows; r++) {
      const row = document.createElement('tr')
      for (let c = 0; c < cols; c++) {
        const td = document.createElement('td')
        td.innerHTML = '&nbsp;'
        row.appendChild(td)
      }
      tbody.appendChild(row)
    }
    table.appendChild(tbody)

    // Insert after the current block-level ancestor
    const sel = window.getSelection()
    let anchor = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null
    if (anchor?.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode
    while (anchor && anchor !== editorRef.current &&
           !['P','DIV','H1','H2','H3','LI'].includes(anchor.nodeName)) {
      anchor = anchor.parentNode
    }
    const para = document.createElement('p')
    para.innerHTML = '<br>'
    if (anchor && anchor !== editorRef.current) {
      anchor.after(table); table.after(para)
    } else {
      editorRef.current.appendChild(table)
      editorRef.current.appendChild(para)
    }

    // Place cursor in first cell
    const first = table.querySelector('th')
    if (first) {
      const r = document.createRange()
      r.selectNodeContents(first); r.collapse(false)
      sel.removeAllRanges(); sel.addRange(r)
    }
    setShowPicker(false)
    emit()
  }

  // Table editing operations
  function tableOp(op) {
    if (!activeTable || !editorRef.current) return
    editorRef.current.focus()
    const sel = window.getSelection()
    let cell = null
    if (sel?.rangeCount) {
      let n = sel.getRangeAt(0).startContainer
      if (n.nodeType === Node.TEXT_NODE) n = n.parentNode
      while (n && n !== activeTable) {
        if (n.nodeName === 'TD' || n.nodeName === 'TH') { cell = n; break }
        n = n.parentNode
      }
    }
    const row = cell?.closest('tr')

    switch (op) {
      case 'addRowAfter': {
        if (!row) break
        const nr = row.cloneNode(true)
        Array.from(nr.cells).forEach(c => { c.innerHTML = '&nbsp;' })
        row.after(nr); break
      }
      case 'addRowBefore': {
        if (!row) break
        const nr = row.cloneNode(true)
        Array.from(nr.cells).forEach(c => { c.innerHTML = '&nbsp;' })
        row.before(nr); break
      }
      case 'deleteRow': {
        if (!row) break
        const parent = row.parentElement
        if (parent.rows.length > 1) row.remove()
        break
      }
      case 'addColAfter': {
        if (!cell) break
        const idx = cell.cellIndex
        Array.from(activeTable.rows).forEach((r, ri) => {
          const nc = ri === 0 ? document.createElement('th') : document.createElement('td')
          nc.innerHTML = '&nbsp;'
          const ref = r.cells[idx + 1]
          ref ? r.insertBefore(nc, ref) : r.appendChild(nc)
        }); break
      }
      case 'addColBefore': {
        if (!cell) break
        const idx = cell.cellIndex
        Array.from(activeTable.rows).forEach((r, ri) => {
          const nc = ri === 0 ? document.createElement('th') : document.createElement('td')
          nc.innerHTML = '&nbsp;'
          r.insertBefore(nc, r.cells[idx])
        }); break
      }
      case 'deleteCol': {
        if (!cell) break
        const idx = cell.cellIndex
        if (activeTable.rows[0]?.cells.length > 1) {
          Array.from(activeTable.rows).forEach(r => { if (r.cells[idx]) r.deleteCell(idx) })
        }
        break
      }
      case 'deleteTable': {
        const p = document.createElement('p'); p.innerHTML = '<br>'
        activeTable.after(p); activeTable.remove()
        setActiveTable(null)
        break
      }
    }
    emit()
  }

  function importMarkdown() {
    if (!mdText.trim()) return
    const converted = markdownToHtml(mdText)
    if (editorRef.current) { editorRef.current.innerHTML = converted; emit() }
    setShowImport(false); setMdText('')
  }

  function tbBtn(label, onAction, title, extra = '') {
    return (
      <button
        type="button"
        title={title || label}
        className={`${styles.tbBtn} ${extra}`}
        onMouseDown={e => { e.preventDefault(); onAction() }}
      >{label}</button>
    )
  }

  return (
    <div className={styles.richEditor}>

      {/* ── Main toolbar ── */}
      <div className={styles.toolbar}>
        {tbBtn(<strong>B</strong>,  () => exec('bold'),      'Bold')}
        {tbBtn(<em>I</em>,          () => exec('italic'),    'Italic')}
        {tbBtn(<u>U</u>,            () => exec('underline'), 'Underline')}
        <span className={styles.tbDivider} />
        {tbBtn('H1', () => exec('formatBlock','h1'), 'Heading 1')}
        {tbBtn('H2', () => exec('formatBlock','h2'), 'Heading 2')}
        {tbBtn('H3', () => exec('formatBlock','h3'), 'Heading 3')}
        {tbBtn('¶',  () => exec('formatBlock','p'),  'Paragraph')}
        <span className={styles.tbDivider} />
        {tbBtn('• List',  () => exec('insertUnorderedList'), 'Bullet list')}
        {tbBtn('1. List', () => exec('insertOrderedList'),   'Numbered list')}
        <span className={styles.tbDivider} />
        {tbBtn('― Divider', insertDivider, 'Insert horizontal divider')}
        {tbBtn('🔗 Link',   insertLink,    'Insert link')}
        {tbBtn('🖼 Image',  insertImage,   'Insert image URL')}
        <span className={styles.tbDivider} />
        {/* Table picker */}
        <div className={styles.tbPickerWrap} ref={pickerRef}>
          <button
            type="button"
            className={styles.tbBtn}
            onMouseDown={e => { e.preventDefault(); setShowPicker(v => !v) }}
          >⊞ Table</button>
          {showPicker && (
            <div className={styles.tbPickerDrop}>
              <TablePicker onInsert={insertTable} />
            </div>
          )}
        </div>
        <span className={styles.tbDivider} />
        <button
          type="button"
          className={`${styles.tbBtn} ${styles.tbImport}`}
          onClick={() => setShowImport(v => !v)}
        >↓ Import MD</button>
      </div>

      {/* ── Table context toolbar (appears when cursor is inside a table) ── */}
      {activeTable && (
        <div className={styles.tableBar}>
          <span className={styles.tableBarLabel}>Table:</span>
          <button type="button" className={styles.tbBtn} onMouseDown={e=>{e.preventDefault();tableOp('addRowBefore')}}>↑ Row</button>
          <button type="button" className={styles.tbBtn} onMouseDown={e=>{e.preventDefault();tableOp('addRowAfter')}}>↓ Row</button>
          <button type="button" className={styles.tbBtn} onMouseDown={e=>{e.preventDefault();tableOp('addColBefore')}}>← Col</button>
          <button type="button" className={styles.tbBtn} onMouseDown={e=>{e.preventDefault();tableOp('addColAfter')}}>→ Col</button>
          <span className={styles.tbDivider} />
          <button type="button" className={styles.tbBtn} onMouseDown={e=>{e.preventDefault();tableOp('deleteRow')}}>Del Row</button>
          <button type="button" className={styles.tbBtn} onMouseDown={e=>{e.preventDefault();tableOp('deleteCol')}}>Del Col</button>
          <button type="button" className={`${styles.tbBtn} ${styles.tbDanger}`} onMouseDown={e=>{e.preventDefault();tableOp('deleteTable')}}>Del Table</button>
        </div>
      )}

      {/* ── Markdown import panel ── */}
      {showImport && (
        <div className={styles.importPanel}>
          <p className={styles.importHint}>
            Paste markdown (e.g. from Scribe) — supports headings, bold, lists, tables, images, code blocks.
          </p>
          <textarea
            className={styles.importTextarea}
            value={mdText}
            onChange={e => setMdText(e.target.value)}
            placeholder={'# Heading\n\n**Bold**, *italic*, - bullet\n\n| Col A | Col B |\n|-------|-------|\n| Data  | Data  |'}
            rows={8}
          />
          <div className={styles.importActions}>
            <button type="button" className={formStyles.btnSecondary} onClick={() => { setShowImport(false); setMdText('') }}>Cancel</button>
            <button type="button" className={formStyles.btnPrimary} onClick={importMarkdown}>Import</button>
          </div>
        </div>
      )}

      {/* ── Editable area ── */}
      <div
        ref={editorRef}
        className={styles.editorBody}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onMouseMove={onEditorMouseMove}
        onMouseDown={onEditorMouseDown}
      />
    </div>
  )
}

// ─── Folder tree ──────────────────────────────────────────────────────────────

function buildTree(flat) {
  const map = {}
  flat.forEach(f => { map[f.id] = { ...f, children: [] } })
  const roots = []
  flat.forEach(f => {
    if (f.parent_id && map[f.parent_id]) map[f.parent_id].children.push(map[f.id])
    else roots.push(map[f.id])
  })
  return roots
}

function FolderNode({ node, depth, selected, onSelect, onEdit, onDelete, onDropArticle }) {
  const [open,     setOpen]     = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const hasChildren = node.children?.length > 0

  function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true) }
  function onDragLeave()  { setDragOver(false) }
  async function onDrop(e) {
    e.preventDefault(); setDragOver(false)
    const id = e.dataTransfer.getData('articleId')
    if (id) await onDropArticle(parseInt(id, 10), node.id)
  }

  return (
    <>
      <div
        className={`${styles.folderRow} ${dragOver ? styles.folderDragOver : ''}`}
        style={{ paddingLeft: depth * 14 }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {hasChildren ? (
          <button
            type="button"
            className={styles.folderChevron}
            onMouseDown={e => { e.stopPropagation(); setOpen(v => !v) }}
          >{open ? '▾' : '▸'}</button>
        ) : (
          <span className={styles.folderChevronPlaceholder} />
        )}
        <button
          className={`${styles.folderItem} ${selected === node.id ? styles.folderActive : ''}`}
          onClick={() => onSelect(node.id)}
        >
          <span className={styles.folderIcon}>{node.icon}</span>
          <span className={styles.folderName}>{node.name}</span>
          {node.org_name && <span className={styles.orgBadge} title={`Restricted to ${node.org_name}`}>🏢</span>}
          <span className={styles.folderCount}>{node.article_count}</span>
        </button>
        <div className={styles.folderActions}>
          <button className={styles.folderEdit} onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onEdit(node) }} title="Edit">✏️</button>
          <button className={styles.folderDel}  onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onDelete(node) }} title="Delete">×</button>
        </div>
      </div>
      {open && hasChildren && node.children.map(child => (
        <FolderNode key={child.id} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} onDropArticle={onDropArticle} />
      ))}
    </>
  )
}

// ─── Folder modal (create / edit) ─────────────────────────────────────────────

function FolderModal({ folder, folders, orgs, onClose, onSaved }) {
  const [name,     setName]     = useState(folder?.name     || '')
  const [icon,     setIcon]     = useState(folder?.icon     || '📁')
  const [parentId, setParentId] = useState(folder?.parent_id ?? '')
  const [orgId,    setOrgId]    = useState(folder?.org_id   ?? '')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState(null)

  const ICONS = ['📁','📂','⚙️','🛡️','💻','🌐','🔑','📋','🚀','📖','🔧','💡','🧩','📝','🗂️','📌']

  // Exclude self + descendants from parent dropdown
  const validParents = folders.filter(f => f.id !== folder?.id)

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true); setError(null)
    const url    = folder ? `/api/kb/folders/${folder.id}` : '/api/kb/folders'
    const method = folder ? 'PUT' : 'POST'
    const res    = await apiFetch(url, {
      method,
      body: JSON.stringify({ name: name.trim(), icon, parent_id: parentId || null, org_id: orgId || null }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { setError(data.error); return }
    onSaved(data, !folder)
  }

  return (
    <Modal title={folder ? 'Edit Folder' : 'New Folder'} onClose={onClose}>
      <div className={formStyles.form}>
        <div className={formStyles.field}>
          <label className={formStyles.label}>Name</label>
          <input className={formStyles.input} autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSave()} />
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label}>Icon</label>
          <div className={styles.iconPicker}>
            {ICONS.map(ic => (
              <button key={ic} type="button" className={`${styles.iconOption} ${icon===ic?styles.iconSelected:''}`} onClick={()=>setIcon(ic)}>{ic}</button>
            ))}
          </div>
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label}>Parent Folder <span className={styles.optLabel}>(optional — creates a subfolder)</span></label>
          <select className={formStyles.select} value={parentId} onChange={e => setParentId(e.target.value)}>
            <option value="">None (top level)</option>
            {validParents.map(f => <option key={f.id} value={f.id}>{f.icon} {f.name}</option>)}
          </select>
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label}>Restrict to Organisation <span className={styles.optLabel}>(optional — for client portal)</span></label>
          <select className={formStyles.select} value={orgId} onChange={e => setOrgId(e.target.value)}>
            <option value="">Visible to all</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>

        {error && <div className={formStyles.error}>{error}</div>}
        <div className={formStyles.actions}>
          <button type="button" className={formStyles.btnSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={formStyles.btnPrimary} disabled={saving || !name.trim()} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save Folder'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function FolderSidebar({ folders, orgs, selected, onSelect, onReload, onDropArticle }) {
  const [modalFolder, setModalFolder] = useState(undefined)
  const [confirmFolder, setConfirmFolder] = useState(null)
  const [unfiledDrag, setUnfiledDrag] = useState(false)
  const tree = buildTree(folders)

  async function handleDelete(f) {
    await apiFetch(`/api/kb/folders/${f.id}`, { method: 'DELETE' })
    if (selected === f.id) onSelect('all')
    onReload()
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <span className={styles.sidebarTitle}>Folders</span>
        <button className={styles.newFolderBtn} onClick={() => setModalFolder(null)} title="New folder">+</button>
      </div>

      <nav className={styles.folderList}>
        {/* All Articles — not a drop target */}
        <button className={`${styles.folderItem} ${styles.folderItemFlat} ${selected==='all'?styles.folderActive:''}`} onClick={() => onSelect('all')}>
          <span className={styles.folderIcon}>📚</span>
          <span className={styles.folderName}>All Articles</span>
        </button>
        {/* Unfiled — drop target to remove folder */}
        <button
          className={`${styles.folderItem} ${styles.folderItemFlat} ${selected==='unfiled'?styles.folderActive:''} ${unfiledDrag?styles.folderDragOver:''}`}
          onClick={() => onSelect('unfiled')}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setUnfiledDrag(true) }}
          onDragLeave={() => setUnfiledDrag(false)}
          onDrop={async e => {
            e.preventDefault(); setUnfiledDrag(false)
            const id = e.dataTransfer.getData('articleId')
            if (id) await onDropArticle(parseInt(id, 10), null)
          }}
        >
          <span className={styles.folderIcon}>📄</span>
          <span className={styles.folderName}>Unfiled</span>
        </button>

        {tree.length > 0 && <div className={styles.folderDivider} />}

        {tree.map(node => (
          <FolderNode
            key={node.id}
            node={node}
            depth={0}
            selected={selected}
            onSelect={onSelect}
            onEdit={f => setModalFolder(f)}
            onDelete={f => setConfirmFolder(f)}
            onDropArticle={onDropArticle}
          />
        ))}
      </nav>

      {modalFolder !== undefined && (
        <FolderModal
          folder={modalFolder}
          folders={folders}
          orgs={orgs}
          onClose={() => setModalFolder(undefined)}
          onSaved={() => { setModalFolder(undefined); onReload() }}
        />
      )}

      {confirmFolder && (
        <ConfirmModal
          title={`Delete "${confirmFolder.name}"?`}
          message="Articles and sub-folders inside will become Unfiled. This cannot be undone."
          confirmLabel="Delete folder"
          onConfirm={() => handleDelete(confirmFolder)}
          onClose={() => setConfirmFolder(null)}
        />
      )}
    </aside>
  )
}

// ─── Article editor overlay ───────────────────────────────────────────────────

function ArticleEditor({ article, folders, onClose, onSaved }) {
  const [title,      setTitle]      = useState(article?.title      || '')
  const [folderId,   setFolderId]   = useState(article?.folder_id  ?? '')
  const [published,  setPublished]  = useState(article?.published  ?? false)
  const [visibility, setVisibility] = useState(article?.visibility || 'internal')
  const [body,       setBody]       = useState(article?.body       || '')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState(null)

  async function handleSave() {
    if (!title.trim()) { setError('Title is required.'); return }
    if (!body.trim())  { setError('Content is required.'); return }
    setSaving(true); setError(null)
    const url    = article ? `/api/kb/${article.id}` : '/api/kb'
    const method = article ? 'PUT' : 'POST'
    const res    = await apiFetch(url, {
      method,
      body: JSON.stringify({ title: title.trim(), body, folder_id: folderId || null, published, visibility }),
    })
    if (!res.ok) { const d = await res.json(); setError(d.error); setSaving(false); return }
    onSaved()
  }

  // Flat folder list for select
  function flatFolders(list, depth = 0) {
    return list.flatMap(f => [
      { ...f, _depth: depth },
      ...flatFolders(f.children || [], depth + 1),
    ])
  }
  const flat = flatFolders(buildTree(folders))

  return (
    <div className={styles.editorOverlay}>
      <div className={styles.editorPanel}>
        <div className={styles.editorHeader}>
          <input
            className={styles.editorTitle}
            placeholder="Article title…"
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
          />
          <div className={styles.editorMeta}>
            <select className={styles.folderSelect} value={folderId} onChange={e => setFolderId(e.target.value)}>
              <option value="">Unfiled</option>
              {flat.map(f => (
                <option key={f.id} value={f.id}>{'  '.repeat(f._depth)}{f.icon} {f.name}</option>
              ))}
            </select>

            <select className={styles.folderSelect} value={visibility} onChange={e => setVisibility(e.target.value)}>
              <option value="internal">🔒 Internal only</option>
              <option value="public">🌐 Public (portal)</option>
            </select>

            <label className={styles.pubToggle}>
              <input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} />
              Published
            </label>
          </div>
        </div>

        <div className={styles.editorContent}>
          <RichEditor key={article?.id ?? 'new'} initialValue={body} onChange={setBody} />
        </div>

        <div className={styles.editorFooter}>
          {error && <span className={styles.editorError}>{error}</span>}
          <button type="button" className={formStyles.btnSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={formStyles.btnPrimary} disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : article ? 'Update Article' : 'Create Article'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Article view overlay ─────────────────────────────────────────────────────

function ArticleView({ article, onClose, onEdit }) {
  return (
    <div className={styles.editorOverlay}>
      <div className={styles.editorPanel}>
        <div className={styles.editorHeader}>
          <h2 className={styles.viewTitle}>{article.title}</h2>
          <div className={styles.viewMeta}>
            {article.folder_name && (
              <span className={styles.folderBadge}>{article.folder_icon} {article.folder_name}</span>
            )}
            {article.visibility === 'public' && <span className={styles.publicBadge}>🌐 Public</span>}
            {!article.published && <span className={styles.draftBadge}>Draft</span>}
            <span className={styles.viewDate}>Updated {formatDate(article.updated_at)}</span>
          </div>
        </div>
        <div className={styles.viewBody} dangerouslySetInnerHTML={{ __html: article.body }} />
        <div className={styles.editorFooter}>
          <button type="button" className={formStyles.btnSecondary} onClick={onClose}>Close</button>
          <button type="button" className={formStyles.btnPrimary} onClick={onEdit}>Edit Article</button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function KnowledgeBase() {
  const [folders,  setFolders]  = useState([])
  const [orgs,     setOrgs]     = useState([])
  const [articles, setArticles] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState('all')
  const [search,   setSearch]   = useState('')
  const [editing,  setEditing]  = useState(null)   // null=hidden, false=new, obj=edit
  const [viewing,  setViewing]  = useState(null)
  const [deleteId, setDeleteId] = useState(null)

  function loadFolders() {
    apiFetch('/api/kb/folders').then(r => r.json()).then(d => { if (Array.isArray(d)) setFolders(d) })
  }
  function loadOrgs() {
    apiFetch('/api/organisations').then(r => r.json()).then(d => { if (Array.isArray(d)) setOrgs(d) })
  }
  function loadArticles() {
    setLoading(true)
    const p = new URLSearchParams()
    if (search)             p.set('search', search)
    if (selected !== 'all') p.set('folder_id', selected === 'unfiled' ? 'unfiled' : String(selected))
    apiFetch(`/api/kb?${p}`).then(r => r.json()).then(d => {
      if (Array.isArray(d)) setArticles(d)
      setLoading(false)
    })
  }

  useEffect(() => { loadFolders(); loadOrgs() }, [])
  useEffect(() => { loadArticles() }, [search, selected])

  async function handleDropArticle(articleId, folderId) {
    await apiFetch(`/api/kb/${articleId}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ folder_id: folderId }),
    })
    loadArticles(); loadFolders()
  }

  async function handleDelete(id) {
    await apiFetch(`/api/kb/${id}`, { method: 'DELETE' })
    setDeleteId(null); loadArticles(); loadFolders()
  }
  async function openView(id) {
    const d = await apiFetch(`/api/kb/${id}`).then(r => r.json()); setViewing(d)
  }
  async function openEdit(id) {
    const d = await apiFetch(`/api/kb/${id}`).then(r => r.json())
    setEditing(d); setViewing(null)
  }

  const selectedLabel =
    selected === 'all'     ? 'All Articles' :
    selected === 'unfiled' ? 'Unfiled' :
    folders.find(f => f.id === selected)?.name ?? 'Articles'

  return (
    <div className={styles.page}>
      <PageHeader
        title="Knowledge Base"
        action={<button className={styles.btnNew} onClick={() => setEditing(false)}>+ New Article</button>}
      />

      <div className={styles.layout}>
        <FolderSidebar
          folders={folders}
          orgs={orgs}
          selected={selected}
          onSelect={setSelected}
          onReload={() => { loadFolders(); loadArticles() }}
          onDropArticle={handleDropArticle}
        />

        <main className={styles.main}>
          <div className={styles.topBar}>
            <h3 className={styles.sectionTitle}>{selectedLabel}</h3>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Search articles…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <div className={styles.state}>Loading…</div>
          ) : articles.length === 0 ? (
            <div className={styles.empty}>
              <p>No articles yet.</p>
              <button className={styles.btnNew} onClick={() => setEditing(false)}>Create the first one</button>
            </div>
          ) : (
            <div className={styles.grid}>
              {articles.map(a => (
                <div
                  key={a.id}
                  className={styles.card}
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData('articleId', String(a.id))
                    e.dataTransfer.effectAllowed = 'move'
                    e.currentTarget.classList.add(styles.cardDragging)
                  }}
                  onDragEnd={e => e.currentTarget.classList.remove(styles.cardDragging)}
                >
                  <div className={styles.cardTop}>
                    <div className={styles.cardMeta}>
                      {a.folder_name
                        ? <span className={styles.catBadge}>{a.folder_icon} {a.folder_name}</span>
                        : <span className={styles.unfiledBadge}>Unfiled</span>}
                      {a.visibility === 'public' && <span className={styles.publicBadge}>🌐</span>}
                      {!a.published && <span className={styles.draftBadge}>Draft</span>}
                    </div>
                    <div className={styles.cardActions}>
                      <button className={styles.btnView}   onClick={() => openView(a.id)}>View</button>
                      <button className={styles.btnEdit}   onClick={() => openEdit(a.id)}>Edit</button>
                      <button className={styles.btnDelete} onClick={() => setDeleteId(a.id)}>×</button>
                    </div>
                  </div>
                  <h3 className={styles.cardTitle} onClick={() => openView(a.id)}>{a.title}</h3>
                  <p className={styles.cardExcerpt}>
                    {(a.excerpt || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()}
                  </p>
                  <div className={styles.cardFooter}>Updated {formatDate(a.updated_at)}</div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {editing !== null && (
        <ArticleEditor
          article={editing || null}
          folders={folders}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadArticles(); loadFolders() }}
        />
      )}

      {viewing && (
        <ArticleView
          article={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => openEdit(viewing.id)}
        />
      )}

      {deleteId && (
        <Modal title="Delete Article" onClose={() => setDeleteId(null)}>
          <div className={formStyles.form}>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
              This article will be permanently deleted.
            </p>
            <div className={formStyles.actions}>
              <button className={formStyles.btnSecondary} onClick={() => setDeleteId(null)}>Cancel</button>
              <button className={styles.btnDanger} onClick={() => handleDelete(deleteId)}>Delete</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
