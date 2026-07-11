import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFigmaRenderClient } from './figmaRenderClient.js'
import { FigmaApiError, FigmaRateLimitError } from './figmaApiClient.js'

const SAMPLE_PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=',
  'base64',
)

function createTempCacheDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pagepilot-figma-render-cache-'))
}

function createLogger() {
  return { log() {} }
}

function createHeaders(headers = {}) {
  const headerMap = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]))
  return {
    get(name) {
      return headerMap.get(String(name || '').toLowerCase()) || null
    },
  }
}

function createJsonResponse(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: createHeaders(headers),
    async json() {
      return payload
    },
  }
}

function createBinaryResponse(status, buffer, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: createHeaders({
      'Content-Type': 'image/png',
      'Content-Length': buffer.length,
      ...headers,
    }),
    async arrayBuffer() {
      return buffer
    },
  }
}

function createFetchMock(handlers) {
  let callCount = 0
  const calls = []
  const fetchImpl = async (...args) => {
    calls.push(args)
    const handler = typeof handlers === 'function' ? handlers : handlers[callCount]
    callCount += 1
    return handler(...args)
  }
  fetchImpl.getCallCount = () => callCount
  fetchImpl.getCalls = () => calls.slice()
  return fetchImpl
}

function createRenderApiPayload(nodeId, imageUrl = 'https://figma.example/render.png') {
  return {
    images: {
      [nodeId]: imageUrl,
    },
  }
}

test('cache miss calls metadata API once and downloads image once', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock([
    () => createJsonResponse(200, createRenderApiPayload('123:456')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER),
  ])
  const client = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

  const result = await client.getFigmaRenderedImage({
    fileKey: 'file-key',
    nodeId: '123:456',
    token: 'secret-token',
    nodeName: 'Hero Frame',
  })

  assert.equal(fetchMock.getCallCount(), 2)
  assert.equal(result.cache.source, 'figma-api')
  assert.equal(result.cache.hit, false)
  assert.equal(result.nodeName, 'Hero Frame')
  assert.equal(result.renderId, 'file-key__123_456__png__2x')
})

test('successful PNG save stores metadata and extracts mime type size and dimensions', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock([
    () => createJsonResponse(200, createRenderApiPayload('123:456')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER),
  ])
  const client = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

  const result = await client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' })
  const metadataPath = path.join(cacheDir, `${result.renderId}.json`)
  const imagePath = path.join(cacheDir, `${result.renderId}.png`)
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))

  assert.equal(fs.existsSync(imagePath), true)
  assert.equal(metadata.mimeType, 'image/png')
  assert.equal(metadata.sizeBytes, SAMPLE_PNG_BUFFER.length)
  assert.equal(metadata.width, 1)
  assert.equal(metadata.height, 1)
})

test('same request reuses memory cache without API or download calls', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock([
    () => createJsonResponse(200, createRenderApiPayload('123:456')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER),
  ])
  const client = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

  await client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' })
  const second = await client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' })

  assert.equal(fetchMock.getCallCount(), 2)
  assert.equal(second.cache.source, 'memory')
  assert.equal(second.cache.hit, true)
})

test('new cache instance reuses disk cache after restart', async () => {
  const cacheDir = createTempCacheDir()
  const firstFetch = createFetchMock([
    () => createJsonResponse(200, createRenderApiPayload('123:456')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER),
  ])
  const firstClient = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: firstFetch, logger: createLogger() })
  await firstClient.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' })

  const secondFetch = createFetchMock(() => {
    throw new Error('should not fetch')
  })
  const secondClient = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: secondFetch, logger: createLogger() })
  const result = await secondClient.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' })

  assert.equal(secondFetch.getCallCount(), 0)
  assert.equal(result.cache.source, 'disk')
})

test('forceRefresh true re-calls metadata API and image download', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock([
    () => createJsonResponse(200, createRenderApiPayload('123:456', 'https://figma.example/first.png')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER),
    () => createJsonResponse(200, createRenderApiPayload('123:456', 'https://figma.example/second.png')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER),
  ])
  const client = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

  await client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' })
  const result = await client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token', forceRefresh: true })

  assert.equal(fetchMock.getCallCount(), 4)
  assert.equal(result.cache.source, 'figma-api')
})

test('concurrent identical requests dedupe metadata and download work', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock([
    () => new Promise((resolve) => {
      setTimeout(() => resolve(createJsonResponse(200, createRenderApiPayload('123:456'))), 20)
    }),
    () => new Promise((resolve) => {
      setTimeout(() => resolve(createBinaryResponse(200, SAMPLE_PNG_BUFFER)), 20)
    }),
  ])
  const client = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

  const [first, second] = await Promise.all([
    client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' }),
    client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' }),
  ])

  assert.equal(fetchMock.getCallCount(), 2)
  assert.equal(first.renderId, second.renderId)
})

