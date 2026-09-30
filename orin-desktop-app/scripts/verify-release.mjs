#!/usr/bin/env node
/**
 * Verify a published release is internally coherent.
 *
 * The updater broke four separate ways before, and every one of them produced a
 * release that looked fine: the manifest was missing, the manifest was never
 * generated, the asset URL 404'd because GitHub rewrote the space in the
 * filename, and the signature was collected and then thrown away. None of those
 * is visible from the release page.
 *
 * This checks the chain an installed app actually walks:
 *
 *   manifest -> asset URL -> bytes -> signature sibling
 *
 * Usage:
 *   node scripts/verify-release.mjs
 *   node scripts/verify-release.mjs https://github.com/OWNER/REPO/releases/latest/download/latest.json
 */

import { readFile } from 'node:fs/promises'

const DEFAULT_MANIFEST = 'https://github.com/januththedev/Orin-Code/releases/latest/download/latest.json'

const ok = (m) => console.log(`  ok    ${m}`)
const bad = (m) => {
  console.error(`  FAIL  ${m}`)
  process.exitCode = 1
}

async function main() {
  const manifestUrl = process.argv[2] || DEFAULT_MANIFEST
  console.log(`verifying ${manifestUrl}\n`)

  // 1. The manifest the app fetches must exist and parse.
  const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) {
    bad(`manifest returned HTTP ${response.status}`)
    return
  }
  ok(`manifest fetched (HTTP ${response.status})`)

  const manifest = await response.json()
  const platform = manifest?.platforms?.['windows-x86_64']
  if (!platform) {
    bad('manifest has no windows-x86_64 platform entry')
    return
  }
  ok(`version ${manifest.version}`)

  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    bad(`version "${manifest.version}" is not semver`)
  } else {
    ok('version is semver')
  }
  if (typeof manifest.pub_date === 'string' && !Number.isNaN(Date.parse(manifest.pub_date))) {
    ok('pub_date parses')
  } else {
    bad(`pub_date "${manifest.pub_date}" does not parse`)
  }

  // 2. The signature must be present and base64-shaped. Tauri uses minisign.
  if (typeof platform.signature !== 'string' || platform.signature.length < 100) {
    bad('signature is missing or implausibly short')
  } else if (!/^[A-Za-z0-9+/=]+$/.test(platform.signature)) {
    bad('signature is not base64')
  } else {
    ok(`signature present (${platform.signature.length} chars)`)
  }

  // 3. The asset URL must actually resolve — this is where GitHub rewriting
  //    " " to "." in the asset name broke us before.
  if (/[%2F\s]/.test(platform.url) || /\s/.test(decodeURIComponent(platform.url))) {
    bad(`asset URL contains an encoded space or whitespace: ${platform.url}`)
  } else {
    ok('asset URL has no whitespace to be rewritten')
  }

  const asset = await fetch(platform.url, { signal: AbortSignal.timeout(60_000) })
  if (!asset.ok) {
    bad(`asset returned HTTP ${asset.status} — the updater would 404 on download`)
    return
  }
  const bytes = Number(asset.headers.get('content-length') || 0)
  ok(`asset downloads (HTTP ${asset.status}${bytes ? `, ${bytes} bytes` : ''})`)

  // 4. The signature the manifest names must be the same one published as the
  //    asset's sibling, or the app is verifying against nothing.
  const sigResponse = await fetch(`${platform.url}.sig`, { signal: AbortSignal.timeout(30_000) })
  if (!sigResponse.ok) {
    bad(`signature sibling returned HTTP ${sigResponse.status}`)
    return
  }
  const published = (await sigResponse.text()).trim()
  if (published !== platform.signature.trim()) {
    bad('the manifest signature differs from the published .sig')
  } else {
    ok('manifest signature matches the published .sig')
  }

  // 5. The app can only accept this if the committed public key is present.
  //    Tauri stores it base64-wrapped, so decode before judging the shape.
  const stored = (await readFile(new URL('../updater.pub', import.meta.url), 'utf8')).trim()
  const pubkey = (() => {
    try {
      return Buffer.from(stored, 'base64').toString('utf8').trim()
    } catch {
      return stored
    }
  })()
  if (/minisign public key: [0-9A-F]{16}/.test(pubkey)) {
    ok('updater.pub is a minisign public key')
  } else {
    bad('updater.pub does not decode to a minisign public key')
  }

  console.log(process.exitCode ? '\nrelease is NOT coherent' : '\nrelease is coherent')
}

if (process.argv[1]?.endsWith('verify-release.mjs')) {
  main().catch((error) => {
    console.error(`verify-release: ${error.message}`)
    process.exit(1)
  })
}
