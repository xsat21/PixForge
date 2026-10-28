export type Format = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif'
export type InputFormat = Format | 'image/heic'
export type FileIdentity = { type: string; name?: string }

export const outputFormats = new Set<Format>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
])
export const inputAccept =
  '.jpg,.jpeg,.png,.webp,.avif,.heic,.heif,image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,image/heic-sequence,image/heif-sequence,image/avif-sequence'
const mimeTypes: Record<string, InputFormat> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/avif': 'image/avif',
  'image/avif-sequence': 'image/avif',
  'image/heic': 'image/heic',
  'image/heif': 'image/heic',
  'image/heic-sequence': 'image/heic',
  'image/heif-sequence': 'image/heic',
}
const extensions: Record<string, InputFormat> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heic',
}

// Some operating systems provide no MIME type for phone images. Only fall back
// to the extension for missing/generic MIME, never an explicitly unsupported type.
export function inputFormat(file: FileIdentity): InputFormat | null {
  const mime = file.type.split(';')[0].trim().toLowerCase()
  if (mimeTypes[mime]) return mimeTypes[mime]
  if (mime && mime !== 'application/octet-stream') return null
  const extension = file.name?.split('.').pop()?.toLowerCase() ?? ''
  return extensions[extension] ?? null
}

export function detectFileFormat(bytes: Uint8Array): InputFormat | null {
  const text = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end))
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg'
  if (text(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png'
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp'
  if (bytes.length >= 16 && text(4, 8) === 'ftyp') {
    const size = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(0)
    const brands = [text(8, 12)]
    for (
      let offset = 16;
      offset + 4 <= Math.min(size, bytes.length);
      offset += 4
    )
      brands.push(text(offset, offset + 4))
    // AVIF can also advertise the generic HEIF mif1 brand. Check AV1 first.
    if (brands.some((brand) => ['avif', 'avis'].includes(brand)))
      return 'image/avif'
    if (
      brands.some((brand) =>
        [
          'heic',
          'heix',
          'hevc',
          'hevx',
          'heim',
          'heis',
          'hevm',
          'hevs',
          'mif1',
          'msf1',
        ].includes(brand),
      )
    )
      return 'image/heic'
  }
  return null
}
