/**
 * Extension → Monaco language mapping.
 *
 * Kept in its own module with no imports so the table can be tested. Getting
 * this wrong is invisible in the editor — a `.c` file silently opens as
 * unhighlighted plaintext — so the table is covered by tests rather than by
 * hoping someone notices.
 *
 * Order matters: the first match wins, so the specific patterns come before the
 * generic ones. `.h` is deliberately grouped with C++ because that is what
 * almost every real header is.
 */

export const LANGUAGES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.(ts|tsx|mts|cts)$/i, 'typescript'],
  [/\.(js|jsx|mjs|cjs)$/i, 'javascript'],
  [/\.pyw?$/i, 'python'],
  [/\.rs$/i, 'rust'],
  [/\.go$/i, 'go'],
  [/\.java$/i, 'java'],
  [/\.kt$/i, 'kotlin'],
  [/\.c$/i, 'c'],
  [/\.(cpp|cc|cxx|hh|hpp)$/i, 'cpp'],
  [/\.h$/i, 'cpp'],
  [/\.cs$/i, 'csharp'],
  [/\.swift$/i, 'swift'],
  [/\.rb$/i, 'ruby'],
  [/\.php$/i, 'php'],
  [/\.sql$/i, 'sql'],
  [/\.lua$/i, 'lua'],
  [/\.(xml|xsl|svg|plist|csproj)$/i, 'xml'],
  [/\.(vue|svelte|astro)$/i, 'html'],
  [/\.jsonc?$/i, 'json'],
  [/\.(css|scss|less)$/i, 'css'],
  [/\.html?$/i, 'html'],
  [/\.(md|markdown)$/i, 'markdown'],
  [/\.(sh|bash|zsh|ps1)$/i, 'shell'],
  [/\.(yml|yaml)$/i, 'yaml'],
  [/\.(toml|ini|cfg|conf)$/i, 'ini'],
  // Build files. A C or C++ project is defined by these far more than by any
  // single source file, so they get first-class highlighting.
  [/(^|\/)(makefile|gnumakefile)$/i, 'shell'],
  [/(^|\/)cmakelists\.txt$/i, 'cmake'],
  [/\.mk$/i, 'shell'],
  [/(^|\/)meson\.build$/i, 'ini'],
  [/(^|\/)configure\.ac$/i, 'shell'],
  [/\.cmake$/i, 'cmake'],
  // Matches Dockerfile, Dockerfile.dev, Dockerfile.prod — but not a random
  // file that merely starts with the word, like "Dockerfile-notes.md".
  [/^dockerfile(\.[\w-]+)*$/i, 'dockerfile'],
  [/\.git(ignore|attributes|modules)$/i, 'ini'],
]

/** Map a file name or path to a Monaco language id. */
export function languageFor(name: string): string {
  const path = String(name ?? '').replace(/\\/g, '/')
  const base = path.slice(path.lastIndexOf('/') + 1)
  return LANGUAGES.find(([pattern]) => pattern.test(base))?.[1] ?? 'plaintext'
}
