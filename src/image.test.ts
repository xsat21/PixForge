import { describe, expect, it } from 'vitest'
import {
  defaultSettings,
  formatBytes,
  MAX_FILE_BYTES,
  outputDimensions,
  outputName,
  uniqueNames,
  validateFile,
  validateSettings,
} from './image'

describe('image validation', () => {
  it('accepts supported images, rejects empty, oversized and unsupported inputs', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp'])
      expect(validateFile({ type, size: 100 })).toBeNull()
    expect(validateFile({ type: 'image/svg+xml', size: 100 })).toContain(
      'Choose',
    )
    expect(validateFile({ type: 'image/png', size: 0 })).toContain('empty')
    expect(
      validateFile({ type: 'image/png', size: MAX_FILE_BYTES + 1 }),
    ).toContain('40 MB')
  })
  it.each(['0', '-1', '1.5', '16385', 'NaN', '1e2'])(
    'rejects invalid dimension %s',
    (width) => {
      expect(validateSettings({ ...defaultSettings, width })).not.toBeNull()
    },
  )
  it('validates quality and format', () => {
    expect(validateSettings(defaultSettings)).toBeNull()
    expect(
      validateSettings({ ...defaultSettings, quality: NaN }),
    ).not.toBeNull()
    expect(validateSettings({ ...defaultSettings, quality: 0 })).not.toBeNull()
    expect(
      validateSettings({ ...defaultSettings, quality: 101 }),
    ).not.toBeNull()
  })
})
describe('resize geometry', () => {
  it('keeps original dimensions by default', () =>
    expect(outputDimensions(1200, 800, defaultSettings)).toEqual({
      width: 1200,
      height: 800,
    }))
  it('fits both bounds and respects portrait aspect ratio', () => {
    expect(
      outputDimensions(1200, 800, {
        ...defaultSettings,
        width: '600',
        height: '300',
      }),
    ).toEqual({ width: 450, height: 300 })
    expect(
      outputDimensions(800, 1200, { ...defaultSettings, height: '600' }),
    ).toEqual({ width: 400, height: 600 })
  })
  it('never upscales or produces a zero dimension', () => {
    expect(
      outputDimensions(20, 10, { ...defaultSettings, width: '100' }),
    ).toEqual({ width: 20, height: 10 })
    expect(
      outputDimensions(16000, 1, { ...defaultSettings, width: '1' }),
    ).toEqual({ width: 1, height: 1 })
  })
  it('allows independent dimensions when unlocked', () => {
    expect(
      outputDimensions(1200, 800, {
        ...defaultSettings,
        lock: false,
        width: '400',
        height: '100',
      }),
    ).toEqual({ width: 400, height: 100 })
    expect(
      outputDimensions(1200, 800, {
        ...defaultSettings,
        lock: false,
        width: '1600',
      }),
    ).toEqual({ width: 1200, height: 800 })
  })
})
describe('download names and size display', () => {
  it('sanitizes filenames and uses the real output extension', () => {
    expect(outputName('../../photo.png', 'image/jpeg')).toBe(
      'photo-pixforge.jpg',
    )
    expect(outputName('a.webp', 'image/png')).toBe('a-pixforge.png')
    expect(outputName('image.jpeg', 'image/webp')).toBe('image-pixforge.webp')
  })
  it('avoids ZIP collisions including case and already suffixed names', () => {
    const names = uniqueNames(['x.jpg', 'x.jpg', 'x-2.jpg', 'X.jpg'])
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(4)
  })
  it('formats byte counts', () => {
    expect(formatBytes(100)).toBe('100 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB')
  })
})
