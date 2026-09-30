#!/usr/bin/env node
/**
 * Build the updater manifest (`latest.json`) for a release.
 *
 * The Tauri CLI signs the installer and writes `<installer>.exe.sig`, but it
 * never writes the manifest — the string `latest.json` does not appear in the
 * CLI binary at all. Publishing the manifest is the release process's job, so
 * this does it, and the in-app updater has something to fetch.
 *
 * The manifest is derived entirely from artifacts that are actually on disk. If
 * an installer is unsigned there is no manifest, because an update the app
 * cannot verify is worse than no update at all.
 *
 * Usage:
 *   node scripts/make-latest-json.mjs --dir artifacts --version 1.8.0 \
 *     --repo januththedev/Orin-Code --tag v1.8.0
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, basename } from 'node:path'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (!key.startsWith('--')) continue
    out[key.slice(2)] = argv[i + 1]
    i += 1
  }
  return out
}

/**
 * Read a `.sig` file into the base64 signature the manifest carries.
 *
 * Tauri's Windows `.sig` is the bare base64 signature, but some toolchains emit
 * a JSON wrapper. Handle both rather than publishing a manifest the app cannot
 * verify.
 */
export async function readSignature(sigPath) {
  const raw = (await readFile(sigPath, 'utf8')).trim()
  if (!raw) throw new Error(`Signature file is empty: ${basename(sigPath)}`)
  if (raw.startsWith('{')) {
    const parsed = JSON.parse(raw)
    const signature = parsed.signature || parsed.sig
    if (!signature) throw new Error(`No signature field in ${basename(sigPath)}`)
    return String(signature).trim()
  }
  return raw
}

export function platformKey() {
  return 'windows-x86_64'
}

/** Filesystem-safe, and the exact name the release asset will have. */
export function releaseUrl(repo, tag, fileName) {
  return `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(fileName)}`
}

export async function collectArtifacts(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const names = entries.filter((e) => e.isFile()).map((e) => e.name)
  const installer = names.find((n) => n.endsWith('.exe') && !n.endsWith('.sig'))
  if (!installer) throw new Error(`No installer (.exe) in ${dir}`)
  const sig = names.find((n) => n.endsWith('.sig') && n.startsWith(installer))
  if (!sig) {
    throw new Error(
      `No signature for ${installer}. The build was unsigned, so there is nothing the app could verify.`,
    )
  }
  return { installer, sig }
}

export async function buildManifest({ dir, version, repo, tag, notes, now }) {
  const { installer, sig } = await collectArtifacts(dir)
  const signature = await readSignature(join(dir, sig))
  return {
    version,
    notes: notes || `Orin Code ${version}`,
    pub_date: (now ? new Date(now) : new Date()).toISOString(),
    platforms: {
      [platformKey()]: {
        signature,
        url: releaseUrl(repo, tag, installer),
      },
    },
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { dir, version, repo, tag, notes } = args
  if (!dir || !version || !repo || !tag) {
    console.error('usage: make-latest-json.mjs --dir <artifacts> --version <v> --repo <owner/name> --tag <vX.Y.Z> [--notes <text>]')
    process.exit(2)
  }
  const manifest = await buildManifest({ dir, version, repo, tag, notes })
  const out = join(dir, 'latest.json')
  await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const target = Object.values(manifest.platforms)[0]
  console.log(`wrote ${out}`)
  console.log(`  version   ${manifest.version}`)
  console.log(`  platform  ${platformKey()}`)
  console.log(`  asset     ${target.url}`)
  console.log(`  signature ${target.signature.length} chars`)
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  main().catch((error) => {
    console.error(`make-latest-json: ${error.message}`)
    process.exit(1)
  })
}
