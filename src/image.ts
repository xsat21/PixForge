import { detectFileFormat, inputFormat, outputFormats } from './formats'
import type { FileIdentity, Format } from './formats'
import { assertImageDimensions, MAX_DIMENSION, MAX_FILE_BYTES } from './limits'
import {
  avifSupport,
  AVIF_DECODE_UNAVAILABLE,
  AVIF_ENCODE_UNAVAILABLE,
  encodeCanvas,
} from './capabilities'
import { decodeHeic } from './heic-decoder'
export type { Format } from './formats'
export {
  MAX_FILES,
  MAX_BATCH_BYTES,
  MAX_DIMENSION,
  MAX_FILE_BYTES,
  MAX_PIXELS,
} from './limits'
export type Settings = {
  format: Format
  quality: number
  width: string
  height: string
  lock: boolean
}

export const defaultSettings: Settings = {
  format: 'image/webp',
  quality: 80,
  width: '',
  height: '',
  lock: true,
}

export function validateFile(
  file: FileIdentity & { size: number },
): string | null {
  if (!inputFormat(file))
    return 'Choose a JPG, PNG, or WebP image, or an AVIF, HEIC, or HEIF file.'
  if (!file.size) return 'This file is empty.'
  if (file.size > MAX_FILE_BYTES) return 'Images must be 40 MB or smaller.'
  return null
}

function dimension(value: string): number | undefined {
  if (value === '') return undefined
  if (
    !/^\d+$/.test(value) ||
    Number(value) < 1 ||
    Number(value) > MAX_DIMENSION
  ) {
    throw new Error(
      `Dimensions must be whole numbers from 1 to ${MAX_DIMENSION.toLocaleString('en-US')}.`,
    )
  }
  return Number(value)
}

// Locked dimensions are a bounding box; unlocked dimensions may stretch the image.
// Neither mode upscales. An omitted dimension preserves its original size when unlocked.
export function outputDimensions(
  sourceWidth: number,
  sourceHeight: number,
  settings: Settings,
) {
  const width = dimension(settings.width)
  const height = dimension(settings.height)
  if (settings.lock) {
    const scale = Math.min(
      1,
      width ? width / sourceWidth : 1,
      height ? height / sourceHeight : 1,
    )
    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
    }
  }
  return {
    width: Math.min(width ?? sourceWidth, sourceWidth),
    height: Math.min(height ?? sourceHeight, sourceHeight),
  }
}

export function validateSettings(settings: Settings): string | null {
  try {
    dimension(settings.width)
    dimension(settings.height)
    if (
      !Number.isFinite(settings.quality) ||
      settings.quality < 1 ||
      settings.quality > 100
    )
      throw new Error('Quality must be between 1 and 100.')
    if (!outputFormats.has(settings.format))
      throw new Error('Unsupported output format.')
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid settings.'
  }
}

export function outputName(name: string, format: Format): string {
  const extension = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
  }[format]
  const stem =
    (name.split(/[\\/]/).pop() || 'image')
      .replace(/\.[^.]*$/, '')
      .replace(/[^\p{L}\p{N}._ -]/gu, '_')
      .replace(/^\.+/, '')
      .slice(0, 100) || 'image'
  return `${stem}-pixforge.${extension}`
}

export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((name) => {
    let next = name
    let index = 2
    const dot = name.lastIndexOf('.')
    while (used.has(next.toLowerCase()))
      next = `${name.slice(0, dot)}-${index++}${name.slice(dot)}`
    used.add(next.toLowerCase())
    return next
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export async function processImage(
  file: File,
  settings: Settings,
  signal?: AbortSignal,
) {
  const invalid = validateFile(file) ?? validateSettings(settings)
  if (invalid) throw new Error(invalid)
  if (settings.format === 'image/avif' && !(await avifSupport()).encode)
    throw new Error(AVIF_ENCODE_UNAVAILABLE)
  const format = detectFileFormat(
    new Uint8Array(await file.slice(0, 256).arrayBuffer()),
  )
  if (!format)
    throw new Error(
      'This image could not be decoded. It may be damaged or unsupported.',
    )
  if (format === 'image/avif' && !(await avifSupport()).decode)
    throw new Error(AVIF_DECODE_UNAVAILABLE)
  let bitmap: ImageBitmap
  if (format === 'image/heic') {
    bitmap = await decodeHeic(file, signal)
  } else {
    try {
      bitmap = await createImageBitmap(file.slice(0, file.size, format), {
        imageOrientation: 'from-image',
      })
    } catch {
      throw new Error(
        format === 'image/avif'
          ? 'This AVIF image could not be decoded. It may be damaged or use an unsupported AVIF variant.'
          : 'This image could not be decoded. It may be damaged or unsupported.',
      )
    }
  }
  try {
    if (signal?.aborted)
      throw new DOMException('Processing cancelled.', 'AbortError')
    assertImageDimensions(bitmap.width, bitmap.height)
    const { width, height } = outputDimensions(
      bitmap.width,
      bitmap.height,
      settings,
    )
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    try {
      const ctx = canvas.getContext('2d')
      if (!ctx)
        throw new Error('Your browser could not create an image canvas.')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      if (settings.format === 'image/jpeg') {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
      }
      ctx.drawImage(bitmap, 0, 0, width, height)
      const blob = await encodeCanvas(
        canvas,
        settings.format,
        settings.quality / 100,
      )
      return {
        blob,
        width,
        height,
        name: outputName(file.name, settings.format),
      }
    } finally {
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    bitmap.close()
  }
}
