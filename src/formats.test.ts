import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectFileFormat, inputFormat } from './formats'
import { outputName, validateFile } from './image'

const fixture = (name: string) =>
  new Uint8Array(readFileSync(`tests/fixtures/${name}`))

describe('modern format validation and MIME handling', () => {
  it.each([
    'image/avif',
    'image/heic',
    'image/heif',
    'image/heic-sequence',
    'image/heif-sequence',
    'image/avif-sequence',
  ])('accepts %s', (type) => {
    expect(validateFile({ type, size: 123 })).toBeNull()
  })
  it.each([
    'avif',
    'heic',
    'heif',
    'AVIF',
    'HEIC',
    'HEIF',
    'jpg',
    'jpeg',
    'png',
    'webp',
  ])('uses the .%s extension with absent or generic MIME', (extension) => {
    for (const type of ['', 'application/octet-stream'])
      expect(
        validateFile({ type, size: 123, name: `phone.${extension}` }),
      ).toBeNull()
  })
  it('normalizes MIME aliases, case, parameters, and conflicting extensions', () => {
    expect(
      inputFormat({ name: 'phone.HEIC', type: ' IMAGE/HEIF; version=1' }),
    ).toBe('image/heic')
    expect(inputFormat({ name: 'wrong.heic', type: 'image/avif' })).toBe(
      'image/avif',
    )
    expect(inputFormat({ name: 'photo.jpg', type: 'image/jpg' })).toBe(
      'image/jpeg',
    )
    expect(inputFormat({ name: 'phone.heif', type: '' })).toBe('image/heic')
  })
  it('rejects unknown/explicitly unsafe MIME, unknown extensions, and empty modern files', () => {
    expect(
      validateFile({ name: 'attack.heic', type: 'image/svg+xml', size: 100 }),
    ).toContain('Choose')
    expect(
      validateFile({ name: 'unknown.bin', type: '', size: 100 }),
    ).toContain('Choose')
    expect(validateFile({ type: 'image/avif', size: 0 })).toContain('empty')
  })
})

describe('file signatures', () => {
  it('recognizes actual local AVIF and HEIC fixtures', () => {
    expect(detectFileFormat(fixture('sample.avif'))).toBe('image/avif')
    expect(detectFileFormat(fixture('sample.heic'))).toBe('image/heic')
  })
  it('prioritizes AVIF over generic HEIF compatible brands', () => {
    const bytes = new Uint8Array(28)
    new DataView(bytes.buffer).setUint32(0, 28)
    bytes.set(new TextEncoder().encode('ftypmif1'), 4)
    bytes.set(new TextEncoder().encode('mif1avif'), 16)
    expect(detectFileFormat(bytes)).toBe('image/avif')
  })
  it('keeps native signatures and rejects unknown, short, or spoofed headers', () => {
    expect(detectFileFormat(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(
      'image/jpeg',
    )
    expect(
      detectFileFormat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
    ).toBe('image/png')
    expect(detectFileFormat(new TextEncoder().encode('RIFF0000WEBP'))).toBe(
      'image/webp',
    )
    for (const text of ['', 'avif', '<svg/>', '0000ftypxxxx0000'])
      expect(detectFileFormat(new TextEncoder().encode(text))).toBeNull()
  })
})

describe('modern output filenames', () => {
  it.each(['photo.heic', 'photo.heif', 'photo.avif', 'photo.HEIC'])(
    'generates AVIF/JPG/PNG/WebP names for %s',
    (name) => {
      expect(outputName(name, 'image/avif')).toBe('photo-pixforge.avif')
      expect(outputName(name, 'image/jpeg')).toBe('photo-pixforge.jpg')
      expect(outputName(name, 'image/png')).toBe('photo-pixforge.png')
      expect(outputName(name, 'image/webp')).toBe('photo-pixforge.webp')
    },
  )
})
