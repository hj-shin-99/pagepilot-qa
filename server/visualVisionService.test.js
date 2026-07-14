import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { createVisualVisionService, prepareVisionImage } from './visualVisionService.js'

test('vision image preparation resizes and reuses cached output', async () => {
  const workspace = createTempWorkspace()
  const inputPath = path.join(workspace, 'source.png')
  const cacheDir = path.join(workspace, 'ai-review')
  await sharp({ create: { width: 400, height: 240, channels: 3, background: '#336699' } }).png().toFile(inputPath)

  const first = await prepareVisionImage(inputPath, { cacheDir, maxWidth: 120, quality: 75, label: 'figma' })
  const second = await prepareVisionImage(inputPath, { cacheDir, maxWidth: 120, quality: 75, label: 'figma' })

  assert.equal(first.mimeType, 'image/jpeg')
  assert.equal(first.width, 120)
  assert.equal(first.cached, false)
  assert.equal(second.cached, true)
  assert.equal(second.dataUrl.startsWith('data:image/jpeg;base64,'), true)
})

test('visual vision service attaches overview and hero crop images without exposing local paths', async () => {
  const workspace = createTempWorkspace()
  const paths = {
    projectRoot: workspace,
    figmaRenderDir: path.join(workspace, '.cache', 'figma', 'renders'),
    visualScreenshotDir: path.join(workspace, '.cache', 'visual', 'screenshots'),
  }
  fs.mkdirSync(paths.figmaRenderDir, { recursive: true })
  fs.mkdirSync(paths.visualScreenshotDir, { recursive: true })
  await sharp({ create: { width: 220, height: 140, channels: 3, background: '#111111' } }).png().toFile(path.join(paths.figmaRenderDir, 'render-1.png'))
  await sharp({ create: { width: 220, height: 140, channels: 3, background: '#eeeeee' } }).png().toFile(path.join(paths.visualScreenshotDir, 'aaaaaaaaaaaaaaaaaaaaaaaa.png'))

  const service = createVisualVisionService({ paths, cacheDir: path.join(workspace, '.cache', 'visual', 'ai-review'), overviewMaxWidth: 100, heroMaxWidth: 120 })
  const result = await service.attachVisionInput({
    visualAssets: { figmaRenderId: 'render-1', webScreenshotFileName: 'aaaaaaaaaaaaaaaaaaaaaaaa.png' },
    visualEvidence: {
      hero: {
        figmaSectionId: 'figma-hero',
        webSectionId: 'web-hero',
        sections: [
          { sectionId: 'figma-hero', source: 'figma', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.7, confidence: 'high' },
          { sectionId: 'web-hero', source: 'web', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.7, confidence: 'high' },
        ],
      },
      media: {},
    },
  })

  assert.equal(result.meta.visionPrepared, true)
  assert.equal(result.payload.visionInput.images.length, 4)
  assert.deepEqual(result.meta.visionInputSummary.map((item) => item.label), ['figma-overview', 'web-overview', 'figma-hero', 'web-hero'])
  assert.deepEqual(result.meta.visionInputSummary.map((item) => item.detail), ['low', 'low', 'high', 'high'])
  assert.equal(result.payload.visionInput.images.every((image) => image.dataUrl.startsWith('data:image/jpeg;base64,')), true)
  assert.equal(result.meta.visionCropSummary.every((item) => item.cropReason === 'hero-section-descriptor'), true)
  assert.equal(JSON.stringify(result.meta).includes(workspace), false)
})

test('visual vision service records hero crop fallback reason when descriptor is missing', async () => {
  const workspace = createTempWorkspace()
  const paths = {
    projectRoot: workspace,
    figmaRenderDir: path.join(workspace, '.cache', 'figma', 'renders'),
    visualScreenshotDir: path.join(workspace, '.cache', 'visual', 'screenshots'),
  }
  fs.mkdirSync(paths.figmaRenderDir, { recursive: true })
  fs.mkdirSync(paths.visualScreenshotDir, { recursive: true })
  await sharp({ create: { width: 320, height: 1000, channels: 3, background: '#111111' } }).png().toFile(path.join(paths.figmaRenderDir, 'render-1.png'))
  await sharp({ create: { width: 320, height: 1000, channels: 3, background: '#eeeeee' } }).png().toFile(path.join(paths.visualScreenshotDir, 'aaaaaaaaaaaaaaaaaaaaaaaa.png'))

  const service = createVisualVisionService({ paths, cacheDir: path.join(workspace, '.cache', 'visual', 'ai-review'), overviewMaxWidth: 100, heroMaxWidth: 120 })
  const result = await service.attachVisionInput({ visualAssets: { figmaRenderId: 'render-1', webScreenshotFileName: 'aaaaaaaaaaaaaaaaaaaaaaaa.png' }, visualEvidence: { hero: {}, media: {} } })

  assert.equal(result.payload.visionInput.images.length, 4)
  assert.equal(result.meta.visionCropSummary.every((item) => item.cropFailureReason === 'hero-descriptor-missing'), true)
})

function createTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pagepilot-vision-'))
}
