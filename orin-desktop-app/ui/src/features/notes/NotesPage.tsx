import { useEffect, useMemo, useState } from 'react'
import { FileText, Save } from 'lucide-react'
import { bridge } from '../../bridge/client'
import { useProjectsStore } from '../../stores/projectsStore'
import { useUiStore } from '../../stores/uiStore'
import './notes.css'

const DEFAULT_NOTES = `# Project notes\n\n- First note {{id:: note-001}}\n`

export default function NotesPage() {
  const projects = useProjectsStore((state) => state.projects)
  const activeProjectId = useProjectsStore((state) => state.activeProjectId)
  const toast = useUiStore((state) => state.toast)
  const root = useMemo(() => projects.find((project) => project.id === activeProjectId)?.rootPath || null, [projects, activeProjectId])
  const path = root ? `${root.replace(/[\\/]+$/, '')}/NOTES.md` : null
  const [text, setText] = useState(DEFAULT_NOTES)
  const [status, setStatus] = useState('Choose a project to edit its shared notes.')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!path) { setStatus('Choose a project to edit its shared notes.'); return }
    setBusy(true)
    bridge.readFile(path).then(setText).catch(() => setText(DEFAULT_NOTES)).finally(() => setBusy(false))
  }, [path])

  const save = async () => {
    if (!path) return
    setBusy(true)
    try {
      await bridge.writeFile(path, text)
      setStatus('Saved NOTES.md · Logseq-compatible Markdown')
      toast('success', 'Notes saved', 'The shared @orin/notes contract is preserved.')
    } catch (error) {
      setStatus(String(error))
    } finally { setBusy(false) }
  }

  return (
    <main className="notes-page">
      <header className="notes-header">
        <div><span className="notes-kicker"><FileText size={13} /> SHARED NOTES</span><h1>Project notes</h1><p>Markdown stays readable in Logseq and Orin Automations. Preserve <code>{'{{id:: ...}}'}</code> block IDs when editing.</p></div>
        <button className="button-primary" disabled={!path || busy} onClick={() => void save()}><Save size={14} /> {busy ? 'Working…' : 'Save notes'}</button>
      </header>
      <div className="notes-status">{status}</div>
      <textarea className="notes-editor" value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} disabled={!path || busy} aria-label="Logseq-compatible project notes" />
    </main>
  )
}
