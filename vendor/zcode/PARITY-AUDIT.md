# ZCode → Orin Code parity audit

Generated 2026-10-02 against `vendor/zcode-src` @ `29628c9` (ZCode v3.14.3),
the source of truth. Every claim below carries file:line evidence from that
tree. This is a register of what is missing, not a plan to "improve" ZCode —
the objective is that the externally observable behaviour matches.

## The scale, measured

| | ZCode | Orin Code | Ratio |
|---|---|---|---|
| UI source files (`.tsx`/`.ts`) | **1,492** | **71** | 21× |
| Top-level UI directories | 38 | 6 | 6× |
| Monorepo packages | 15 (+ `apps/zcode-cli`) | 1 | — |

Orin Code is a Tauri/Rust port, so file counts will never match — a Rust
bridge replaces an Electron main process. But the ratio is the honest measure
of how much *surface* has been ported, and 71 vs 1,492 says most of it has not.

**What has been ported** (from `PORT-STATUS.md`): type scale, colour roles,
unified Integrations (connectors + MCP), deny-only hooks, background tasks and
sub-agents, in-app page reader, the pet window, chat storage, file-based
memory, the signed updater, and Google sign-in.

## Severity scale

- **P0** — a user-visible ZCode workflow is absent. The app is a different tool.
- **P1** — the workflow exists but loses behaviour ZCode has.
- **P2** — divergence that is defensible or invisible in normal use.

---

## P0 — shell and navigation

### The shell itself

ZCode's window is a three-column flex (`WorkspaceShellLayout.tsx:1510-1972`):

```
DesktopWindowFrame
├── DesktopTopOverlay            sidebar toggle, back/forward, new task, updates
├── sidebar (264px, resizable)   tasks + projects + command centre + footer
├── resizable separator
└── conversation column
    ├── WorkspaceHeader          (chat view only)
    ├── conversation / automations / plugin-store   ← WorkspaceMainView
    └── terminal panel           (resizable, default closed)
    + side pane (right, tabbed, 19 tab types)
```

Orin Code has a left rail of 11 view buttons and one content area
(`ui/src/app/Layout.tsx:83-92`, `ui/src/app/routes.tsx:20-56`). There is no
right side pane, no bottom terminal panel, no resizable column split, and no
`WorkspaceMainView` equivalent.

### Missing shell surfaces

| ZCode | Evidence | Orin Code | Status |
|---|---|---|---|
| `WorkspaceMainView` = chat \| automations \| plugin-store | `app-shell/types.ts:120` | none | P0 |
| Workspace tabs (local + remote, prepended, restored) | `store/tabStore.ts:34-44, 296, 574-651` | none | P0 |
| Side pane, 19 tab types | `lib/workspaceSidePane.ts:516-535` | none | P0 |
| Side-pane tab bar: dnd, context menu, add-menu, recently-closed (8) | `AnimatedSidePanePanel.tsx:912-1315`, `useAppPanels.ts:105,1332-1348` | none | P0 |
| Terminal panel, `⌘J`, default closed | `useAppPanels.ts:192,1228-1238`, `WorkspaceShellLayout.tsx:1902` | `bridge/term.rs` exists, no panel | P1 |
| Sidebar file-tree slide-over | `WorkspaceSidebar.tsx:1664-1696`, `WorkspaceFileTree.tsx:560-576` | none | P0 |
| Sidebar task modes: archived / timeline / grouped / workspace | `WorkspaceSidebar.tsx:207-221, 1351-1643` | flat "Chats and tasks" list | P1 |
| Browser-style back/forward (max 50) | `lib/taskNavigationHistory.ts:37-45`, `DesktopTopOverlay.tsx:164-186` | none | P1 |
| Welcome screen, 5 open reasons | `Root.tsx:93-98, 982-991` | `App.tsx` boot gate | P2 |
| 9 per-region error boundaries | `ErrorBoundary.tsx:123` | 1 app-level | P2 |

### Workspaces

