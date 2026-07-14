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

test('visual vision service keeps hero descriptor crop within actual hero boundary', async () => {
  const workspace = createTempWorkspace()
  const paths = {
    projectRoot: workspace,
    figmaRenderDir: path.join(workspace, '.cache', 'figma', 'renders'),
    visualScreenshotDir: path.join(workspace, '.cache', 'visual', 'screenshots'),
  }
  fs.mkdirSync(paths.figmaRenderDir, { recursive: true })
  fs.mkdirSync(paths.visualScreenshotDir, { recursive: true })
  await sharp({ create: { width: 1600, height: 5600, channels: 3, background: '#111111' } }).png().toFile(path.join(paths.figmaRenderDir, 'render-1.png'))
  await sharp({ create: { width: 1600, height: 2200, channels: 3, background: '#eeeeee' } }).png().toFile(path.join(paths.visualScreenshotDir, 'aaaaaaaaaaaaaaaaaaaaaaaa.png'))

  const service = createVisualVisionService({ paths, cacheDir: path.join(workspace, '.cache', 'visual', 'ai-review'), heroMaxWidth: 1600 })
  const result = await service.attachVisionInput({
    visualAssets: { figmaRenderId: 'render-1', webScreenshotFileName: 'aaaaaaaaaaaaaaaaaaaaaaaa.png' },
    visualEvidence: {
      hero: {
        figmaSectionId: 'figma-hero',
        webSectionId: 'web-hero',
        sections: [
          { sectionId: 'figma-hero', source: 'figma', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.18, confidence: 'high' },
          { sectionId: 'web-hero', source: 'web', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.31, confidence: 'high' },
        ],
      },
      media: {},
    },
  })
  const figmaHero = result.meta.visionInputSummary.find((item) => item.label === 'figma-hero')
  const webHero = result.meta.visionInputSummary.find((item) => item.label === 'web-hero')

  assert.equal(figmaHero.height <= 1050, true)
  assert.equal(webHero.height <= 700, true)
  assert.equal(result.meta.visionCropSummary.every((item) => item.cropReason === 'hero-section-descriptor'), true)
})

test('visual vision service expands short hero descriptor to descendant CTA and media boxes', async () => {
  const workspace = createTempWorkspace()
  const paths = {
    projectRoot: workspace,
    figmaRenderDir: path.join(workspace, '.cache', 'figma', 'renders'),
    visualScreenshotDir: path.join(workspace, '.cache', 'visual', 'screenshots'),
  }
  fs.mkdirSync(paths.figmaRenderDir, { recursive: true })
  fs.mkdirSync(paths.visualScreenshotDir, { recursive: true })
  await sharp({ create: { width: 1600, height: 2200, channels: 3, background: '#111111' } }).png().toFile(path.join(paths.figmaRenderDir, 'render-1.png'))
  await sharp({ create: { width: 1600, height: 2200, channels: 3, background: '#eeeeee' } }).png().toFile(path.join(paths.visualScreenshotDir, 'aaaaaaaaaaaaaaaaaaaaaaaa.png'))

  const service = createVisualVisionService({ paths, cacheDir: path.join(workspace, '.cache', 'visual', 'ai-review'), heroMaxWidth: 1600 })
  const result = await service.attachVisionInput({
    visualAssets: { figmaRenderId: 'render-1', webScreenshotFileName: 'aaaaaaaaaaaaaaaaaaaaaaaa.png' },
    visualEvidence: {
      hero: {
        figmaSectionId: 'figma-hero',
        webSectionId: 'web-hero',
        sections: [
          { sectionId: 'figma-hero', source: 'figma', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.09, confidence: 'high' },
          { sectionId: 'web-hero', source: 'web', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.09, confidence: 'high' },
        ],
        descendants: [
          { source: 'figma', kind: 'cta', xRatio: 0.1, yRatio: 0.22, widthRatio: 0.2, heightRatio: 0.05 },
          { source: 'figma', kind: 'media', xRatio: 0.5, yRatio: 0.25, widthRatio: 0.35, heightRatio: 0.16 },
          { source: 'web', kind: 'cta', xRatio: 0.1, yRatio: 0.2, widthRatio: 0.2, heightRatio: 0.05 },
          { source: 'web', kind: 'media', xRatio: 0.5, yRatio: 0.23, widthRatio: 0.35, heightRatio: 0.16 },
        ],
      },
      media: {},
    },
  })
  const figmaHero = result.meta.visionCropSummary.find((item) => item.label === 'figma-hero')
  const webHero = result.meta.visionCropSummary.find((item) => item.label === 'web-hero')

  assert.equal(figmaHero.height > figmaHero.cropDiagnostics.descriptorHeight, true)
  assert.equal(webHero.height > webHero.cropDiagnostics.descriptorHeight, true)
  assert.equal(figmaHero.cropDiagnostics.cropAdjusted, true)
  assert.equal(figmaHero.cropDiagnostics.cropAdjustmentReason, 'descendant-union-adjusted')
  assert.equal(webHero.cropDiagnostics.cropAdjustmentReason, 'descendant-union-adjusted')
})

