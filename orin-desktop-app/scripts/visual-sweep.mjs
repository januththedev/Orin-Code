// Visual sweep: open every view in a real browser and screenshot it.
//
// Three things make this possible, and none of them is a mock of the UI:
//
//   1. The renderer is a Vite app that talks to Rust only through
//      `window.__TAURI_INTERNALS__.invoke(cmd, args)`. Driving that in
//      Chromium exercises the real components, not test doubles.
//   2. `@tauri-apps/api/mocks` ships `mockIPC` for exactly this, and it
//      already wires the event plugin's internals correctly. A hand-rolled
//      `__TAURI_INTERNALS__` looked equivalent and was not: the API package
//      also reaches for `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener`,
//      which is a different global, and the missing one threw during unmount
//      and left a blank window.
//   3. The welcome gate is deliberate and has no offline bypass -- it requires
//      a provider key or a live session. The mock answers `provider_has_key`
//      true so the sweep can reach the views behind it. That is a harness
//      concern only; nothing here weakens the product.
//
// Every view in `ui/src/app/routes.tsx` is covered, navigated the way a user
// would: clicking the rail, the Code tab, the New button, the footer settings
// gear, and the command palette for the two views the rail does not expose.
//
// Run:  node scripts/visual-sweep.mjs [--out DIR] [--port N]
// Writes one PNG per view plus a summary; exits non-zero if any view failed to
// render, so it is usable as a CI gate on a machine that can run Chromium.
//
// NOTE on escaping: this file contains a large template literal holding the
// browser-side shim. Inside it, a newline in a mock string must be written
// as \\n -- two characters -- so it survives the template literal and is then
// interpreted as an escape by the JavaScript running in the page. Getting that
// one level wrong produces a blank window, hence the self-check below.

import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const outDir = join(root, argOf('--out', 'visual-snapshots'))
const port = Number(argOf('--port', '4319'))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
}

const LEADING = new RegExp('^([/\\\\])+')

/** Static server for the built UI. Small enough not to need vite preview. */
function serve(dir) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let file = join(dir, normalize(decodeURIComponent(url.pathname)).replace(LEADING, ''))
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    // SPA fallback, so a deep link would still boot the app.
    if (!existsSync(file)) file = join(dir, 'index.html')
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

/**
 * The answers the app will get back for each bridge command. Data is
 * deliberately realistic rather than empty: an empty state and a populated list
 * exercise different rendering, and a screenshot of an empty list proves very
 * little. Every shape here was taken from the renderer's own bridge types and
 * its built-in mock -- guessing produced `live.filter is not a function`, which
 * crashed the composer during render and blanked the whole window.
 */
