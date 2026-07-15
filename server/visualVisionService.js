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
      const visionCropSummary = [figmaHero, webHero].map((image) => ({ label: image.label, width: image.width, height: image.height, cropUsed: Boolean(image.cropUsed), cropReason: image.cropReason, cropFailureReason: image.cropFailureReason || '', cropDiagnostics: image.cropDiagnostics || null }))
      const heroCropPairQuality = createHeroCropPairQuality(visionCropSummary)
      const visionImages = heroCropPairQuality.compatible ? [figmaOverview, webOverview, figmaHero, webHero] : [figmaOverview, webOverview]
      const images = visionImages.map((image) => ({
        label: image.label,
        dataUrl: image.dataUrl,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        detail: image.detail,
      }))
      const visionInputSummary = images.map(({ label, width, height, detail }) => ({ label, width, height, detail }))

      const preparedPayload = {
        ...payload,
        visionInput: {
          enabled: true,
          images,
        },
      }
      Object.defineProperty(preparedPayload, '__visionCropSummary', { value: visionCropSummary, enumerable: false })
      Object.defineProperty(preparedPayload, '__heroCropPairQuality', { value: heroCropPairQuality, enumerable: false })

      return {
        payload: preparedPayload,
        meta: {
          visionPrepared: true,
          figmaImagePrepared: true,
          webImagePrepared: true,
          visionInputSummary,
          visionCropSummary,
          heroCropPairQuality,
          figmaImage: { width: figmaOverview.width, height: figmaOverview.height, originalWidth: figmaOverview.originalWidth, originalHeight: figmaOverview.originalHeight, cached: figmaOverview.cached, sizeBytes: figmaOverview.sizeBytes },
          webImage: { width: webOverview.width, height: webOverview.height, originalWidth: webOverview.originalWidth, originalHeight: webOverview.originalHeight, cached: webOverview.cached, sizeBytes: webOverview.sizeBytes },
        },
      }
    },
  }
}

function createHeroCropPairQuality(visionCropSummary = []) {
  const figma = findCropSummary(visionCropSummary, 'figma-hero')
  const web = findCropSummary(visionCropSummary, 'web-hero')
  const figmaCoverageRatio = cropCoverageRatio(figma)
  const webCoverageRatio = cropCoverageRatio(web)
  const coverageRatioDelta = Number(Math.abs(figmaCoverageRatio - webCoverageRatio).toFixed(4))
  const figmaValidCount = Number(figma?.cropDiagnostics?.validDescendantBoxCount || 0)
  const webValidCount = Number(web?.cropDiagnostics?.validDescendantBoxCount || 0)
  const figmaPassed = figma?.cropDiagnostics?.cropQualityPassed === true
  const webPassed = web?.cropDiagnostics?.cropQualityPassed === true
  const coverageValues = [figmaCoverageRatio, webCoverageRatio].filter((value) => Number.isFinite(value) && value > 0)
  const maxCoverage = coverageValues.length ? Math.max(...coverageValues) : 0
  const minCoverage = coverageValues.length ? Math.min(...coverageValues) : 0

  let reason = ''
  if (!figma || !web) reason = 'hero-crop-missing'
  else if (!figmaPassed || !webPassed) reason = 'hero-crop-quality-failed'
  else if ((figmaValidCount === 0 && webValidCount > 0) || (webValidCount === 0 && figmaValidCount > 0)) reason = 'hero-descendant-count-mismatch'
  else if (minCoverage > 0 && maxCoverage / minCoverage >= 2.5) reason = 'hero-coverage-ratio-mismatch'
  else if (minCoverage > 0 && minCoverage < maxCoverage * 0.35) reason = 'hero-thin-partial-crop'

  return {
    compatible: reason === '',
    figmaCoverageRatio,
    webCoverageRatio,
    coverageRatioDelta,
    reason,
  }
}

function findCropSummary(items, label) {
  return (Array.isArray(items) ? items : []).find((item) => String(item?.label || '').toLowerCase() === label) || null
}

function cropCoverageRatio(item) {
  const ratio = Number(item?.cropDiagnostics?.cropCoverageRatio)
  return Number.isFinite(ratio) && ratio >= 0 ? ratio : 0
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
    cropDiagnostics: cropResult.diagnostics || null,
  }
}