test('429 with stale cached image falls back to stale render', async () => {
  const cacheDir = createTempCacheDir()
  const primeFetch = createFetchMock([
    () => createJsonResponse(200, createRenderApiPayload('123:456')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER),
  ])
  const primeClient = createFigmaRenderClient({ cacheDir, ttlMs: 5, fetchImpl: primeFetch, logger: createLogger() })
  await primeClient.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' })
  await new Promise((resolve) => setTimeout(resolve, 15))

  const retryFetch = createFetchMock(() => createJsonResponse(429, {}, { 'Retry-After': '60' }))
  const retryClient = createFigmaRenderClient({ cacheDir, ttlMs: 5, fetchImpl: retryFetch, logger: createLogger() })
  const result = await retryClient.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' })

  assert.equal(result.cache.hit, true)
  assert.equal(result.cache.stale, true)
  assert.equal(result.cache.source, 'disk')
})

test('429 without stale cache returns rate limit error', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock(() => createJsonResponse(429, {}, { 'Retry-After': '60' }))
  const client = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

  await assert.rejects(
    () => client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' }),
    (error) => {
      assert.equal(error instanceof FigmaRateLimitError, true)
      assert.equal(error.cacheAvailable, false)
      return true
    },
  )
})

test('401 and 403 do not use stale render fallback', async () => {
  const cacheDir = createTempCacheDir()
  const primeFetch = createFetchMock([
    () => createJsonResponse(200, createRenderApiPayload('123:456')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER),
  ])
  const primeClient = createFigmaRenderClient({ cacheDir, ttlMs: 5, fetchImpl: primeFetch, logger: createLogger() })
  await primeClient.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' })
  await new Promise((resolve) => setTimeout(resolve, 15))

  for (const status of [401, 403]) {
    const fetchMock = createFetchMock(() => createJsonResponse(status, {}))
    const client = createFigmaRenderClient({ cacheDir, ttlMs: 5, fetchImpl: fetchMock, logger: createLogger() })
    await assert.rejects(
      () => client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' }),
      (error) => {
        assert.equal(error instanceof FigmaApiError, true)
        assert.equal(error.status, status)
        return true
      },
    )
  }
})

test('missing node image URL in metadata response returns clear error', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock(() => createJsonResponse(200, { images: {} }))
  const client = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

  await assert.rejects(
    () => client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' }),
    (error) => {
      assert.equal(error instanceof FigmaApiError, true)
      assert.equal(error.code, 'figma_render_url_missing')
      return true
    },
  )
})

test('image download 404 and 500 return errors', async () => {
  for (const status of [404, 500]) {
    const cacheDir = createTempCacheDir()
    const fetchMock = createFetchMock([
      () => createJsonResponse(200, createRenderApiPayload('123:456')),
      () => createBinaryResponse(status, SAMPLE_PNG_BUFFER),
    ])
    const client = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

    await assert.rejects(
      () => client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' }),
      (error) => {
        assert.equal(error instanceof FigmaApiError, true)
        assert.equal(error.code, 'figma_render_download_failed')
        return true
      },
    )
  }
})

test('non-image content type is rejected before save', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock([
    () => createJsonResponse(200, createRenderApiPayload('123:456')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER, { 'Content-Type': 'text/html' }),
  ])
  const client = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

  await assert.rejects(
    () => client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' }),
    (error) => {
      assert.equal(error instanceof FigmaApiError, true)
      assert.equal(error.code, 'figma_render_invalid_content_type')
      assert.equal(fs.readdirSync(cacheDir).length, 0)
      return true
    },
  )
})

test('max image size limit rejects oversized download', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock([
    () => createJsonResponse(200, createRenderApiPayload('123:456')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER, { 'Content-Length': SAMPLE_PNG_BUFFER.length + 1 }),
  ])
  const client = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger(), maxBytes: SAMPLE_PNG_BUFFER.length })

  await assert.rejects(
    () => client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' }),
    (error) => {
      assert.equal(error instanceof FigmaApiError, true)
      assert.equal(error.code, 'figma_render_too_large')
      return true
    },
  )
})

