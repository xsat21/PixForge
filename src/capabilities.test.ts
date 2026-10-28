import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  AVIF_DECODE_UNAVAILABLE,
  AVIF_ENCODE_UNAVAILABLE,
  detectAvifSupport,
  encodeCanvas,
} from './capabilities'

const avif = new Blob([readFileSync('tests/fixtures/probe.avif')], {
  type: 'image/avif',
})
function canvasWith(blob: Blob | null) {
  const canvas = {
    width: 0,
    height: 0,
    toBlob: vi.fn((callback) => callback(blob)),
  }
  vi.stubGlobal('document', { createElement: () => canvas })
  return canvas as unknown as HTMLCanvasElement
}
afterEach(() => vi.unstubAllGlobals())

describe('native AVIF capabilities', () => {
  it('separates successful decoding from unavailable encoding', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ close }))
    const canvas = canvasWith(new Blob(['png'], { type: 'image/png' }))
    expect(await detectAvifSupport()).toEqual({ decode: true, encode: false })
    expect(close).toHaveBeenCalledOnce()
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
  })
  it('handles unsupported/throwing decoders and unavailable encoders safely', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockRejectedValue(new Error(AVIF_DECODE_UNAVAILABLE)),
    )
    canvasWith(null)
    expect(await detectAvifSupport()).toEqual({ decode: false, encode: false })
  })
  it('detects AVIF output only when MIME and file signatures agree', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ close: vi.fn() }),
    )
    canvasWith(avif)
    expect(await detectAvifSupport()).toEqual({ decode: true, encode: true })
    const falseAvif = canvasWith(new Blob(['not AVIF'], { type: 'image/avif' }))
    await expect(encodeCanvas(falseAvif, 'image/avif', 0.8)).rejects.toThrow(
      AVIF_ENCODE_UNAVAILABLE,
    )
  })
  it('rejects silent Canvas PNG fallback for AVIF and WebP', async () => {
    const canvas = canvasWith(new Blob(['PNG'], { type: 'image/png' }))
    await expect(encodeCanvas(canvas, 'image/avif', 0.8)).rejects.toThrow(
      AVIF_ENCODE_UNAVAILABLE,
    )
    await expect(encodeCanvas(canvas, 'image/webp', 0.8)).rejects.toThrow(
      'does not support encoding',
    )
    expect(await encodeCanvas(canvas, 'image/png', 0.8)).toHaveProperty(
      'type',
      'image/png',
    )
  })
})
