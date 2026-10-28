export const MAX_FILES = 50
export const MAX_FILE_BYTES = 40 * 1024 * 1024
export const MAX_BATCH_BYTES = 200 * 1024 * 1024
export const MAX_PIXELS = 40_000_000
export const MAX_DIMENSION = 16_384

export function assertImageDimensions(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MAX_PIXELS ||
    Math.max(width, height) > MAX_DIMENSION
  ) {
    throw new Error(
      'Image exceeds the 40 megapixel or 16,384 pixel side limit.',
    )
  }
}
