import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table'
import { TableHeader } from '@tiptap/extension-table'
import { useEffect, useCallback, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import styles from './RichTextEditor.module.css'

const COLORS = [
  { label: 'Default', value: null },
  { label: 'Red', value: '#DC2626' },
  { label: 'Orange', value: '#D97706' },
  { label: 'Green', value: '#059669' },
  { label: 'Blue', value: '#2563EB' },
  { label: 'Purple', value: '#7C3AED' },
  { label: 'Gray', value: '#6B7280' },
]

const RichTextEditor = forwardRef(function RichTextEditor({ value, onChange, placeholder, className, internalMode }, ref) {
  const [showColorPicker, setShowColorPicker] = useState(false)
  const colorPickerRef = useRef(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextStyle,
      Color,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: placeholder || 'Write a reply…' }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: value || '',
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      onChange(html === '<p></p>' ? '' : html)
    },
  })

  // Sync external value clears (e.g. after sending)
  useEffect(() => {
    if (!editor) return
    if (!value && editor.getHTML() !== '<p></p>') {
      editor.commands.clearContent()
    }
  }, [value, editor])

  // Expose insertHTMLContent to parent via ref
  useImperativeHandle(ref, () => ({
    insertHTMLContent: (html) => {
      editor?.chain().focus().insertContent(html).run()
    }
  }), [editor])

  // Close color picker on outside click
  useEffect(() => {
    function handleClick(e) {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target)) {
        setShowColorPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const insertTable = useCallback(() => {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  }, [editor])

  const setLink = useCallback(() => {
    const url = window.prompt('URL:')
    if (!url) return
    if (url === '') {
      editor?.chain().focus().unsetLink().run()
    } else {
      editor?.chain().focus().setLink({ href: url }).run()
    }
  }, [editor])

  if (!editor) return null

  const currentColor = editor.getAttributes('textStyle').color || null

  return (
    <div className={`${styles.wrapper} ${internalMode ? styles.wrapperInternal : ''} ${className || ''}`}>
      <div className={styles.toolbar}>
        {/* Text format */}
        <button type="button" title="Bold" className={`${styles.tbBtn} ${editor.isActive('bold') ? styles.tbActive : ''}`}
          onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBold().run() }}>
          <b>B</b>
        </button>
        <button type="button" title="Italic" className={`${styles.tbBtn} ${editor.isActive('italic') ? styles.tbActive : ''}`}
          onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleItalic().run() }}>
          <i>I</i>
        </button>
        <button type="button" title="Underline" className={`${styles.tbBtn} ${editor.isActive('underline') ? styles.tbActive : ''}`}
          onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleUnderline().run() }}>
          <u>U</u>
        </button>
        <button type="button" title="Strike" className={`${styles.tbBtn} ${editor.isActive('strike') ? styles.tbActive : ''}`}
          onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleStrike().run() }}>
          <s>S</s>
        </button>

        <div className={styles.tbDivider} />

        {/* Headings */}
        <button type="button" title="Heading 1" className={`${styles.tbBtn} ${editor.isActive('heading', { level: 1 }) ? styles.tbActive : ''}`}
          onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 1 }).run() }}>
          H1
        </button>
        <button type="button" title="Heading 2" className={`${styles.tbBtn} ${editor.isActive('heading', { level: 2 }) ? styles.tbActive : ''}`}
          onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 2 }).run() }}>
          H2
        </button>

        <div className={styles.tbDivider} />

        {/* Lists */}
        <button type="button" title="Bullet list" className={`${styles.tbBtn} ${editor.isActive('bulletList') ? styles.tbActive : ''}`}
          onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBulletList().run() }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/>
            <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/>
            <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/>
            <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/>
          </svg>
        </button>
        <button type="button" title="Numbered list" className={`${styles.tbBtn} ${editor.isActive('orderedList') ? styles.tbActive : ''}`}
          onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run() }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/>
            <path d="M4 6h1v4" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M4 10h2" strokeLinecap="round"/>
            <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <div className={styles.tbDivider} />

        {/* Color picker */}
        <div className={styles.colorPickerWrap} ref={colorPickerRef}>
          <button type="button" title="Text colour" className={styles.tbBtn}
            onMouseDown={e => { e.preventDefault(); setShowColorPicker(v => !v) }}>
            <span className={styles.colorIcon}>
              A
              <span className={styles.colorBar} style={{ background: currentColor || 'var(--text-primary)' }} />
            </span>
          </button>
          {showColorPicker && (
            <div className={styles.colorDropdown}>
              {COLORS.map(c => (
                <button key={c.label} type="button" className={`${styles.colorSwatch} ${currentColor === c.value ? styles.colorSwatchActive : ''}`}
                  title={c.label}
                  onMouseDown={e => {
                    e.preventDefault()
                    if (c.value) {
                      editor.chain().focus().setColor(c.value).run()
                    } else {
                      editor.chain().focus().unsetColor().run()
                    }
                    setShowColorPicker(false)
                  }}
                  style={{ '--swatch-color': c.value || 'var(--text-primary)' }}
                />
              ))}
            </div>
          )}
        </div>

        <div className={styles.tbDivider} />

        {/* Link */}
        <button type="button" title="Insert link" className={`${styles.tbBtn} ${editor.isActive('link') ? styles.tbActive : ''}`}
          onMouseDown={e => { e.preventDefault(); setLink() }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
        </button>

        {/* Table */}
        <button type="button" title="Insert table" className={styles.tbBtn}
          onMouseDown={e => { e.preventDefault(); insertTable() }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="3" y1="15" x2="21" y2="15"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
            <line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
        </button>

        {/* Block quote */}
        <button type="button" title="Blockquote" className={`${styles.tbBtn} ${editor.isActive('blockquote') ? styles.tbActive : ''}`}
          onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBlockquote().run() }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
            <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
          </svg>
        </button>

        {/* Code block */}
        <button type="button" title="Code block" className={`${styles.tbBtn} ${editor.isActive('codeBlock') ? styles.tbActive : ''}`}
          onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleCodeBlock().run() }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
          </svg>
        </button>

        <div className={styles.tbDivider} />

        {/* Undo / Redo */}
        <button type="button" title="Undo" className={styles.tbBtn} disabled={!editor.can().undo()}
          onMouseDown={e => { e.preventDefault(); editor.chain().focus().undo().run() }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
          </svg>
        </button>
        <button type="button" title="Redo" className={styles.tbBtn} disabled={!editor.can().redo()}
          onMouseDown={e => { e.preventDefault(); editor.chain().focus().redo().run() }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>
          </svg>
        </button>
      </div>

      <EditorContent editor={editor} className={styles.content} />
    </div>
  )
})

export default RichTextEditor
