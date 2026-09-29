# Orin AI — PC

**Orin AI** is a free, AI-native workspace for Windows, built by [Januth Nimnal](https://github.com/Januth1234). It ships as two products in this repository:

1. **Orin Code Editor** — a full VS Code fork (`/src`) with the Orin AI sidebar: chat, agent mode, and inline edits powered by any model you connect.
2. **Orin Desktop Workspace** (`/orin-desktop-app`) — a fast, lightweight standalone app (Tauri v2 + Rust + React 19) with chat, projects, artifacts, an IDE, and **Computer Use**: Orin can see your screen and control your mouse and keyboard when you ask it to.

Website & cloud accounts: **[orinai.org](https://orinai.org)**

---

## Highlights

### Orin Desktop Workspace
- **~15 MB installer, sub-400 ms cold start** — native Rust core, no Electron. Every network call, file operation, terminal, and input event runs in Rust workers; the UI is plain React over a typed command bridge ([`docs/BRIDGE.md`](orin-desktop-app/docs/BRIDGE.md)).
- **Chat with modes** — Chat · Cowork · Agent · Computer Use, with any model.
- **Any provider** — Anthropic, OpenAI-compatible endpoints (OpenRouter/Groq/Ollama/LM Studio), or the built-in offline mock. Keys live in the OS credential manager, never in plaintext.
- **Agent tool loop** — read/write/search files, run commands (with diffs + approval gates), and now **drive your PC**: `screenshot`, `mouse_click`, `type_text`, `press_key`, `scroll`, `open_app`. Every real-desktop action passes a session approval gate — approve once per run, revoke anytime.
- **Computer Use mode** — give Orin a goal ("clean up my desktop", "fill this form"); it observes the screen, decides, acts, and verifies in a loop.
- **IDE surface** — file explorer with git status dots, Monaco editor, real ConPTY terminal, AI panel with plan/steps/diffs and accept/reject.
- **Projects & artifacts** — folder-backed projects with custom instructions; generated artifacts with version history and preview/download.
- **Orin AI accounts** *(new)* — sign in with your orinai.org account for quota-metered **Orin Cloud models**, plus opt-out cross-device sync of settings and chats.

### Orin Code Editor
- Built on VS Code — extensions, themes, and keybindings all work.
- Orin sidebar with time-aware greeting, chat history, and agent tool use.
- Fast Apply via search/replace blocks; Cmd/Ctrl+L chat, Cmd/Ctrl+K inline edit.
- Bring your own keys or run fully local models.

---

## Build

### Orin Desktop Workspace

Prerequisites: Node 20+, Rust stable (MSVC), WebView2 (preinstalled on Win 10/11), VS Build Tools with C++.

```powershell
cd orin-desktop-app
npm install

npm run dev          # UI only, in a browser (mock backend)
npm run app:dev      # full app with the Rust core + hot reload
npm run typecheck && npm run lint
npm run test         # Rust unit tests (cargo test)

npm run app:build    # NSIS installer → src-tauri/target/release/bundle/
```

The amber bolt mark lives at [`assets/orin-mark.svg`](orin-desktop-app/assets/orin-mark.svg); icons are generated via `scripts/generate-icons.mjs`.

### Installing Orin Code

Every tagged release publishes a signed-free NSIS installer. Download
`Orin Code_<version>_x64-setup.exe` from the
[release page](https://github.com/januththedev/Orin-Code/releases) and run it.

It installs to `%LOCALAPPDATA%\Programs\Orin Code`, adds a Start Menu entry and
an uninstaller under *Settings → Apps → Installed apps*. There is no
machine-wide install and no admin prompt: everything lands under your user
profile.

The installer is **not code-signed**, so SmartScreen will show
*"Windows protected your PC"*. Click **More info → Run anyway**. This is
expected for an unsigned release and is a decision you should make knowing
that a signed build needs a code-signing certificate, which this repository
does not carry.

**Requirements:** Windows 10 21H2 or 11, and WebView2 — preinstalled on
Windows 11 and on any current Windows 10; if the app shows a blank window,
install the [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

The first launch has no offline mode: you need an Orin account or a provider
key before the app opens.

### Orin Code Editor

Prerequisites: Node 20+, Python 3, VS Build Tools.

```powershell
npm install
npm run buildreact
npm run compile
npm run gulp vscode-win32-x64   # Windows desktop build
```

---

## Repository layout

| Path | What it is |
|---|---|
| `src/` | VS Code fork — Orin sidebar under `src/vs/workbench/contrib/orin/` |
| `orin-desktop-app/src-tauri/` | Rust core: providers, agent loop, terminals, SQLite, Computer Use |
| `orin-desktop-app/ui/` | React 19 UI: home, chat, projects, artifacts, IDE, settings |
| `agent-tools/desktop/` | PowerShell "orin" CLI used to QA-drive Windows apps |
| `resources/win32/` | Installer/window branding assets |

## License

MIT for Orin code — see [LICENSE](LICENSE). The editor portion also carries
[VS Code's license terms](LICENSE-VS-Code.txt) and Microsoft's
[ThirdPartyNotices](ThirdPartyNotices.txt).

## Author

**Januth Nimnal** · [orinai.org](https://orinai.org) · [@Januth1234](https://github.com/Januth1234)
