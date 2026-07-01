import { describe, expect, it } from 'vitest'
import { langForExt, parseImports } from './imports'

describe('langForExt', () => {
  it('maps js/ts family to js and py to py', () => {
    expect(langForExt('a/b.ts')).toBe('js')
    expect(langForExt('a/b.tsx')).toBe('js')
    expect(langForExt('a/b.jsx')).toBe('js')
    expect(langForExt('a/b.mjs')).toBe('js')
    expect(langForExt('a/b.js')).toBe('js')
    expect(langForExt('a/b.cjs')).toBe('js')
    expect(langForExt('a/b.py')).toBe('py')
    expect(langForExt('a/b.md')).toBeNull()
  })
})

describe('parseImports js', () => {
  it('extracts static, side-effect, re-export, require and dynamic specifiers', () => {
    const src = [
      "import a from './a'",
      "import { b } from '../b/index'",
      "import './side-effect.css'",
      "export { c } from './c'",
      "const d = require('./d')",
      "const e = await import('./e')",
    ].join('\n')
    expect(parseImports(src, 'js')).toEqual([
      './a',
      '../b/index',
      './c',
      './side-effect.css',
      './d',
      './e',
    ])
  })

  it('dedupes repeated specifiers', () => {
    expect(parseImports("import x from './x'\nimport './x'", 'js')).toEqual(['./x'])
  })

  it('does not match import/require as a substring of another identifier or prose', () => {
    expect(parseImports("const x = reimport('./oops')", 'js')).toEqual([])
    expect(parseImports("// this config is important from './legacy-notes'", 'js')).toEqual([])
  })
})

describe('parseImports py', () => {
  it('extracts import and from-import module paths', () => {
    const src = ['import os', 'import a.b.c', 'from .rel import thing', 'from ..pkg import x'].join(
      '\n',
    )
    expect(parseImports(src, 'py')).toEqual(['.rel', '..pkg', 'os', 'a.b.c'])
  })
})
