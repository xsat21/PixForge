import createHeif from 'libheif-js/libheif-wasm/libheif-bundle.mjs'
import { assertImageDimensions } from './limits'

// One job per worker: the parent terminates it after success, error, or timeout.
// WASM is embedded in the module; instantiation never fetches a remote binary.
self.onmessage = async (event: MessageEvent<{ buffer?: ArrayBuffer }>) => {
  try {
    let heif: Awaited<ReturnType<typeof createHeif>>
    try {
      // Some builds return an initialized module synchronously; await supports both.
      heif = await createHeif({ print: () => {}, printErr: () => {} })
    } catch {
      throw new Error(
        'HEIC decoding is unavailable in this environment. Try a browser with WebAssembly and Web Worker support.',
      )
    }
    if (!event.data.buffer) {
      self.postMessage({ ready: true })
      return
    }
    const decoder = new heif.HeifDecoder()
    let images: ReturnType<typeof decoder.decode> = []
    try {
      images = decoder.decode(new Uint8Array(event.data.buffer))
      const image = images.find((image) => image.is_primary()) ?? images[0]
      if (!image)
        throw new Error(
          'This HEIC/HEIF image could not be decoded. It may be damaged or use an unsupported codec.',
        )
      // libheif applies container rotation/mirroring during decoding and reports
      // transformed handle dimensions. Check them before allocating RGBA pixels.
      const width = image.get_width()
      const height = image.get_height()
      assertImageDimensions(width, height)
      const pixels = await new Promise<{
        width: number
        height: number
        data: Uint8ClampedArray<ArrayBuffer>
      }>((resolve, reject) => {
        image.display(
          { width, height, data: new Uint8ClampedArray(width * height * 4) },
          (result) => {
            if (result) resolve(result)
            else
              reject(
                new Error(
                  'This HEIC/HEIF image could not be decoded. It may be damaged or use an unsupported codec.',
                ),
              )
          },
        )
      })
      self.postMessage(
        { width, height, data: pixels.data.buffer },
        { transfer: [pixels.data.buffer] },
      )
    } finally {
      for (const image of images) image.free()
      if (decoder.decoder) heif.heif_context_free(decoder.decoder)
    }
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : 'HEIC/HEIF processing failed. Try a smaller image.',
    })
  }
}
