import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_TTL_MS = 60 * 60 * 1000

export function createFigmaCache(options = {}) {
  const ttlMs = normalizeTtl(options.ttlMs)
  const cacheDir = options.cacheDir || getDefaultCacheDir()
  const memoryCache = new Map()

  ensureDirectory(cacheDir)

  return {
    ttlMs,
    cacheDir,
    getFresh,
    getStale,
    set,
    clear,
    clearAll,
    createCacheKey,
  }

  function getFresh({ fileKey, nodeId, now = Date.now() }) {
    const cacheKey = createCacheKey({ fileKey, nodeId })
    const memoryEntry = readFreshMemoryEntry(cacheKey, now)
    if (memoryEntry) return memoryEntry

    const diskEntry = readDiskEntry(cacheDir, cacheKey)
    if (!diskEntry) return null
    if (diskEntry.expiresAt <= now) return null

    memoryCache.set(cacheKey, diskEntry)
    return createCacheResult(diskEntry, 'disk', false, now)
  }

  function getStale({ fileKey, nodeId, now = Date.now() }) {
    const cacheKey = createCacheKey({ fileKey, nodeId })
    const memoryEntry = readAnyMemoryEntry(cacheKey)
    if (memoryEntry) {
      return createCacheResult(memoryEntry, 'memory', true, now)
    }

    const diskEntry = readDiskEntry(cacheDir, cacheKey)
    if (!diskEntry) return null
    memoryCache.set(cacheKey, diskEntry)
    return createCacheResult(diskEntry, 'disk', true, now)
  }

  function set({ fileKey, nodeId, data, now = Date.now() }) {
    const cacheKey = createCacheKey({ fileKey, nodeId })
    const record = {
      version: 1,
      cachedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      fileKeyMasked: maskFigmaFileKey(fileKey),
      nodeId,
      data,
    }

    memoryCache.set(cacheKey, record)
    writeDiskEntry(cacheDir, cacheKey, record)
    return createCacheResult(record, 'figma-api', false, now)
  }

  function clear({ fileKey, nodeId }) {
    const cacheKey = createCacheKey({ fileKey, nodeId })
    memoryCache.delete(cacheKey)

    const filePath = getCacheFilePath(cacheDir, cacheKey)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      return { cleared: true, cacheKey }
    }

    return { cleared: false, cacheKey }
  }

  function clearAll() {
    memoryCache.clear()
    if (!fs.existsSync(cacheDir)) return { clearedCount: 0 }

    const entries = fs.readdirSync(cacheDir)
    let clearedCount = 0
    entries.forEach((entry) => {
      const filePath = path.join(cacheDir, entry)
      if (!fs.statSync(filePath).isFile()) return
      fs.unlinkSync(filePath)
      clearedCount += 1
    })
    return { clearedCount }
  }

  function readFreshMemoryEntry(cacheKey, now) {
    const entry = readAnyMemoryEntry(cacheKey)
    if (!entry) return null
    return entry.expiresAt > now ? createCacheResult(entry, 'memory', false, now) : null
  }

  function readAnyMemoryEntry(cacheKey) {
    const entry = memoryCache.get(cacheKey)
    if (!entry) return null
    if (!isValidCacheRecord(entry)) {
      memoryCache.delete(cacheKey)
      return null
    }
    return normalizeRecord(entry)
  }
}

export function createCacheKey({ fileKey, nodeId }) {
  return `${sanitizeCacheKeySegment(fileKey)}__${sanitizeCacheKeySegment(nodeId)}`
}

export function getCacheFilePath(cacheDir, cacheKey) {
  return path.join(cacheDir, `${cacheKey}.json`)
}

export function maskFigmaFileKey(value) {
  const text = String(value || '')
  if (text.length <= 4) return text
  return `${text.slice(0, 4)}${'*'.repeat(text.length - 4)}`
}

function getDefaultCacheDir() {
  const currentFile = fileURLToPath(import.meta.url)
  return path.resolve(path.dirname(currentFile), '..', '.cache', 'figma')
}

function sanitizeCacheKeySegment(value) {
  return String(value || '').replace(/[^0-9a-zA-Z._-]/g, '_')
}

function ensureDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true })
  }
}

function readDiskEntry(cacheDir, cacheKey) {
  const filePath = getCacheFilePath(cacheDir, cacheKey)
  return readDiskEntryAtPath(filePath)
}

function readDiskEntryAtPath(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!isValidCacheRecord(parsed)) {
      fs.unlinkSync(filePath)
      return null
    }
    return normalizeRecord(parsed)
  } catch {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch {
      // Ignore cleanup failure and allow API fallback.
    }
    return null
  }
}

function writeDiskEntry(cacheDir, cacheKey, record) {
  ensureDirectory(cacheDir)
  const filePath = getCacheFilePath(cacheDir, cacheKey)
  fs.writeFileSync(filePath, JSON.stringify(record), 'utf8')
}

function isValidCacheRecord(record) {
  if (!record || typeof record !== 'object') return false
  if (!record.cachedAt || !record.expiresAt) return false
  if (!record.nodeId || !record.data || typeof record.data !== 'object') return false
  return Number.isFinite(normalizeTimestamp(record.cachedAt)) && Number.isFinite(normalizeTimestamp(record.expiresAt))
}

function normalizeRecord(record) {
  return {
    ...record,
    cachedAt: normalizeTimestamp(record.cachedAt),
    expiresAt: normalizeTimestamp(record.expiresAt),
  }
}

function normalizeTimestamp(value) {
  if (typeof value === 'number') return value
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : Number.NaN
}

function createCacheResult(record, source, stale, now) {
  return {
    data: record.data,
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

function normalizeTtl(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_TTL_MS
}
