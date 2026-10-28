import { AVIF_PROBE } from './avif-probe'
import { detectFileFormat } from './formats'
import type { Format } from './formats'

export const AVIF_ENCODE_UNAVAILABLE =
  'AVIF output is not supported by this browser. Choose JPG, PNG, or WebP.'
export const AVIF_DECODE_UNAVAILABLE =
  'AVIF decoding is not supported by this browser. Try a browser with AVIF support.'
export type AvifSupport = { decode: boolean; encode: boolean }

export async function encodeCanvas(
  canvas: HTMLCanvasElement,
  format: Format,
  quality: number,
): Promise<Blob> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result)
        else reject(new Error('Image encoding failed. Try smaller dimensions.'))
      },
      format,
      quality,
    )
  })
  // Canvas silently falls back to PNG for an unsupported requested encoder.
  if (
    blob.type !== format ||
    (format === 'image/avif' &&
      detectFileFormat(
        new Uint8Array(await blob.slice(0, 256).arrayBuffer()),
      ) !== 'image/avif')
  ) {
    throw new Error(
      format === 'image/avif'
        ? AVIF_ENCODE_UNAVAILABLE
        : 'Your browser does not support encoding this format. Try PNG or JPG.',
    )
  }
  return blob
}

export async function detectAvifSupport(): Promise<AvifSupport> {
  const decode = async () => {
    try {
      const bytes = Uint8Array.from(atob(AVIF_PROBE), (character) =>
        character.charCodeAt(0),
      )
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: 'image/avif' }),
      )
      bitmap.close()
      return true
    } catch {
      return false
    }
  }
  const encode = async () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    try {
      await encodeCanvas(canvas, 'image/avif', 0.8)
      return true
    } catch {
      return false
    } finally {
      canvas.width = canvas.height = 0
    }
  }
  const [canDecode, canEncode] = await Promise.all([decode(), encode()])
  return { decode: canDecode, encode: canEncode }
}

let cachedSupport: Promise<AvifSupport> | undefined
export function avifSupport(): Promise<AvifSupport> {
  return (cachedSupport ??= detectAvifSupport())
}