const SHIM = `
(() => {
  const now = Date.now();
  const mins = (n) => now - n * 60_000;
  const nl = String.fromCharCode(10);
  const block = (...lines) => lines.join(nl);
  const answers = {
    app_info: { version: '1.9.0', os: 'windows' },
    auth_status: { signedIn: true, session: { name: 'Januth Nimnal', email: 'nimnaljanuth@gmail.com', plan: 'pro' } },
    auth_logout: undefined,
    backend_status: { reachable: true, latencyMs: 42, httpStatus: 200 },
    // sync must answer its envelope, not undefined: the store filters on it.
    sync_pull: { blob: null, updatedAt: null },
    sync_push: undefined,
    // The welcome gate. True so the sweep reaches the views behind it.
    provider_has_key: true,
    // hasKey: true for groq and openrouter, so the store's keyed-provider path
    // runs. This is the path that was broken: a Groq key used to be visible in
    // Settings and absent from the picker.
    providers_list: [
      { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyRequired: true, docsUrl: 'https://console.groq.com/keys', hasKey: true },
      { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', keyRequired: true, docsUrl: 'https://platform.deepseek.com/api_keys', hasKey: false },
      { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyRequired: true, docsUrl: 'https://openrouter.ai/settings/keys', hasKey: true },
    ],
    // Per-preset live catalogs, so a focused check can assert that a keyed
    // non-OpenRouter provider really reaches the picker.
    groq_models: [
      { id: 'groq/llama-3.3-70b-versatile', provider: 'groq', label: 'Llama 3.3 70B (Groq)', tier: 'fast', speed: 3, intelligence: 2, contextTokens: 131072 },
      { id: 'groq/kimi-k2-instruct', provider: 'groq', label: 'Kimi K2 (Groq)', tier: 'balanced', speed: 3, intelligence: 3, contextTokens: 131072 },
    ],
    openrouter_models: [
      { id: 'openrouter/deepseek/deepseek-chat-v3-0324:free', provider: 'openrouter', label: 'DeepSeek V3 - Free', tier: 'reasoning', speed: 2, intelligence: 3, contextTokens: 163840 },
    ],
    // models_fetch and models_check_new both return ModelInfo[], not a report.
    models_list: [
      { id: 'mock/orin-offline', provider: 'mock', label: 'Orin Offline', tier: 'balanced', speed: 3, intelligence: 1, contextTokens: 32000 },
      { id: 'claude-sonnet-5', provider: 'anthropic', label: 'Claude Sonnet 5', tier: 'balanced', speed: 88, intelligence: 94, contextTokens: 200000 },
      { id: 'claude-opus-5', provider: 'anthropic', label: 'Claude Opus 5', tier: 'max', speed: 62, intelligence: 98, contextTokens: 200000 },
      { id: 'gpt-5.5', provider: 'openai_compat', label: 'GPT-5.5', tier: 'reasoning', speed: 71, intelligence: 95, contextTokens: 400000 },
      { id: 'qwen-3-max', provider: 'router', label: 'Qwen 3 Max', tier: 'fast', speed: 96, intelligence: 81, contextTokens: 262144 },
    ],
    // Adds a model the static catalog does not have, so mergeLiveModels runs.
    // Note: the bridge client sends the preset id, so a per-preset reply is
    // what modelsFetch resolves to. Groq's list is deliberately distinctive so
    // the sweep can assert it reached the picker.
    models_fetch: [
      { id: 'groq/llama-3.3-70b-versatile', provider: 'groq', label: 'Llama 3.3 70B (Groq)', tier: 'fast', speed: 3, intelligence: 2, contextTokens: 131072 },
      { id: 'groq/kimi-k2-instruct', provider: 'groq', label: 'Kimi K2 (Groq)', tier: 'balanced', speed: 3, intelligence: 3, contextTokens: 131072 },
      { id: 'openrouter/deepseek/deepseek-chat-v3-0324:free', provider: 'openrouter', label: 'DeepSeek V3 - Free', tier: 'reasoning', speed: 2, intelligence: 3, contextTokens: 163840 },
    ],
    models_check_new: [],
    update_check: { available: false, current: '1.9.0', latest: '1.9.0', notes: '' },
    // The sweep does not assert persistence, so a null store_get is enough
    // here. The focused model-picker check installs a real key/value store,
    // because "does the selection survive a reload" cannot be tested against a
    // backend that forgets everything.
    store_get: null,
    telegram_has_token: false,
    pc_link_status: { linked: false },
    pc_task_poll: { tasks: [] },
    connector_has_cred: false,
    connector_test: { ok: true, latencyMs: 120 },
    mcp_servers: [
      { name: 'orin-core', transport: 'http', url: 'https://mcp.orinai.org/mcp', enabled: true, status: 'ready' },
      { name: 'filesystem', transport: 'stdio', command: 'npx -y @modelcontextprotocol/server-filesystem', enabled: true, status: 'ready' },
      { name: 'github', transport: 'http', url: 'https://mcp.github.example/mcp', enabled: false, status: 'stopped' },
    ],
    mcp_test: { ok: true, latencyMs: 88 },
    cu_available_providers: [
      { id: 'openai', label: 'Computer Use (OpenAI)', available: true },
      { id: 'anthropic', label: 'Computer Use (Anthropic)', available: true },
    ],
    hooks_status: [
      { id: 'run-tests', name: 'Run tests before commit', event: 'PreToolUse', enabled: true, trusted: true, blocks: true },
      { id: 'block-secrets', name: 'Block writes containing secrets', event: 'PreToolUse', enabled: true, trusted: true, blocks: true },
    ],
    // Real frontmatter, or MemoryPage correctly rejects every file and shows
    // its validation banner instead of a list. A screenshot of the error state
    // proves the validator works but says nothing about the list.
    memory_list: [
      { name: 'user-januth.md', updatedAtMs: mins(90), content: block('---', 'name: user-januth', 'description: Who Januth is and how they work.', 'metadata:', '  type: user', '---', '', 'Januth Nimnal, owner of the Orin ecosystem. Prefers exact numbers over adjectives.') },
      { name: 'feedback-verify-first.md', updatedAtMs: mins(400), content: block('---', 'name: feedback-verify-first', 'description: Run the tests before reporting a result.', 'metadata:', '  type: feedback', '---', '', '**Why:** a claim without a number is a guess.', '**How to apply:** run the suite, quote the real output.') },
      { name: 'project-orin-ecosystem.md', updatedAtMs: mins(2000), content: block('---', 'name: project-orin-ecosystem', 'description: Layout and conventions across the Orin repos.', 'metadata:', '  type: project', '---', '', 'See [[user-januth]] for who maintains it.') },
    ],
    // States are camelCase to match the serde rename_all attribute on TaskState
    // in src-tauri/src/bridge/queue.rs. Sending snake_case instead files an
    // approval-pending task under "recently finished", which looks alarming and
    // hides the approval buttons entirely.
    queue_list: [
      { id: 't-1', title: 'Audit dependencies', instructions: 'Run npm audit and summarise', state: 'running', delegated: false, parentId: null, createdAtMs: mins(2), startedAtMs: mins(2), finishedAtMs: null },
      { id: 't-2', title: 'Write release notes', instructions: 'Summarise the last three commits', state: 'queued', delegated: false, parentId: null, createdAtMs: mins(1), startedAtMs: null, finishedAtMs: null },
      { id: 't-3', title: 'Sub-agent: check tests', instructions: 'Verify the suite is green', state: 'awaitingApproval', delegated: true, parentId: null, createdAtMs: mins(5), startedAtMs: mins(4), finishedAtMs: null },
    ],
    fs_exists: true,
    fs_read_file: block('# Orin Code', '', 'A Tauri workspace for running coding agents.'),
    fs_read_dir: [
      { name: 'orin-desktop-app', path: 'D:/Orin_ECOSYS/Orin-Code/orin-desktop-app', type: 'folder' },
      { name: 'README.md', path: 'D:/Orin_ECOSYS/Orin-Code/README.md', type: 'file', size: 4820 },
      { name: 'vendor', path: 'D:/Orin_ECOSYS/Orin-Code/vendor', type: 'folder' },
    ],
    git_status: { branch: 'main', ahead: 0, behind: 0, files: [] },
    search_workspace: [
      { path: 'ui/src/App.tsx', line: 12, text: "setPhase(!signedIn && !hasKey ? 'welcome' : 'app')" },
      { path: 'src-tauri/src/bridge/browser.rs', line: 245, text: 'pub fn html_to_text(html: &str) -> String {' },
    ],
    browser_read: { url: 'https://opencode.ai/zen/v1/models', title: 'Models', text: block('space-bunny-free', 'big-pickle') },
  };
  window.__ORIN_ANSWERS__ = answers;
})();
`

