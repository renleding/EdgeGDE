import { describe, it, expect, vi, beforeEach } from 'vitest'
import { compileLayoutCompat } from '../../../src/lib/compile-layout-compat'
import { openPencilToCanvas } from '../../../src/canvas/openpencil-migration'
import { compileFromCanvas } from '../../../src/canvas/compile-from-canvas'

// The compat layer is pure delegation: openPencilToCanvas → compileFromCanvas.
// Mock both pipeline stages so the test targets only this module's behavior.
vi.mock('../../../src/canvas/openpencil-migration', () => ({
  openPencilToCanvas: vi.fn(),
}))

vi.mock('../../../src/canvas/compile-from-canvas', () => ({
  compileFromCanvas: vi.fn(),
}))

const mockedOpenPencilToCanvas = vi.mocked(openPencilToCanvas)
const mockedCompileFromCanvas = vi.mocked(compileFromCanvas)

describe('compileLayoutCompat', () => {
  beforeEach(() => {
    mockedOpenPencilToCanvas.mockReset()
    mockedCompileFromCanvas.mockReset()
  })

  it('converts the layout to a canvas doc and compiles it to HTML', () => {
    const layout = { rootNode: { id: 'r', type: 'FRAME' } }
    const doc = { nodes: {} }
    mockedOpenPencilToCanvas.mockReturnValue(doc as never)
    mockedCompileFromCanvas.mockReturnValue('<html>compiled</html>')

    const html = compileLayoutCompat(layout)

    expect(mockedOpenPencilToCanvas).toHaveBeenCalledTimes(1)
    expect(mockedOpenPencilToCanvas).toHaveBeenCalledWith(layout)
    expect(mockedCompileFromCanvas).toHaveBeenCalledTimes(1)
    expect(mockedCompileFromCanvas).toHaveBeenCalledWith(doc)
    expect(html).toBe('<html>compiled</html>')
  })

  it('returns exactly what compileFromCanvas produces', () => {
    mockedOpenPencilToCanvas.mockReturnValue({ nodes: {} } as never)
    mockedCompileFromCanvas.mockReturnValue('   <div>legacy html</div>   ')

    expect(compileLayoutCompat({})).toBe('   <div>legacy html</div>   ')
  })

  it('ignores the design argument (second parameter)', () => {
    const layout = { rootNode: { id: 'r', type: 'TEXT' } }
    const design = { colors: { primary: '#fff' } }
    mockedOpenPencilToCanvas.mockReturnValue({ nodes: {} } as never)
    mockedCompileFromCanvas.mockReturnValue('<p>hi</p>')

    compileLayoutCompat(layout, design)

    expect(mockedOpenPencilToCanvas).toHaveBeenCalledWith(layout)
    expect(mockedOpenPencilToCanvas).toHaveBeenCalledTimes(1)
    // design tokens must NOT leak into the canvas conversion
    expect(mockedOpenPencilToCanvas).not.toHaveBeenCalledWith(layout, design)
    expect(mockedCompileFromCanvas).toHaveBeenCalledTimes(1)
  })

  it('propagates errors thrown by the pipeline stages', () => {
    mockedOpenPencilToCanvas.mockImplementation(() => {
      throw new Error('bad layout')
    })

    expect(() => compileLayoutCompat({})).toThrow('bad layout')
  })

  it('propagates compile errors', () => {
    mockedOpenPencilToCanvas.mockReturnValue({ nodes: {} } as never)
    mockedCompileFromCanvas.mockImplementation(() => {
      throw new Error('compile exploded')
    })

    expect(() => compileLayoutCompat({})).toThrow('compile exploded')
  })
})
