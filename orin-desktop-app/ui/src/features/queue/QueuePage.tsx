import { useCallback, useEffect, useState } from 'react'
import { ListTree, ShieldAlert, X, Plus } from 'lucide-react'
import { bridge } from '../../bridge/client'
import type { BackgroundTask, TaskState } from '../../bridge/types'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { useUiStore } from '../../stores/uiStore'
import './queue.css'

/**
 * Background tasks and sub-agents.
 *
 * A queued task is not a licence to act unattended. Read and reasoning continue
 * on their own, but anything that mutates still stops and asks — the queue only
 * decides *when* work starts, never whether approval is needed.
 */

const STATE_LABEL: Record<TaskState, string> = {
  queued: 'Queued',
  running: 'Running',
  awaitingApproval: 'Waiting for you',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const LIVE: TaskState[] = ['queued', 'running', 'awaitingApproval']

export default function QueuePage() {
  const [tasks, setTasks] = useState<BackgroundTask[]>([])
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useUiStore((s) => s.toast)

  const load = useCallback(async () => {
    try {
      setTasks(await bridge.queueList())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the queue.')
    }
  }, [])

  useEffect(() => {
    void load()
    // A held task is waiting on the user, so the queue has to notice when they
    // answer. Polling a local list is cheap and has nothing to fetch.
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [load])

  const add = async () => {
    const cleanTitle = title.trim()
    const body = instructions.trim()
    if (!cleanTitle || !body) {
      setError('A task needs a title and something to do.')
      return
    }
    setBusy('new')
    try {
      await bridge.queueEnqueue({ id: crypto.randomUUID(), title: cleanTitle, instructions: body })
      setTitle('')
      setInstructions('')
      setError('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That task could not be queued.')
    } finally {
      setBusy(null)
    }
  }

  const act = async (task: BackgroundTask, action: 'cancel' | 'resume') => {
    setBusy(task.id)
    try {
      if (action === 'cancel') await bridge.queueCancel(task.id)
      else await bridge.queueResume(task.id)
      await load()
    } catch (e) {
      toast('error', 'Queue', e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(null)
    }
  }

  const live = tasks.filter((t) => LIVE.includes(t.state))
  const settled = tasks.filter((t) => !LIVE.includes(t.state)).slice(0, 20)

  const row = (task: BackgroundTask) => (
    <li key={task.id} className={`queue-row queue-row--${task.state}`}>
      <div className="queue-row-main">
        <div className="queue-row-title">
          <strong>{task.title}</strong>
          {task.delegated && <span className="queue-badge queue-badge--sub">Sub-agent</span>}
          <span className="queue-state">{STATE_LABEL[task.state]}</span>
        </div>
        <p className="queue-instructions">{task.instructions}</p>
        {task.error && <p className="queue-error">{task.error}</p>}
        {task.state === 'awaitingApproval' && (
          <p className="queue-hold">
            <ShieldAlert size={13} /> It wants to change something and is waiting for your approval.
          </p>
        )}
      </div>
      {LIVE.includes(task.state) && (
        <div className="queue-actions">
          {task.state === 'awaitingApproval' && (
            <Button size="sm" variant="ghost" disabled={busy === task.id} onClick={() => void act(task, 'resume')}>
              Continue
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy === task.id} onClick={() => void act(task, 'cancel')}>
            <X size={13} />
          </Button>
        </div>
      )}
    </li>
  )

  return (
    <section className="view queue-view">
      <header className="queue-head">
        <div>
          <h1>Background work</h1>
          <p className="queue-sub">
            Tasks that keep going while you do something else, and sub-agents an
            agent can delegate to. Anything that writes still asks first.
          </p>
        </div>
      </header>

      <div className="queue-add">
        <input
          value={title}
          placeholder="Title, e.g. Rename the test fixtures"
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Task title"
        />
        <textarea
          value={instructions}
          placeholder="What should it do?"
          onChange={(e) => setInstructions(e.target.value)}
          aria-label="Task instructions"
        />
        <Button size="sm" disabled={busy === 'new'} onClick={() => void add()}>
          <Plus size={13} /> Queue
        </Button>
      </div>

      {error && <p className="queue-error" role="alert">{error}</p>}

      {live.length === 0 ? (
        <EmptyState
          title="Nothing running"
          hint="Queue a task and it will start as soon as a slot is free."
        />
      ) : (
        <ul className="queue-list">{live.map(row)}</ul>
      )}

      {settled.length > 0 && (
        <>
          <h2 className="queue-section">Recently finished</h2>
          <ul className="queue-list queue-list--settled">{settled.map(row)}</ul>
        </>
      )}

      <p className="queue-footnote">
        <ListTree size={13} /> A sub-agent cannot outlast the task that owns it, and cancelling a
        parent cancels everything it delegated.
      </p>
    </section>
  )
}