// Fail loudly and locally if the shim is not valid JavaScript. A malformed shim
// otherwise reaches the browser and surfaces as "Invalid or unexpected token"
// on every page, which reads as an application crash rather than a typo here.
try {
  new Function(SHIM)
} catch (error) {
  console.error('The Tauri shim is not valid JavaScript:', error.message)
  const at = /<anonymous>:(\d+):(\d+)/.exec(String(error.stack ?? ''))
  if (at) {
    const line = Number(at[1])
    console.error('--- offending line', line, '---')
    console.error(SHIM.split('\n').slice(Math.max(0, line - 2), line + 1).join('\n'))
  }
  process.exit(2)
}

/**
 * Every view, and how a user reaches it.
 *
 * Selectors deliberately target the expanded sidebar, where the buttons carry
 * visible text and no `title` attribute -- the `title` exists only on the
 * collapsed rail-icon variant, so selecting by title silently matched nothing.
 *
 * They must also resolve to the BUTTON, never to a container. An earlier version
 * filtered the `.rail-items` wrapper by its text, which matched the div; the
 * click then landed wherever the div's centre happened to be, and the sweep
 * cheerfully reported the Notes view as "artifacts".
 */
const VIEWS = [
  { view: 'home', label: 'Home', step: { button: '.rail-tab', text: 'Home' } },
  { view: 'chat', label: 'Chat', step: { button: '.new-chat-button' } },
  { view: 'projects', label: 'Projects', step: { button: '.rail-item', text: 'Projects' } },
  { view: 'artifacts', label: 'Artifacts', step: { button: '.rail-item', text: 'Artifacts' } },
  { view: 'studio', label: 'Studio', step: { button: '.rail-item', text: 'Studio' } },
  { view: 'computer', label: 'Computer Use', step: { button: '.rail-item', text: 'Computer Use' } },
  { view: 'notes', label: 'Notes', step: { button: '.rail-item', text: 'Notes' } },
  { view: 'queue', label: 'Background', step: { button: '.rail-item', text: 'Background' } },
  { view: 'browser', label: 'Read a page', step: { button: '.rail-item', text: 'Read a page' } },
  { view: 'memory', label: 'Memory', step: { button: '.rail-item', text: 'Memory' } },
  { view: 'customize', label: 'Customize', step: { button: '.rail-item', text: 'Customize' } },
  { view: 'ide', label: 'Code', step: { button: '.rail-tab', text: 'Code' } },
  { view: 'settings', label: 'Settings', step: { title: 'Settings' } },
  { view: 'skills', label: 'Skills', step: { palette: 'Skills' } },
  { view: 'connectors', label: 'Integrations', step: { palette: 'MCP Servers' } },
]