test('visual vision service clamps oversized hero descriptor at next section boundary', async () => {
  const workspace = createTempWorkspace()
  const paths = {
    projectRoot: workspace,
    figmaRenderDir: path.join(workspace, '.cache', 'figma', 'renders'),
    visualScreenshotDir: path.join(workspace, '.cache', 'visual', 'screenshots'),
  }
  fs.mkdirSync(paths.figmaRenderDir, { recursive: true })
  fs.mkdirSync(paths.visualScreenshotDir, { recursive: true })
  await sharp({ create: { width: 1600, height: 2200, channels: 3, background: '#111111' } }).png().toFile(path.join(paths.figmaRenderDir, 'render-1.png'))
  await sharp({ create: { width: 1600, height: 2200, channels: 3, background: '#eeeeee' } }).png().toFile(path.join(paths.visualScreenshotDir, 'aaaaaaaaaaaaaaaaaaaaaaaa.png'))

  const service = createVisualVisionService({ paths, cacheDir: path.join(workspace, '.cache', 'visual', 'ai-review'), heroMaxWidth: 1600 })
  const result = await service.attachVisionInput({
    visualAssets: { figmaRenderId: 'render-1', webScreenshotFileName: 'aaaaaaaaaaaaaaaaaaaaaaaa.png' },
    visualEvidence: {
      hero: {
        figmaSectionId: 'figma-hero',
        webSectionId: 'web-hero',
        sections: [
          { sectionId: 'figma-hero', source: 'figma', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.62, confidence: 'high' },
          { sectionId: 'figma-next', source: 'figma', role: 'content', xRatio: 0, yRatio: 0.31, widthRatio: 1, heightRatio: 0.2, confidence: 'medium' },
          { sectionId: 'web-hero', source: 'web', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.58, confidence: 'high' },
          { sectionId: 'web-next', source: 'web', role: 'content', xRatio: 0, yRatio: 0.28, widthRatio: 1, heightRatio: 0.2, confidence: 'medium' },
        ],
      },
      media: {},
    },
  })
  const figmaHero = result.meta.visionCropSummary.find((item) => item.label === 'figma-hero')
  const webHero = result.meta.visionCropSummary.find((item) => item.label === 'web-hero')

  assert.equal(figmaHero.height, 682)
  assert.equal(Math.abs(webHero.height - 616) <= 1, true)
  assert.equal(figmaHero.cropDiagnostics.cropAdjustmentReason, 'next-section-clamped')
  assert.equal(webHero.cropDiagnostics.cropAdjustmentReason, 'next-section-clamped')
})

test('visual vision service expands generic short hero crop to lower CTA ratio bbox', async () => {
  const { paths, workspace } = await createVisionWorkspace({ width: 1200, height: 2400 })
  const service = createVisualVisionService({ paths, cacheDir: path.join(workspace, '.cache', 'visual', 'ai-review'), heroMaxWidth: 1200 })
  const result = await service.attachVisionInput(createGenericHeroPayload({
    sections: [
      { sectionId: 'figma-hero', source: 'figma', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.12 },
      { sectionId: 'web-hero', source: 'web', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.12 },
    ],
    descendants: [
      { source: 'figma', kind: 'cta', xRatio: 0.12, yRatio: 0.38, widthRatio: 0.18, heightRatio: 0.05 },
      { source: 'web', kind: 'cta', xRatio: 0.14, yRatio: 0.38, widthRatio: 0.18, heightRatio: 0.05 },
    ],
  }))
  const webHero = result.meta.visionCropSummary.find((item) => item.label === 'web-hero')

  assert.equal(webHero.cropDiagnostics.validDescendantBoxCount, 1)
  assert.equal(webHero.cropDiagnostics.descendantUnionHeight > 0, true)
  assert.equal(webHero.cropDiagnostics.finalCropHeight > webHero.cropDiagnostics.descriptorHeight, true)
  assert.equal(webHero.cropDiagnostics.cropQualityPassed, true)
})

