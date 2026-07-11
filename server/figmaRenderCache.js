import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { maskFigmaFileKey } from './figmaCache.js'

const DEFAULT_TTL_MS = 60 * 60 * 1000
const SAFE_RENDER_ID_PATTERN = /^[0-9a-zA-Z._-]+$/

export function createFigmaRenderCache(options = {}) {
  const ttlMs = normalizeTtl(options.ttlMs)
  const cacheDir = options.cacheDir || getDefaultRenderCacheDir()
  const memoryCache = new Map()

  ensureDirectory(cacheDir)

  return {
    ttlMs,
    cacheDir,
    getFresh,
    getStale,
    set,
    clear,
    clearByNode,
    clearAll,
    createCacheKey,
    resolveRenderFile,
  }

  function getFresh({ fileKey, nodeId, format = 'png', scale = 2, now = Date.now() }) {
    const cacheKey = createCacheKey({ fileKey, nodeId, format, scale })
    const memoryEntry = readFreshMemoryEntry(cacheKey, now)
    if (memoryEntry) return memoryEntry

    const diskEntry = readDiskEntry(cacheDir, cacheKey)
    if (!diskEntry) return null
    if (diskEntry.expiresAt <= now) return null

    memoryCache.set(cacheKey, diskEntry)
    return createCacheResult(diskEntry, 'disk', false, now)
  }

  function getStale({ fileKey, nodeId, format = 'png', scale = 2, now = Date.now() }) {
    const cacheKey = createCacheKey({ fileKey, nodeId, format, scale })
    const memoryEntry = readAnyMemoryEntry(cacheKey)
    if (memoryEntry) return createCacheResult(memoryEntry, 'memory', true, now)

    const diskEntry = readDiskEntry(cacheDir, cacheKey)
    if (!diskEntry) return null

    memoryCache.set(cacheKey, diskEntry)
    return createCacheResult(diskEntry, 'disk', true, now)
  }

  function set({ fileKey, nodeId, format = 'png', scale = 2, buffer, mimeType, width = null, height = null, source = 'figma-api', now = Date.now() }) {
    const cacheKey = createCacheKey({ fileKey, nodeId, format, scale })
    const renderId = cacheKey
    const normalizedFormat = normalizeFormat(format)
    const imageFileName = `${renderId}.${getFileExtension(normalizedFormat)}`
    const record = {
      version: 1,
      renderId,
      cachedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      fileKeyMasked: maskFigmaFileKey(fileKey),
      nodeId,
      format: normalizedFormat,
      scale: normalizeScale(scale),
      mimeType,
      width: normalizeDimension(width),
      height: normalizeDimension(height),
      sizeBytes: buffer.length,
      source,
      imageFileName,
    }

    writeDiskEntry(cacheDir, record, buffer)
    memoryCache.set(cacheKey, record)
    return createCacheResult(record, 'figma-api', false, now)
  }

  function clear({ fileKey, nodeId, format = 'png', scale = 2 }) {
    const cacheKey = createCacheKey({ fileKey, nodeId, format, scale })
    memoryCache.delete(cacheKey)
    return deleteRecordFiles(cacheDir, readDiskEntry(cacheDir, cacheKey), cacheKey)
  }

  function clearByNode({ fileKey, nodeId }) {
    const prefix = `${sanitizeCacheKeySegment(fileKey)}__${sanitizeCacheKeySegment(nodeId)}__`
    const renderIds = new Set()

    for (const cacheKey of memoryCache.keys()) {
      if (cacheKey.startsWith(prefix)) renderIds.add(cacheKey)
    }

    if (fs.existsSync(cacheDir)) {
      fs.readdirSync(cacheDir).forEach((entry) => {
        if (!entry.endsWith('.json')) return
        const renderId = entry.slice(0, -5)
        if (renderId.startsWith(prefix)) renderIds.add(renderId)
      })
    }

    let clearedCount = 0
    renderIds.forEach((renderId) => {
      memoryCache.delete(renderId)
      const result = deleteRecordFiles(cacheDir, readDiskEntryByRenderId(cacheDir, renderId), renderId)
      if (result.cleared) clearedCount += 1
    })

    return { cleared: clearedCount > 0, clearedCount }
  }

  function clearAll() {
    memoryCache.clear()
    if (!fs.existsSync(cacheDir)) return { clearedCount: 0 }

    let clearedCount = 0
    fs.readdirSync(cacheDir).forEach((entry) => {
      const filePath = path.join(cacheDir, entry)
      if (!fs.statSync(filePath).isFile()) return
      fs.unlinkSync(filePath)
      clearedCount += 1
    })

    return { clearedCount }
  }

  function resolveRenderFile({ renderId }) {
    if (!isSafeRenderId(renderId)) return null

    const record = readDiskEntryByRenderId(cacheDir, renderId)
    if (!record) return null

    const imagePath = getImageFilePath(cacheDir, record.imageFileName)
    if (!imagePath || !fs.existsSync(imagePath)) return null

    return {
      imagePath,
      imageFileName: record.imageFileName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      renderId: record.renderId,
      format: record.format,
    }
  }

  function readFreshMemoryEntry(cacheKey, now) {
    const entry = readAnyMemoryEntry(cacheKey)
    if (!entry) return null
    return entry.expiresAt > now ? createCacheResult(entry, 'memory', false, now) : null
  }

  function readAnyMemoryEntry(cacheKey) {
    const entry = memoryCache.get(cacheKey)
    if (!entry) return null
    if (!isValidCacheRecord(entry, cacheDir)) {
      memoryCache.delete(cacheKey)
      return null
    }
    return normalizeRecord(entry)
  }
}