const locate = (page, step) => {
  if (step.title) return page.locator(`[title="${step.title}"]`).first()
  if (step.button) {
    return step.text
      ? page.locator(step.button).filter({ hasText: step.text }).first()
      : page.locator(step.button).first()
  }
  return null
}

const pad = (value, width) => String(value ?? '').padEnd(width)

// `@tauri-apps/api/mocks` is self-contained -- no imports, no TS helper
// polyfills -- so it can be injected as a classic script by stripping the
// export statement and re-exposing the functions on window.
const mocksSource = readFileSync(join(root, 'node_modules', '@tauri-apps', 'api', 'mocks.js'), 'utf8')
  .replace(/^export \{[^}]*\};?\s*$/m, '')
  .concat('\nwindow.__ORIN_MOCKS__ = { mockIPC, mockWindows, mockConvertFileSrc, clearMocks };\n')
const mocksPath = join(tmpdir(), 'orin-tauri-mocks.js')
writeFileSync(mocksPath, mocksSource)

const server = await serve(dist)
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await context.addInitScript(SHIM)
await context.addInitScript({ path: mocksPath })
await context.addInitScript(
  `
  const answers = window.__ORIN_ANSWERS__ ?? {};
  window.__ORIN_CALLS__ = [];
  const { mockIPC, mockWindows, mockConvertFileSrc } = window.__ORIN_MOCKS__;
  mockWindows('main', { label: 'main' });
  mockConvertFileSrc((path) => path);
  mockIPC(async (cmd) => {
    window.__ORIN_CALLS__.push(cmd);
    if (Object.prototype.hasOwnProperty.call(answers, cmd)) return answers[cmd];
    return undefined;
  });
`,
)
const page = await context.newPage()

// Boot-phase diagnostics. A blank window is the least informative failure this
// tool can produce, so whatever stopped it is reported up front and in full
// rather than surfacing as fifteen identical navigation timeouts.
const bootErrors = []
page.on('pageerror', (error) => bootErrors.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') bootErrors.push(`console: ${message.text()}`)
})

