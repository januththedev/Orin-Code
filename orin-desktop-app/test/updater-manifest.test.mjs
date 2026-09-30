import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildManifest, collectArtifacts, readSignature, releaseUrl, platformKey } from '../scripts/make-latest-json.mjs'

const REPO = 'januththedev/Orin-Code'
const TAG = 'v1.8.0'
const VERSION = '1.8.0'
const INSTALLER = 'Orin Code_1.8.0_x64-setup.exe'
const SIG = `${INSTALLER}.sig`
const SIGNATURE = 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ=='

async function fixture(files) {
  const dir = await mkdtemp(join(tmpdir(), 'orin-manifest-'))
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, name), body, 'utf8')
  }
  return dir
}

test('the manifest is built from the signed installer on disk', async () => {
  const dir = await fixture({ [INSTALLER]: 'MZ binary', [SIG]: SIGNATURE })
  const manifest = await buildManifest({ dir, version: VERSION, repo: REPO, tag: TAG, notes: '', now: '2026-01-02T03:04:05.000Z' })

  assert.equal(manifest.version, VERSION)
  assert.equal(manifest.pub_date, '2026-01-02T03:04:05.000Z')
  assert.equal(manifest.platforms[platformKey()].signature, SIGNATURE)
  assert.equal(
    manifest.platforms[platformKey()].url,
    'https://github.com/januththedev/Orin-Code/releases/download/v1.8.0/Orin%20Code_1.8.0_x64-setup.exe',
  )
  assert.equal(manifest.notes, 'Orin Code 1.8.0')
})

test('an unsigned installer produces no manifest, because the app could not verify it', async () => {
  const dir = await fixture({ [INSTALLER]: 'MZ binary' })
  await assert.rejects(() => collectArtifacts(dir), /No signature/)
})

test('a manifest with no installer is refused', async () => {
  const dir = await fixture({ 'latest.json': '{}' })
  await assert.rejects(() => collectArtifacts(dir), /No installer/)
})

test('a .sig that is a JSON wrapper is unwrapped rather than published verbatim', async () => {
  const dir = await fixture({ [INSTALLER]: 'MZ', [SIG]: JSON.stringify({ signature: SIGNATURE, pubkey: 'abc' }) })
  const signature = await readSignature(join(dir, SIG))
  assert.equal(signature, SIGNATURE)
})

test('an empty or signature-less .sig is refused', async () => {
  const empty = await fixture({ 'a.sig': '   \n' })
  await assert.rejects(() => readSignature(join(empty, 'a.sig')), /empty/)
  const noField = await fixture({ 'a.sig': JSON.stringify({ pubkey: 'abc' }) })
  await assert.rejects(() => readSignature(join(noField, 'a.sig')), /No signature field/)
})

test('the asset name is percent-encoded so a spaced filename resolves', () => {
  const url = releaseUrl(REPO, TAG, INSTALLER)
  assert.ok(!url.includes(' '), `url must not contain a raw space: ${url}`)
  assert.ok(url.endsWith('Orin%20Code_1.8.0_x64-setup.exe'), url)
})

test('the signature file belonging to a different installer is not borrowed', async () => {
  // A .sig for some other file must not satisfy this installer's manifest.
  const dir = await fixture({ [INSTALLER]: 'MZ', 'Other_1.0.0_x64-setup.exe.sig': SIGNATURE })
  await assert.rejects(() => collectArtifacts(dir), /No signature/)
})

test('the written manifest is valid JSON a client can parse', async () => {
  const dir = await fixture({ [INSTALLER]: 'MZ', [SIG]: SIGNATURE })
  const manifest = await buildManifest({ dir, version: VERSION, repo: REPO, tag: TAG, now: '2026-01-01T00:00:00.000Z' })
  const reparsed = JSON.parse(JSON.stringify(manifest))
  assert.equal(reparsed.platforms['windows-x86_64'].signature, SIGNATURE)
})

test('the script actually runs as a command line, not just when imported', async () => {
  // The first version guarded its entry point with a hand-built
  // `file://${argv[1]}` comparison, which produces two slashes on Windows
  // where the real URL has three. The entry body never ran, the process exited
  // 0, and the release silently shipped without a manifest. Import-only tests
  // cannot catch that, so run it.
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join, resolve } = await import('node:path')

  const dir = await mkdtemp(join(tmpdir(), 'orin-cli-'))
  await writeFile(join(dir, INSTALLER), 'MZ', 'utf8')
  await writeFile(join(dir, SIG), SIGNATURE, 'utf8')

  const script = resolve('scripts/make-latest-json.mjs')
  const { stdout } = await run(process.execPath, [script, '--dir', dir, '--version', VERSION, '--repo', REPO, '--tag', TAG])

  assert.match(stdout, /wrote /, `the CLI must actually write: ${stdout}`)
  const written = JSON.parse(await readFile(join(dir, 'latest.json'), 'utf8'))
  assert.equal(written.version, VERSION)
  assert.equal(written.platforms['windows-x86_64'].signature, SIGNATURE)
})

test('the command line exits non-zero for an unsigned installer', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join, resolve } = await import('node:path')
  const run = promisify(execFile)

  const dir = await mkdtemp(join(tmpdir(), 'orin-cli-bad-'))
  await writeFile(join(dir, INSTALLER), 'MZ', 'utf8')
  const script = resolve('scripts/make-latest-json.mjs')
  await assert.rejects(
    () => run(process.execPath, [script, '--dir', dir, '--version', VERSION, '--repo', REPO, '--tag', TAG]),
    /No signature/,
  )
})

test('the asset name has nothing GitHub would rewrite on upload', async () => {
  // GitHub replaced the space in "Orin Code_1.8.0_x64-setup.exe" with a dot
  // when it was uploaded, so the manifest's %20 URL 404'd and the app offered
  // an update it could not download.
  const { buildManifest } = await import('../scripts/make-latest-json.mjs')
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const dir = await mkdtemp(join(tmpdir(), 'orin-name-'))
  const name = 'orin-code_1.8.0_x64-setup.exe'
  await writeFile(join(dir, name), 'MZ', 'utf8')
  await writeFile(join(dir, `${name}.sig`), SIGNATURE, 'utf8')

  const manifest = await buildManifest({ dir, version: VERSION, repo: REPO, tag: TAG, now: '2026-01-01T00:00:00.000Z' })
  const url = manifest.platforms['windows-x86_64'].url
  assert.ok(!/%20/.test(url), `the URL must not depend on a space: ${url}`)
  assert.ok(!/\s/.test(url), `the URL must contain no whitespace: ${url}`)
  assert.ok(url.endsWith(name), url)
})
