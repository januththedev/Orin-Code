import { useState } from 'react'
import { Globe, ExternalLink, Copy, Check } from 'lucide-react'
import { bridge } from '../../bridge/client'
import type { PageText } from '../../bridge/types'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import './browser.css'

/**
 * Read a public page.
 *
 * The page arrives as text, not as a rendered webview. That is deliberate: the
 * shell has a strict CSP and no sandboxed frame for untrusted content, so
 * rendering a third-party page here would hand that page a position inside
 * Orin. Reading is also what the agent actually needs.
 *
 * Fetching goes through Orin Tools' `/api/fetch`, so there is one
 * implementation of what the agent may read, not two that drift.
 */
export default function BrowserPage() {
  const [url, setUrl] = useState('')
  const [page, setPage] = useState<PageText | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const open = async () => {
    const target = url.trim()
    if (!target) return
    setBusy(true)
    setError('')
    try {
      const result = await bridge.browserRead(target, 20000)
      setPage(result)
    } catch (e) {
      setPage(null)
      setError(e instanceof Error ? e.message : 'That page could not be read.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!page) return
    try {
      await navigator.clipboard.writeText(page.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Could not copy to the clipboard.')
    }
  }

  return (
    <section className="view browser-view">
      <header className="browser-head">
        <h1>Read a page</h1>
        <p className="browser-sub">
          Fetch a public page and bring the text back for the agent to work with.
          Nothing is rendered as a live page.
        </p>
      </header>

      <form
        className="browser-bar"
        onSubmit={(e) => {
          e.preventDefault()
          void open()
        }}
      >
        <Globe size={15} aria-hidden="true" />
        <input
          value={url}
          placeholder="https://example.com/article"
          onChange={(e) => setUrl(e.target.value)}
          aria-label="Page URL"
        />
        <Button size="sm" disabled={busy || !url.trim()} onClick={() => void open()}>
          {busy ? 'Reading…' : 'Read'}
        </Button>
      </form>

      {error && <p className="browser-error" role="alert">{error}</p>}

      {page ? (
        <article className="browser-result">
          <div className="browser-result-head">
            <div>
              <a className="browser-title" href={page.finalUrl || page.url} target="_blank" rel="noreferrer noopener">
                {page.finalUrl || page.url} <ExternalLink size={12} />
              </a>
              <p className="browser-meta">
                HTTP {page.status}
                {page.contentType ? ` · ${page.contentType}` : ''}
                {page.truncated ? ' · truncated' : ''}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void copy()}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <pre className="browser-text">{page.text}</pre>
        </article>
      ) : !busy && !error ? (
        <EmptyState
          title="Nothing open"
          hint="Paste a public address above. Private, loopback, and cloud-metadata addresses are refused."
        />
      ) : null}
    </section>
  )
}
