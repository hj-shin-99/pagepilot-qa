import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { createProjectCachePaths, resolveFigmaRenderFile, resolveVisualScreenshotFile } from './imageAssetRoutes.js'

const DEFAULT_MAX_WIDTH = 1280
const DEFAULT_QUALITY = 82
const DEFAULT_MAX_OUTPUT_BYTES = 2_500_000
const OVERVIEW_MAX_WIDTH = 1440
const OVERVIEW_MAX_HEIGHT = 4200
const OVERVIEW_MAX_PIXELS = 5_000_000
const OVERVIEW_QUALITY = 80
const HERO_MAX_WIDTH = 1600
const HERO_QUALITY = 88
const HERO_MIN_CROP_HEIGHT = 720
const HERO_MAX_CROP_HEIGHT_RATIO = 0.36

export function createVisualVisionService(options = {}) {
  const paths = options.paths || createProjectCachePaths(options.metaUrl)
  const cacheDir = options.cacheDir || path.resolve(paths.projectRoot, '.cache', 'visual', 'ai-review')
  const maxOutputBytes = positiveNumber(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES)

  return {
    async attachVisionInput(payload = {}) {
      const assets = payload.visualAssets || {}
      const figmaFile = resolveFigmaRenderFile(paths, assets.figmaRenderId)
      const webFile = resolveVisualScreenshotFile(paths, assets.webScreenshotFileName)
      if (!figmaFile) return { payload, meta: { visionPrepared: false, figmaImagePrepared: false, webImagePrepared: Boolean(webFile), visionFailureReason: 'missing-figma-render' } }
      if (!webFile) return { payload, meta: { visionPrepared: false, figmaImagePrepared: true, webImagePrepared: false, visionFailureReason: 'missing-web-screenshot' } }

      const [figmaOverview, webOverview, figmaHero, webHero] = await Promise.all([
        prepareVisionImage(figmaFile.absolutePath, { cacheDir, maxWidth: options.overviewMaxWidth || OVERVIEW_MAX_WIDTH, maxHeight: options.overviewMaxHeight || OVERVIEW_MAX_HEIGHT, maxPixels: options.overviewMaxPixels || OVERVIEW_MAX_PIXELS, quality: options.overviewQuality || OVERVIEW_QUALITY, maxOutputBytes, label: 'figma-overview', variant: 'overview', detail: 'low' }),
        prepareVisionImage(webFile.absolutePath, { cacheDir, maxWidth: options.overviewMaxWidth || OVERVIEW_MAX_WIDTH, maxHeight: options.overviewMaxHeight || OVERVIEW_MAX_HEIGHT, maxPixels: options.overviewMaxPixels || OVERVIEW_MAX_PIXELS, quality: options.overviewQuality || OVERVIEW_QUALITY, maxOutputBytes, label: 'web-overview', variant: 'overview', detail: 'low' }),
        prepareVisionImage(figmaFile.absolutePath, { cacheDir, maxWidth: options.heroMaxWidth || HERO_MAX_WIDTH, quality: options.heroQuality || HERO_QUALITY, maxOutputBytes, label: 'figma-hero', variant: 'hero', detail: 'high', crop: createHeroCropRegion(payload, 'figma') }),
        prepareVisionImage(webFile.absolutePath, { cacheDir, maxWidth: options.heroMaxWidth || HERO_MAX_WIDTH, quality: options.heroQuality || HERO_QUALITY, maxOutputBytes, label: 'web-hero', variant: 'hero', detail: 'high', crop: createHeroCropRegion(payload, 'web') }),
      ])
      const images = [figmaOverview, webOverview, figmaHero, webHero].map((image) => ({
        label: image.label,
        dataUrl: image.dataUrl,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        detail: image.detail,
      }))
      const visionInputSummary = images.map(({ label, width, height, detail }) => ({ label, width, height, detail }))

      return {
        payload: {
          ...payload,
          visionInput: {
            enabled: true,
            images,
          },
        },
        meta: {
          visionPrepared: true,
          figmaImagePrepared: true,
          webImagePrepared: true,
          visionInputSummary,
          visionCropSummary: [figmaHero, webHero].map((image) => ({ label: image.label, cropUsed: Boolean(image.cropUsed), cropReason: image.cropReason, cropFailureReason: image.cropFailureReason || '' })),
          figmaImage: { width: figmaOverview.width, height: figmaOverview.height, originalWidth: figmaOverview.originalWidth, originalHeight: figmaOverview.originalHeight, cached: figmaOverview.cached, sizeBytes: figmaOverview.sizeBytes },
          webImage: { width: webOverview.width, height: webOverview.height, originalWidth: webOverview.originalWidth, originalHeight: webOverview.originalHeight, cached: webOverview.cached, sizeBytes: webOverview.sizeBytes },
        },
      }
    },
  }
}

