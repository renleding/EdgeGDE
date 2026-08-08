import { describe, it, expect } from 'vitest'
import { generateCSS } from '../../../src/lib/generateCSS'
import type { EDR } from '../../../src/lib/generateCSS'

const HASH = 'abc123'

describe('generateCSS', () => {
  it('returns empty string when EDR has no global tokens and no components', () => {
    expect(generateCSS({ components: {} }, HASH)).toBe('')
    expect(generateCSS({ components: {}, global: {} }, HASH)).toBe('')
    expect(generateCSS({ components: {} } as EDR, HASH)).toBe('')
  })

  it('emits :root custom properties from global tokens with sorted keys', () => {
    const edr: EDR = {
      components: {},
      global: { color_primary: '#123456', font_size: '16px' },
    }
    const out = generateCSS(edr, HASH)
    expect(out).toBe(':root{--color-primary:#123456;--font-size:16px;}')
  })

  it('normalizes underscores to dashes in global token names', () => {
    const edr: EDR = { components: {}, global: { my_token_name: 'v' } }
    expect(generateCSS(edr, HASH)).toBe(':root{--my-token-name:v;}')
  })

  it('emits component classes with role-scoped selectors', () => {
    const edr: EDR = {
      components: { button: { color: 'red' }, card: { padding: '8px' } },
    }
    const out = generateCSS(edr, HASH)
    expect(out).toContain(`.edr-${HASH}-button{color:red;}`)
    expect(out).toContain(`.edr-${HASH}-card{padding:8px;}`)
    // Sorted roles: button before card
    expect(out.indexOf('button')).toBeLessThan(out.indexOf('card'))
  })

  it('sorts component style properties alphabetically', () => {
    const edr: EDR = { components: { x: { b: '2', a: '1' } } }
    expect(generateCSS(edr, HASH)).toBe(`.edr-${HASH}-x{a:1;b:2;}`)
  })

  it('normalizes property names to kebab-case', () => {
    const edr: EDR = { components: { x: { background_color: 'black' } } }
    expect(generateCSS(edr, HASH)).toBe(`.edr-${HASH}-x{background-color:black;}`)
  })

  it('skips non-object or empty component styles', () => {
    const edr: EDR = {
      components: {
        a: {},
        b: null as unknown as Record<string, any>,
        c: 'not-an-object' as unknown as Record<string, any>,
        d: { color: 'blue' },
      },
    }
    const out = generateCSS(edr, HASH)
    expect(out).toContain(`.edr-${HASH}-d`)
    expect(out).not.toContain('a{')
    expect(out).not.toContain('b{')
    expect(out).not.toContain('c{')
  })

  it('combines global tokens and components in one output', () => {
    const edr: EDR = {
      global: { primary: '#000' },
      components: { btn: { color: 'white' } },
    }
    const out = generateCSS(edr, HASH)
    expect(out).toBe(`:root{--primary:#000;}.edr-${HASH}-btn{color:white;}`)
  })

  it('coerces non-string style values with String()', () => {
    const edr: EDR = { components: { x: { opacity: 0.5, zIndex: 10 } } }
    // Note: only underscores are kebab-normalized; camelCase passes through
    expect(generateCSS(edr, HASH)).toBe(`.edr-${HASH}-x{opacity:0.5;zIndex:10;}`)
  })

  it('trims leading/trailing whitespace from final output', () => {
    const edr: EDR = { components: { x: { color: 'red' } } }
    const out = generateCSS(edr, HASH)
    expect(out.startsWith(' ')).toBe(false)
    expect(out.endsWith(' ')).toBe(false)
  })
})