function createHeroCropRegion(payload, source) {
  const descriptor = findHeroDescriptor(payload, source)
  if (descriptor) {
    return {
      source,
      descriptor,
      descendants: findHeroDescendantBoxes(payload, source),
      sections: findHeroSourceSections(payload, source),
      fallback: false,
    }
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

function findHeroSourceSections(payload = {}, source) {
  const sections = Array.isArray(payload.visualEvidence?.hero?.sections) ? payload.visualEvidence.hero.sections : []
  return sections.filter((item) => item?.source === source && hasUsableRatioBox(item))
}

function findHeroDescendantBoxes(payload = {}, source) {
  const heroDescendants = Array.isArray(payload.visualEvidence?.hero?.descendants) ? payload.visualEvidence.hero.descendants : []
  const cta = payload.visualEvidence?.cta || {}
  const media = payload.visualEvidence?.media || {}
  return [
    ...heroDescendants,
    ...(Array.isArray(cta.figmaActions) ? cta.figmaActions : []),
    ...(Array.isArray(cta.webActions) ? cta.webActions : []),
    ...(Array.isArray(media.figmaPrimaryCandidates) ? media.figmaPrimaryCandidates : []),
    ...(Array.isArray(media.webPrimaryCandidates) ? media.webPrimaryCandidates : []),
  ].filter((item) => item?.source === source)
}

function resolveCrop(cropInput, metadata) {
  if (!cropInput) {
    return { crop: null, width: metadata.width, height: metadata.height, cacheValue: null, reason: 'none', failureReason: '' }
  }
  const descriptor = cropInput.descriptor
  const descriptorCrop = descriptor && createCropFromDescriptor(descriptor, metadata, cropInput)
  if (descriptorCrop) return descriptorCrop
  const fallbackCrop = createTopViewportCrop(metadata)
  return {
    ...fallbackCrop,
    reason: cropInput.fallback ? 'top-viewport-fallback' : 'descriptor-invalid-top-viewport-fallback',
    failureReason: cropInput.reason || (descriptor ? 'hero-descriptor-invalid' : 'hero-descriptor-missing'),
  }
}

function createCropFromDescriptor(descriptor, metadata, cropInput = {}) {
  if (!hasUsableRatioBox(descriptor)) return null
  const width = metadata.width
  const height = metadata.height
  const descriptorBox = normalizeRatioBox(descriptor, 'descriptor')
  const descendantResult = createDescendantUnion(cropInput.descendants, descriptorBox, metadata)
  const descendantUnion = descendantResult.union
  const nextBoundary = getNextSectionBoundary(cropInput.sections, descriptorBox)
  const descriptorBottom = descriptorBox.yRatio + descriptorBox.heightRatio
  const unionBottom = descendantUnion ? Math.max(descriptorBottom, descendantUnion.bottomRatio) : descriptorBottom
  const unclampedBottom = Math.min(Math.max(unionBottom, descriptorBottom), descriptorBox.yRatio + HERO_MAX_CROP_HEIGHT_RATIO)
  const finalBottom = nextBoundary !== null ? Math.min(unclampedBottom, nextBoundary) : unclampedBottom
  const finalHeightRatio = Math.max(0.04, finalBottom - descriptorBox.yRatio)
  const rawX = Math.floor(descriptorBox.xRatio * width)
  const rawY = Math.floor(descriptorBox.yRatio * height)
  const rawWidth = Math.ceil(descriptorBox.widthRatio * width)
  const rawHeight = Math.ceil(finalHeightRatio * height)
  const padX = Math.round(Math.min(width * 0.04, 160))
  const crop = clampCrop({
    left: rawX - padX,
    top: rawY,
    width: rawWidth + padX * 2,
    height: rawHeight,
  }, metadata)
  if (!isValidCrop(crop)) return null
  const descriptorHeight = Math.ceil(descriptorBox.heightRatio * height)
  const descendantUnionHeight = descendantUnion ? Math.ceil(descendantUnion.height) : 0
  const cropAdjusted = crop.height !== descriptorHeight
  const cropCoverageRatio = height > 0 ? Number((crop.height / height).toFixed(4)) : 0
  const cropQualityPassed = descendantResult.validCount > 0 && descendantUnionHeight > 0 && crop.height >= Math.min(HERO_MIN_CROP_HEIGHT, height)
  return {
    crop,
    width: crop.width,
    height: crop.height,
    cacheValue: crop,
    reason: 'hero-section-descriptor',
    failureReason: '',
    diagnostics: {
      descriptorHeight,
      validDescendantBoxCount: descendantResult.validCount,
      invalidDescendantBoxCount: descendantResult.invalidCount,
      descendantUnionHeight,
      nextSectionBoundary: nextBoundary !== null ? Math.round(nextBoundary * height) : null,
      finalCropHeight: crop.height,
      cropCoverageRatio,
      cropQualityPassed,
      cropAdjusted,
      cropAdjustmentReason: cropAdjusted ? (nextBoundary !== null && finalBottom === nextBoundary ? 'next-section-clamped' : 'descendant-union-adjusted') : '',
      descendantUnionFailureReason: descendantResult.validCount === 0 ? 'no-valid-semantic-descendant-box' : '',
    },
  }
}

function normalizeRatioBox(value = {}, kind = '') {
  const defaultHeight = kind === 'cta' ? 0.045 : kind === 'media' ? 0.18 : 0.04
  const xRatio = clamp(Number(value.xRatio), 0, 1)
  const yRatio = clamp(Number(value.yRatio), 0, 1)
  const widthRatio = clamp(Number(value.widthRatio), 0.02, 1 - xRatio || 1)
  const heightRatio = clamp(Number(value.heightRatio), defaultHeight, 1 - yRatio || defaultHeight)
  return { xRatio, yRatio, widthRatio, heightRatio }
}

function createDescendantUnion(descendants = [], descriptorBox, metadata) {
  let invalidCount = 0
  const boxes = (Array.isArray(descendants) ? descendants : [])
    .map((item) => normalizeDescendantBox(item, descriptorBox, metadata))
    .filter((box) => {
      if (!box) {
        invalidCount += 1
        return false
      }
      return true
    })
  if (boxes.length === 0) return { union: null, validCount: 0, invalidCount }
  const top = Math.min(...boxes.map((box) => box.top))
  const bottom = Math.max(...boxes.map((box) => box.bottom))
  return {
    union: {
      top,
      bottom,
      yRatio: top / metadata.height,
      bottomRatio: bottom / metadata.height,
      height: Math.max(0, bottom - top),
    },
    validCount: boxes.length,
    invalidCount,
  }
}

function normalizeDescendantBox(item = {}, descriptorBox, metadata) {
  const spatial = item?.spatialEvidence && typeof item.spatialEvidence === 'object' ? item.spatialEvidence : null
  const ratioSource = hasUsableRatioBox(item) ? item : hasUsableRatioBox(spatial) ? spatial : null
  const ratioBox = ratioSource ? normalizeRatioBox(ratioSource, item.kind || item.type || '') : null
  const pxBox = ratioBox
    ? {
        left: ratioBox.xRatio * metadata.width,
        top: ratioBox.yRatio * metadata.height,
        width: ratioBox.widthRatio * metadata.width,
        height: ratioBox.heightRatio * metadata.height,
      }
    : getPixelBox(item, metadata)
  if (!pxBox) return null
  const crop = clampCrop(pxBox, metadata)
  if (!isValidSemanticBox(crop)) return null
  const bottomRatio = (crop.top + crop.height) / metadata.height
  if (bottomRatio < descriptorBox.yRatio - 0.02) return null
  return { top: crop.top, bottom: crop.top + crop.height }
}

function getPixelBox(item = {}, metadata) {
  const spatial = item?.spatialEvidence && typeof item.spatialEvidence === 'object' ? item.spatialEvidence : null
  const box = spatial || item.boundingBox || item.absoluteBoundingBox || item.bbox || item.rect || item.bounds || item.box || item
  const left = nullableNumber(box.x ?? box.left)
  const top = nullableNumber(box.y ?? box.top)
  const width = nullableNumber(box.width ?? (Number.isFinite(Number(box.right)) && left !== null ? Number(box.right) - left : null))
  const height = nullableNumber(box.height ?? (Number.isFinite(Number(box.bottom)) && top !== null ? Number(box.bottom) - top : null))
  if (left === null || top === null || width === null || height === null || width <= 0 || height <= 0) return null
  const sourceWidth = positiveNullableNumber(box.sourceWidth)
  const sourceHeight = positiveNullableNumber(box.sourceHeight)
  if (metadata && sourceWidth && sourceHeight && sourceWidth > 0 && sourceHeight > 0) {
    return {
      left: left * (metadata.width / sourceWidth),
      top: top * (metadata.height / sourceHeight),
      width: width * (metadata.width / sourceWidth),
      height: height * (metadata.height / sourceHeight),
    }
  }
  return { left, top, width, height }
}

function getNextSectionBoundary(sections = [], descriptorBox) {
  const boundaries = (Array.isArray(sections) ? sections : [])
    .map((section) => Number(section.yRatio))
    .filter((yRatio) => Number.isFinite(yRatio) && yRatio > descriptorBox.yRatio + 0.02)
    .sort((first, second) => first - second)
  return boundaries[0] ?? null
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

function isValidSemanticBox(crop) {
  return Number(crop?.width) > 0 && Number(crop?.height) > 0
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

function nullableNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function positiveNullableNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
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