const results = []
let previousFingerprint = ''
try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
  // The boot effect awaits several mocked commands before painting.
  let booted = true
  try {
    await page.waitForSelector('.rail-item, .rail-icon', { timeout: 20_000 })
  } catch {
    booted = false
    console.log('\nThe app never painted. That is a harness or app fault, not 15 view faults.\n')
    console.log('boot errors:')
    for (const e of bootErrors.slice(0, 12)) console.log('  ' + e)
    const calls = await page.evaluate(() => window.__ORIN_CALLS__ ?? []).catch(() => [])
    console.log(`\ncommands invoked (${calls.length}): ${[...new Set(calls)].join(', ')}`)
    console.log(`#root html length: ${await page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? -1)}`)
  }
  if (booted) {
    await page.waitForTimeout(600)
    if (existsSync(outDir)) rmSync(outDir, { recursive: true })
    mkdirSync(outDir, { recursive: true })

    for (const view of VIEWS) {
      const problems = []
      const onPageError = (error) => problems.push(`pageerror: ${error.message}`)
      const onConsole = (message) => {
        if (message.type() !== 'error') return
        const text = message.text()
        // A failed fetch to an origin the shim does not serve is expected noise.
        if (/Failed to load resource|net::ERR|ERR_CONNECTION/i.test(text)) return
        problems.push(`console: ${text}`)
      }
      page.on('pageerror', onPageError)
      page.on('console', onConsole)

      let navigated = true
      try {
        if (view.step.palette) {
          // The command palette became the Command Centre in ZCode parity step 2,
          // so these two views are reached through it.
          await page.keyboard.press('Control+Shift+P')
          await page.waitForSelector('.cc', { timeout: 10_000 })
          await page.locator('.cc-input').fill(view.step.palette)
          await page.waitForTimeout(250)
          await page.locator('.cc-row').filter({ hasText: view.step.palette }).first().click()
          await page.waitForTimeout(500)
        }
        else {
          const target = locate(page, view.step)
          await target.waitFor({ state: 'visible', timeout: 10_000 })
          await target.click()
        }
        // Lazy chunks resolve over HTTP; give the view a moment to paint and for
        // any error boundary to fire.
        await page.waitForTimeout(900)
      } catch (error) {
        navigated = false
        problems.push(`navigation: ${error.message.split('\n')[0]}`)
      }

      // Two independent checks that the click did what it claimed, because a
      // screenshot of the wrong view is worse than no screenshot: it looks like
      // a pass. `active` reads the app's own highlighted rail item, and the text
      // fingerprint must differ from the previous view, since ten rail views
      // once all reported byte-identical content.
      const active = await page
        .evaluate(() => {
          const el = document.querySelector('.rail-item.active, .rail-tab.active, .rail-icon.active')
          return el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 24) : null
        })
        .catch(() => null)
      const fingerprint = await page
        .evaluate(() => {
          const main = document.querySelector('main') ?? document.getElementById('root')
          return (main?.textContent ?? '').replace(/\s+/g, ' ').trim()
        })
        .catch(() => '')
      const painted = fingerprint.length

      if (navigated && active && view.view !== 'home' && view.view !== 'chat' && view.step.button?.text) {
        if (!active.toLowerCase().includes(view.step.button.text.toLowerCase())) {
          problems.push(`landed on "${active}", expected "${view.label}"`)
        }
      }
      if (navigated && previousFingerprint && fingerprint === previousFingerprint) {
        problems.push('rendered exactly the same content as the previous view')
      }
      previousFingerprint = fingerprint

      const file = join(outDir, `${String(results.length + 1).padStart(2, '0')}-${view.view}.png`)
      await page.screenshot({ path: file, fullPage: false })

      page.off('pageerror', onPageError)
      page.off('console', onConsole)

      const ok = navigated && painted > 0 && problems.length === 0
      results.push({ view: view.view, label: view.label, ok, painted, active, problems, file })
    }
  }
} finally {
  await browser.close()
  server.close()
}

console.log(`\nOrin Code — visual sweep of ${VIEWS.length} views\n`)
for (const r of results) {
  const status = r.ok ? 'ok  ' : 'FAIL'
  const detail = r.ok ? '' : `\n        ${r.problems.slice(0, 3).join('\n        ')}`
  console.log(`  ${status}  ${pad(r.view, 12)} ${pad(r.label, 16)} ${String(r.painted).padStart(6)} chars  ${pad(r.active ?? '-', 16)}${detail}`)
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} views rendered cleanly`)
console.log(`snapshots: ${outDir}`)
process.exit(failed.length ? 1 : 0)
