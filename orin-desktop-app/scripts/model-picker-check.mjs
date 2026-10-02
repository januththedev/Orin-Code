// Focused check for the fix in ui/src/stores/modelsStore.ts: with a Groq key
// present, do Groq's models reach the composer picker?
//
// This is the assertion the unit tests cannot make, because the defect lived in
// the seam between the bridge, the store and the picker. It opens the real
// picker, and it fails if a configured non-OpenRouter provider is missing from
// the menu -- which is exactly what the user was seeing.
//
// Run: node scripts/model-picker-check.mjs

import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, normalize, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')
const port = 4321
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

// Reuse the sweep's answers and mock wiring rather than duplicating them.
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
  const { mockIPC, mockWindows, mockConvertFileSrc } = window.__ORIN_MOCKS__;
  mockWindows('main', { label: 'main' });
  mockConvertFileSrc((p) => p);
  // A real key/value store so persistence is actually exercised. Backed by
  // sessionStorage rather than a Map: this init script re-runs on every
  // navigation, so a Map would be wiped by the reload the check is trying to
  // survive, and "persistence works" would be reported against a store that
  // had just forgotten everything.
  const storeGet = (key) => {
    const raw = sessionStorage.getItem('orin-kv:' + key);
    return raw === null ? null : JSON.parse(raw);
  };
  const storeSet = (key, value) => { sessionStorage.setItem('orin-kv:' + key, JSON.stringify(value)); return undefined; };
  const storeDelete = (key) => { sessionStorage.removeItem('orin-kv:' + key); return undefined; };
  mockIPC(async (cmd, args) => {
    if (cmd === 'store_get') return storeGet(args && args.key);
    if (cmd === 'store_set') return storeSet(args && args.key, args && args.value);
    if (cmd === 'store_delete') return storeDelete(args && args.key);
    // models_fetch is per-preset in the real bridge, so answer per preset here
    // rather than returning one list for every provider.
    if (cmd === 'models_fetch') {
      const preset = args && args.presetId;
      if (preset === 'groq') return answers.groq_models;
      if (preset === 'openrouter') return answers.openrouter_models;
      return [];
    }
    return answers[cmd];
  });
`,
)
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const checks = []
const check = (name, pass, detail = '') => {
  checks.push({ name, pass, detail })
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.new-chat-button', { timeout: 20_000 })
  await page.locator('.new-chat-button').click()
  await page.waitForSelector('.model-selector', { timeout: 20_000 })
  // The store loads the curated catalog, then every keyed provider.
  await page.waitForTimeout(1200)

  const trigger = page.locator('.model-selector')
  check('picker trigger is present', (await trigger.count()) === 1)
  const before = (await trigger.textContent()) ?? ''
  check('a model is selected by default', before.trim().length > 0, `shows "${before.trim()}"`)

  await trigger.click()
  await page.waitForSelector('.model-menu', { timeout: 10_000 })
  const menuText = (await page.locator('.model-menu').textContent()) ?? ''

  // The defect: a keyed, non-OpenRouter provider was never in this list.
  check('a keyed Groq model is in the picker', menuText.includes('Llama 3.3 70B (Groq)'))
  check('a second Groq model is in the picker', menuText.includes('Kimi K2 (Groq)'))
  check('the keyed OpenRouter model is in the picker', menuText.includes('DeepSeek V3 - Free'))
  check('the curated offline model is still offered', menuText.includes('Orin Offline'))
  check(
    'a provider with no key is not fetched',
    !menuText.includes('DeepSeek Chat'),
    'deepseek reports hasKey:false, so it must not appear',
  )

  // Switching must work and must be reflected in the trigger.
  // Target the item itself: filtering the panel matched a wrapper and the
  // click landed on whichever model happened to be under the pointer.
  const groqItem = page.locator('.model-menu .dropdown-item').filter({ hasText: 'Kimi K2 (Groq)' }).first()
  await groqItem.click()
  await page.waitForTimeout(600)
  const after = (await page.locator('.model-selector').textContent()) ?? ''
  check('selecting a model updates the trigger', after.includes('Kimi K2'), `shows "${after.trim()}"`)

  // And it must persist across a reload, which is what storeSet/storeGet does.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.model-selector', { timeout: 20_000 })
  await page.waitForTimeout(1200)
  const persisted = (await page.locator('.model-selector').textContent()) ?? ''
  check(
    'the selection survives a reload',
    persisted.includes('Kimi K2'),
    persisted.includes('Kimi K2') ? 'persisted' : `after reload it shows "${persisted.trim()}"`,
  )

  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  server.close()
}

const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} model-picker checks passed`)
process.exit(failed.length ? 1 : 0)
