import { expect } from '@playwright/test'
import type { Page, Download } from '@playwright/test'
import { readFile } from 'node:fs/promises'

export async function sample(page: Page, name = 'sample.png') {
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
export async function downloadBytes(download: Download) {
  expect(await download.failure()).toBeNull()
  return readFile((await download.path())!)
}
export async function inspect(page: Page, bytes: Uint8Array, type: string) {
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