export function createCacheKey({ fileKey, nodeId, format = 'png', scale = 2 }) {
  const normalizedScale = normalizeScale(scale)
  const scaleLabel = `${String(normalizedScale).replace(/\.0+$/, '').replace(/\.$/, '')}x`
  return [
    sanitizeCacheKeySegment(fileKey),
    sanitizeCacheKeySegment(nodeId),
    sanitizeCacheKeySegment(normalizeFormat(format)),
    sanitizeCacheKeySegment(scaleLabel),
  ].join('__')
}

export function isSafeRenderId(value) {
  return SAFE_RENDER_ID_PATTERN.test(String(value || ''))
}

function getDefaultRenderCacheDir() {
  const currentFile = fileURLToPath(import.meta.url)
  return path.resolve(path.dirname(currentFile), '..', '.cache', 'figma', 'renders')
}

function getMetadataFilePath(cacheDir, renderId) {
  return path.join(cacheDir, `${renderId}.json`)
}

function getImageFilePath(cacheDir, imageFileName) {
  if (!imageFileName || path.basename(imageFileName) !== imageFileName) return null
  const resolvedPath = path.join(cacheDir, imageFileName)
  return path.dirname(resolvedPath) === cacheDir ? resolvedPath : null
}

function readDiskEntry(cacheDir, cacheKey) {
  return readDiskEntryByRenderId(cacheDir, cacheKey)
}

function readDiskEntryByRenderId(cacheDir, renderId) {
  const metadataPath = getMetadataFilePath(cacheDir, renderId)

  try {
    if (!fs.existsSync(metadataPath)) return null
    const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    if (!isValidCacheRecord(parsed, cacheDir)) {
      cleanupInvalidRecord(cacheDir, parsed, metadataPath, renderId)
      return null
    }
    return normalizeRecord(parsed)
  } catch {
    cleanupInvalidRecord(cacheDir, null, metadataPath, renderId)
    return null
  }
}

function writeDiskEntry(cacheDir, record, buffer) {
  ensureDirectory(cacheDir)
  const imagePath = getImageFilePath(cacheDir, record.imageFileName)
  if (!imagePath) {
    throw new Error('Invalid render image file path')
  }

  const metadataPath = getMetadataFilePath(cacheDir, record.renderId)
  fs.writeFileSync(imagePath, buffer)

  const savedStats = fs.statSync(imagePath)
  if (!savedStats.isFile() || savedStats.size <= 0) {
    throw new Error('Render image was not saved correctly')
  }

  fs.writeFileSync(metadataPath, JSON.stringify(record), 'utf8')
}

function cleanupInvalidRecord(cacheDir, record, metadataPath, renderId) {
  try {
    if (fs.existsSync(metadataPath)) fs.unlinkSync(metadataPath)
  } catch {
    // Ignore cleanup failure and treat as cache miss.
  }

  const imageFileName = record?.imageFileName
  const imagePath = getImageFilePath(cacheDir, imageFileName)
  try {
    if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath)
  } catch {
    // Ignore cleanup failure and treat as cache miss.
  }

  if (!imagePath && renderId && isSafeRenderId(renderId)) {
    tryDeleteKnownImageVariants(cacheDir, renderId)
  }
}

