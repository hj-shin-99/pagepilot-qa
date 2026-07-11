import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFigmaApiClient, FigmaApiError, FigmaRateLimitError } from './figmaApiClient.js'

function createTempCacheDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pagepilot-figma-cache-'))
}

function createLogger() {
  return { log() {} }
}

function createNodePayload(nodeId, name = 'Sample Frame') {
  return {
    nodes: {
      [nodeId]: {
        document: {
          id: nodeId,
          name,
          type: 'FRAME',
          visible: true,
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
          children: [],
        },
      },
    },
  }
}

function createJsonResponse(status, payload, headers = {}) {
  const headerMap = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]))
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headerMap.get(String(name || '').toLowerCase()) || null
      },
    },
    async json() {
      return payload
    },
  }
}

function createFetchMock(handlers) {
  let callCount = 0
  const fetchImpl = async (...args) => {
    callCount += 1
    const handler = typeof handlers === 'function' ? handlers : handlers[callCount - 1]
    return handler(...args)
  }
  fetchImpl.getCallCount = () => callCount
  return fetchImpl
}

test('cache miss calls API once and stores to memory and disk', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock(() => createJsonResponse(200, createNodePayload('123:456')))
  const client = createFigmaApiClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

  const result = await client.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' })

  assert.equal(fetchMock.getCallCount(), 1)
  assert.equal(result.targetNode.name, 'Sample Frame')
  assert.equal(result.cache.source, 'figma-api')
  assert.equal(result.cache.hit, false)
  assert.equal(fs.readdirSync(cacheDir).length, 1)
})

test('same request reuses memory cache without new API call', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock(() => createJsonResponse(200, createNodePayload('123:456')))
  const client = createFigmaApiClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

  await client.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' })
  const second = await client.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' })

  assert.equal(fetchMock.getCallCount(), 1)
  assert.equal(second.cache.source, 'memory')
  assert.equal(second.cache.hit, true)
})

test('new cache instance can reuse disk cache after restart', async () => {
  const cacheDir = createTempCacheDir()
  const firstFetch = createFetchMock(() => createJsonResponse(200, createNodePayload('123:456')))
  const firstClient = createFigmaApiClient({ cacheDir, ttlMs: 60000, fetchImpl: firstFetch, logger: createLogger() })
  await firstClient.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' })

  const secondFetch = createFetchMock(() => createJsonResponse(200, createNodePayload('123:456', 'Should Not Fetch')))
  const secondClient = createFigmaApiClient({ cacheDir, ttlMs: 60000, fetchImpl: secondFetch, logger: createLogger() })
  const result = await secondClient.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' })

  assert.equal(secondFetch.getCallCount(), 0)
  assert.equal(result.cache.source, 'disk')
  assert.equal(result.targetNode.name, 'Sample Frame')
})

test('expired cache triggers API re-fetch', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock([
    () => createJsonResponse(200, createNodePayload('123:456', 'First')),
    () => createJsonResponse(200, createNodePayload('123:456', 'Second')),
  ])
  const client = createFigmaApiClient({ cacheDir, ttlMs: 5, fetchImpl: fetchMock, logger: createLogger() })

  await client.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' })
  await new Promise((resolve) => setTimeout(resolve, 15))
  const result = await client.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' })

  assert.equal(fetchMock.getCallCount(), 2)
  assert.equal(result.targetNode.name, 'Second')
})

test('forceRefresh bypasses cache and re-fetches API', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock([
    () => createJsonResponse(200, createNodePayload('123:456', 'First')),
    () => createJsonResponse(200, createNodePayload('123:456', 'Second')),
  ])
  const client = createFigmaApiClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

  await client.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' })
  const result = await client.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret', forceRefresh: true })

  assert.equal(fetchMock.getCallCount(), 2)
  assert.equal(result.targetNode.name, 'Second')
  assert.equal(result.cache.source, 'figma-api')
})

test('concurrent identical requests dedupe in-flight API call', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock(() => new Promise((resolve) => {
    setTimeout(() => resolve(createJsonResponse(200, createNodePayload('123:456'))), 20)
  }))
  const client = createFigmaApiClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

  const [first, second] = await Promise.all([
    client.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' }),
    client.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' }),
  ])

  assert.equal(fetchMock.getCallCount(), 1)
  assert.equal(first.targetNode.id, '123:456')
  assert.equal(second.targetNode.id, '123:456')
})

