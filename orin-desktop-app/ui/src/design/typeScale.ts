/**
 * The interface type scale, and the rule that keeps it honest.
 *
 * Ported from ZCode's DESIGN.md (Apache-2.0, see vendor/zcode/MODIFICATIONS.md).
 * Six semantic roles derived from a single base, plus one restricted floor size.
 *
 * The rule that matters: interface size changes by changing `--ui-font-size`
 * and nothing else. Never by setting the root font size, never by a hardcoded
 * pixel value in a component. A hardcoded value is the bug this module exists
 * to make detectable — `ui/test/type-scale.test.mjs` fails the build if one
 * creeps back into a stylesheet.
 */

export type TypeRole = 'xl' | 'lg' | 'base' | 'caption' | 'sm' | 'xs' | '2xs'

/** Offset from the base, in px. */
const ROLE_OFFSET: Readonly<Record<TypeRole, number>> = {
  xl: 4,
  lg: 2,
  base: 0,
  caption: -1,
  sm: -2,
  xs: -4,
  '2xs': -5,
}

export const TYPE_ROLES: readonly TypeRole[] = ['xl', 'lg', 'base', 'caption', 'sm', 'xs', '2xs']

/** Default and permitted range for the base interface size. */
export const UI_FONT_SIZE_DEFAULT = 14
export const UI_FONT_SIZE_MIN = 12
export const UI_FONT_SIZE_MAX = 18

export const CSS_VAR = '--ui-font-size'

/** Role → CSS custom property, e.g. `xl` → `--fs-lg`. */
export const ROLE_VAR: Readonly<Record<TypeRole, string>> = {
  xl: '--fs-lg',
  lg: '--fs-md',
  base: '--fs-base',
  caption: '--fs-caption',
  sm: '--fs-sm',
  xs: '--fs-xs',
  '2xs': '--fs-2xs',
}

/** Compute one role's pixel size for a given base. */
export function sizeFor(role: TypeRole, base: number = UI_FONT_SIZE_DEFAULT): number {
  return base + ROLE_OFFSET[role]
}

/**
 * Coerce a stored or user-supplied base into the permitted range.
 *
 * A corrupt stored value must not be able to produce a negative or absurd
 * `--ui-font-size` that breaks every rule derived from it.
 */
export function clampUiFontSize(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : UI_FONT_SIZE_DEFAULT
  return Math.min(UI_FONT_SIZE_MAX, Math.max(UI_FONT_SIZE_MIN, n))
}

/** Every role's computed size, for verification and documentation. */
export function scaleFor(base: number = UI_FONT_SIZE_DEFAULT): Record<TypeRole, number> {
  const out = {} as Record<TypeRole, number>
  for (const role of TYPE_ROLES) out[role] = sizeFor(role, base)
  return out
}

/**
 * Content-level type that legitimately sits outside the interface scale:
 * code, diff, terminal and Monaco output, keyboard hints, and display type such
 * as a homepage headline. These render content the user picked a size for, or
 * are deliberately larger than any interface role.
 */
const CONTENT_EXEMPT = /(\.message-|code|diff|terminal|monaco|kbd|\bpre\b|display|headline|hero|boot-mark)/i

/**
 * Is a `font-size: Npx` declaration allowed here?
 *
 * Interface declarations must use a scale token instead. Content-level type —
 * code, diff, terminal, and Monaco output — keeps its own numeric size, because
 * those render text the user chose the size for.
 */
export function isAllowedFontSize(declaration: string, selector: string): boolean {
  if (CONTENT_EXEMPT.test(selector)) return true
  return !/font-size\s*:\s*[\d.]+(px|rem)/i.test(declaration)
}