ZCode's workspace is a directory or a remote SSH/WSL target carrying a
`workspaceIdentity` so `10.0.0.1:/home/dev` and `10.0.0.2:/home/dev` are
distinct (`tabStore.ts:26,257-263`, `app-shell/types.ts:174-175`). Opened via
the sidebar Projects `+` menu ("Open Folder" / "Connect Remote"), the
`DirectoryBrowser`, or the `SSHDialog`; with none open the shell renders
**`null`** (`Root.tsx:1010-1088`).

Orin Code: no workspace concept. `fs_read_dir` / `dialog_pick_folder` exist in
the bridge; nothing holds one open across views.

## P0 — commands and shortcuts

ZCode has **four disjoint namespaces** and no shared id space. There is no
single registry to copy; each is a separate table.

| Namespace | Count | Evidence | Orin Code |
|---|---|---|---|
| `SHORTCUT_COMMANDS` | 24 | `shared/src/shortcutCommands.ts:61-100` | 6 hardcoded in `Layout.tsx:240-263` |
| Command Centre `QuickPickCommand` | 15-18 | `quickpick/quickPickCommands.ts:37-46,86-298` | 2 (`go-skills`, `go-connectors`) |
| `DesktopCommandIds` | 28 | `shared/src/platform.ts:473-502` | none |
| Slash commands | 21 + 2 | `shared/src/zcode-slash-command-help.ts:9-200`, `slash-command-surface.ts:16-25` | none |

### Keyboard shortcuts

ZCode's table is user-rebindable, persisted sparsely, with a conflict system
that models Cmd-vs-Ctrl per platform, physical equivalence, scope isolation, and
steal-with-confirmation (`shortcuts/conflicts.ts:22-245`, `bindings.ts:132-203`).
Bindings are **hidden while recording** and the app menu is rebuilt with
accelerators stripped (`desktop/src/main/index.ts:1396-1442`).

Orin Code hardcodes `Ctrl/⌘+B`, `Ctrl/⌘+N`, `Ctrl/⌘+K`, `Ctrl+Shift+P`
(`Layout.tsx:240-263`). No rebinding, no conflict detection, no recorder UI.
**Every chord above is missing**: `⌘,` settings · `⌘F` find-in-task ·
`⌘⇧L` theme · `⌘J` terminal · `⌘⌥B` side pane · `⌘⇧[`/`⌘⇧]` prev/next task ·
`⌘[`/`⌘]` back/forward · `Ctrl+M` model menu · `Ctrl+Shift+M` cycle mode ·
`Ctrl+T` cycle thought level · `⌘⇧U` coding/office mode · `⌘⇧O` onboarding ·
`⌘+W` close context · `⌘N/O` new task / open workspace · zoom `⌘=/-/0`.

### Command Centre search

ZCode: scope prefixes `>` commands, `#` conversations, `@` files, none = all
(`CommandCenterDialog.tsx:162-180`), plus history in localStorage keyed by
workspace, limit 20 (`commandCenterSearchHistory.ts:9,24-26`). Matching is
token-substring AND, no fuzzy ranking (`:182-193`).

Orin Code: a flat list, no scopes, no history, no files/conversations.

## P0 — settings

ZCode has **18 sections in 3 groups** (`settings/settingsPageConfig.ts:45-159`)
and ~90 individual settings across **four storage tiers**: `~/.zcode/v2/setting.json`,
encrypted `credentials.json`, `provider_config.json`, and renderer `localStorage`.

Sections: `general`, `appearance`, `modelProvider`, `browser`, `computerUse`,
`shortcuts`, `workspaceFileSearch`, `memory`, `subagents`, `plugin`, `mcp`,
`skill`, `commands`, `automations`, `hooks`, `usage` (+ hidden `migration`).

Orin Code: 9 sections — General, Models, Notifications, AI behavior, Privacy,
Keyboard shortcuts, Updates, Account. There is **no shortcut rebinding**, no
hooks editor, no subagent editor, no browser section, no usage/stats.

Settings are a **tab, not a route** (`tabStore.ts:30,492`), and an *overlay*:
the workspace stays mounted at `opacity-0 pointer-events-none inert`
(`RootWorkspaceContent.tsx:99-123`) — the comment there explains why `hidden` is
forbidden. Orin Code replaces the view instead.

