# PixForge v0.1.0

**Your images. Your device.** A privacy-first, self-hosted toolkit for batch image compression, resizing, and conversion. All image processing runs locally using the browser's image decoder and Canvas API. No accounts, uploads, analytics, third-party fonts, or remote APIs.

## Features

- Drag and drop or select up to 50 JPG, PNG, and WebP images.
- Convert to JPG, PNG, or WebP; adjust lossy quality from 1–100%.
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

Unit tests cover limits, dimensions, validation, and filenames. Browser tests exercise real Canvas encoding and decoding, JPEG transparency flattening, PNG alpha, WebP support/fallback, drag and drop, corrupt input isolation, ZIP contents, settings invalidation, responsive layout, and no HTTP requests during processing. Browser projects include desktop Chromium, mobile Chromium, Firefox, and WebKit. To use an existing Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium` and pass `-- --project=chromium --project=mobile-chromium` to `npm run test:e2e`. Set `PLAYWRIGHT_BASE_URL` to test a running deployment instead of starting the preview server. CI runs all checks and a Docker HTTP smoke test.

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
docker build -t pixforge:0.1.0 .
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp:rw,size=16m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges pixforge:0.1.0
```

For a build behind a trusted TLS-intercepting proxy, pass its public CA with `docker build --secret id=proxy_ca,src=/path/to/ca.pem -t pixforge:0.1.0 .`. Certificate verification stays enabled; the CA mount is not retained. No build secret is needed for ordinary deployments.

Place a TLS reverse proxy in front of port 8080 for public deployment. The container includes security headers in `nginx.conf`; preserve them in your reverse proxy. Nginx may retain ordinary page/asset access logs, but images and image filenames are never sent to it. The production CSP denies network connections from application JavaScript. The app needs a modern browser with Canvas, Blob URLs, and `createImageBitmap`. HTTPS is recommended for public hosting.

For other static hosting, deploy `dist/` after `npm run build` and configure the equivalent headers from `nginx.conf`. The build assumes hosting at the domain root. The app can keep processing after its assets load without an Internet connection; it does not include a service worker for offline page reloads.

## Image behavior and limits

- Inputs: JPG, PNG, and WebP. Other formats, including SVG, are deliberately rejected.
- Limits: 40 MB per file, 200 MB per batch, 50 files, 40 million decoded pixels, and 16,384 pixels per side. Files are processed sequentially to limit peak canvas memory. Pixel limits are checked after browser decoding; they cannot prevent every decoder memory exhaustion. Use smaller batches on constrained devices.
- Locked resize uses width and height as maximum bounds and preserves each image's own aspect ratio. Blank bounds preserve the original size. Unlocking allows stretching; a blank dimension then keeps that original dimension.
- PNG output is lossless; its quality slider is disabled. JPG fills transparent areas with white. WebP/JPG quality and color handling depend on the browser's encoder; a specific file size or reduction is not guaranteed. An unsupported output encoder produces a per-image error; select PNG or JPG instead.
- Animated inputs are flattened to the browser-decoded frame. Animation, EXIF/IPTC/XMP metadata, original DPI, and original color profiles are not preserved. Decoding applies browser orientation handling. This is a screen-image tool, not a color-managed print workflow.
- Originals remain in memory for reprocessing; results are cleared when settings change. Removing images, clearing the batch, or leaving the page releases result Blob URLs. Reloading loses the batch. Nothing is saved to browser storage.
- ZIP archives are assembled in memory, so large batches require extra RAM. ZIP compression is disabled because the images are already compressed. Duplicate names get numbered suffixes.

## License

[MIT](LICENSE)
