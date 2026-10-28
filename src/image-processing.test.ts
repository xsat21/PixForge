import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  avifSupport,
  AVIF_DECODE_UNAVAILABLE,
  AVIF_ENCODE_UNAVAILABLE,
} from './capabilities'
import { decodeHeic, HEIC_UNAVAILABLE } from './heic-decoder'
import { defaultSettings, processImage } from './image'

vi.mock('./capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./capabilities')>()),
  avifSupport: vi.fn(),
}))
vi.mock('./heic-decoder', () => ({
  decodeHeic: vi.fn(),
  HEIC_UNAVAILABLE: 'HEIC decoding is unavailable in this environment.',
}))
const file = (name: string) =>
  new File([readFileSync(`tests/fixtures/${name}`)], name, {
    type: name.endsWith('heic') ? 'image/heic' : 'image/avif',
  })
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('unsupported modern codecs', () => {
  it('rejects unavailable AVIF output before decoding an input', async () => {
    vi.mocked(avifSupport).mockResolvedValue({ decode: true, encode: false })
    await expect(
      processImage(file('sample.heic'), {
        ...defaultSettings,
        format: 'image/avif',
      }),
    ).rejects.toThrow(AVIF_ENCODE_UNAVAILABLE)
    expect(decodeHeic).not.toHaveBeenCalled()
  })
  it('reports unsupported AVIF decoding', async () => {
    vi.mocked(avifSupport).mockResolvedValue({ decode: false, encode: false })
    await expect(
      processImage(file('sample.avif'), defaultSettings),
    ).rejects.toThrow(AVIF_DECODE_UNAVAILABLE)
  })
  it('distinguishes a damaged AVIF from an unavailable decoder', async () => {
    vi.mocked(avifSupport).mockResolvedValue({ decode: true, encode: false })
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockRejectedValue(new Error('corrupt image')),
    )
    await expect(
      processImage(file('sample.avif'), defaultSettings),
    ).rejects.toThrow('damaged or use an unsupported AVIF variant')
  })
  it('propagates unavailable HEIC decoding as an individual processing error', async () => {
    vi.mocked(decodeHeic).mockRejectedValue(new Error(HEIC_UNAVAILABLE))
    await expect(
      processImage(file('sample.heic'), defaultSettings),
    ).rejects.toThrow(HEIC_UNAVAILABLE)
  })
  it('rejects an image name and MIME with no supported signature', async () => {
    await expect(
      processImage(
        new File(['not an image'], 'broken.heic', { type: 'image/heic' }),
        defaultSettings,
      ),
    ).rejects.toThrow('could not be decoded')
    expect(decodeHeic).not.toHaveBeenCalled()
  })
})
