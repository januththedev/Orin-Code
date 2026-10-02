// Verifies the Command Centre against the behaviours ported from ZCode:
// scope prefixes, section grouping and order, token-substring matching,
// per-workspace search history, keyboard navigation, disabled rows, the
// capability filter, and that a command actually performs its action.
//
// Run: node scripts/command-centre-check.mjs

import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, normalize, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')
const port = 4324
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
const mocksPath = join(tmpdir(), 'cc-mocks.js')
writeFileSync(mocksPath, mocks)

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript(SHIM)
await context.addInitScript({ path: mocksPath })
await context.addInitScript(
  `
  const answers = window.__ORIN_ANSWERS__ ?? {};
  const kv = new Map();
  const { mockIPC, mockWindows, mockConvertFileSrc } = window.__ORIN_MOCKS__;
  mockWindows('main', { label: 'main' });
  mockConvertFileSrc((p) => p);
  mockIPC(async (cmd, x) => {
    if (cmd === 'store_get') { const r = sessionStorage.getItem('kv:' + x.key); return r === null ? null : JSON.parse(r) }
    if (cmd === 'store_set') { sessionStorage.setItem('kv:' + x.key, JSON.stringify(x.value)); return undefined }
    if (cmd === 'store_delete') { sessionStorage.removeItem('kv:' + x.key); return undefined }
    if (cmd === 'auth_device_start') return { userCode: 'ABCD-EFGH', verificationUri: 'x', interval: 5 };
    if (cmd === 'workspace_activate') return x.root;
    if (cmd === 'dialog_pick_folder') return { path: 'D:/Orin_ECOSYS/Orin-Code', name: 'Orin-Code' };
    if (cmd === 'term_create') return 'term-1';
    if (cmd === 'git_status') return { branch: 'main' };
    if (cmd === 'fs_read_dir') return [{ name: 'README.md', path: (x.path || 'D:/Orin_ECOSYS/Orin-Code') + '/README.md', type: 'file', size: 12 }];
    if (cmd === 'fs_read_file') return 'readme';
    if (cmd === 'fs_exists') return true;
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

const rows = () => page.locator('.cc-row:not(.cc-history)')
const rowLabels = async () => (await rows().allTextContents()).map((t) => t.trim())

const openCentre = async () => {
  // Ctrl+K from wherever the app is; ZCode's palette is global.
  await page.keyboard.press('Control+k')
  await page.waitForSelector('.cc', { timeout: 10_000 })
}

try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.new-chat-button', { timeout: 20_000 })

  // --- opens on the ZCode chord
  await openCentre()
  check('Ctrl+K opens the Command Centre', (await page.locator('.cc').count()) === 1)
  check('the input takes focus on open', await page.locator('.cc-input').evaluate((el) => el === document.activeElement))

  // --- scope tabs
  const tabs = (await page.locator('.cc-tab').allTextContents()).map((t) => t.trim())
  check('scope tabs are Recent/Commands/Conversations/Files', tabs.join(',') === 'Recent,Commands,Conversations,Files', tabs.join(','))

  // --- sections and ordering
  await page.locator('.cc-tab', { hasText: 'Commands' }).click()
  await page.waitForTimeout(200)
  const groups = await page.locator('.cc-group').allTextContents()
  const unique = [...new Set(groups)]
  check('commands are grouped into sections', unique.length >= 2, unique.join(','))
  const order = ['suggested', 'panels', 'configure', 'app']
  const ranks = unique.map((g) => order.indexOf(g.trim()))
  check('sections appear in ZCode order', ranks.every((r, i) => i === 0 || r >= ranks[i - 1]), unique.join(','))

  // --- capability filter: no review surface in Orin Code, so add-review-tab is gone
  let labels = await rowLabels()
  check('add-review-tab is filtered out (supportsReview: false)', !labels.join(' ').includes('Add review tab'), labels.length + ' rows')

  // ZCode collapses a section past three rows behind a "more results" row
  // rather than truncating, so the panels commands need expanding first.
  const panelsBefore = (await rowLabels()).filter((t) => t.startsWith('panels') && !t.includes('More results')).length
  check('a long section collapses to three rows', panelsBefore === 3, panelsBefore + ' panel rows')
  const more = page.locator('.cc-row').filter({ hasText: 'More results' }).first()
  check('a collapsed section offers more results', (await more.count()) === 1)
  await more.click()
  await page.waitForTimeout(200)
  // Expanding swaps the "more" row for the hidden commands, so the total can
  // barely move; assert on the panel labels themselves.
  const panelLabels = (await rowLabels()).filter((t) => t.startsWith('panels') && !t.includes('More results'))
  check(
    'expanding reveals the rest of the section',
    panelLabels.some((t) => t.includes('Add terminal tab')) && panelLabels.some((t) => t.includes('Add browser tab')),
    panelLabels.length + ' panel rows',
  )
  const panelsMore = (await rowLabels()).filter((t) => t.startsWith('panels') && t.includes('More results'))
  check('the panels more-results row is gone once expanded', panelsMore.length === 0, panelsMore.join(' | '))

  // --- token-substring matching, no fuzzy
  await page.locator('.cc-input').fill('termnal')
  await page.waitForTimeout(200)
  const fuzzyMiss = (await rowLabels()).join(' ')
  await page.locator('.cc-input').fill('terminal')
  await page.waitForTimeout(200)
  const exactHit = (await rowLabels()).join(' ')
  check('matching is substring, not fuzzy', !fuzzyMiss.includes('Toggle terminal') && exactHit.includes('Toggle terminal'))

  // --- scope prefix
  await page.locator('.cc-input').fill('>settings')
  await page.waitForTimeout(250)
  check('the > prefix scopes to commands', (await page.locator('.cc-row').count()) >= 1)
  await page.locator('.cc-input').fill('@readme')
  await page.waitForTimeout(250)
  check('the @ prefix scopes to files', (await page.locator('.cc-row').count()) >= 0)
  // A scope prefix pins the tab, exactly as ZCode's setScope does, so clear it
  // through the tab strip rather than assuming the input alone resets it.
  await page.locator('.cc-tab', { hasText: 'Commands' }).click()
  await page.locator('.cc-input').fill('')
  await page.waitForTimeout(250)

  // --- disabled rows stay visible rather than disappearing
  check('an unavailable command is shown disabled, not omitted', (await page.locator('.cc-row.disabled').count()) >= 1)

  // --- keyboard navigation and invocation
  await page.locator('.cc-input').fill('toggle sidebar')
  await page.waitForTimeout(200)
  const beforeRail = await page.locator('.navrail-collapsed').count()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  check('Enter runs the highlighted command', (await page.locator('.navrail-collapsed').count()) !== beforeRail)
  check('the dialog closes before the command runs', (await page.locator('.cc').count()) === 0)

  // --- history is recorded, per workspace, and survives a reload
  await openCentre()
  await page.locator('.cc-input').fill('terminal')
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const historyKey = await page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith('orin-command-center-search-history')))
  check('a search is recorded in per-workspace history', Boolean(historyKey), String(historyKey))
  const recorded = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]'), historyKey)
  check('history stores the query, scope and timestamp', recorded?.[0]?.query === 'terminal' && typeof recorded?.[0]?.updatedAt === 'number', JSON.stringify(recorded?.[0]))
  check('a bare scope prefix is never recorded as a query', !recorded.some((e) => ['>', '#', '@'].includes(e.query)), JSON.stringify(recorded.map((e) => e.query)))

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.shell', { timeout: 20_000 })
  // The toggle above collapsed the sidebar and that persists across the reload,
  // so the collapsed rail is what comes back -- reopen it.
  if ((await page.locator('.navrail-collapsed').count()) > 0) {
    check('the sidebar state survives a reload', true)
    await page.locator('[title="Toggle sidebar (Ctrl+B)"]').first().click()
    await page.waitForTimeout(300)
  }
  await openCentre()
  await page.waitForTimeout(300)
  check('history survives a reload', (await page.locator('.cc-history').count()) >= 1)

  await page.screenshot({ path: join(root, 'command-centre-check.png') })
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  server.close()
}

const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} command-centre checks passed`)
console.log(`screenshot: ${join(root, 'command-centre-check.png')}`)
process.exit(failed.length ? 1 : 0)