/**
 * Semantic colour roles, ported from ZCode's DESIGN.md (Apache-2.0).
 *
 * ZCode's rule is that brand is for key emphasis and never a full-page
 * background, and that file-type icons keep their own descriptor colours
 * rather than inheriting brand. Orin's existing palette is preserved; this adds
 * the missing role names and the icon descriptors so a screen can ask for
 * "brand" or "file-icon-c" by meaning rather than by hex.
 */

export type IconDescriptor =
  | 'source' | 'header' | 'config' | 'docs' | 'data' | 'style'
  | 'script' | 'binary' | 'archive' | 'test' | 'image' | 'lock'

/** Icon descriptor → hue, in Orin's palette family. */
export const ICON_HUES: Readonly<Record<IconDescriptor, number>> = {
  source: 32, header: 24, config: 210, docs: 190, data: 150, style: 280,
  script: 200, binary: 350, archive: 45, test: 120, image: 320, lock: 0,
}

/** Map a file name to its icon descriptor. */
export function describeFile(name: string): IconDescriptor {
  // Windows paths use backslashes. Without normalising, a full path never
  // matches the anchored build-file and dotfile rules.
  const file = String(name ?? '').replace(/\\/g, '/')
  const base = file.slice(file.lastIndexOf('/') + 1)
  const lower = base.toLowerCase()

  // Raster only. SVG is markup, so it belongs with the style descriptors.
  if (/\.(png|jpg|jpeg|gif|webp|ico|avif)$/.test(lower)) return 'image'
  if (/\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/.test(lower)) return 'archive'
  if (/\.(exe|dll|so|dylib|bin|o|a|obj|wasm)$/.test(lower)) return 'binary'
  if (/(^|\.)(test|spec)\.[a-z]+$/.test(lower) || /_test\.[a-z]+$/.test(lower)) return 'test'
  if (/^(makefile|cmakelists\.txt|dockerfile)$/.test(lower)) return 'config'
  if (/\.(json|ya?ml|toml|ini|cfg|conf|lock|env)$/.test(lower)) return 'config'
  if (/\.(md|markdown|rst|txt|adoc)$/.test(lower)) return 'docs'
  if (/\.(csv|tsv|db|sqlite|sql)$/.test(lower)) return 'data'
  if (/\.(css|scss|less|svg)$/.test(lower)) return 'style'
  if (/\.(c|h|cc|cpp|cxx|hpp)$/.test(lower)) return 'source'
  if (/\.(rs|go|py|js|ts|tsx|jsx|java|kt|rb|php|swift|lua|sh|ps1)$/.test(lower)) return 'script'
  // Anything starting with a dot is a dotfile; treat as config.
  if (lower.startsWith('.')) return 'config'
  return 'source'
}

/**
 * A brand colour is for emphasis, not for filling a surface.
 *
 * The rule is that `--color-brand` must never be a full-page background. This
 * exists so that rule is checkable rather than aspirational.
 */
export function isSurfaceSafe(brandValue: string, role: string): boolean {
  const isSurfaceRole = /^(background|bg|canvas|panel|surface|fill)$/i.test(role)
  if (!isSurfaceRole) return true
  // A brand token may still be referenced by a surface role if it resolves to a
  // low-alpha overlay, which is what --accent-soft does.
  return /rgba?\([^)]*\/|rgba\([^)]*,\s*0?\.\d+\)|oklch\([^)]*\/|color-mix/.test(brandValue)
}
