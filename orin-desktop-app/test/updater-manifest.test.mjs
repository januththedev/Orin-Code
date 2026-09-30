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
