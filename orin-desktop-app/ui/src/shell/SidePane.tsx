import { useEffect, useRef, useState } from 'react'
import { Plus, X, RotateCcw } from 'lucide-react'
import { usePanelsStore, newTabId } from '../stores/panelsStore'
import {
  AVAILABLE_TAB_TYPES,
  isTabTypeAvailable,
  isRestorableTab,
  sidePaneTabLabel,
  SIDE_PANE_TAB_MIN_WIDTH_PX,
  SIDE_PANE_TAB_GAP,
  type SidePaneTab,
  type SidePaneTabType,
} from './sidePaneTabs'
import { TabContent } from './TabContent'

/**
 * The right-hand side pane, ported from ZCode's `AnimatedSidePanePanel`.
 *
 * Kept deliberately faithful on the parts that are easy to drop in a port:
 *
 *   - the tab strip scrolls horizontally with edge fades once the tabs exceed
 *     the available width, rather than wrapping or shrinking;
 *   - each tab has a context menu of close / close others / close all;
 *   - the `+` add menu lists only the tab types that are currently available;
 *   - recently-closed is offered for reopen, capped at 8, and only for tabs
 *     whose content can still be pointed at;
 *   - an empty pane shows a launcher rather than nothing at all.
 */

function tabIdFor(type: SidePaneTabType, id?: string): SidePaneTab {
  const base = { id: id ?? newTabId(type), openedAt: Date.now() }
  switch (type) {
    case 'git':
      return { ...base, type: 'git', id: 'git' }
    case 'terminal':
      return { ...base, type: 'terminal', sessionId: `term-${base.id}` }
    case 'bash-output':
      return { ...base, type: 'bash-output', runId: base.id }
    case 'subagent-session':
      return { ...base, type: 'subagent-session', taskId: base.id }
    case 'browser':
      return { ...base, type: 'browser', initialUrl: null }
    case 'code-viewer':
      return { ...base, type: 'code-viewer', source: { path: '', language: null, content: null }, sourceKey: null }
    default:
      return { ...base, type } as SidePaneTab
  }
}

export function SidePane() {
  const sidePane = usePanelsStore((s) => s.sidePane)
  const recentlyClosed = usePanelsStore((s) => s.recentlyClosed)
  const open = usePanelsStore((s) => s.open)
  const close = usePanelsStore((s) => s.close)
  const closeOthers = usePanelsStore((s) => s.closeOthers)
  const closeAll = usePanelsStore((s) => s.closeAll)
  const reorder = usePanelsStore((s) => s.reorder)
  const reopenClosed = usePanelsStore((s) => s.reopenClosed)
  const setTerminalOpen = usePanelsStore((s) => s.setTerminalOpen)

  const [addOpen, setAddOpen] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  // The active tab stays visible as the strip overflows, rather than the active
  // tab being the one scrolled out of sight.
  useEffect(() => {
    if (!sidePane.activeTabId || !stripRef.current) return
    const el = stripRef.current.querySelector(`[data-tab-id="${sidePane.activeTabId}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [sidePane.activeTabId])

  const active = sidePane.tabs.find((tab) => tab.id === sidePane.activeTabId) ?? null
  const openable = AVAILABLE_TAB_TYPES.filter(isTabTypeAvailable)
  const reopenable = recentlyClosed.filter(isRestorableTab)

  return (
    <section className="side-pane" aria-label="Side pane">
      <div className="side-pane-strip" ref={stripRef} role="tablist">
        {sidePane.tabs.map((tab, index) => (
          <div
            key={tab.id}
            className={`side-pane-tab ${tab.id === sidePane.activeTabId ? 'active' : ''}`}
            style={{ minWidth: SIDE_PANE_TAB_MIN_WIDTH_PX, marginRight: SIDE_PANE_TAB_GAP }}
            role="tab"
            aria-selected={tab.id === sidePane.activeTabId}
            data-tab-id={tab.id}
            draggable
            onDragStart={() => setDragFrom(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragFrom !== null && dragFrom !== index) reorder(dragFrom, index)
              setDragFrom(null)
            }}
          >
            <button
              type="button"
              className="side-pane-tab-label"
              onClick={() => open(tab)}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenuFor(menuFor === tab.id ? null : tab.id)
              }}
              title={sidePaneTabLabel(tab)}
            >
              {sidePaneTabLabel(tab)}
            </button>
            <button
              type="button"
              className="side-pane-tab-close"
              aria-label={`Close ${sidePaneTabLabel(tab)}`}
              onClick={() => close(tab.id)}
            >
              <X size={11} />
            </button>
            {menuFor === tab.id && (
              <div className="side-pane-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { close(tab.id); setMenuFor(null) }}>
                  Close
                </button>
                <button type="button" role="menuitem" onClick={() => { closeOthers(tab.id); setMenuFor(null) }}>
                  Close others
                </button>
                <button type="button" role="menuitem" onClick={() => { closeAll(); setMenuFor(null) }}>
                  Close all
                </button>
              </div>
            )}
          </div>
        ))}

        <div className="side-pane-add">
          <button
            type="button"
            className="side-pane-add-button"
            aria-label="Add a side pane"
            onClick={() => setAddOpen(!addOpen)}
          >
            <Plus size={13} />
          </button>
          {addOpen && (
            <div className="side-pane-menu" role="menu">
              {openable.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const tab = tabIdFor(type)
                    open(tab)
                    // Opening the terminal pane also reveals the bottom panel,
                    // matching the two being the same facility in ZCode.
                    if (type === 'terminal') setTerminalOpen(true)
                    setAddOpen(false)
                  }}
                >
                  {type}
                </button>
              ))}
              {openable.length === 0 && <span className="side-pane-menu-empty">Nothing available yet</span>}
            </div>
          )}
        </div>

        {reopenable.length > 0 && (
          <div className="side-pane-recent">
            <RotateCcw size={11} aria-hidden="true" />
            {reopenable.slice(0, 3).map((tab) => (
              <button key={tab.id} type="button" onClick={() => reopenClosed(tab.id)} title={`Reopen ${sidePaneTabLabel(tab)}`}>
                {sidePaneTabLabel(tab)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="side-pane-body">
        {active ? (
          <TabContent tab={active} />
        ) : (
          <div className="side-pane-launcher">
            <p>Nothing open</p>
            <div className="side-pane-launcher-items">
              {openable.slice(0, 5).map((type) => (
                <button key={type} type="button" onClick={() => open(tabIdFor(type))}>
                  {type}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}