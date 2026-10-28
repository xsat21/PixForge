export type Format = 'image/jpeg' | 'image/png' | 'image/webp'
export type Settings = {
  format: Format
  quality: number
  width: string
  height: string
  lock: boolean
}

export const MAX_FILES = 50
export const MAX_FILE_BYTES = 40 * 1024 * 1024
export const MAX_BATCH_BYTES = 200 * 1024 * 1024
export const MAX_PIXELS = 40_000_000
export const MAX_DIMENSION = 16_384
export const defaultSettings: Settings = {
  format: 'image/webp',
  quality: 80,
  width: '',
  height: '',
  lock: true,
}
const formats = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function validateFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!formats.has(file.type)) return 'Choose a JPG, PNG, or WebP image.'
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
    if (!formats.has(settings.format))
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

export async function processImage(file: File, settings: Settings) {
  const invalid = validateFile(file) ?? validateSettings(settings)
  if (invalid) throw new Error(invalid)
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(
      'This image could not be decoded. It may be damaged or unsupported.',
    )
  }
  try {
    if (
      bitmap.width * bitmap.height > MAX_PIXELS ||
      Math.max(bitmap.width, bitmap.height) > MAX_DIMENSION
    ) {
      throw new Error(
        'Image exceeds the 40 megapixel or 16,384 pixel side limit.',
      )
    }
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
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) =>
            result
              ? resolve(result)
              : reject(
                  new Error('Image encoding failed. Try smaller dimensions.'),
                ),
          settings.format,
          settings.quality / 100,
        )
      })
      if (blob.type !== settings.format)
        throw new Error(
          'Your browser does not support encoding this format. Try PNG or JPG.',
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