export async function prepareVisionImage(inputPath, options = {}) {
  const cacheDir = options.cacheDir
  if (!cacheDir) throw new Error('cacheDir is required')
  const maxWidth = positiveNumber(options.maxWidth, DEFAULT_MAX_WIDTH)
  const maxHeight = positiveNumber(options.maxHeight, 0)
  const maxPixels = positiveNumber(options.maxPixels, 0)
  const quality = positiveNumber(options.quality, DEFAULT_QUALITY)
  const maxOutputBytes = positiveNumber(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES)
  const label = safeLabel(options.label)
  const variant = safeLabel(options.variant || 'default')
  const detail = normalizeDetail(options.detail)
  const stats = await fs.stat(inputPath)
  if (!stats.isFile() || stats.size <= 0) throw new Error('Vision image source is invalid')
  await fs.mkdir(cacheDir, { recursive: true })
  const sourceHash = await createFileHash(inputPath)
  const sourceMetadata = await sharp(inputPath).metadata()
  const originalWidth = Number(sourceMetadata.width || 0)
  const originalHeight = Number(sourceMetadata.height || 0)
  if (originalWidth <= 0 || originalHeight <= 0) throw new Error('Vision image source metadata is invalid')
  const cropResult = resolveCrop(options.crop, { width: originalWidth, height: originalHeight })
  const resizeWidth = getResizeWidth({ width: cropResult.width, height: cropResult.height, maxWidth, maxHeight, maxPixels })

  const cacheKey = createImageCacheKey({ sourceHash, maxWidth, maxHeight, maxPixels, quality, label, variant, crop: cropResult.cacheValue })
  const outputPath = path.resolve(cacheDir, `${label}-${cacheKey}.jpg`)
  let cached = true
  let outputStats = await statOrNull(outputPath)
  if (!outputStats) {
    cached = false
    let pipeline = sharp(inputPath).rotate()
    if (cropResult.crop) pipeline = pipeline.extract(cropResult.crop)
    await pipeline
      .resize({ width: resizeWidth, withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toFile(outputPath)
    outputStats = await fs.stat(outputPath)
  }
  if (outputStats.size > maxOutputBytes) throw new Error('Prepared vision image exceeds max output size')

  const metadata = await sharp(outputPath).metadata()
  const buffer = await fs.readFile(outputPath)
  return {
    dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
    mimeType: 'image/jpeg',
    label,
    detail,
    width: Number(metadata.width || 0),
    height: Number(metadata.height || 0),
    originalWidth,
    originalHeight,
    sizeBytes: outputStats.size,
    cached,
    cropUsed: Boolean(cropResult.crop),
    cropReason: cropResult.reason,
    cropFailureReason: cropResult.failureReason,
  }
}

function createHeroCropRegion(payload, source) {
  const descriptor = findHeroDescriptor(payload, source)
  if (descriptor) {
    return { source, descriptor, fallback: false }
  }
  return { source, descriptor: null, fallback: true, reason: 'hero-descriptor-missing' }
}

function findHeroDescriptor(payload = {}, source) {
  const sections = Array.isArray(payload.visualEvidence?.hero?.sections) ? payload.visualEvidence.hero.sections : []
  const heroSectionId = source === 'figma' ? payload.visualEvidence?.hero?.figmaSectionId : payload.visualEvidence?.hero?.webSectionId
  return sections.find((item) => item?.source === source && item?.sectionId && item.sectionId === heroSectionId)
    || sections.find((item) => item?.source === source && item?.role === 'hero' && hasUsableRatioBox(item))
    || null
}

function resolveCrop(cropInput, metadata) {
  if (!cropInput) {
    return { crop: null, width: metadata.width, height: metadata.height, cacheValue: null, reason: 'none', failureReason: '' }
  }
  const descriptor = cropInput.descriptor
  const descriptorCrop = descriptor && createCropFromDescriptor(descriptor, metadata)
  if (descriptorCrop) return descriptorCrop
  const fallbackCrop = createTopViewportCrop(metadata)
  return {
    ...fallbackCrop,
    reason: cropInput.fallback ? 'top-viewport-fallback' : 'descriptor-invalid-top-viewport-fallback',
    failureReason: cropInput.reason || (descriptor ? 'hero-descriptor-invalid' : 'hero-descriptor-missing'),
  }
}

function createCropFromDescriptor(descriptor, metadata) {
  if (!hasUsableRatioBox(descriptor)) return null
  const width = metadata.width
  const height = metadata.height
  const rawX = Math.floor(clamp(Number(descriptor.xRatio), 0, 1) * width)
  const rawY = Math.floor(clamp(Number(descriptor.yRatio), 0, 1) * height)
  const rawWidth = Math.ceil(clamp(Number(descriptor.widthRatio), 0.05, 1) * width)
  const rawHeight = Math.ceil(clamp(Number(descriptor.heightRatio), 0.04, HERO_MAX_CROP_HEIGHT_RATIO) * height)
  const padX = Math.round(Math.min(width * 0.04, 160))
  const padY = Math.round(clamp(rawHeight * 0.14, 96, 320))
  const minHeight = Math.min(height, Math.max(HERO_MIN_CROP_HEIGHT, Math.round(width * 0.42)))
  const crop = clampCrop({
    left: rawX - padX,
    top: rawY - padY,
    width: rawWidth + padX * 2,
    height: Math.max(rawHeight + padY * 2, minHeight),
  }, metadata)
  if (!isValidCrop(crop)) return null
  return { crop, width: crop.width, height: crop.height, cacheValue: crop, reason: 'hero-section-descriptor', failureReason: '' }
}

function createTopViewportCrop(metadata) {
  const height = Math.min(metadata.height, Math.max(HERO_MIN_CROP_HEIGHT, Math.round(metadata.width * 0.65)))
  const crop = clampCrop({ left: 0, top: 0, width: metadata.width, height }, metadata)
  return { crop, width: crop.width, height: crop.height, cacheValue: crop, reason: 'top-viewport-fallback', failureReason: '' }
}

function clampCrop(crop, metadata) {
  const left = Math.max(0, Math.min(metadata.width - 1, Math.round(crop.left)))
  const top = Math.max(0, Math.min(metadata.height - 1, Math.round(crop.top)))
  const width = Math.max(1, Math.min(metadata.width - left, Math.round(crop.width)))
  const height = Math.max(1, Math.min(metadata.height - top, Math.round(crop.height)))
  return { left, top, width, height }
}

function isValidCrop(crop) {
  return Number(crop?.width) >= 32 && Number(crop?.height) >= 32
}

function hasUsableRatioBox(value) {
  return Number.isFinite(Number(value?.xRatio))
    && Number.isFinite(Number(value?.yRatio))
    && Number.isFinite(Number(value?.widthRatio))
    && Number.isFinite(Number(value?.heightRatio))
    && Number(value.widthRatio) > 0
    && Number(value.heightRatio) > 0
}

function getResizeWidth({ width, height, maxWidth, maxHeight, maxPixels }) {
  const safeWidth = positiveNumber(width, maxWidth)
  const safeHeight = positiveNumber(height, safeWidth)
  const aspect = safeHeight / safeWidth
  const heightLimitedWidth = maxHeight > 0 ? maxHeight / aspect : maxWidth
  const pixelLimitedWidth = maxPixels > 0 ? Math.sqrt(maxPixels / aspect) : maxWidth
  return Math.max(1, Math.floor(Math.min(maxWidth, heightLimitedWidth, pixelLimitedWidth)))
}

async function createFileHash(filePath) {
  const buffer = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function createImageCacheKey(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
}

async function statOrNull(filePath) {
  try {
    const stats = await fs.stat(filePath)
    return stats.isFile() ? stats : null
  } catch {
    return null
  }
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function clamp(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.max(min, Math.min(max, number))
}

function normalizeDetail(value) {
  return ['low', 'high', 'auto'].includes(value) ? value : 'auto'
}

function safeLabel(value) {
  return /^[a-z0-9_-]+$/i.test(String(value || '')) ? String(value) : 'image'
}
