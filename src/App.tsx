import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  ImagePlus,
  Layers3,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlink2,
  X,
  Zap,
} from 'lucide-react'
import { zip } from 'fflate'
import {
  defaultSettings,
  formatBytes,
  MAX_BATCH_BYTES,
  MAX_FILES,
  processImage,
  uniqueNames,
  validateFile,
  validateSettings,
} from './image'
import type { Format, Settings } from './image'
import { inputAccept } from './formats'
import { avifSupport } from './capabilities'
import type { AvifSupport } from './capabilities'
import { checkHeicSupport } from './heic-decoder'

type Result = Awaited<ReturnType<typeof processImage>> & { url: string }
type Item = {
  id: string
  file: File
  result?: Result
  error?: string
  processing?: boolean
}

const formatOptions: { value: Format; label: string; description: string }[] = [
  { value: 'image/webp', label: 'WebP', description: 'Small & versatile' },
  { value: 'image/jpeg', label: 'JPG', description: 'Best for photos' },
  { value: 'image/png', label: 'PNG', description: 'Lossless output' },
  {
    value: 'image/avif',
    label: 'AVIF',
    description: 'Browser-dependent output',
  },
]

function download(url: string, name: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export default function App() {
  const [items, setItems] = useState<Item[]>([])
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [busy, setBusy] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState('')
  const [capabilities, setCapabilities] = useState<{
    avif: AvifSupport
    heic: boolean
  } | null>(null)
  const processingAbort = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(0)
  const itemsRef = useRef(items)
  const urls = useRef(new Set<string>())
  const mounted = useRef(true)
  const busyRef = useRef(false)

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    processingAbort.current = controller
    void Promise.all([avifSupport(), checkHeicSupport(controller.signal)]).then(
      ([avif, heic]) => {
        if (!controller.signal.aborted) setCapabilities({ avif, heic })
      },
    )
    const activeUrls = urls.current
    return () => {
      mounted.current = false
      controller.abort()
      activeUrls.forEach((url) => URL.revokeObjectURL(url))
      activeUrls.clear()
    }
  }, [])

  function updateItems(next: Item[]) {
    itemsRef.current = next
    setItems(next)
  }
  function release(item: Item) {
    if (item.result) {
      URL.revokeObjectURL(item.result.url)
      urls.current.delete(item.result.url)
    }
  }
  function changeSettings(next: Partial<Settings>) {
    if (busyRef.current || zipping) return
    itemsRef.current.forEach(release)
    updateItems(itemsRef.current.map(({ id, file }) => ({ id, file })))
    setSettings((current) => ({ ...current, ...next }))
    setNotice('')
  }
  function addFiles(files: File[]) {
    if (busyRef.current || zipping) return
    const next = [...itemsRef.current]
    const errors: string[] = []
    let total = next.reduce((sum, item) => sum + item.file.size, 0)
    for (const file of files) {
      const invalid = validateFile(file)
      if (invalid) {
        errors.push(`${file.name}: ${invalid}`)
        continue
      }
      if (next.length >= MAX_FILES) {
        errors.push('A batch can contain up to 50 images.')
        break
      }
      if (total + file.size > MAX_BATCH_BYTES) {
        errors.push(`${file.name}: The batch limit is 200 MB.`)
        continue
      }
      total += file.size
      next.push({ id: String(++nextId.current), file })
    }
    updateItems(next)
    setNotice(errors.join(' '))
  }
  function onInput(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }
  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    addFiles(Array.from(event.dataTransfer.files))
  }
  function remove(id: string) {
    if (busyRef.current || zipping) return
    const item = itemsRef.current.find((item) => item.id === id)
    if (item) release(item)
    updateItems(itemsRef.current.filter((item) => item.id !== id))
  }
  function clear() {
    if (busyRef.current || zipping) return
    itemsRef.current.forEach(release)
    updateItems([])
    setNotice('')
  }
  async function processAll() {
    if (busyRef.current || !itemsRef.current.length) return
    const error = validateSettings(settings)
    if (error) {
      setNotice(error)
      return
    }
    busyRef.current = true
    setBusy(true)
    setNotice('')
    for (const item of [...itemsRef.current]) {
      if (!mounted.current) break
      if (item.result) continue
      updateItems(
        itemsRef.current.map((current) =>
          current.id === item.id
            ? { ...current, processing: true, error: undefined }
            : current,
        ),
      )
      try {
        const result = await processImage(
          item.file,
          settings,
          processingAbort.current?.signal,
        )
        if (!mounted.current) break
        const url = URL.createObjectURL(result.blob)
        urls.current.add(url)
        updateItems(
          itemsRef.current.map((current) =>
            current.id === item.id
              ? { ...current, processing: false, result: { ...result, url } }
              : current,
          ),
        )
      } catch (error) {
        if (!mounted.current) break
        updateItems(
          itemsRef.current.map((current) =>
            current.id === item.id
              ? {
                  ...current,
                  processing: false,
                  error:
                    error instanceof Error
                      ? error.message
                      : 'Processing failed. Try a smaller image.',
                }
              : current,
          ),
        )
      }
      // Give the browser a chance to render progress between images.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    busyRef.current = false
    if (mounted.current) setBusy(false)
  }
  async function downloadAll() {
    if (zipping || busyRef.current) return
    setZipping(true)
    setNotice('')
    try {
      const results = itemsRef.current.flatMap((item) =>
        item.result ? [item.result] : [],
      )
      const names = uniqueNames(results.map((result) => result.name))
      const entries: Record<string, Uint8Array> = Object.create(null)
      for (const [index, result] of results.entries())
        entries[names[index]] = new Uint8Array(await result.blob.arrayBuffer())
      const bytes = await new Promise<Uint8Array<ArrayBuffer>>(
        (resolve, reject) => {
          zip(entries, { level: 0 }, (error, data) =>
            error ? reject(error) : resolve(data as Uint8Array<ArrayBuffer>),
          )
        },
      )
      if (!mounted.current) return
      const url = URL.createObjectURL(
        new Blob([bytes], { type: 'application/zip' }),
      )
      urls.current.add(url)
      download(url, 'pixforge-images.zip')
      setTimeout(() => {
        URL.revokeObjectURL(url)
        urls.current.delete(url)
      }, 30_000)
    } catch {
      if (mounted.current)
        setNotice(
          'Could not create the ZIP. Try downloading individual images or using a smaller batch.',
        )
    } finally {
      if (mounted.current) setZipping(false)
    }
  }

  const completed = items.filter((item) => item.result)
  const originalBytes = completed.reduce((sum, item) => sum + item.file.size, 0)
  const outputBytes = completed.reduce(
    (sum, item) => sum + item.result!.blob.size,
    0,
  )
  const saved = originalBytes - outputBytes
  const pending = items.length - completed.length
  const disabled = busy || zipping
  const settingsError = validateSettings(settings)

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="PixForge home">
          <span className="brand-mark">
            <Layers3 size={21} strokeWidth={2.5} />
          </span>
          PixForge<span className="version">v0.2.0</span>
        </a>
        <div className="header-note">
          <span className="status-dot" />
          100% on your device
          <span className="header-divider" />
          <a href="#privacy">
            <ShieldCheck size={15} /> Privacy first
          </a>
        </div>
      </header>

      <main>
        <section className="intro">
          <div className="eyebrow">
            <span /> SMALLER FILES. SAME BIG IDEAS.
          </div>
          <h1>
            Your images.
            <br className="mobile-break" /> <span>More possibilities.</span>
          </h1>
          <p>
            Compress, resize, and convert. Keep the quality, lose the weight.
            <br className="desktop-break" /> All in your browser. All yours.
          </p>
        </section>

        <div className="workspace">
          <section className="image-workspace" aria-label="Image workspace">
            <div
              className={`drop-zone ${dragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                if (!disabled) setDragging(true)
              }}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                )
                  setDragging(false)
              }}
              onDrop={onDrop}
            >
              <input
                ref={inputRef}
                id="file-input"
                type="file"
                accept={inputAccept}
                multiple
                onChange={onInput}
                disabled={disabled}
                className="sr-only"
                aria-label="Choose images"
              />
              <div className="upload-icon">
                <ImagePlus size={29} strokeWidth={1.6} />
                <span>
                  <Plus size={11} />
                </span>
              </div>
              <h2>Drop your images here</h2>
              <p>or choose a few. We’ll take it from here.</p>
              <button
                className="button browse-button"
                onClick={() => inputRef.current?.click()}
                disabled={disabled}
              >
                <Plus size={16} />
                Browse files
              </button>
              <div className="upload-meta">
                JPG, PNG, WebP, AVIF, HEIC/HEIF <span>·</span> Up to 40 MB each{' '}
                <span>·</span> 50 images
              </div>
            </div>

            <div className="queue-heading">
              <h2>
                Your images{' '}
                <span className="count">
                  {items.length.toString().padStart(2, '0')}
                </span>
              </h2>
              {items.length > 0 ? (
                <button
                  className="text-button"
                  onClick={clear}
                  disabled={disabled}
                >
                  <Trash2 size={13} />
                  Clear all
                </button>
              ) : (
                <span className="muted small">
                  A little lighter, a lot better.
                </span>
              )}
            </div>
            {notice && (
              <div className="notice" role="alert">
                <span>{notice}</span>
                <button
                  className="icon-button"
                  aria-label="Dismiss message"
                  onClick={() => setNotice('')}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            {items.length === 0 ? (
              <div className="empty-state">
                <div className="empty-art">
                  <div />
                  <div />
                  <div>
                    <ImagePlus size={24} strokeWidth={1.3} />
                  </div>
                </div>
                <h3>Good things start with a drop.</h3>
                <p>Your images will appear here, ready for a fresh start.</p>
                <div className="empty-tags">
                  <span>
                    <Check size={12} />
                    Batch processing
                  </span>
                  <span>
                    <Check size={12} />
                    No sign-up
                  </span>
                  <span>
                    <Check size={12} />
                    No uploads
                  </span>
                </div>
              </div>
            ) : (
              <ul className="image-list" aria-label="Uploaded images">
                {items.map((item) => (
                  <li className="image-row" key={item.id}>
                    <div className="thumbnail">
                      {item.result ? (
                        <img
                          src={item.result.url}
                          alt={`Processed ${item.file.name}`}
                        />
                      ) : item.processing ? (
                        <LoaderCircle className="spin" size={22} />
                      ) : (
                        <ImagePlus size={22} />
                      )}
                    </div>
                    <div className="image-details">
                      <h3 title={item.file.name}>{item.file.name}</h3>
                      {item.error ? (
                        <p className="image-error" role="alert">
                          {item.error}
                        </p>
                      ) : (
                        <p className="image-sizes">
                          {formatBytes(item.file.size)}
                          {item.result ? (
                            <>
                              <ArrowRight size={12} />
                              <strong>
                                {formatBytes(item.result.blob.size)}
                              </strong>
                              <span
                                className={
                                  item.result.blob.size <= item.file.size
                                    ? 'saving'
                                    : 'growth'
                                }
                              >
                                {item.result.blob.size <= item.file.size
                                  ? '−'
                                  : '+'}
                                {Math.abs(
                                  (1 - item.result.blob.size / item.file.size) *
                                    100,
                                ).toFixed(0)}
                                %
                              </span>
                            </>
                          ) : (
                            <span>
                              {item.processing
                                ? 'Processing…'
                                : 'Ready to process'}
                            </span>
                          )}
                        </p>
                      )}
                      {item.result && (
                        <p className="result-meta">
                          {item.result.width} × {item.result.height} ·{' '}
                          {item.result.blob.type
                            .replace('image/', '')
                            .toUpperCase()}
                        </p>
                      )}
                    </div>
                    <div className="row-actions">
                      {item.result && (
                        <button
                          className="icon-button download-one"
                          aria-label={`Download ${item.file.name}`}
                          onClick={() =>
                            download(item.result!.url, item.result!.name)
                          }
                          disabled={disabled}
                        >
                          <ArrowDownToLine size={17} />
                        </button>
                      )}
                      <button
                        className="icon-button"
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() => remove(item.id)}
                        disabled={disabled}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {completed.length > 0 && (
              <div className="batch-summary" aria-live="polite">
                <div>
                  <CheckCheck size={17} />
                  <span>
                    {completed.length} of {items.length} processed{' '}
                    <strong>
                      {saved >= 0
                        ? `${formatBytes(saved)} saved`
                        : `${formatBytes(-saved)} larger`}
                    </strong>
                  </span>
                </div>
                <button
                  className="button zip-button"
                  onClick={downloadAll}
                  disabled={disabled}
                >
                  {zipping ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <ArrowDownToLine size={15} />
                  )}
                  Download ZIP
                </button>
              </div>
            )}
            <div className="local-note">
              <LockKeyhole size={13} />
              <span>Your files never leave this device. That’s a promise.</span>
            </div>
          </section>

          <aside className="settings-panel" aria-labelledby="settings-title">
            <div className="panel-heading">
              <div>
                <Sparkles size={17} />
                <h2 id="settings-title">Make it yours</h2>
              </div>
              <span>OUTPUT SETTINGS</span>
            </div>
            <fieldset disabled={disabled}>
              <legend className="sr-only">Output settings</legend>
              <div className="setting-section">
                <label className="setting-label">
                  Convert to <span className="tiny-tag">FORMAT</span>
                </label>
                <div className="format-options">
                  {formatOptions.map((option) => (
                    <button
                      key={option.value}
                      className={`format-option ${settings.format === option.value ? 'selected' : ''}`}
                      onClick={() => changeSettings({ format: option.value })}
                      aria-pressed={settings.format === option.value}
                      disabled={
                        option.value === 'image/avif' &&
                        capabilities?.avif.encode !== true
                      }
                      title={
                        option.value === 'image/avif'
                          ? capabilities?.avif.encode
                            ? 'AVIF output supported by this browser'
                            : capabilities
                              ? 'AVIF output is not supported by this browser.'
                              : 'Checking AVIF output support…'
                          : undefined
                      }
                    >
                      {option.label}
                      {settings.format === option.value && (
                        <span className="selected-dot" />
                      )}
                    </button>
                  ))}
                </div>
                <p className="setting-hint">
                  {
                    formatOptions.find(
                      (option) => option.value === settings.format,
                    )?.description
                  }
                  {settings.format === 'image/webp'
                    ? '. Great quality, less space.'
                    : settings.format === 'image/jpeg'
                      ? '. Transparency becomes white.'
                      : '. Preserves transparency.'}
                </p>
                <p className="setting-hint format-support" role="status">
                  {!capabilities ? (
                    'Checking AVIF and HEIC support…'
                  ) : (
                    <>
                      {capabilities.avif.decode
                        ? 'AVIF input supported. '
                        : 'AVIF decoding is not supported by this browser. '}
                      {capabilities.avif.encode
                        ? 'AVIF output supported.'
                        : 'AVIF output is not supported by this browser.'}
                      <br />
                      {capabilities.heic
                        ? 'HEIC/HEIF input supported locally.'
                        : 'HEIC decoding is unavailable in this environment.'}
                    </>
                  )}
                </p>
              </div>
              <div className="setting-section quality-section">
                <div className="setting-label">
                  <label htmlFor="quality">Quality</label>
                  <output htmlFor="quality">
                    {settings.format === 'image/png'
                      ? 'Lossless'
                      : `${settings.quality}%`}
                  </output>
                </div>
                <input
                  id="quality"
                  type="range"
                  min="1"
                  max="100"
                  value={settings.quality}
                  disabled={disabled || settings.format === 'image/png'}
                  onChange={(event) =>
                    changeSettings({ quality: Number(event.target.value) })
                  }
                  style={
                    {
                      '--range-progress': `${settings.quality}%`,
                    } as React.CSSProperties
                  }
                />
                <div className="range-labels">
                  <span>Smaller file</span>
                  <span>Higher quality</span>
                </div>
                <div className="tip">
                  <Zap size={13} />
                  <span>
                    {settings.format === 'image/png'
                      ? 'PNG is lossless; quality doesn’t affect its size.'
                      : '80% is the sweet spot for most images.'}
                  </span>
                </div>
              </div>
              <div className="setting-section resize-section">
                <div className="setting-label">
                  <span>Resize image</span>
                  <span className="optional">Optional</span>
                </div>
                <div className="dimensions">
                  <label>
                    Width
                    <div className="dimension-input">
                      <input
                        type="number"
                        aria-label="Width in pixels"
                        min="1"
                        max="16384"
                        step="1"
                        placeholder="Original"
                        value={settings.width}
                        onChange={(event) =>
                          changeSettings({ width: event.target.value })
                        }
                      />
                      <span>px</span>
                    </div>
                  </label>
                  <button
                    className={`ratio-button ${settings.lock ? 'locked' : ''}`}
                    onClick={() => changeSettings({ lock: !settings.lock })}
                    aria-label="Lock aspect ratio"
                    aria-pressed={settings.lock}
                  >
                    {settings.lock ? (
                      <Link2 size={17} />
                    ) : (
                      <Unlink2 size={17} />
                    )}
                  </button>
                  <label>
                    Height
                    <div className="dimension-input">
                      <input
                        type="number"
                        aria-label="Height in pixels"
                        min="1"
                        max="16384"
                        step="1"
                        placeholder="Original"
                        value={settings.height}
                        onChange={(event) =>
                          changeSettings({ height: event.target.value })
                        }
                      />
                      <span>px</span>
                    </div>
                  </label>
                </div>
                <p className="setting-hint">
                  {settings.lock
                    ? 'Aspect ratio locked. Fits within these dimensions.'
                    : 'Aspect ratio unlocked. Images may stretch.'}{' '}
                  No upscaling.
                </p>
                {settingsError && (
                  <p role="alert" className="image-error">
                    {settingsError}
                  </p>
                )}
              </div>
            </fieldset>
            <div className="process-section">
              <button
                className="button process-button"
                onClick={processAll}
                disabled={disabled || !pending || !!settingsError}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Zap size={17} />
                )}
                {busy
                  ? `Processing ${completed.length} / ${items.length}`
                  : pending
                    ? `Process ${pending} image${pending === 1 ? '' : 's'}`
                    : items.length
                      ? 'All images processed'
                      : 'Process images'}
                {!busy && <ArrowRight size={17} />}
              </button>
              <p>
                <ShieldCheck size={12} />
                Local processing. Zero uploads.
              </p>
            </div>
          </aside>
        </div>

        <section
          className="benefits"
          id="privacy"
          aria-label="Privacy and features"
        >
          <div>
            <span className="benefit-icon">
              <ShieldCheck size={20} />
            </span>
            <div>
              <h3>Private by design</h3>
              <p>
                Your images stay in your browser.
                <br />
                We never see a single pixel.
              </p>
            </div>
          </div>
          <div>
            <span className="benefit-icon">
              <Zap size={20} />
            </span>
            <div>
              <h3>Less waiting. More creating.</h3>
              <p>
                No upload queues or server trips.
                <br />
                Just your device, doing its thing.
              </p>
            </div>
          </div>
          <div>
            <span className="benefit-icon">
              <Layers3 size={20} />
            </span>
            <div>
              <h3>A whole batch, one click</h3>
              <p>
                One image or fifty. Same simple
                <br />
                workflow, every time.
              </p>
            </div>
          </div>
        </section>
        <details className="good-to-know">
          <summary>
            Good to know <ChevronDown size={14} />
          </summary>
          <p>
            JPG, PNG, WebP, AVIF, and HEIC/HEIF inputs. AVIF support depends on
            your browser. HEIC/HEIF uses a local decoder and its primary image;
            animated inputs are flattened to one frame. Re-encoding removes most
            metadata; outputs are intended for screen use, not color-critical
            print. Smaller files aren’t guaranteed, especially with PNG. Quality
            is browser-dependent. Maximum: 50 images, 200 MB per batch, 40
            megapixels and 16,384 pixels per side. Large batches and ZIP
            downloads need available device memory. Changing settings clears
            previous results so you can process again.
          </p>
        </details>
      </main>
      <footer>
        <span className="footer-brand">
          <Layers3 size={14} />
          PixForge <span>·</span> Built for your pixels.
        </span>
        <span>
          No clouds. No compromises.<span className="footer-spark">✳</span>
        </span>
      </footer>
      <div className="sr-only" role="status" aria-live="polite">
        {busy
          ? `Processing images. ${completed.length} complete.`
          : `${items.length} images, ${completed.length} processed.`}
      </div>
    </div>
  )
}
