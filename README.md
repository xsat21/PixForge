# PixForge v0.2.0

**Your images. Your device.** A privacy-first, self-hosted toolkit for batch image compression, resizing, and conversion. All image processing runs locally using native browser decoders, a bundled HEIC/HEIF WebAssembly decoder, and the Canvas API. No accounts, uploads, analytics, third-party fonts, or remote APIs.

## Features

- Drag and drop or select up to 50 JPG, PNG, WebP, AVIF, and HEIC/HEIF images.
- Convert to JPG, PNG, WebP, or AVIF when the browser has a native AVIF encoder; adjust lossy quality from 1–100%.
- Runtime AVIF input/output capability checks, inline compatibility messages, and fully local HEIC/HEIF input decoding.
- Resize to a bounding box with aspect ratio locked, or set independent dimensions. Images are never upscaled.
- Compare input/output file sizes, including when an output is larger.
- Download individual results or a ZIP with collision-safe filenames.
- Responsive dark interface, keyboard controls, progress announcements, and per-image error handling.
- Nginx static hosting with a restrictive Content Security Policy and no upload endpoint.

## Local development

Requires Node.js **22.12+** (Node 24 LTS recommended) and npm. Use the committed lockfile.

```sh
npm ci
npm run dev
```

Vite serves the development app on port 5173. The dev server binds to all interfaces for container development; expose it only on trusted networks. Development uses Vite's local WebSocket for hot reload; the production app makes no processing requests.

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium firefox webkit
npm run test:e2e
```

Unit tests cover limits, dimensions, validation, extensions/MIME types, binary signatures, filenames, encoder fallback, unsupported decoders, worker cancellation, and worker deadlines. Browser tests exercise real Canvas encoding and decoding, JPEG transparency flattening, PNG alpha, WebP support/fallback, AVIF input and capability behavior, HEIC/HEIF input, HEIF container rotation, alpha, mixed-format error isolation, worker lifetimes, drag and drop, ZIP contents, settings invalidation, responsive layout, and no HTTP requests during processing. Tiny original fixtures are committed in `tests/fixtures`; their generation tools are not runtime or CI dependencies. Browser projects include desktop Chromium, mobile Chromium, Firefox, and WebKit. To use an existing Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium` and pass `-- --project=chromium --project=mobile-chromium` to `npm run test:e2e`. Set `PLAYWRIGHT_BASE_URL` to test a running deployment instead of starting the preview server. CI runs all checks and the same browser tests against the Docker deployment with its production CSP, plus HTTP/security-header checks.

To inspect a production build locally:

```sh
npm run build
npm run preview
```

## Self-host with Docker

Requires Docker with BuildKit and Docker Compose v2.

```sh
docker compose up --build -d
```

Open your host on port **8080**. No database, API service, credentials, volumes, or image storage is required. The container runs as an unprivileged user with a read-only filesystem, temporary runtime storage, and dropped capabilities. Health is checked at `/healthz`.

```sh
docker compose logs -f
docker compose down
```

Or build and run directly:

```sh
docker build -t pixforge:0.2.0 .
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp:rw,size=16m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges pixforge:0.2.0
```

For a build behind a trusted TLS-intercepting proxy, pass its public CA with `docker build --secret id=proxy_ca,src=/path/to/ca.pem -t pixforge:0.2.0 .`. Certificate verification stays enabled; the CA mount is not retained. No build secret is needed for ordinary deployments.

Place a TLS reverse proxy in front of port 8080 for public deployment. The container includes security headers in `nginx.conf`; preserve them in your reverse proxy. Nginx may retain ordinary page/asset access logs, but images and image filenames are never sent to it. The production CSP keeps `connect-src 'none'` and only adds `'wasm-unsafe-eval'` to `script-src` so the bundled decoder can instantiate WebAssembly. It does **not** enable JavaScript `unsafe-eval`, external scripts, or remote connections. Blob workers remain allowed. The app needs a modern browser with Canvas, Blob URLs, and `createImageBitmap`. HEIC/HEIF additionally needs WebAssembly and Web Workers, including permission to instantiate WASM under your hosting CSP. HTTPS is recommended for public hosting.

For other static hosting, deploy `dist/` after `npm run build` and configure the equivalent headers from `nginx.conf`. The build assumes hosting at the domain root. The app can keep processing after its assets load without an Internet connection; it does not include a service worker for offline page reloads.

## Format and browser compatibility

| Format      | Input                                                          | Output                                                                                      |
| ----------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| JPG / PNG   | Native browser decoding                                        | Native Canvas encoding                                                                      |
| WebP        | Native browser decoding                                        | Native Canvas encoding; an unsupported encoder reports an inline error                      |
| AVIF        | Native decoding, tested at runtime using an embedded 1×1 image | Only enabled after a Canvas probe produces an AVIF MIME type **and** an AVIF file signature |
| HEIC / HEIF | Bundled libheif HEVC decoder in a local worker                 | Not an output format; convert to JPG/PNG/WebP, or AVIF when enabled                         |

