# Orin brand kit

Everything here is **generated**. Edit the generators, not the files.

```bash
npm run brand          # marks + rasters + sounds
npm run brand:marks    # brand/logo/*.svg and brand/pets/*.svg
npm run brand:raster   # brand/png/*.png
npm run brand:sounds   # brand/sounds/*.wav, copied into ui/public/brand/
```

Generation is deterministic — no randomness, no timestamps in the data — so
regenerating produces byte-identical output and `git diff` only moves when the
design actually changed.

## Why generated rather than drawn

There are now two renderings of the brand: one in the app, one in this folder.
The arrangement that lets those drift apart silently is to define each twice, so
`test/brand-assets.test.mjs` is the thing that keeps them honest. It asserts
that the cue list, the pet geometry, and the logo file set on both sides match,
and that no logo renders with content flush against its own edge.

## Logo

| File | Use |
|---|---|
| `orin-mark.svg` | Flexible default. Bolt only, transparent. |
| `orin-mark-mono.svg` | One colour, `currentColor`. 16px favicons, single-colour print, emboss. |
| `orin-appicon-{dark,light}.svg` | Mark on a plate, for icons and avatars. |
| `orin-appicon-1024.svg` | Source for every raster size and store listings. |
| `orin-lockup-horizontal.svg` | Bolt + wordmark on one optical centre line. |
| `orin-lockup-stacked.svg` | Square placements. |
| `orin-lockup-reversed.svg` | Dark headers, where ink-on-paper is unavailable. |

The bolt is on a 24-unit grid and centred **optically, not geometrically**: its
diagonals read heavier than its flats, so without the correction it looks
top-heavy. The wordmark is drawn as paths — no webfont, so the logo renders
identically wherever it is placed.

The wordmark letterforms are composed from rounded rects and polygons rather
than hand-written bezier contours. The first attempt used one path per glyph
with a subpath for the counter, and the O came out wrong: the outer contour
spanned 0–10.6 while the counter spanned 0.3–4.0, so it hugged the left edge
and read as a filled shape with a slit.

## Pets

One sprite per companion, on the same 24-unit grid, each with a distinct
silhouette so they read at 18px. The geometry lives in
`ui/src/features/pets/petModel.ts` and `generate-brand-marks.mjs` imports that
module — the files in `brand/pets/` and the sprites the app draws are one
definition, not two.

Hue is applied at render time (`--pet-hue`), so a single sprite serves every
mood. The plates put the pet on brand ink rather than a tint of its own hue: a
plate and a pet in the same colour with no contrast between them render as one
solid square and the silhouette — the whole point of the sprite — disappears.

## Sound

Five cues — `send`, `thinking`, `reply`, `success`, `error` — as 16-bit mono
44.1kHz PCM, rendered from the same frequency and envelope table that
`ui/src/design/sound.ts` synthesises at runtime.

The app still synthesises by default. A runtime oscillator costs no download, no
decode, and carries no licence, and it works with no filesystem access at all.
The WAVs exist so the brand sounds the same on a website, in a video, or in a
support clip — surfaces that cannot run a synth. `ui/src/design/soundAssets.ts`
exposes them with synthesis as the fallback, so a missing or undecodable file
degrades to the synthesised cue rather than to silence.
