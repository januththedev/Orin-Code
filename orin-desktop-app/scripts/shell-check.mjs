// Verifies the ZCode shell: the resizable three-column layout, the side-pane
// tab strip, and the bottom terminal panel.
//
// The visual sweep confirms 15 views still render; it does not open a side
// pane or a terminal, because nothing in normal navigation does. This does, so
// the shell is actually exercised rather than assumed.
//
// Run: node scripts/shell-check.mjs

import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, normalize, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')
const port = 4322
const LEADING = new RegExp('^([/\\\\])+')
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.wav': 'audio/wav', '.woff2': 'font/woff2',
}

const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  let f = join(dist, normalize(decodeURIComponent(u.pathname)).replace(LEADING, ''))
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html')
  if (!existsSync(f)) f = join(dist, 'index.html')
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' })
  createReadStream(f).pipe(res)
})
await new Promise((r) => server.listen(port, '127.0.0.1', r))

const sweep = readFileSync(join(root, 'scripts', 'visual-sweep.mjs'), 'utf8')
const SHIM = sweep.slice(
  sweep.indexOf('const SHIM = `') + 'const SHIM = `'.length,
  sweep.indexOf('`\n\n// Fail loudly and locally'),
)
const mocks = readFileSync(join(root, 'node_modules', '@tauri-apps', 'api', 'mocks.js'), 'utf8')
  .replace(/^export \{[^}]*\};?\s*$/m, '')
  .concat('\nwindow.__ORIN_MOCKS__ = { mockIPC, mockWindows, mockConvertFileSrc, clearMocks };\n')
const mocksPath = join(tmpdir(), 'orin-tauri-mocks.js')
writeFileSync(mocksPath, mocks)

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript(SHIM)
await context.addInitScript({ path: mocksPath })
await context.addInitScript(
  `
  const answers = window.__ORIN_ANSWERS__ ?? {};
  window.__ORIN_CALLS__ = [];
  const kv = new Map();
  const { mockIPC, mockWindows, mockConvertFileSrc } = window.__ORIN_MOCKS__;
  mockWindows('main', { label: 'main' });
  mockConvertFileSrc((p) => p);
  mockIPC(async (cmd, args) => {
    window.__ORIN_CALLS__.push(cmd);
    // Before the generic store_get: an open project, so the git pane is not
    // permanently in its no-folder state.
    if (cmd === 'store_get' && args.key === 'projects') {
      return { projects: [{ id: 'p1', name: 'Orin-Code', rootPath: 'D:/Orin_ECOSYS/Orin-Code' }], activeProjectId: 'p1' };
    }
    if (cmd === 'store_get') { const raw = sessionStorage.getItem('kv:' + args.key); return raw === null ? null : JSON.parse(raw); }
    if (cmd === 'store_set') { sessionStorage.setItem('kv:' + args.key, JSON.stringify(args.value)); return undefined; }
    if (cmd === 'store_delete') { sessionStorage.removeItem('kv:' + args.key); return undefined; }
    if (cmd === 'git_status') return { branch: 'main', 'src/main.rs': 'modified' };
    if (cmd === 'term_create') return 'term-session-1';
    return answers[cmd];
  });
`,
)
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const checks = []
const check = (name, pass, detail = '') => {
  checks.push({ name, pass })
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.new-chat-button', { timeout: 20_000 })
  await page.locator('.new-chat-button').click()
  await page.waitForSelector('.main-view', { timeout: 20_000 })

  check('the shell renders the conversation column', (await page.locator('.conversation-column').count()) === 1)
  check('the sidebar is inside the conversation column', (await page.locator('.conversation-inner .navrail').count()) === 1)
  // ZCode's pane is visible from the start and shows a launcher when empty
  // (`App.tsx:504`: open is the inverse of collapsed). Asserting it closed would
  // be asserting a divergence from the source of truth.
  check('the side pane is visible by default, as in ZCode', (await page.locator('.side-pane').count()) === 1)
  check('an empty pane offers a launcher', (await page.locator('.side-pane-launcher').count()) === 1)
  check('the terminal panel is closed by default', (await page.locator('.terminal-panel').count()) === 0)

  // -- open a side pane tab via the add menu, as a user would
  await page.locator('.side-pane-add-button').click()
  await page.waitForSelector('.side-pane-menu', { timeout: 5_000 })
  const menuItems = await page.locator('.side-pane-menu [role="menuitem"]').allTextContents()
  check('the add menu lists available tab types', menuItems.length >= 4, menuItems.join(', '))
  check('the add menu omits types with no ported content', !menuItems.includes('whiteboard'), 'whiteboard has no content yet')

  await page.locator('.side-pane-menu [role="menuitem"]', { hasText: 'git' }).first().click()
  await page.waitForSelector('.side-pane', { timeout: 5_000 })
  check('the side pane opens with a git tab', (await page.locator('.side-pane-tab').count()) === 1)
  check('the pane shows the repository status', (await page.locator('.tab-git').count()) === 1)
  const gitText = (await page.locator('.side-pane-body').textContent()) ?? ''
  check('the git pane reports the branch from the bridge', gitText.includes('main'), gitText.slice(0, 60).trim())

  // Opening the same singleton type again must reuse the tab, not stack another.
  await page.locator('.side-pane-add-button').click()
  await page.locator('.side-pane-menu [role="menuitem"]', { hasText: 'git' }).first().click()
  await page.waitForTimeout(300)
  check('reopening a singleton tab reuses it', (await page.locator('.side-pane-tab').count()) === 1)

  // A second, keyed tab should stack.
  await page.locator('.side-pane-add-button').click()
  await page.locator('.side-pane-menu [role="menuitem"]', { hasText: 'terminal' }).first().click()
  await page.waitForTimeout(300)
  check('a keyed tab stacks alongside', (await page.locator('.side-pane-tab').count()) === 2)

  check('the terminal panel opened with the terminal tab', (await page.locator('.terminal-panel').count()) === 1)
  check('the terminal panel offers a session', ((await page.locator('.terminal-panel-status').textContent()) ?? '').includes('session'))

  // The resize handle between the pane and the conversation column must exist.
  check('a resize handle separates the columns', (await page.locator('.pane-handle').count()) === 1)
  const handleBox = await page.locator('.pane-handle').boundingBox()
  check('the handle is actually laid out', handleBox !== null && handleBox.width > 0 && handleBox.height > 0)

  // -- tabs and pane state must survive a reload
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.side-pane', { timeout: 20_000 })
  await page.waitForTimeout(600)
  const restored = await page.locator('.side-pane-tab').count()
  check('tabs survive a reload', restored === 2, `saw ${restored}`)

  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.screenshot({ path: join(root, 'shell-check.png') })
} finally {
  await browser.close()
  server.close()
}

const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} shell checks passed`)
console.log(`screenshot: ${join(root, 'shell-check.png')}`)
process.exit(failed.length ? 1 : 0)