Missing P0 settings: **`modelProvider`** in ZCode is a left-nav + detail editor
over a two-layer config (`provider-config.ts:173-264`, ~55 files) with
per-provider base URL, API format (`anthropic-messages` / `openai-chat-completions`
/ `openai-responses`), API key, model add/rename/enable/reorder, per-model
context window, modalities, capability chips and reasoning levels. Orin Code has
a flat provider list with a key field and a model *count* — no per-model editing.

## P0 — workspace (parity step 4 — LANDED)

Ported from `store/tabStore.ts` (workspace half), `root/rootWorkspaceShellTarget.ts`,
`WorkspaceFileTree.tsx` and `WorkspaceSidebar.tsx:1664-1696`.

| Surface | ZCode evidence | Orin Code | State |
|---|---|---|---|
| Workspace context: path, identity, purpose, availability | `tabStore.ts:26,34-44` | `stores/workspaceStore.ts` | Done |
| Identity separating same-path/different-remote | `tabStore.ts:257-263` | `workspaceKey()` | Modelled; no remote transport yet |
| Activating the workspace in the core | `rootWorkspaceShellTarget.ts:20-62` | `workspaceStore.open()` → `workspace_activate` | Done |
| Expanded folders, expand-all / collapse-all | `tabStore.ts:132`, `workspaceExpansionPreference.ts` | `workspaceStore.expanded` | Done |
| Availability when a folder disappears | `tabStore.ts:26` | re-checked on hydrate | Done |
| Sidebar file-tree overlay | `WorkspaceSidebar.tsx:1664-1696` | `shell/WorkspaceFileTree.tsx` | Done |
| Tree keys: Enter open, Right expand, Left collapse | `WorkspaceFileTree.tsx:560-576` | same | Done |
| Side-pane state scoped per workspace AND task | `buildTaskSidePaneMemoryKey` | `buildSidePaneOwnerKey()` | Done |
| Terminal cwd is the workspace | `useAppPanels.ts:1405-1407` | `termCreate(cwd)` | Done |
| Editor tabs shared and persisted | `useTabPersistence` | `stores/editorStore.ts` | Done |
| File create / rename / delete / move | **absent from ZCode's file service** | deliberately not added | N/A |
| Remote workspace (SSH/WSL) | `tabStore.ts:40-42`, `SSHDialog` | not started | P0 |
| Sidebar task modes: grouped / timeline / archived / workspace | `WorkspaceSidebar.tsx:207-221` | not started | P1 |

**ZCode's file service has no create, rename, delete or move.** Its 18 methods
are read/search plus two workspace creators, the tree's context menu is
copy-path only, and `WorkspaceFileTree.tsx` contains zero
`fileService.write|create|rename|delete|move` calls — the agent writes files
through tool calls. A file manager here would be inventing a surface ZCode does
not have, so the explorer is read-only on purpose.

Three real defects the checks caught while landing this:

1. `ProjectsPage.openFolder()` registered a project but never opened a
   workspace, so the explorer showed a folder while the terminal, git and the
   agent stayed where they launched — the split context this step removes.
2. The IDE was crushed to a ~105px editor once the shell's rail and side pane
   surrounded it (`250px minmax(0,1fr) 340px` inside a 695px column). The
   centre track has a real minimum now and the side columns shrink first.
3. The project's own type-scale guard rejected two hardcoded pixel sizes in
   the new tree CSS. The styles moved onto `--fs-md` / `--fs-xs`.

## P0 — editor, files, git, terminal