**AVIF decoding and encoding are independent capabilities.** Do not infer output support from a browser's ability to display AVIF. Many browsers can decode AVIF but cannot encode it via Canvas. PixForge always displays the AVIF output control, but disables it and explains why when the probe fails. AVIF input gets a friendly per-image error if decoding is unavailable; damaged files and unsupported AVIF variants also fail individually. The same resizing, quality, comparison, and download controls apply to enabled AVIF output. There is no AVIF encoder polyfill or remote fallback.

Desktop/mobile Chromium validation confirmed native AVIF input and correct **unavailable AVIF output** behavior. That environment did not provide a native AVIF Canvas encoder, so real AVIF export was not exercised there; unit tests cover the positive probe contract and silent PNG fallback, and browser tests exercise real AVIF export conditionally on engines that provide it. Firefox/WebKit behavior must be checked by the browser suite on those engines; do not assume support from a version label alone.

## HEIC/HEIF implementation and tradeoffs

The only new application dependency is [`libheif-js` 1.23.5](https://github.com/catdad-experiments/libheif-js/tree/1.23.5), a maintained Emscripten build of libheif 1.23.5 with the HEVC decoder. PixForge imports its prebundled ESM WASM build, not the older pure-JavaScript build. The decoder and WASM bytes are included in the production JavaScript; there is no runtime CDN, WASM fetch, telemetry, or upload. This adds roughly 2 MB to the JavaScript payload (the complete production JS is approximately 2.3 MB / 809 KB gzip). Vite's large-chunk warning is expected: eager bundling deliberately makes the decoder available for offline processing immediately after the page loads.

A startup worker probes actual decoder initialization. Each HEIC job then gets a fresh disposable worker, after the probe completes; the application processes images sequentially. Buffers move across the worker boundary using transferables. The worker reads the primary image, checks dimensions before allocating RGBA pixels, and preserves decoded alpha. Results go through the existing Canvas resizing/encoding pipeline. Image handles and decoder contexts are released, and the parent terminates the worker after success, failure, cancellation/page unmount, or a 60-second deadline, releasing its WASM heap instead of retaining a growing decoder pool.

Unsupported codecs, malformed containers, unavailable Worker/WASM support, and worker errors become individual inline errors, so the rest of the batch can finish. Timeouts are reported as a decoding failure with a suggestion to use a smaller file. Native browser decodes cannot be forcibly interrupted, and a severe browser/process memory exhaustion can still terminate the tab. HEIC HDR/high-bit-depth content becomes 8-bit RGBA for Canvas; this is not lossless HDR, camera RAW, or color-managed editing. Transparency is preserved in PNG/WebP/AVIF when supported by the source and target codecs; JPG flattens it to white.

The existing MIT license covers PixForge's application code. The decoder has LGPL-3.0 obligations; its unmodified library notices/license texts and source/build/replacement pointers ship in [`public/licenses/`](public/licenses/README.txt), also available under `/licenses/` in the deployed app. Preserve those files when redistributing, including when replacing the decoder with another compatible build.

## Image behavior and limits

- Inputs: JPG, PNG, WebP, AVIF, HEIC, and HEIF. Other formats, including SVG, are deliberately rejected. Missing or generic MIME types fall back to known extensions; bytes are checked before selecting a decoder. HEIF denotes a container: this release supports HEVC-coded HEIC/HEIF through libheif; other HEIF codecs/variants may be unsupported.
- Limits: 40 MB per file, 200 MB per batch, 50 files, 40 million decoded pixels, and 16,384 pixels per side. Files are processed sequentially to limit peak canvas memory. HEIC dimensions are checked before allocating the RGBA display buffer; native-format dimensions are checked after browser decoding. Container parsing and native decoding can still consume memory before those checks; they cannot prevent every decoder memory exhaustion. Use smaller batches on constrained devices.
- Locked resize uses width and height as maximum bounds and preserves each image's own aspect ratio. Blank bounds preserve the original size. Unlocking allows stretching; a blank dimension then keeps that original dimension.
- PNG output is lossless; its quality slider is disabled. JPG fills transparent areas with white. AVIF/WebP/JPG quality and color handling depend on the browser's encoder; a specific file size or reduction is not guaranteed. An unsupported output encoder produces a per-image error; select PNG or JPG instead.
- Animated native inputs are flattened to the browser-decoded frame. HEIC/HEIF uses its primary image (or first image if none is marked primary); sequences, depth maps, and additional images are not exported. Animation, EXIF/IPTC/XMP metadata, original DPI, and original color profiles are not preserved. Native decoding applies browser orientation handling; libheif applies HEIF container rotation/mirroring. A rotated HEIC fixture checks both dimensions and colored pixel positions to avoid double-rotating. This is a screen-image tool, not a color-managed print workflow.
- Originals remain in memory for reprocessing; results are cleared when settings change. Removing images, clearing the batch, or leaving the page releases result Blob URLs. Reloading loses the batch. Nothing is saved to browser storage.
- ZIP archives are assembled in memory, so large batches require extra RAM. ZIP compression is disabled because the images are already compressed. Duplicate names get numbered suffixes.

## License

[MIT application license](LICENSE); see the [decoder notices](public/licenses/README.txt) for the separately licensed HEIC dependency.
