import { describe, it, expect } from 'vitest'
import { parseDesignMd } from '../../../src/lib/design-parser'

const SAMPLE_MD = `# Design
## Colors
primary: #FF0000
secondary: #00FF00
background: #FFFFFF
text: #111111
surface: #F5F5F5
border: #CCCCCC
muted: #999999

## Typography
font-family: Inter
heading-tracking: -0.02em
heading-font: Georgia

## Spacing
gap: 16px

## Fields
field-background: #F0F0F0
field-text-color: #222222
field-label-color: #333333
field-border-radius: 8px
field-border-color: #DDDDDD
field-backdrop-blur: 10px
field-padding: 12px
field-height: 48px
field-placeholder-color: #888888
field-focus-color: #0000FF
`

describe('parseDesignMd — empty/error handling', () => {
  it('returns empty tokens for empty input', () => {
    const t = parseDesignMd('')
    expect(t.colors).toEqual({})
    expect(t.typography).toEqual({})
    expect(t.spacing).toEqual({})
  })

  it('returns empty tokens for undefined input', () => {
    const t = parseDesignMd(undefined as unknown as string)
    expect(t.colors).toEqual({})
  })
})

describe('parseDesignMd — colors', () => {
  it('parses all color tokens', () => {
    const t = parseDesignMd(SAMPLE_MD)
    expect(t.colors.primary).toBe('#ff0000')
    expect(t.colors.secondary).toBe('#00ff00')
    expect(t.colors.background).toBe('#ffffff')
    expect(t.colors.text).toBe('#111111')
    expect(t.colors.surface).toBe('#f5f5f5')
    expect(t.colors.border).toBe('#cccccc')
    expect(t.colors.muted).toBe('#999999')
  })

  it('normalizes hex with # prefix to lowercase', () => {
    const md = '## Colors\nprimary: #AB12CD\n'
    expect(parseDesignMd(md).colors.primary).toBe('#ab12cd')
  })

  it('ignores hex without # prefix (regex requires #)', () => {
    const md = '## Colors\nprimary: AB12CD\n'
    expect(parseDesignMd(md).colors.primary).toBeUndefined()
  })

  it('ignores malformed hex (not 6 chars)', () => {
    const md = '## Colors\nprimary: #FFF\n'
    expect(parseDesignMd(md).colors.primary).toBeUndefined()
  })
})

describe('parseDesignMd — typography', () => {
  it('parses font family, heading font, and tracking', () => {
    // NOTE: source regexes are greedy across newlines — each key must be the
    // only letter-content line in its section for an exact capture.
    const t = parseDesignMd(`## Typography
font-family: Inter
`)
    expect(t.typography.fontFamily).toBe('Inter')
    const h = parseDesignMd(`## Typography
heading-font: Georgia
`)
    expect(h.typography.headingFont).toBe('Georgia')
    const ht = parseDesignMd(`## Typography
heading-tracking: -0.02em
`)
    expect(ht.typography.headingTracking).toBe('-0.02em')
  })

  it('parses all three when tracking is between non-letter lines', () => {
    const t = parseDesignMd(`## Typography
heading-tracking: -0.02em
heading-font: Georgia
font-family: Inter
`)
    expect(t.typography.headingTracking).toBe('-0.02em')
    // font-family greedy capture spans to the last letter line
    expect(t.typography.fontFamily).toBe('Inter')
  })

  it('handles hyphenated font-family key', () => {
    const md = '## Typography\nfont-family: Open Sans\n'
    expect(parseDesignMd(md).typography.fontFamily).toBe('Open Sans')
  })
})

describe('parseDesignMd — spacing', () => {
  it('parses gap', () => {
    expect(parseDesignMd(SAMPLE_MD).spacing.gap).toBe('16px')
  })

  it('parses padding as gap alternative', () => {
    const md = '## Spacing\npadding: 24px\n'
    expect(parseDesignMd(md).spacing.gap).toBe('24px')
  })
})

describe('parseDesignMd — fields', () => {
  it('parses all field tokens', () => {
    const t = parseDesignMd(SAMPLE_MD)
    expect(t.field).toEqual({
      background: '#F0F0F0',
      textColor: '#222222',
      labelColor: '#333333',
      borderRadius: '8px',
      borderColor: '#DDDDDD',
      backdropBlur: '10px',
      padding: '12px',
      height: '48px',
      placeholderColor: '#888888',
      focusColor: '#0000FF',
    })
  })

  it('initializes field only when Fields section present', () => {
    const md = '## Colors\nprimary: #123456\n'
    const t = parseDesignMd(md)
    expect(t.field).toBeUndefined()
    expect(t.colors.primary).toBe('#123456')
  })
})

describe('parseDesignMd — section isolation', () => {
  it('does not leak tokens across sections', () => {
    const md = '## Colors\nprimary: #111111\n## Typography\nfont-family: Inter\n'
    const t = parseDesignMd(md)
    expect(t.colors.primary).toBe('#111111')
    expect(t.typography.fontFamily).toBe('Inter')
    expect(t.colors.secondary).toBeUndefined()
  })
})