function tryDeleteKnownImageVariants(cacheDir, renderId) {
  for (const extension of ['png', 'jpg', 'jpeg']) {
    const imagePath = path.join(cacheDir, `${renderId}.${extension}`)
    try {
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath)
    } catch {
      // Ignore cleanup failure and treat as cache miss.
    }
  }
}

function deleteRecordFiles(cacheDir, record, renderId) {
  const metadataPath = getMetadataFilePath(cacheDir, renderId)
  let cleared = false

  try {
    if (fs.existsSync(metadataPath)) {
      fs.unlinkSync(metadataPath)
      cleared = true
    }
  } catch {
    // Ignore file removal failure and report best-effort result below.
  }

  const imagePath = getImageFilePath(cacheDir, record?.imageFileName)
  try {
    if (imagePath && fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath)
      cleared = true
    }
  } catch {
    // Ignore file removal failure and report best-effort result below.
  }

  return { cleared, renderId }
}

function isValidCacheRecord(record, cacheDir) {
  if (!record || typeof record !== 'object') return false
  if (!record.renderId || !isSafeRenderId(record.renderId)) return false
  if (!record.cachedAt || !record.expiresAt) return false
  if (!record.nodeId || !record.fileKeyMasked) return false
  if (!record.format || !record.mimeType || !record.imageFileName) return false
  if (!Number.isFinite(Number(record.scale)) || Number(record.scale) <= 0) return false
  if (!Number.isFinite(Number(record.sizeBytes)) || Number(record.sizeBytes) <= 0) return false
  if (!Number.isFinite(normalizeTimestamp(record.cachedAt)) || !Number.isFinite(normalizeTimestamp(record.expiresAt))) return false

  const imagePath = getImageFilePath(cacheDir, record.imageFileName)
  if (!imagePath || !fs.existsSync(imagePath)) return false

  const stats = fs.statSync(imagePath)
  return stats.isFile() && stats.size > 0
}

function normalizeRecord(record) {
  return {
    ...record,
    cachedAt: normalizeTimestamp(record.cachedAt),
    expiresAt: normalizeTimestamp(record.expiresAt),
    scale: normalizeScale(record.scale),
    width: normalizeDimension(record.width),
    height: normalizeDimension(record.height),
    sizeBytes: Math.round(Number(record.sizeBytes)),
    format: normalizeFormat(record.format),
  }
}

function createCacheResult(record, source, stale, now) {
  return {
    data: createRenderMetadata(record),
    cache: {
      hit: source !== 'figma-api',
      stale,
      source,
      cachedAt: new Date(record.cachedAt).toISOString(),
      ageMs: Math.max(0, now - record.cachedAt),
    },
    cachedAt: record.cachedAt,
    expiresAt: record.expiresAt,
  }
}

function createRenderMetadata(record) {
  return {
    renderId: record.renderId,
    fileKeyMasked: record.fileKeyMasked,
    nodeId: record.nodeId,
    format: record.format,
    scale: record.scale,
    mimeType: record.mimeType,
    width: record.width,
    height: record.height,
    sizeBytes: record.sizeBytes,
    source: record.source,
    localImagePath: createPublicLocalImagePath(record.imageFileName),
  }
}

function createPublicLocalImagePath(imageFileName) {
  return path.posix.join('.cache', 'figma', 'renders', imageFileName)
}

function getFileExtension(format) {
  return normalizeFormat(format) === 'jpg' ? 'jpg' : 'png'
}

function normalizeFormat(value) {
  const normalized = String(value || 'png').trim().toLowerCase()
  if (normalized === 'jpeg') return 'jpg'
  return normalized === 'jpg' ? 'jpg' : 'png'
}

function normalizeScale(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 2
  return Math.round(numeric * 100) / 100
}

function normalizeDimension(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null
}

function normalizeTimestamp(value) {
  if (typeof value === 'number') return value
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : Number.NaN
}

function normalizeTtl(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_TTL_MS
}

function sanitizeCacheKeySegment(value) {
  return String(value || '').replace(/[^0-9a-zA-Z._-]/g, '_')
}

function ensureDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true })
  }
}
