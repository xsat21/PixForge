import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { downloadBytes, inspect } from './helpers'

declare global {
  interface Window {
    pixforgeWorkers: { active: number; peak: number; created: number }
    pixforgeRevokedURLs: string[]
  }
}

async function ready(page: Page) {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.format-support')).not.toContainText('Checking', {
    timeout: 15_000,
  })
}
async function localFile(name: string, mimeType: string, filename = name) {
  return {
    name: filename,
    mimeType,
    buffer: await readFile(`tests/fixtures/${name}`),
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.pixforgeRevokedURLs = []
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = (url: string) => {
      window.pixforgeRevokedURLs.push(url)
      revoke(url)
    }
    const NativeWorker = window.Worker
    window.pixforgeWorkers = { active: 0, peak: 0, created: 0 }
    window.Worker = class extends NativeWorker {
      private stopped = false
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        const stats = window.pixforgeWorkers
        stats.created++
        stats.peak = Math.max(stats.peak, ++stats.active)
      }
      terminate() {
        if (!this.stopped) {
          this.stopped = true
          window.pixforgeWorkers.active--
        }
        super.terminate()
      }
    }
  })
})

test('AVIF input decodes and resizes locally, or reports unavailable decoding', async ({
  page,
  context,
}) => {
  await ready(page)
  const support = await page.locator('.format-support').innerText()
  const requests: string[] = []
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url())
  })
  await context.setOffline(true)
  // Mobile file pickers can supply no MIME. Sniff bytes after accepting the extension.
  await page
    .getByLabel('Choose images')
    .setInputFiles(await localFile('sample.avif', '', 'phone.AVIF'))
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  await page.getByLabel('Width in pixels').fill('32')
  await page
    .getByRole('button', { name: 'Process 1 image', exact: true })
    .click()
  if (support.includes('AVIF decoding is not supported')) {
    await expect(page.getByRole('alert')).toContainText(
      'AVIF decoding is not supported',
    )
  } else {
    await expect(page.getByText('32 × 20 · PNG')).toBeVisible()
    const pending = page.waitForEvent('download')
    await page
      .getByRole('button', { name: 'Download phone.AVIF', exact: true })
      .click()
    const bytes = await downloadBytes(await pending)
    expect(await inspect(page, bytes, 'image/png')).toEqual({
      width: 32,
      height: 20,
      corner: [0, 0, 0, 0],
    })
  }
  expect(requests).toEqual([])
})

test('HEIC/HEIF preserves container rotation and alpha with sequential workers, offline ZIP, and cleanup', async ({
  page,
  context,
}) => {
  await ready(page)
  await expect(page.locator('.format-support')).toContainText(
    'HEIC/HEIF input supported locally.',
  )
  await context.setOffline(true)
  const requests: string[] = []
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url())
  })
  await page
    .getByLabel('Choose images')
    .setInputFiles([
      await localFile('rotated.heic', 'application/octet-stream', 'phone.HEIF'),
      await localFile('alpha.heic', '', 'alpha.heic'),
    ])
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  await page
    .getByRole('button', { name: 'Process 2 images', exact: true })
    .click()
  await expect(page.getByText('40 × 64 · PNG')).toBeVisible()
  await expect(page.getByText('64 × 40 · PNG')).toBeVisible()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click()
  const archive = unzipSync(await downloadBytes(await pending))
  expect(Object.keys(archive)).toEqual([
    'phone-pixforge.png',
    'alpha-pixforge.png',
  ])
  const rotated = await page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(data)], { type: 'image/png' }),
    )
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const points = [
      [3, 3],
      [36, 3],
      [3, 60],
      [36, 60],
    ].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data))
    bitmap.close()
    return points
  }, Array.from(archive['phone-pixforge.png']))
  // Clockwise rotation: blue, red, yellow, green. Tolerate lossy HEVC color shifts.
  const expected = [
    [30, 30, 230],
    [230, 30, 30],
    [230, 210, 30],
    [30, 210, 30],
  ]
  rotated.forEach((pixel, index) =>
    pixel
      .slice(0, 3)
      .forEach((channel, color) =>
        expect(Math.abs(channel - expected[index][color])).toBeLessThan(20),
      ),
  )
  expect(
    (await inspect(page, archive['alpha-pixforge.png'], 'image/png')).corner[3],
  ).toBe(0)
  expect(await page.evaluate(() => window.pixforgeWorkers)).toMatchObject({
    active: 0,
    peak: 1,
    created: 3,
  })
  const resultURLs = await page
    .locator('.thumbnail img')
    .evaluateAll((images) => images.map((img) => (img as HTMLImageElement).src))
  await page.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect(page.getByText('Good things start with a drop.')).toBeVisible()
  expect(await page.evaluate(() => window.pixforgeRevokedURLs)).toEqual(
    expect.arrayContaining(resultURLs),
  )
  expect(requests).toEqual([])
})

