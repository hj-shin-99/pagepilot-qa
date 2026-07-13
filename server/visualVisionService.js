import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { createProjectCachePaths, resolveFigmaRenderFile, resolveVisualScreenshotFile } from './imageAssetRoutes.js'

const DEFAULT_MAX_WIDTH = 1280
const DEFAULT_QUALITY = 82
const DEFAULT_MAX_OUTPUT_BYTES = 2_500_000

export function createVisualVisionService(options = {}) {
  const paths = options.paths || createProjectCachePaths(options.metaUrl)
  const cacheDir = options.cacheDir || path.resolve(paths.projectRoot, '.cache', 'visual', 'ai-review')
  const maxWidth = positiveNumber(options.maxWidth, DEFAULT_MAX_WIDTH)
  const quality = positiveNumber(options.quality, DEFAULT_QUALITY)
  const maxOutputBytes = positiveNumber(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES)

  return {
    async attachVisionInput(payload = {}) {
      const assets = payload.visualAssets || {}
      const figmaFile = resolveFigmaRenderFile(paths, assets.figmaRenderId)
      const webFile = resolveVisualScreenshotFile(paths, assets.webScreenshotFileName)
      if (!figmaFile) return { payload, meta: { visionPrepared: false, figmaImagePrepared: false, webImagePrepared: Boolean(webFile), visionFailureReason: 'missing-figma-render' } }
      if (!webFile) return { payload, meta: { visionPrepared: false, figmaImagePrepared: true, webImagePrepared: false, visionFailureReason: 'missing-web-screenshot' } }

      const [figmaImage, webImage] = await Promise.all([
        prepareVisionImage(figmaFile.absolutePath, { cacheDir, maxWidth, quality, maxOutputBytes, label: 'figma' }),
        prepareVisionImage(webFile.absolutePath, { cacheDir, maxWidth, quality, maxOutputBytes, label: 'web' }),
      ])

      return {
        payload: {
          ...payload,
          visionInput: {
            enabled: true,
            images: {
              figma: { dataUrl: figmaImage.dataUrl, mimeType: figmaImage.mimeType, width: figmaImage.width, height: figmaImage.height },
              web: { dataUrl: webImage.dataUrl, mimeType: webImage.mimeType, width: webImage.width, height: webImage.height },
            },
          },
        },
        meta: {
          visionPrepared: true,
          figmaImagePrepared: true,
          webImagePrepared: true,
          figmaImage: { width: figmaImage.width, height: figmaImage.height, cached: figmaImage.cached, sizeBytes: figmaImage.sizeBytes },
          webImage: { width: webImage.width, height: webImage.height, cached: webImage.cached, sizeBytes: webImage.sizeBytes },
        },
      }
    },
  }
}

export async function prepareVisionImage(inputPath, options = {}) {
  const cacheDir = options.cacheDir
  if (!cacheDir) throw new Error('cacheDir is required')
  const maxWidth = positiveNumber(options.maxWidth, DEFAULT_MAX_WIDTH)
  const quality = positiveNumber(options.quality, DEFAULT_QUALITY)
  const maxOutputBytes = positiveNumber(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES)
  const label = safeLabel(options.label)
  const stats = await fs.stat(inputPath)
  if (!stats.isFile() || stats.size <= 0) throw new Error('Vision image source is invalid')
  await fs.mkdir(cacheDir, { recursive: true })

  const cacheKey = createImageCacheKey({ inputPath, mtimeMs: stats.mtimeMs, size: stats.size, maxWidth, quality, label })
  const outputPath = path.resolve(cacheDir, `${label}-${cacheKey}.jpg`)
  let cached = true
  let outputStats = await statOrNull(outputPath)
  if (!outputStats) {
    cached = false
    await sharp(inputPath)
      .rotate()
      .resize({ width: maxWidth, withoutEnlargement: true })
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
    width: Number(metadata.width || 0),
    height: Number(metadata.height || 0),
    sizeBytes: outputStats.size,
    cached,
  }
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

function safeLabel(value) {
  return /^[a-z0-9_-]+$/i.test(String(value || '')) ? String(value) : 'image'
}