| Surface | ZCode evidence | Orin Code |
|---|---|---|
| Composer | **Lexical** (`LexicalChatInput.tsx`), mentions, attachments, image paste, input history `↑/↓`, `Alt+→` past mention, `⌘↵` modified submit, `⌘/Ctrl+C/V` in terminal | `<textarea>` (`Composer.tsx`), slash menu only |
| File tree | `WorkspaceFileTree.tsx` — `Enter` open, `→` expand, `←` collapse | `shell/WorkspaceFileTree.tsx` (sidebar overlay) |
| Code viewer | Shiki, light/dark theme, line numbers, wrap, font size (`codePreviewSettings.ts:10-24`) | `IdePage` w/ Monaco |
| PDF / PPTX / image previews | `pdf-viewer.tsx:308-325`, `pptx-preview-viewer.tsx:562-576`, `image-preview-dialog.tsx:233-234` | none |
| Git pane | `GitPane`, `GitGraph`, `GitBranchSwitcher`, `GitActionMenu.tsx:345-370` | `git_status` command only |
| Embedded browser | `HumanBrowserView` + agent-controlled `browser-use` side pane (`workspaceSidePane.ts:6-27,100-121`) | `browser_read` command, no UI |

## P0 — agent surface

| Surface | ZCode evidence | Orin Code |
|---|---|---|
| Permission dialog | `PermissionDialog.tsx:602-658` — `1/2/3` direct respond | `bridge/queue.rs` approval; no dialog UI |
| Elicitation / ask-user / plan | `ElicitationDialog.tsx:140-155` (`exitplanmode`, `askuserquestion`) | none |
| Slash-command surface | 21 builtins + `/plan`, `/side` | none |
| Sub-agents | `SubagentsSection`, `SubAgentConfig` (`shared/src/subagents-types.ts:93-108`) | `queue.rs` delegated flag only |
| Hooks UI | `HookForm.tsx`, 7 events, matcher/command/timeout | `hooks_status` read-only list |
| Workflow runs | `workflow-run` / `workflow-actor-session` / `workflow-workspace` side panes | none |
| Plugin store | `PluginStorePage.tsx:55,97` | Integrations lists MCP + connectors |
| Automations | `AutomationsSection.tsx:730-736` | none |
| CUA permission | `CuaPermissionPanel`, `cua-permission/` | `cu/` bridge; no permission UI |

## P1 — behavioural divergences already known

1. **Model picker was hardcoded to one provider.** Fixed today (`3c85ccf`): the
   composer fetched only `openrouter` from component state while Settings
   discarded every other provider's list. Now one shared store feeds both.
2. **Hooks cannot approve** — deliberate. ZCode's hooks participate in
   permission decisions (`NOTICE.md`); Orin's may deny or add context only, so a
   model-written hook file cannot green-light a mutation.
3. **Agent is sandboxed** — deliberate. ZCode's adapter has no default OS
   sandbox; Orin's Rust boundary rejects traversal and symlink escapes.
4. **Computer Use kept, not ported** — ZCode's `packages/zcode-cua` is a
   placeholder returning "unavailable"; Orin's works.
5. **`text-ui-*`** — ZCode's Tailwind utility, ported as CSS custom properties
   (Orin Code is not a Tailwind project). Enforced by a test.

## Sequence, cheapest visible parity first

Ordered by user-visible gap per unit of work, so each step is shippable:

1. **Keyboard shortcut table + rebinding + recorder.** Unblocks 18 missing
   chords and is the foundation for every later command surface. ZCode's
   `shortcutCommands.ts` + `conflicts.ts` are self-contained and portable.
2. **Command Centre as a real surface** — scope prefixes, sections, history,
   files/conversations. Extends what exists rather than replacing it.
3. **Terminal panel + side pane shell.** Turns the single-column layout into
   ZCode's resizable three-column shell; unblocks side panes.
4. **Workspace concept** — open folder/remote, persist across views, tabs.
   This is what makes "open a folder and work in it" possible at all.
5. **Settings parity** — shortcuts section first (needs 1), then modelProvider
   detail editor, then hooks/subagents/browser sections.
6. **Slash commands**, then permission/elicitation dialogs.
7. **Git + file tree + embedded browser UI** on top of the shell from 3.
8. **Plugin store, automations, workflow panes.**

Each step is ported from the ZCode files cited above, keeping externally
observable behaviour identical, and is verified by `npm run visual` (15 views)
plus targeted tests before it is called done.