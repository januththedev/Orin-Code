# Modifications

## What is vendored here

This directory contains **reference material only**, taken from
[`zai-org/ZCode`](https://github.com/zai-org/ZCode) ("ZCode"), fetched at
upstream commit `29628c9acdb81b703bbd4080c207a0e7ce5e276e` (2026-09-24).

| File | Status |
| --- | --- |
| `LICENSE` | **Unmodified.** Apache License 2.0, copied verbatim. |
| `NOTICE.md` | **Unmodified.** Upstream's own disclosure, copied verbatim. |
| `THIRD-PARTY-NOTICES.md` | **Unmodified.** Upstream's third-party attributions. |
| `DESIGN.md` | **Unmodified.** Upstream's design system, read as reference. |
| `README.en.md` | **Unmodified.** |

Orin Code ships **none** of ZCode's source code. No ZCode source file has been
copied, vendored, or linked into this repository. What is retained here is the
documentation that Apache-2.0 §4(d) and §4(f) require us to keep if we ever
redistribute any derived work, together with the design system we are reading
from.

## Licence position

ZCode is licensed under the Apache License, Version 2.0. That licence permits
commercial use, modification, and distribution, and includes an express patent
grant. What it requires, and what Orin Code does:

- **§4(a) — retain copyright, licence, and NOTICE notices.** `LICENSE`,
  `NOTICE.md`, and `THIRD-PARTY-NOTICES.md` are present in this directory
  verbatim, and the About screen credits Z.ai / Zhipu AI (Z.ai).
- **§4(b) — state significant changes.** This file is that statement.
- **§4(c) — keep any embedded attribution notices.** Upstream's are untouched.
- **§6 — no trademark grant.** Orin Code ships **no** Z.ai or ZCode marks, no
  ZCode name in its product surface, and makes no claim of affiliation. The
  Orin name, bolt mark, palette, and design tokens are Orin's own.

## What Orin Code has taken, and what it has not

**Taken as influence (design intent, not code):** the information architecture
studied from `DESIGN.md` — a calm, dense, operational interface, a mandatory
`text-ui-*` type scale, explicit light and dark token sets, and a rule that
interface type never scales by mutating the root font size.

**Not taken:** ZCode's source, its component implementations, its Tailwind token
values, its agent runtime, its CLI, and its plugin system.

**Deliberately not inherited.** Upstream's own `NOTICE.md` states two things
that Orin Code does better and keeps:

- Upstream's Computer Use package is a non-functional placeholder that returns
  an unavailable error. Orin Code ships a working one.
- Upstream's shared agent adapter provides no default OS-level sandbox. Orin
  Code's agent runs inside a Rust-enforced workspace boundary that rejects path
  traversal, symlink escapes, and any path outside the activated root, and
  every mutating action requires a run-bound, expiring, single-use approval.

## If derived work is ever added

If ZCode source is later vendored or linked, this file must be updated to list
which files, what changed, and where; `LICENSE`, `NOTICE.md`, and
`THIRD-PARTY-NOTICES.md` must travel with the derived work; and the About
screen must continue to credit Z.ai / Zhipu AI.

## Upstream

- Repository: <https://github.com/zai-org/ZCode>
- Copyright: Z.ai / Zhipu AI
- Licence: Apache-2.0
- Pinned commit: `29628c9acdb81b703bbd4080c207a0e7ce5e276e`
- To refresh: `git fetch --depth 1 zcode main && git checkout FETCH_HEAD -- LICENSE NOTICE.md THIRD-PARTY-NOTICES.md DESIGN.md README.en.md`
