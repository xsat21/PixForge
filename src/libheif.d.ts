// The package's generated declarations cover C bindings but omit its JS image
// wrapper. Describe only the documented high-level API used by our worker.
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  interface HeifPixels {
    width: number
    height: number
    data: Uint8ClampedArray<ArrayBuffer>
  }
  interface HeifImage {
    get_width(): number
    get_height(): number
    is_primary(): boolean
    display(
      pixels: HeifPixels,
      callback: (result: HeifPixels | null) => void,
    ): void
    free(): void
  }
  interface HeifDecoder {
    decoder: number | null
    decode(bytes: Uint8Array): HeifImage[]
  }
  interface HeifModule {
    HeifDecoder: new () => HeifDecoder
    heif_context_free(context: number): void
  }
  export default function createHeif(options?: {
    print?: (text: string) => void
    printErr?: (text: string) => void
  }): HeifModule | Promise<HeifModule>
}
