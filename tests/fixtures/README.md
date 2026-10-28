# Original format fixtures

All images here were generated for PixForge from solid colored quadrants, not photographs or third-party artwork. The project authors dedicate these fixture images to the public domain under CC0-1.0. They contain no private data. Each is under 2 KB.

- `sample.jpg`, `sample.png`, and `sample.webp`: the same 64 × 40 colored quadrants in the original v0.1.0 input formats.
- `sample.heic`: 64 × 40, opaque HEVC image, red/green/blue/yellow quadrants.
- `rotated.heic`: the same coded pixels with a HEIF `irot` container transform, derived from EXIF orientation 6. Expected display: 40 × 64, 90° clockwise, blue top left, red top right, yellow bottom left, green bottom right. The EXIF tag is normalized by the encoder, so this tests the container transform rather than applying EXIF twice.
- `alpha.heic`: 64 × 40, transparent stripe on the left.
- `sample.avif`: 64 × 40, the same transparent stripe and colors, encoded with AV1.
- `probe.avif`: 1 × 1 white AVIF, also embedded as base64 in `src/avif-probe.ts` for network-free runtime detection.

Regenerate with Python, Pillow 12.3.0, and pillow-heif 1.8.1: `python tests/fixtures/generate.py`. These Python packages are development-only fixture tools, not application dependencies. The committed fixtures suffice for all tests; no Python installation or external API is needed in CI. Encoder builds can produce different compressed bytes; tests check decoded behavior.
