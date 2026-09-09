import crypto from 'node:crypto'

export const REFERENCE_NORMALIZATION_CACHE_SCHEMA_VERSION = 'reference-normalization-cache-v1'

const DEFAULT_MAX_ENTRIES = 50

export function createReferenceNormalizationCache(options = {}) {
  const maxEntries = Number.isFinite(Number(options.maxEntries)) && Number(options.maxEntries) > 0 ? Math.floor(Number(options.maxEntries)) : DEFAULT_MAX_ENTRIES
  const entries = new Map()

  return {
    async get(key) {
      const entry = entries.get(key)
      if (!entry) return null
      entries.delete(key)
      entries.set(key, entry)
      return cloneJson(entry)
    },
    async set(key, value) {
      if (typeof key !== 'string' || !key || !value || typeof value !== 'object') return false
      entries.delete(key)
      entries.set(key, cloneJson(value))
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value)
      return true
    },
    clear() {
      entries.clear()
    },
    get size() {
      return entries.size
    },
  }
}

export function createReferenceNormalizationCacheKey({ compactInput, model, maxCompletionTokens }) {
  const payload = {
    cacheSchemaVersion: REFERENCE_NORMALIZATION_CACHE_SCHEMA_VERSION,
    model: normalizeText(model, 160),
    maxCompletionTokens: Number.isFinite(Number(maxCompletionTokens)) ? Number(maxCompletionTokens) : 0,
    chunks: Array.isArray(compactInput?.chunks)
      ? compactInput.chunks.map((chunk) => ({
        chunkId: normalizeText(chunk?.chunkId, 80),
        candidateIds: Array.isArray(chunk?.candidateIds) ? chunk.candidateIds.map((id) => normalizeText(id, 80)) : [],
        aiInput: chunk?.aiInput || {},
      }))
      : [],
  }
  const hash = crypto.createHash('sha256').update(stableStringify(payload)).digest('hex')
  return `${REFERENCE_NORMALIZATION_CACHE_SCHEMA_VERSION}:${hash}`
}

export function createReferenceNormalizationCacheMeta(key, overrides = {}) {
  return {
    schemaVersion: REFERENCE_NORMALIZATION_CACHE_SCHEMA_VERSION,
    keyHash: extractKeyHash(key),
    status: 'disabled',
    hit: false,
    read: false,
    written: false,
    ...overrides,
  }
}

function extractKeyHash(key) {
  const text = normalizeText(key, 200)
  const hash = text.split(':').at(-1) || ''
  return /^[a-f0-9]{64}$/.test(hash) ? hash : ''
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((result, key) => {
    const child = value[key]
    if (child !== undefined && typeof child !== 'function') result[key] = canonicalize(child)
    return result
  }, {})
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeText(value, maxLength) {
  const text = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}
