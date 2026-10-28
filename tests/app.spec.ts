import { test, expect } from '@playwright/test'
import type { Page, Download } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'

async function sample(page: Page, name = 'sample.png') {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 100
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#477b39'
    ctx.fillRect(20, 20, 100, 60)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return { name, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') }
}
async function downloadBytes(download: Download) {
  expect(await download.failure()).toBeNull()
  return readFile((await download.path())!)
}
async function inspect(page: Page, bytes: Uint8Array, type: string) {
  return page.evaluate(
    async ({ data, type }) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(data)], { type }),
      )
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const result = {
        width: bitmap.width,
        height: bitmap.height,
        corner: Array.from(ctx.getImageData(0, 0, 1, 1).data),
      }
      bitmap.close()
      return result
    },
    { data: Array.from(bytes), type },
  )
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
})

test('converts, resizes, and downloads a real JPEG without image network requests', async ({
  page,
  context,
}) => {
  await context.setOffline(true)
  const requests: string[] = []
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()))
      requests.push(`${request.method()} ${request.url()}`)
  })
  await page.getByLabel('Choose images').setInputFiles(await sample(page))
  await page.getByRole('button', { name: 'JPG', exact: true }).click()
  await page.getByLabel('Width in pixels').fill('80')
  await page
    .getByRole('button', { name: 'Process 1 image', exact: true })
    .click()
  await expect(page.getByText('80 × 50 · JPEG')).toBeVisible()
  const pending = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Download sample.png', exact: true })
    .click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('sample-pixforge.jpg')
  const bytes = await downloadBytes(download)
  expect(Array.from(bytes.subarray(0, 3))).toEqual([255, 216, 255])
  const decoded = await inspect(page, bytes, 'image/jpeg')
  expect({ width: decoded.width, height: decoded.height }).toEqual({
    width: 80,
    height: 50,
  })
  // JPEG is lossy: white may shift slightly after chroma subsampling.
  for (const channel of decoded.corner.slice(0, 3))
    expect(channel).toBeGreaterThanOrEqual(250)
  expect(decoded.corner[3]).toBe(255)
  expect(requests).toEqual([])
})

test('batch ZIP preserves distinct images, PNG transparency, and unique names', async ({
  page,
}) => {
  const file = await sample(page)
  await page.getByLabel('Choose images').setInputFiles([file, file])
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  await expect(page.getByLabel('Quality', { exact: true })).toBeDisabled()
  await page.getByLabel('Lock aspect ratio').click()
  await page.getByLabel('Width in pixels').fill('40')
  await page.getByLabel('Height in pixels').fill('30')
  await page.getByRole('button', { name: 'Process 2 images' }).click()
  await expect(page.getByText('40 × 30 · PNG')).toHaveCount(2)
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download ZIP' }).click()
  const archive = unzipSync(await downloadBytes(await pending))
  expect(Object.keys(archive)).toEqual([
    'sample-pixforge.png',
    'sample-pixforge-2.png',
  ])
  for (const bytes of Object.values(archive)) {
    expect(Array.from(bytes.subarray(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ])
    expect(await inspect(page, bytes, 'image/png')).toEqual({
      width: 40,
      height: 30,
      corner: [0, 0, 0, 0],
    })
  }
})

test('WebP output is valid and changing settings invalidates old results', async ({
  page,
  browserName,
}) => {
  await page.getByLabel('Choose images').setInputFiles(await sample(page))
  await page
    .getByRole('button', { name: 'Process 1 image', exact: true })
    .click()
  // Safari versions without a WebP encoder must report the unsupported format safely.
  if (browserName === 'webkit') {
    const outcome = page
      .getByText('160 × 100 · WEBP')
      .or(
        page.getByText(
          'Your browser does not support encoding this format. Try PNG or JPG.',
        ),
      )
    await expect(outcome).toBeVisible()
    if (
      await page
        .getByText(
          'Your browser does not support encoding this format. Try PNG or JPG.',
        )
        .isVisible()
    )
      return
  }
  await expect(page.getByText('160 × 100 · WEBP')).toBeVisible()
  const pending = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Download sample.png', exact: true })
    .click()
  const bytes = await downloadBytes(await pending)
  expect(bytes.subarray(8, 12).toString()).toBe('WEBP')
  expect((await inspect(page, bytes, 'image/webp')).width).toBe(160)
  await page.getByLabel('Width in pixels').fill('80')
  await expect(page.getByRole('button', { name: 'Download ZIP' })).toHaveCount(
    0,
  )
  await expect(
    page.getByRole('button', { name: 'Process 1 image', exact: true }),
  ).toBeEnabled()
  await page
    .getByRole('button', { name: 'Remove sample.png', exact: true })
    .click()
  await expect(page.getByText('Good things start with a drop.')).toBeVisible()
})

test('rejects invalid input and isolates corrupt images from successful processing', async ({
  page,
}) => {
  await page.getByLabel('Choose images').setInputFiles({
    name: 'attack.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  })
  await expect(page.getByRole('alert')).toContainText(
    'Choose a JPG, PNG, or WebP',
  )
  await page.getByLabel('Choose images').setInputFiles([
    {
      name: 'broken.png',
      mimeType: 'image/png',
      buffer: Buffer.from('broken'),
    },
    await sample(page),
  ])
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  await page.getByRole('button', { name: 'Process 2 images' }).click()
  await expect(page.getByRole('alert')).toContainText('could not be decoded')
  await expect(page.getByText('160 × 100 · PNG')).toBeVisible()
  await page.getByRole('button', { name: 'Clear all' }).click()
  await expect(page.getByText('Good things start with a drop.')).toBeVisible()
})

test('supports drag and drop, validates dimensions, and has no horizontal overflow', async ({
  page,
}) => {
  const file = await sample(page)
  const transfer = await page.evaluateHandle(
    ({ bytes }) => {
      const data = new DataTransfer()
      data.items.add(
        new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' }),
      )
      return data
    },
    { bytes: Array.from(file.buffer) },
  )
  await page
    .locator('.drop-zone')
    .dispatchEvent('drop', { dataTransfer: transfer })
  await expect(page.getByRole('heading', { name: 'dropped.png' })).toBeVisible()
  await page.getByLabel('Width in pixels').fill('0')
  await expect(
    page.getByRole('button', { name: 'Process 1 image', exact: true }),
  ).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('whole numbers')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})
