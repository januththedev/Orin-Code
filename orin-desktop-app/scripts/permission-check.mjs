// The permission dialog: that it shows the TOOL and its ARGUMENTS (not a
// generic "it wants to change something"), that ZCode's direct-respond keys
// work, that Escape does NOT answer, and that a failed response is surfaced.
//
// Run: node scripts/permission-check.mjs

import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, normalize, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')
const port = 4326
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
const mocksPath = join(tmpdir(), 'perm-mocks.js')
writeFileSync(mocksPath, mocks)

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript(SHIM)
await context.addInitScript({ path: mocksPath })
await context.addInitScript(
  `
  const a = window.__ORIN_ANSWERS__ ?? {};
  const kv = new Map();
  const responded = [];
  window.__RESPONDED__ = responded;
  window.__FAIL_RESPOND__ = false;
  const { mockIPC, mockWindows, mockConvertFileSrc } = window.__ORIN_MOCKS__;
  mockWindows('main', { label: 'main' });
  mockConvertFileSrc((p) => p);
  mockIPC(async (cmd, x) => {
    if (cmd === 'store_get') { const r = sessionStorage.getItem('kv:' + x.key); return r === null ? null : JSON.parse(r) }
    if (cmd === 'store_set') { sessionStorage.setItem('kv:' + x.key, JSON.stringify(x.value)); return undefined }
    if (cmd === 'approvals_pending') {
      return [{
        approvalId: 'a-1', runId: 'run-1', expiresAtMs: Date.now() + 60000,
        tool: 'mcp_call',
        title: 'Call github.create_issue',
        detail: JSON.stringify({ service: 'github', method: 'POST', path: '/repos/OWNER/REPO/issues' }, null, 2),
        destructive: true,
      }];
    }
    if (cmd === 'approval_respond') {
      if (window.__FAIL_RESPOND__) return Promise.reject(new Error('run ended before your answer arrived'));
      responded.push({ id: x.approvalId, approved: x.approved, runId: x.runId });
      return undefined;
    }
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

try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.permission-dialog', { timeout: 20_000 })

  const text = await page.locator('.permission-dialog').textContent()
  check('the dialog names the tool', (text ?? '').includes('mcp_call'), (text ?? '').slice(0, 40))
  check('the dialog shows the title', (text ?? '').includes('Call github.create_issue'))
  check('the dialog shows the arguments, not a generic prompt',
    (text ?? '').includes('/repos/OWNER/REPO/issues'), 'the request path should be visible')
  check('a destructive request is marked', await page.locator('.permission-destructive').count() === 1)

  const options = await page.locator('.permission-option').allTextContents()
  check('ZCode’s numbered options are shown', options.length === 3 && options.join(' ').includes('1'), options.join(' | ').slice(0, 70))

  // Escape must NOT answer -- dismissing is not consent.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  check('Escape does not answer', (await page.evaluate(() => window.__RESPONDED__.length)) === 0)
  check('the dialog stays open after Escape', (await page.locator('.permission-dialog').count()) === 1)

  // A failed decision must surface, not vanish.
  await page.evaluate(() => { window.__FAIL_RESPOND__ = true })
  await page.keyboard.press('1')
  await page.waitForSelector('.permission-error', { timeout: 10_000 })
  const errText = await page.locator('.permission-error').textContent()
  check('a failed response is surfaced', (errText ?? '').includes('run ended'), (errText ?? '').slice(0, 50))
  check('a failed response does not close the dialog', (await page.locator('.permission-dialog').count()) === 1)

  // Reject is option 3, and it is not an approval.
  await page.evaluate(() => { window.__FAIL_RESPOND__ = false })
  await page.keyboard.press('3')
  await page.waitForTimeout(600)
  const responded = await page.evaluate(() => window.__RESPONDED__)
  check('pressing 3 rejects', responded.length === 1 && responded[0].approved === false, JSON.stringify(responded[0] ?? {}))
  check('the response is bound to its run', responded[0]?.runId === 'run-1')

  await page.screenshot({ path: join(root, 'permission-check.png') })
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  server.close()
}

const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} permission checks passed`)
console.log(`screenshot: ${join(root, 'permission-check.png')}`)
process.exit(failed.length ? 1 : 0)