test('429 with stale cache falls back to stale cache', async () => {
  const cacheDir = createTempCacheDir()
  const primeFetch = createFetchMock(() => createJsonResponse(200, createNodePayload('123:456', 'Cached')))
  const primeClient = createFigmaApiClient({ cacheDir, ttlMs: 5, fetchImpl: primeFetch, logger: createLogger() })
  await primeClient.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' })

  await new Promise((resolve) => setTimeout(resolve, 15))

  const retryFetch = createFetchMock(() => createJsonResponse(429, {}, { 'Retry-After': '60' }))
  const retryClient = createFigmaApiClient({ cacheDir, ttlMs: 5, fetchImpl: retryFetch, logger: createLogger() })
  const result = await retryClient.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' })

  assert.equal(retryFetch.getCallCount(), 1)
  assert.equal(result.targetNode.name, 'Cached')
  assert.equal(result.cache.hit, true)
  assert.equal(result.cache.stale, true)
})

test('429 without cache returns rate limit error', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock(() => createJsonResponse(429, {}, { 'Retry-After': '60' }))
  const client = createFigmaApiClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

  await assert.rejects(
    () => client.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' }),
    (error) => {
      assert.equal(error instanceof FigmaRateLimitError, true)
      assert.equal(error.retryAfterSeconds, 60)
      assert.equal(error.cacheAvailable, false)
      return true
    },
  )
})

test('401 or 403 do not use stale cache fallback', async () => {
  const cacheDir = createTempCacheDir()
  const primeFetch = createFetchMock(() => createJsonResponse(200, createNodePayload('123:456', 'Cached')))
  const primeClient = createFigmaApiClient({ cacheDir, ttlMs: 5, fetchImpl: primeFetch, logger: createLogger() })
  await primeClient.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' })
  await new Promise((resolve) => setTimeout(resolve, 15))

  const authFetch = createFetchMock(() => createJsonResponse(401, {}))
  const authClient = createFigmaApiClient({ cacheDir, ttlMs: 5, fetchImpl: authFetch, logger: createLogger() })

  await assert.rejects(
    () => authClient.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' }),
    (error) => {
      assert.equal(error instanceof FigmaApiError, true)
      assert.equal(error.status, 401)
      return true
    },
  )
})

test('corrupted cache file is ignored safely and API fallback succeeds', async () => {
  const cacheDir = createTempCacheDir()
  const client = createFigmaApiClient({ cacheDir, ttlMs: 60000, fetchImpl: createFetchMock(() => createJsonResponse(200, createNodePayload('123:456', 'Recovered'))), logger: createLogger() })
  const cacheKey = client.cache.createCacheKey({ fileKey: 'file-key', nodeId: '123:456' })
  const cacheFile = path.join(cacheDir, `${cacheKey}.json`)
  fs.writeFileSync(cacheFile, '{broken', 'utf8')

  const result = await client.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' })
  assert.equal(result.targetNode.name, 'Recovered')
  assert.equal(fs.existsSync(cacheFile), true)
})

test('cache clear removes one entry', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock(() => createJsonResponse(200, createNodePayload('123:456')))
  const client = createFigmaApiClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })
  await client.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' })

  const cleared = client.clearCache({ fileKey: 'file-key', nodeId: '123:456' })
  assert.equal(cleared.cleared, true)
  assert.equal(fs.readdirSync(cacheDir).length, 0)
})

test('cache clear all removes all entries', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock([
    () => createJsonResponse(200, createNodePayload('123:456')),
    () => createJsonResponse(200, createNodePayload('777:888')),
  ])
  const client = createFigmaApiClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })
  await client.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' })
  await client.getFigmaNodeData({ fileKey: 'file-key', nodeId: '777:888', token: 'secret' })

  const result = client.clearAllCache()
  assert.equal(result.clearedCount, 2)
  assert.equal(fs.readdirSync(cacheDir).length, 0)
})

test('cache key and path do not include token', async () => {
  const cacheDir = createTempCacheDir()
  const client = createFigmaApiClient({ cacheDir, ttlMs: 60000, fetchImpl: createFetchMock(() => createJsonResponse(200, createNodePayload('123:456'))), logger: createLogger() })
  const cacheKey = client.cache.createCacheKey({ fileKey: 'file-key', nodeId: '123:456' })

  assert.equal(cacheKey.includes('secret-token'), false)
  assert.equal(cacheDir.includes('secret-token'), false)
})

test('inspect and text-compare wrappers reuse the same cache entry', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock(() => createJsonResponse(200, createNodePayload('123:456', 'Reusable')))
  const client = createFigmaApiClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

  const inspect = () => client.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' })
  const textCompare = () => client.getFigmaNodeData({ fileKey: 'file-key', nodeId: '123:456', token: 'secret' })

  const first = await inspect()
  const second = await textCompare()

  assert.equal(fetchMock.getCallCount(), 1)
  assert.equal(first.cache.source, 'figma-api')
  assert.equal(second.cache.source, 'memory')
})
