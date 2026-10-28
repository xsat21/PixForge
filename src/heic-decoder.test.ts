import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workers = vi.hoisted(() => ({
  instances: [] as {
    onmessage: ((event: { data: unknown }) => void) | null
    onerror: ((event: { preventDefault(): void }) => void) | null
    postMessage: ReturnType<typeof vi.fn>
    terminate: ReturnType<typeof vi.fn>
  }[],
}))
vi.mock('./heic.worker?worker&inline', () => ({
  default: class {
    onmessage = null
    onerror = null
    onmessageerror = null
    postMessage = vi.fn()
    terminate = vi.fn()
    constructor() {
      workers.instances.push(this)
    }
  },
}))
import { checkHeicSupport, decodeHeic, HEIC_UNAVAILABLE } from './heic-decoder'

beforeEach(() => {
  workers.instances.length = 0
  vi.stubGlobal('Worker', class {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('HEIC worker lifetime and failures', () => {
  it('reports unavailable Worker/WASM support without a hanging job', async () => {
    vi.stubGlobal('Worker', undefined)
    expect(await checkHeicSupport()).toBe(false)
    await expect(decodeHeic(new Blob(['heic']))).rejects.toThrow(
      HEIC_UNAVAILABLE,
    )
    expect(workers.instances).toHaveLength(0)
  })
  it('terminates the capability worker after it initializes', async () => {
    const job = checkHeicSupport()
    const worker = workers.instances[0]
    worker.onmessage!({ data: { ready: true } })
    expect(await job).toBe(true)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('terminates hung or memory-starved workers after the deadline', async () => {
    vi.useFakeTimers()
    const job = checkHeicSupport()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await job).toBe(false)
    expect(workers.instances[0].terminate).toHaveBeenCalledOnce()
  })
  it('terminates an active worker when the page aborts processing', async () => {
    const controller = new AbortController()
    const job = checkHeicSupport(controller.signal)
    controller.abort()
    expect(await job).toBe(false)
    expect(workers.instances[0].terminate).toHaveBeenCalledOnce()
  })
  it('surfaces malformed HEIC errors and releases the worker', async () => {
    const job = decodeHeic(new Blob(['corrupt']))
    // Wait for the input Blob's arrayBuffer() to reach the worker boundary.
    await vi.waitFor(() => expect(workers.instances).toHaveLength(1))
    const assertion = expect(job).rejects.toThrow('damaged')
    workers.instances[0].onmessage!({
      data: { error: 'This HEIC image is damaged.' },
    })
    await assertion
    expect(workers.instances[0].terminate).toHaveBeenCalledOnce()
  })
})