test('visual vision service accepts px bbox, rejects invalid bbox, and does not cross next section', async () => {
  const { paths, workspace } = await createVisionWorkspace({ width: 1200, height: 2000 })
  const service = createVisualVisionService({ paths, cacheDir: path.join(workspace, '.cache', 'visual', 'ai-review'), heroMaxWidth: 1200 })
  const result = await service.attachVisionInput(createGenericHeroPayload({
    sections: [
      { sectionId: 'figma-hero', source: 'figma', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.12 },
      { sectionId: 'figma-next', source: 'figma', role: 'content', xRatio: 0, yRatio: 0.34, widthRatio: 1, heightRatio: 0.2 },
      { sectionId: 'web-hero', source: 'web', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.12 },
      { sectionId: 'web-next', source: 'web', role: 'content', xRatio: 0, yRatio: 0.34, widthRatio: 1, heightRatio: 0.2 },
    ],
    descendants: [
      { source: 'figma', kind: 'text', x: 100, y: 700, width: 500, height: 80 },
      { source: 'figma', kind: 'cta', x: 120, y: 760, width: 220, height: 70 },
      { source: 'figma', kind: 'cta', x: 0, y: 0, width: 0, height: 0 },
      { source: 'web', kind: 'text', boundingBox: { x: 100, y: 700, width: 500, height: 80 } },
      { source: 'web', kind: 'cta', rect: { left: 120, top: 760, width: 220, height: 70 } },
      { source: 'web', kind: 'cta', bounds: { left: 0, top: 0, right: 0, bottom: 0 } },
      { source: 'web', kind: 'media', x: 80, y: 900, width: 900, height: 260 },
    ],
  }))
  const figmaHero = result.meta.visionCropSummary.find((item) => item.label === 'figma-hero')
  const webHero = result.meta.visionCropSummary.find((item) => item.label === 'web-hero')

  assert.equal(figmaHero.cropDiagnostics.validDescendantBoxCount, 2)
  assert.equal(figmaHero.cropDiagnostics.invalidDescendantBoxCount, 1)
  assert.equal(webHero.cropDiagnostics.validDescendantBoxCount, 3)
  assert.equal(webHero.cropDiagnostics.invalidDescendantBoxCount, 1)
  assert.equal(webHero.cropDiagnostics.nextSectionBoundary, 680)
  assert.equal(webHero.cropDiagnostics.finalCropHeight, 680)
  assert.equal(webHero.cropDiagnostics.cropAdjustmentReason, 'next-section-clamped')
})

test('visual vision service handles no hero, no CTA hero, image hero, video hero, and mismatched source heights safely', async () => {
  const { paths, workspace } = await createVisionWorkspace({ width: 1400, height: 2400 })
  const service = createVisualVisionService({ paths, cacheDir: path.join(workspace, '.cache', 'visual', 'ai-review'), heroMaxWidth: 1400 })
  const noHero = await service.attachVisionInput({ visualAssets: { figmaRenderId: 'render-1', webScreenshotFileName: 'aaaaaaaaaaaaaaaaaaaaaaaa.png' }, visualEvidence: { hero: {}, cta: {}, media: {} } })
  const noCta = await service.attachVisionInput(createGenericHeroPayload({
    sections: [
      { sectionId: 'figma-hero', source: 'figma', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.16 },
      { sectionId: 'web-hero', source: 'web', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.24 },
    ],
    descendants: [
      { source: 'figma', kind: 'text', xRatio: 0.08, yRatio: 0.12, widthRatio: 0.5, heightRatio: 0.04 },
      { source: 'figma', kind: 'media', xRatio: 0.45, yRatio: 0.14, widthRatio: 0.4, heightRatio: 0.16 },
      { source: 'web', kind: 'text', xRatio: 0.08, yRatio: 0.12, widthRatio: 0.5, heightRatio: 0.04 },
      { source: 'web', kind: 'media', type: 'video', xRatio: 0.45, yRatio: 0.14, widthRatio: 0.4, heightRatio: 0.16 },
    ],
  }))
  const figmaHero = noCta.meta.visionCropSummary.find((item) => item.label === 'figma-hero')
  const webHero = noCta.meta.visionCropSummary.find((item) => item.label === 'web-hero')

  assert.equal(noHero.meta.visionCropSummary.every((item) => item.cropFailureReason === 'hero-descriptor-missing'), true)
  assert.equal(figmaHero.cropDiagnostics.validDescendantBoxCount, 2)
  assert.equal(webHero.cropDiagnostics.validDescendantBoxCount, 2)
  assert.equal(figmaHero.cropDiagnostics.cropQualityPassed, true)
  assert.equal(webHero.cropDiagnostics.cropQualityPassed, true)
  assert.equal(Math.abs(figmaHero.cropDiagnostics.cropCoverageRatio - webHero.cropDiagnostics.cropCoverageRatio) < 0.2, true)
})

function createTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pagepilot-vision-'))
}

async function createVisionWorkspace({ width, height }) {
  const workspace = createTempWorkspace()
  const paths = {
    projectRoot: workspace,
    figmaRenderDir: path.join(workspace, '.cache', 'figma', 'renders'),
    visualScreenshotDir: path.join(workspace, '.cache', 'visual', 'screenshots'),
  }
  fs.mkdirSync(paths.figmaRenderDir, { recursive: true })
  fs.mkdirSync(paths.visualScreenshotDir, { recursive: true })
  await sharp({ create: { width, height, channels: 3, background: '#111111' } }).png().toFile(path.join(paths.figmaRenderDir, 'render-1.png'))
  await sharp({ create: { width, height, channels: 3, background: '#eeeeee' } }).png().toFile(path.join(paths.visualScreenshotDir, 'aaaaaaaaaaaaaaaaaaaaaaaa.png'))
  return { workspace, paths }
}

function createGenericHeroPayload({ sections, descendants }) {
  return {
    visualAssets: { figmaRenderId: 'render-1', webScreenshotFileName: 'aaaaaaaaaaaaaaaaaaaaaaaa.png' },
    visualEvidence: {
      hero: {
        figmaSectionId: 'figma-hero',
        webSectionId: 'web-hero',
        sections,
        descendants,
      },
      cta: {},
      media: {},
    },
  }
}
