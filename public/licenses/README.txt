PixForge uses the unmodified libheif-js 1.23.5 WebAssembly bundle for local
HEIC/HEIF decoding. It is distributed under LGPL-3.0 with the included library
license texts in libheif-js.txt and libheif.txt. PixForge's own code is MIT.

Source and build instructions (including the linked HEVC decoder):
https://github.com/catdad-experiments/libheif-js/tree/1.23.5
https://github.com/catdad-experiments/libheif-js/blob/1.23.5/scripts/install.js
https://github.com/strukturag/libheif
https://github.com/strukturag/libde265

To replace the library, use this repository's package manifest and lockfile,
install a compatible libheif-js build, and run npm run build. The application
source and worker adapter are available in xsat21/PixForge. No library source
modifications are made. Preserve the library notices when redistributing.
These source URLs are documentation only; the running app does not fetch them.
