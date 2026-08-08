import { describe, it, expect } from 'vitest'
import { applyPatches } from '../../../src/lib/patch-engine'
import type { PatchOperation } from '../../../src/lib/patch-engine'

function makeLayout() {
  return {
    props: { title: 'My Form', theme: 'light' },
    children: [
      { type: 'text', props: { label: 'Name', required: true }, children: [] },
      { type: 'number', props: { label: 'Age' }, children: [] },
    ],
  }
}

describe('applyPatches — input validation', () => {
  it('rejects non-array operations', () => {
    const r = applyPatches(makeLayout(), 'nope' as unknown as PatchOperation[])
    expect(r.success).toBe(false)
    expect(r.error).toBe('Operations must be an array')
  })

  it('rejects more than 20 operations', () => {
    const ops: PatchOperation[] = Array.from({ length: 21 }, (_, i) => ({
      op: 'replace', path: `/props/key${i}`, value: i,
    }))
    const r = applyPatches(makeLayout(), ops)
    expect(r.success).toBe(false)
    expect(r.error).toBe('Exceeded maximum patch operations (20)')
  })

  it('rejects unsupported operation types', () => {
    const r = applyPatches(makeLayout(), [{ op: 'move', path: '/props/title' } as unknown as PatchOperation])
    expect(r.success).toBe(false)
    expect(r.error).toBe('Unsupported operation: move')
    expect(r.path).toBe('/props/title')
  })

  it('rejects invalid paths (no leading slash)', () => {
    const r = applyPatches(makeLayout(), [{ op: 'replace', path: 'props/title', value: 'X' }])
    expect(r.success).toBe(false)
    expect(r.error).toBe('Invalid path: props/title')
  })
})

describe('applyPatches — whitelist enforcement', () => {
  it('denies root path', () => {
    const r = applyPatches(makeLayout(), [{ op: 'replace', path: '/', value: {} }])
    expect(r.success).toBe(false)
    expect(r.error).toBe('Path not allowed: /')
  })

  it('denies /children (root array)', () => {
    const r = applyPatches(makeLayout(), [{ op: 'replace', path: '/children', value: [] }])
    expect(r.success).toBe(false)
  })

  it('denies /children/[index] node replacement', () => {
    const r = applyPatches(makeLayout(), [{ op: 'replace', path: '/children/0', value: {} }])
    expect(r.success).toBe(false)
  })

  it('denies /children/[index]/props object replacement', () => {
    const r = applyPatches(makeLayout(), [{ op: 'replace', path: '/children/0/props', value: {} }])
    expect(r.success).toBe(false)
  })

  it('denies remove on /children/[index]', () => {
    const r = applyPatches(makeLayout(), [{ op: 'remove', path: '/children/0' }])
    expect(r.success).toBe(false)
  })

  it('denies remove on /children', () => {
    const r = applyPatches(makeLayout(), [{ op: 'remove', path: '/children' }])
    expect(r.success).toBe(false)
  })

  it('denies remove on /children/[index]/children (array clear)', () => {
    const r = applyPatches(makeLayout(), [{ op: 'remove', path: '/children/0/children' }])
    expect(r.success).toBe(false)
  })
})

describe('applyPatches — successful granular mutations', () => {
  it('replaces a prop value', () => {
    const r = applyPatches(makeLayout(), [{ op: 'replace', path: '/props/title', value: 'New Title' }])
    expect(r.success).toBe(true)
    expect(r.layout.props.title).toBe('New Title')
    expect(r.layout.props.theme).toBe('light')
  })

  it('adds a new prop', () => {
    const r = applyPatches(makeLayout(), [{ op: 'add', path: '/props/subtitle', value: 'Hi' }])
    expect(r.success).toBe(true)
    expect(r.layout.props.subtitle).toBe('Hi')
  })

  it('adds a child node to /children/[index]/children', () => {
    const r = applyPatches(makeLayout(), [{
      op: 'add', path: '/children/0/children/newNode',
      value: { type: 'text', props: {} },
    }])
    expect(r.success).toBe(true)
    expect(r.layout.children[0].children.newNode).toEqual({ type: 'text', props: {} })
  })

  it('replaces a nested child prop', () => {
    const r = applyPatches(makeLayout(), [{ op: 'replace', path: '/children/0/props/label', value: 'Full Name' }])
    expect(r.success).toBe(true)
    expect(r.layout.children[0].props.label).toBe('Full Name')
  })

  it('removes a prop value (allowed leaf remove)', () => {
    const r = applyPatches(makeLayout(), [{ op: 'remove', path: '/props/theme' }])
    expect(r.success).toBe(true)
    expect(r.layout.props.theme).toBeUndefined()
    expect(r.layout.props.title).toBe('My Form')
  })

  it('removes a nested child prop', () => {
    const r = applyPatches(makeLayout(), [{ op: 'remove', path: '/children/0/props/required' }])
    expect(r.success).toBe(true)
    expect(r.layout.children[0].props.required).toBeUndefined()
  })

  it('applies multiple operations sequentially', () => {
    const r = applyPatches(makeLayout(), [
      { op: 'replace', path: '/props/title', value: 'A' },
      { op: 'add', path: '/props/newKey', value: 42 },
      { op: 'remove', path: '/props/theme' },
    ])
    expect(r.success).toBe(true)
    expect(r.layout.props).toEqual({ title: 'A', newKey: 42 })
  })

  it('does not mutate the original layout (deep clone)', () => {
    const original = makeLayout()
    applyPatches(original, [{ op: 'replace', path: '/props/title', value: 'Changed' }])
    expect(original.props.title).toBe('My Form')
  })
})

describe('applyPatches — traversal failures', () => {
  it('fails when intermediate path does not exist', () => {
    const r = applyPatches(makeLayout(), [{ op: 'replace', path: '/children/5/props/label', value: 'X' }])
    expect(r.success).toBe(false)
    expect(r.error).toContain('path does not exist')
  })

  it('fails when target key does not exist for remove', () => {
    const r = applyPatches(makeLayout(), [{ op: 'remove', path: '/props/missing' }])
    expect(r.success).toBe(false)
  })

  it('fails when removing array index out of bounds', () => {
    const r = applyPatches(makeLayout(), [{ op: 'remove', path: '/children/0/children/9' }])
    expect(r.success).toBe(false)
  })
})

describe('applyPatches — encoded paths', () => {
  it('decodes URI-encoded segments', () => {
    const layout = { props: { 'a b': 1 } }
    const r = applyPatches(layout, [{ op: 'replace', path: '/props/a%20b', value: 2 }])
    expect(r.success).toBe(true)
    expect(r.layout.props['a b']).toBe(2)
  })
})