for (const format of ['JPG', 'WebP']) {
  test(`HEIC converts to ${format} with resize and quality controls`, async ({
    page,
  }) => {
    await ready(page)
    await page
      .getByLabel('Choose images')
      .setInputFiles('tests/fixtures/alpha.heic')
    await page.getByRole('button', { name: format, exact: true }).click()
    await page.getByLabel('Width in pixels').fill('32')
    await page.getByLabel('Quality', { exact: true }).press('ArrowLeft')
    await page
      .getByRole('button', { name: 'Process 1 image', exact: true })
      .click()
    const mime = format === 'JPG' ? 'image/jpeg' : 'image/webp'
    const expected = format === 'JPG' ? '32 × 20 · JPEG' : '32 × 20 · WEBP'
    if (
      format === 'WebP' &&
      (await page
        .getByText(
          'Your browser does not support encoding this format. Try PNG or JPG.',
        )
        .isVisible())
    ) {
      await expect(page.getByRole('alert')).toContainText(
        'does not support encoding',
      )
      return
    }
    await expect(page.getByText(expected)).toBeVisible()
    const pending = page.waitForEvent('download')
    await page
      .getByRole('button', { name: 'Download alpha.heic', exact: true })
      .click()
    const decoded = await inspect(
      page,
      await downloadBytes(await pending),
      mime,
    )
    expect({ width: decoded.width, height: decoded.height }).toEqual({
      width: 32,
      height: 20,
    })
    if (format === 'JPG') {
      expect(decoded.corner[3]).toBe(255)
      // The resized transparent stripe is only four pixels wide; lossy JPEG
      // DCT/chroma subsampling can bleed color from the adjacent red quadrant.
      for (const channel of decoded.corner.slice(0, 3))
        expect(channel).toBeGreaterThan(225)
    } else expect(decoded.corner[3]).toBe(0)
  })
}

test('mixed native/modern batch isolates malformed HEIC and keeps ZIP names unique', async ({
  page,
}) => {
  await ready(page)
  const avifDecode = !(
    await page.locator('.format-support').innerText()
  ).includes('AVIF decoding is not supported')
  const heic = await localFile('sample.heic', 'image/heic')
  await page.getByLabel('Choose images').setInputFiles([
    heic,
    await localFile('sample.avif', 'image/avif'),
    await localFile('sample.jpg', 'image/jpeg'),
    await localFile('sample.webp', 'image/webp'),
    await localFile('sample.png', 'image/png'),
    {
      name: 'broken.heic',
      mimeType: 'image/heic',
      buffer: heic.buffer.subarray(0, 32),
    },
  ])
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  await page
    .getByRole('button', { name: 'Process 6 images', exact: true })
    .click()
  await expect(page.getByText('64 × 40 · PNG')).toHaveCount(avifDecode ? 5 : 4)
  await expect(
    page
      .locator('.image-row')
      .filter({ has: page.getByRole('heading', { name: 'broken.heic' }) })
      .getByRole('alert'),
  ).toContainText('could not be decoded')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click()
  const archive = unzipSync(await downloadBytes(await pending))
  expect(Object.keys(archive)).toHaveLength(avifDecode ? 5 : 4)
  for (const bytes of Object.values(archive))
    expect((await inspect(page, bytes, 'image/png')).width).toBe(64)
  expect(await page.evaluate(() => window.pixforgeWorkers.active)).toBe(0)
})

test('AVIF output is enabled only when the native encoder produces AVIF', async ({
  page,
  context,
}) => {
  await ready(page)
  const nativeEncode = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    return new Promise<boolean>((resolve) =>
      canvas.toBlob(
        (blob) => resolve(blob?.type === 'image/avif'),
        'image/avif',
      ),
    )
  })
  const option = page.getByRole('button', { name: 'AVIF', exact: true })
  if (!nativeEncode) {
    await expect(option).toBeDisabled()
    await expect(page.locator('.format-support')).toContainText(
      'AVIF output is not supported by this browser.',
    )
    return
  }
  await expect(option).toBeEnabled()
  await context.setOffline(true)
  const requests: string[] = []
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url())
  })
  await option.click()
  await page.getByLabel('Width in pixels').fill('32')
  await page.getByLabel('Quality', { exact: true }).press('ArrowLeft')
  await page
    .getByLabel('Choose images')
    .setInputFiles([
      'tests/fixtures/sample.png',
      'tests/fixtures/sample.jpg',
      'tests/fixtures/sample.webp',
      'tests/fixtures/sample.heic',
      'tests/fixtures/sample.avif',
    ])
  await page
    .getByRole('button', { name: 'Process 5 images', exact: true })
    .click()
  const avifDecode = !(
    await page.locator('.format-support').innerText()
  ).includes('AVIF decoding is not supported')
  await expect(page.getByText('32 × 20 · AVIF')).toHaveCount(avifDecode ? 5 : 4)
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click()
  const archive = unzipSync(await downloadBytes(await pending))
  for (const [name, bytes] of Object.entries(archive)) {
    expect(name).toMatch(/\.avif$/)
    expect(bytes.subarray(4, 8).toString()).toBe('ftyp')
    expect(bytes.subarray(8, 32).toString()).toContain('avif')
    if (avifDecode)
      expect((await inspect(page, bytes, 'image/avif')).width).toBe(32)
  }
  expect(requests).toEqual([])
})

test('unavailable HEIC decoder reports a per-image error and still processes PNG', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'WebAssembly', {
      value: undefined,
      configurable: true,
    })
  })
  await ready(page)
  await expect(page.locator('.format-support')).toContainText(
    'HEIC decoding is unavailable in this environment.',
  )
  await page
    .getByLabel('Choose images')
    .setInputFiles(['tests/fixtures/sample.heic', 'tests/fixtures/sample.png'])
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  await page
    .getByRole('button', { name: 'Process 2 images', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText(
    'HEIC decoding is unavailable in this environment.',
  )
  await expect(page.getByText('64 × 40 · PNG')).toBeVisible()
  expect(await page.evaluate(() => window.pixforgeWorkers.active)).toBe(0)
})
