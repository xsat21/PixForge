import HeicWorker from './heic.worker?worker&inline'

export const HEIC_UNAVAILABLE =
  'HEIC decoding is unavailable in this environment. Try a browser with WebAssembly and Web Worker support.'
const HEIC_FAILURE =
  'HEIC/HEIF decoding failed or ran out of memory. Try a smaller image.'
type HeicReply =
  | { ready: true }
  | { error: string }
  | { width: number; height: number; data: ArrayBuffer }

function runWorker(
  buffer?: ArrayBuffer,
  signal?: AbortSignal,
): Promise<HeicReply> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
      reject(new Error(HEIC_UNAVAILABLE))
      return
    }
    let worker: Worker
    try {
      worker = new HeicWorker()
    } catch {
      reject(new Error(HEIC_UNAVAILABLE))
      return
    }
    const finish = (result?: HeicReply, error?: Error) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      if (error) reject(error)
      else if (result && 'error' in result) reject(new Error(result.error))
      else resolve(result!)
    }
    const abort = () =>
      finish(undefined, new DOMException('Processing cancelled.', 'AbortError'))
    const timer = setTimeout(
      () => finish(undefined, new Error(HEIC_FAILURE)),
      60_000,
    )
    worker.onmessage = (event: MessageEvent<HeicReply>) => finish(event.data)
    worker.onerror = (event) => {
      event.preventDefault()
      finish(undefined, new Error(buffer ? HEIC_FAILURE : HEIC_UNAVAILABLE))
    }
    worker.onmessageerror = () => finish(undefined, new Error(HEIC_FAILURE))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    try {
      worker.postMessage(buffer ? { buffer } : {}, buffer ? [buffer] : [])
    } catch {
      finish(undefined, new Error(HEIC_FAILURE))
    }
  })
}

let readiness: Promise<boolean> | undefined
export async function checkHeicSupport(signal?: AbortSignal): Promise<boolean> {
  const pending = runWorker(undefined, signal).then(
    (result) => 'ready' in result,
    () => false,
  )
  readiness = pending
  try {
    return await pending
  } finally {
    if (readiness === pending) readiness = undefined
  }
}

export async function decodeHeic(
  file: Blob,
  signal?: AbortSignal,
): Promise<ImageBitmap> {
  // Avoid overlapping the startup capability probe with the first real image.
  if (readiness) await readiness
  const result = await runWorker(await file.arrayBuffer(), signal)
  if (!('data' in result)) throw new Error(HEIC_FAILURE)
  try {
    return await createImageBitmap(
      new ImageData(
        new Uint8ClampedArray(result.data),
        result.width,
        result.height,
      ),
    )
  } catch {
    throw new Error(HEIC_FAILURE)
  }
}
