# Upstream sources

Three real projects, cloned whole and left intact. This directory is **upstream
source, not Orin Code**: nothing here has been edited, reformatted, ported to
another language, or had its dependencies pruned. Orin Code integration code
lives outside this tree, and nothing in the product imports from these
directories directly — the adapters that will eventually bridge them are
deliberately kept on the Orin side of the boundary.

**Current state: imported and pinned, NOT integrated.** Per the sequence in
`vendor/zcode/PARITY-AUDIT.md`, integration happens only after the ZCode parity
work is finished.

## Revisions

| Directory | Project | Upstream | Commit | Describe | Licence |
| --- | --- | --- | --- | --- | --- |
| `agent-audit/` | iFixAI | `github.com/ifixai-ai/iFixAi` | `ffda13c` | `v4.0.0-21-gffda13c` | Apache-2.0 |
| `agent-memory/` | Hindsight | `github.com/vectorize-io/hindsight` | `017b3f5d8` | `integrations/hermes/v1.2.1-41-g017b3f5d8` | MIT (c) 2025 Vectorize AI, Inc. |
| `agent-orchestration/` | Orca | `github.com/stablyai/orca` | `4e46969b7c` | `v1.4.214-542-g4e46969b7c` | MIT (c) 2026 Lovecast Inc. |

The directory names are implementation names, deliberately not product branding.
`Orca` in particular has nothing to do with the product's own naming; it is the
upstream project's name, kept because attribution requires it.

## Build systems

Recorded because the integration boundary depends on them, and because copying a
dependency tree into Orin's manifest without justification is explicitly out of
bounds:

| Project | Manifest | Runtime |
| --- | --- | --- |
| iFixAI | `pyproject.toml` | Python |
| Hindsight | `package.json` + `pyproject.toml` | Node **and** Python |
| Orca | `package.json` | Node |

None of the three is a native library for the Tauri binary. Each is a
self-contained project with its own toolchain, so the integration will need a
process or service boundary rather than a library link. That decision belongs to
the integration stage, once the real architectures have been read.

## Reproducing

```bash
git clone https://github.com/ifixai-ai/iFixAi.git      agent-audit      && git -C agent-audit      checkout ffda13c
git clone https://github.com/vectorize-io/hindsight.git agent-memory     && git -C agent-memory     checkout 017b3f5d8
git clone https://github.com/stablyai/orca.git          agent-orchestration && git -C agent-orchestration checkout 4e46969b7c
```

## Rules for this directory

- **Do not edit.** A future update is a new clone at a new pin, not a patch.
- **Do not reimplement.** If a capability is needed in Orin Code, bridge to the
  real implementation. An Orin-authored substitute is not a substitute.
- **Do not strip attribution.** `LICENSE`, `NOTICE`, copyright headers and any
  required attribution stay. Removing upstream branding from the *product UI* is
  a naming decision; it is never a licence decision.
- **Do not wire these into the build yet.** Integration is a later stage of the
  parity sequence, and the Tauri bundle must be verified to locate and execute
  whatever the integration ends up needing — a development build passing is not
  evidence that the packaged app can run it.
