import test from 'node:test'
import assert from 'node:assert/strict'
import { languageFor, LANGUAGES } from '../ui/src/features/ide/languages.ts'

test('C and its headers resolve, since C is a primary target', () => {
  for (const name of ['main.c', 'src/parser.c', 'CORE.C', 'a/b/c/deep.c']) {
    assert.equal(languageFor(name), 'c', name)
  }
  // .h is grouped with C++ because that is what real headers almost always are.
  for (const name of ['stdio.h', 'include/vector.h']) {
    assert.equal(languageFor(name), 'cpp', name)
  }
})

test('C build files are highlighted, not left as plaintext', () => {
  assert.equal(languageFor('Makefile'), 'shell')
  assert.equal(languageFor('makefile'), 'shell')
  assert.equal(languageFor('src/Makefile'), 'shell')
  assert.equal(languageFor('GNUmakefile'), 'shell')
  assert.equal(languageFor('CMakeLists.txt'), 'cmake')
  assert.equal(languageFor('build/CMakeLists.txt'), 'cmake')
  assert.equal(languageFor('meson.build'), 'ini')
  assert.equal(languageFor('configure.ac'), 'shell')
  assert.equal(languageFor('rules.mk'), 'shell')
})

test('the main languages are all mapped', () => {
  const cases = {
    'a.ts': 'typescript', 'a.tsx': 'typescript', 'a.js': 'javascript', 'a.jsx': 'javascript',
    'a.py': 'python', 'main.rs': 'rust', 'main.go': 'go', 'A.java': 'java',
    'a.kt': 'kotlin', 'a.cpp': 'cpp', 'a.hpp': 'cpp', 'a.cs': 'csharp', 'a.swift': 'swift',
    'a.rb': 'ruby', 'a.php': 'php', 'a.sql': 'sql', 'a.lua': 'lua',
    'a.xml': 'xml', 'a.vue': 'html', 'a.json': 'json', 'a.jsonc': 'json',
    'a.css': 'css', 'a.scss': 'css', 'a.html': 'html', 'a.md': 'markdown',
    'run.sh': 'shell', 'a.yaml': 'yaml', 'a.yml': 'yaml', 'a.toml': 'ini',
    'Dockerfile': 'dockerfile', 'Dockerfile.dev': 'dockerfile', '.gitignore': 'ini',
    'CMakeLists.txt': 'cmake',
  }
  for (const [name, expected] of Object.entries(cases)) {
    assert.equal(languageFor(name), expected, name)
  }
})

test('unknown and extensionless files fall back to plaintext', () => {
  for (const name of ['LICENSE', 'README', 'a.unknownext', 'a.', '', 'binary.bin']) {
    assert.equal(languageFor(name), 'plaintext', JSON.stringify(name))
  }
})

test('Windows paths resolve the same as POSIX ones', () => {
  assert.equal(languageFor('C:\\work\\src\\main.c'), 'c')
  assert.equal(languageFor('C:\\work\\CMakeLists.txt'), 'cmake')
  assert.equal(languageFor('C:\\work\\src\\parser.c'), 'c')
})

test('the table is ordered so specific patterns win', () => {
  // A .ts file must not be claimed by an earlier generic rule.
  assert.equal(languageFor('a.ts'), 'typescript')
  // C must beat the C++ row.
  assert.equal(languageFor('a.c'), 'c')
  assert.ok(LANGUAGES.length > 20, 'the table should stay comprehensive')
})