test('corrupted metadata or missing file is treated as cache miss and re-fetched', async () => {
  const cacheDir = createTempCacheDir()
  const primeFetch = createFetchMock([
    () => createJsonResponse(200, createRenderApiPayload('123:456')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER),
  ])
  const primeClient = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: primeFetch, logger: createLogger() })
  const first = await primeClient.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' })

  fs.writeFileSync(path.join(cacheDir, `${first.renderId}.json`), '{broken', 'utf8')
  const recoverFetch = createFetchMock([
    () => createJsonResponse(200, createRenderApiPayload('123:456')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER),
  ])
  const recoverClient = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: recoverFetch, logger: createLogger() })
  const recovered = await recoverClient.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' })

  assert.equal(recoverFetch.getCallCount(), 2)
  assert.equal(recovered.cache.source, 'figma-api')

  fs.unlinkSync(path.join(cacheDir, `${first.renderId}.png`))
  const missingFileFetch = createFetchMock([
    () => createJsonResponse(200, createRenderApiPayload('123:456')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER),
  ])
  const missingFileClient = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: missingFileFetch, logger: createLogger() })
  const missingFileRecovered = await missingFileClient.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token', forceRefresh: false })

  assert.equal(missingFileFetch.getCallCount(), 2)
  assert.equal(missingFileRecovered.cache.source, 'figma-api')
})

test('renderId path traversal is rejected', async () => {
  const cacheDir = createTempCacheDir()
  const client = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: createFetchMock(() => createJsonResponse(500, {})), logger: createLogger() })

  assert.equal(client.getLocalRenderFile({ renderId: '../secret' }), null)
  assert.equal(client.getLocalRenderFile({ renderId: '..\\secret' }), null)
})

test('cache clear for one node removes related render variants', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock([
    () => createJsonResponse(200, createRenderApiPayload('123:456', 'https://figma.example/a.png')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER),
    () => createJsonResponse(200, createRenderApiPayload('123:456', 'https://figma.example/b.png')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER, { 'Content-Type': 'image/jpeg' }),
  ])
  const client = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

  await client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token', format: 'png', scale: 2 })
  await client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token', format: 'jpg', scale: 1, forceRefresh: true })

  const cleared = client.clearCache({ fileKey: 'file-key', nodeId: '123:456' })

  assert.equal(cleared.cleared, true)
  assert.equal(cleared.clearedCount, 2)
  assert.equal(fs.readdirSync(cacheDir).length, 0)
})

test('cache clear all removes all render files', async () => {
  const cacheDir = createTempCacheDir()
  const fetchMock = createFetchMock([
    () => createJsonResponse(200, createRenderApiPayload('123:456', 'https://figma.example/a.png')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER),
    () => createJsonResponse(200, createRenderApiPayload('777:888', 'https://figma.example/b.png')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER),
  ])
  const client = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

  await client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' })
  await client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '777:888', token: 'secret-token', forceRefresh: true })
  const result = client.clearAllCache()

  assert.equal(result.clearedCount, 4)
  assert.equal(fs.readdirSync(cacheDir).length, 0)
})

test('token is not included in filenames metadata or response payload', async () => {
  const cacheDir = createTempCacheDir()
  const token = 'secret-token-value'
  const fetchMock = createFetchMock([
    () => createJsonResponse(200, createRenderApiPayload('123:456')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER),
  ])
  const client = createFigmaRenderClient({ cacheDir, ttlMs: 60000, fetchImpl: fetchMock, logger: createLogger() })

  const result = await client.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token })
  const metadataPath = path.join(cacheDir, `${result.renderId}.json`)
  const metadataText = fs.readFileSync(metadataPath, 'utf8')

  assert.equal(result.renderId.includes(token), false)
  assert.equal(result.localImagePath.includes(token), false)
  assert.equal(metadataText.includes(token), false)
  assert.equal(fs.readdirSync(cacheDir).some((entry) => entry.includes(token)), false)
})

test('stale cached image is reused when image download fails temporarily', async () => {
  const cacheDir = createTempCacheDir()
  const primeFetch = createFetchMock([
    () => createJsonResponse(200, createRenderApiPayload('123:456')),
    () => createBinaryResponse(200, SAMPLE_PNG_BUFFER),
  ])
  const primeClient = createFigmaRenderClient({ cacheDir, ttlMs: 5, fetchImpl: primeFetch, logger: createLogger() })
  await primeClient.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' })
  await new Promise((resolve) => setTimeout(resolve, 15))

  const retryFetch = createFetchMock([
    () => createJsonResponse(200, createRenderApiPayload('123:456')),
    () => createBinaryResponse(500, SAMPLE_PNG_BUFFER),
  ])
  const retryClient = createFigmaRenderClient({ cacheDir, ttlMs: 5, fetchImpl: retryFetch, logger: createLogger() })
  const result = await retryClient.getFigmaRenderedImage({ fileKey: 'file-key', nodeId: '123:456', token: 'secret-token' })

  assert.equal(result.cache.hit, true)
  assert.equal(result.cache.stale, true)
})
