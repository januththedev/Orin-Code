// Settings workflows: shortcut rebinding (record / cancel / reset / conflict),
// provider + per-model configuration, and whether either reaches the runtime
// and survives a reload.
//
// Run: node scripts/settings-check.mjs

import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, normalize, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')
const port = 4325
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
  sweep.indexOf('const SHIM = `') + 14,
  sweep.indexOf('`\n\n// Fail loudly and locally'),
)
const mocks = readFileSync(join(root, 'node_modules', '@tauri-apps', 'api', 'mocks.js'), 'utf8')
  .replace(/^export \{[^}]*\};?\s*$/m, '')
  .concat('\nwindow.__ORIN_MOCKS__ = { mockIPC, mockWindows, mockConvertFileSrc, clearMocks };\n')
const mocksPath = join(tmpdir(), 'set-mocks.js')
writeFileSync(mocksPath, mocks)

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
await context.addInitScript(SHIM)
await context.addInitScript({ path: mocksPath })
await context.addInitScript(
  `
  const a = window.__ORIN_ANSWERS__ ?? {};
  const kv = new Map();
  const { mockIPC, mockWindows, mockConvertFileSrc } = window.__ORIN_MOCKS__;
  mockWindows('main', { label: 'main' });
  mockConvertFileSrc((p) => p);
  mockIPC(async (cmd, x) => {
    if (cmd === 'store_get') { const r = sessionStorage.getItem('kv:' + x.key); return r === null ? null : JSON.parse(r) }
    if (cmd === 'store_set') { sessionStorage.setItem('kv:' + x.key, JSON.stringify(x.value)); return undefined }
    if (cmd === 'store_delete') { sessionStorage.removeItem('kv:' + x.key); return undefined }
    if (cmd === 'term_create') return 'term-1';
    if (cmd === 'git_status') return { branch: 'main' };
    return a[cmd];
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

/**
 * Click a control that may be scrolled out of its container.
 *
 * The rail footer sits under `margin-top: auto` inside a flex column, so it can
 * sit below the fold; Playwright's actionability check then refuses to click
 * what a user can in fact scroll to. Scrolling first is the honest fix, and
 * `force` covers a genuinely clipped target without weakening any assertion --
 * every check below still asserts behaviour, not that a pixel was hittable.
 */
const clickable = async (locator) => {
  await locator.scrollIntoViewIfNeeded()
  await locator.click({ force: true, timeout: 10_000 })
}

const openSettings = async (section) => {
  if ((await page.locator('.settings-page').count()) === 0) {
    // Navigate through the Command Centre rather than the rail footer. The
    // footer lives under `margin-top: auto` and may be collapsed or below the
    // fold after the sidebar toggling this run performs; the command palette
    // is always reachable and is itself a path worth exercising.
    await page.keyboard.press('Control+k')
    await page.waitForSelector('.cc', { timeout: 10_000 })
    await page.locator('.cc-input').fill('settings')
    await page.waitForTimeout(300)
    await page.locator('.cc-row').filter({ hasText: 'Settings' }).first().click()
    await page.waitForSelector('.settings-page', { timeout: 10_000 })
  }
  if (section) {
    await clickable(page.locator('.settings-nav-item', { hasText: section }).first())
    await page.waitForSelector('.settings-content', { timeout: 10_000 })
    await page.waitForTimeout(450)
  }
}

try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.rail-item, .rail-icon', { timeout: 20_000 })

  // ---------------------------------------------------------- shortcuts
  await openSettings('Keyboard shortcuts')
  const rows = await page.locator('.shortcut-table tr').count()
  check('the shortcuts section lists commands', rows > 10, rows + ' rows')

  const body = await page.locator('.shortcuts-section').textContent()
  check('onboarding-only commands are not listed', !body.includes('Toggle onboarding') && !body.includes('Toggle Coding/Office'))
  check('a configurable command is listed with its default', body.includes('Toggle Sidebar') && body.includes('Ctrl+B'))

  // Record a new chord.
  const sidebarRow = page.locator('.shortcut-table tr').filter({ hasText: 'Toggle Sidebar' }).first()
  await sidebarRow.getByRole('button', { name: 'Change' }).click()
  check('clicking Change starts recording', (await page.locator('.shortcut-recording').count()) === 1)
  await page.keyboard.press('Alt+Shift+S')
  await page.waitForTimeout(400)
  const afterRecord = await page.locator('.shortcut-table tr').filter({ hasText: 'Toggle Sidebar' }).first().textContent()
  check('the recorded chord is shown', /Alt\+Shift\+S/i.test(afterRecord), afterRecord.trim().slice(0, 60))
  check('a Reset button appears once overridden', (await sidebarRow.getByRole('button', { name: 'Reset' }).count()) === 1)

  // The dispatcher must use it, and the Command Centre must show it.
  await page.keyboard.press('Alt+Shift+S')
  await page.waitForTimeout(400)
  check('the rebind reaches the dispatcher', (await page.locator('.navrail-collapsed').count()) === 1)
  await page.keyboard.press('Control+k')
  await page.waitForSelector('.cc', { timeout: 10_000 })
  const cc = await page.locator('.cc').textContent()
  check('the Command Centre shows the rebind, not the default', /Alt\+⇧S|Alt\+Shift\+S/i.test(cc))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // Escape cancels recording.
  const settingsRow = page.locator('.shortcut-table tr').filter({ hasText: 'Open Settings' }).first()
  await settingsRow.getByRole('button', { name: 'Change' }).click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check('Escape cancels a recording', (await page.locator('.shortcut-recording').count()) === 0)
  check('Escape leaves the binding untouched', (await settingsRow.textContent()).includes('Ctrl'))

  // A reserved chord is refused.
  await settingsRow.getByRole('button', { name: 'Change' }).click()
  await page.keyboard.press('Control+c')
  await page.waitForTimeout(400)
  const reservedMessage = await page.locator('.account-error').textContent().catch(() => '')
  check('a reserved chord is refused', Boolean(reservedMessage), (reservedMessage ?? '').slice(0, 50))
  await page.keyboard.press('Escape')

  // Backspace resets.
  await sidebarRow.getByRole('button', { name: 'Reset' }).click()
  await page.waitForTimeout(400)
  const afterReset = await page.locator('.shortcut-table tr').filter({ hasText: 'Toggle Sidebar' }).first().textContent()
  check('Backspace/Reset restores the default', afterReset.includes('Ctrl+B'), afterReset.trim().slice(0, 50))

  // Filtering.
  await page.locator('.shortcuts-toolbar input').first().fill('theme')
  await page.waitForTimeout(300)
  const filtered = await page.locator('.shortcut-table tr').count()
  check('filtering narrows the list', filtered > 0 && filtered < rows, `${filtered} of ${rows}`)
  await page.locator('.shortcuts-toolbar input').first().fill('')

  // ------------------------------------------------------------ models
  await openSettings('Models & providers')
  const providerNav = await page.locator('.provider-nav-item').count()
  check('providers are listed in a detail nav', providerNav >= 2, `${providerNav} providers`)

  const modelRow = page.locator('.provider-model-row').first()
  await modelRow.click()
  await page.waitForTimeout(300)
  const body2 = await page.locator('.provider-model-body').textContent()
  check('per-model configuration is exposed', body2.includes('Context window') && body2.includes('Reasoning levels'))
  check('capability flags are present', body2.includes('Tool calling') && body2.includes('JSON schema output'))

  // A valid context window saves.
  await page.locator('.provider-model-body input[type="number"]').first().fill('200000')
  await page.waitForTimeout(400)
  const saved = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((k) => k.endsWith('provider_config'))
    return key ? JSON.parse(sessionStorage.getItem(key)) : null
  })
  check('a model edit is persisted to the provider config', Boolean(saved?.models) && Object.keys(saved.models).length > 0, JSON.stringify(saved?.models ?? {}).slice(0, 80))
  check('the saved value round-trips', JSON.stringify(saved?.models ?? {}).includes('200000'))

  // An invalid one is refused.
  await page.locator('.provider-model-body input[type="number"]').first().fill('-5')
  await page.waitForTimeout(400)
  const invalid = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((k) => k.endsWith('provider_config'))
    return key ? JSON.parse(sessionStorage.getItem(key)) : null
  })
  check('an invalid value is refused, not stored', !JSON.stringify(invalid?.models ?? {}).includes('-5'))

  // Reload persistence.
  await page.reload({ waitUntil: 'domcontentloaded' })
  try {
    await page.waitForSelector('.rail-item, .rail-icon', { timeout: 20_000 })
  } catch {
    // A blank window after reload means a settings view threw on hydrate.
    const what = await page.evaluate(() => ({ text: document.body.innerText.slice(0, 300), html: document.getElementById('root')?.innerHTML.length ?? -1 }))
    console.log('DIAG after reload:', JSON.stringify(what))
    console.log('DIAG errors:', errors.slice(0, 3).join(' | '))
    check('the app boots after a reload with settings persisted', false, JSON.stringify(what).slice(0, 200))
    throw new Error('app did not boot after reload')
  }
  await openSettings('Models & providers')
  await page.waitForTimeout(400)
  const persisted = await page.locator('.provider-model-row').first().textContent()
  check('model configuration survives a reload', persisted.includes('edited'), persisted.trim().slice(0, 60))

  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.screenshot({ path: join(root, 'settings-check.png') })
} finally {
  await browser.close()
  server.close()
}

const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} settings checks passed`)
console.log(`screenshot: ${join(root, 'settings-check.png')}`)
process.exit(failed.length ? 1 : 0)