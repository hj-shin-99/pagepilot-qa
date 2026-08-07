import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { auditPerformanceResources, PERFORMANCE_AUDIT_TEST_ONLY } from './techPerformanceAudit.js'

test('performance audit summarizes healthy resource transfer by type', () => {
  const result = auditPerformanceResources('https://example.com', snapshot({
    performanceInfo: {
      resources: [
        resource({ url: 'https://example.com/', resourceType: 'document', transferSize: 20000, encodedBodySize: 18000 }),
        resource({ url: 'https://example.com/app.js', resourceType: 'script', transferSize: 120000, encodedBodySize: 110000 }),
        resource({ url: 'https://example.com/app.css', resourceType: 'stylesheet', transferSize: 24000, encodedBodySize: 22000 }),
      ],
      renderBlockingCandidates: [],
    },
  }), responses())

  assert.equal(result.meta.noTarget, false)
  assert.equal(result.items.find((item) => item.category === 'overview').status, 'ok')
})

test('performance audit does not treat missing content-length as zero-byte failure', () => {
  const result = auditPerformanceResources('https://example.com', snapshot({
    performanceInfo: {
      resources: [resource({ url: 'https://example.com/app.js', resourceType: 'script', transferSize: 0, encodedBodySize: 0, duration: 120 })],
      renderBlockingCandidates: [],
    },
  }), responses([{ url: 'https://example.com/app.js', resourceType: 'script', contentType: 'application/javascript', contentEncoding: 'br', statusCode: 200 }]))

  assert.equal(result.items.find((item) => item.category === 'failed-resource').status, 'ok')
})

test('performance audit warns on large js css image font and media resources', () => {
  const result = auditPerformanceResources('https://example.com', snapshot({
    performanceInfo: {
      resources: [
        resource({ url: 'https://example.com/large.js', resourceType: 'script', transferSize: 350000, encodedBodySize: 350000 }),
        resource({ url: 'https://example.com/large.css', resourceType: 'stylesheet', transferSize: 140000, encodedBodySize: 140000 }),
        resource({ url: 'https://example.com/hero.webp', resourceType: 'image', transferSize: 700000, encodedBodySize: 700000 }),
        resource({ url: 'https://example.com/font.woff2', resourceType: 'font', transferSize: 220000, encodedBodySize: 220000 }),
        resource({ url: 'https://example.com/video.mp4', resourceType: 'media', transferSize: 1500000, encodedBodySize: 1500000 }),
      ],
      renderBlockingCandidates: [],
    },
  }), responses())

  const largeItem = result.items.find((item) => item.category === 'large-resource')
  assert.equal(largeItem.status, 'warn')
  assert.equal(largeItem.sourceCount >= 5, true)
})

test('performance audit warns on slow first-party resources and relaxes third-party threshold', () => {
  const result = auditPerformanceResources('https://example.com', snapshot({
    performanceInfo: {
      resources: [
        resource({ url: 'https://example.com/app.js', resourceType: 'script', duration: 1800, transferSize: 120000, encodedBodySize: 100000 }),
        resource({ url: 'https://cdn.example.net/sdk.js', resourceType: 'script', duration: 2200, transferSize: 90000, encodedBodySize: 90000 }),
      ],
      renderBlockingCandidates: [],
    },
  }), responses())

  const slowItem = result.items.find((item) => item.category === 'slow-resource')
  assert.equal(slowItem.status, 'warn')
  assert.equal(slowItem.issues.some((issue) => issue.includes('first-party')), true)
  assert.equal(slowItem.issues.some((issue) => issue.includes('cdn.example.net')), false)
})

test('performance audit accepts compressed text resources and ignores tiny uncompressed text', () => {
  const result = auditPerformanceResources('https://example.com', snapshot({
    performanceInfo: {
      resources: [
        resource({ url: 'https://example.com/', resourceType: 'document', transferSize: 3000, encodedBodySize: 3000 }),
        resource({ url: 'https://example.com/tiny.js', resourceType: 'script', transferSize: 900, encodedBodySize: 900 }),
      ],
      renderBlockingCandidates: [],
    },
  }), responses([
    { url: 'https://example.com/', resourceType: 'document', contentType: 'text/html', contentEncoding: 'br', statusCode: 200 },
    { url: 'https://example.com/tiny.js', resourceType: 'script', contentType: 'application/javascript', contentEncoding: '', statusCode: 200 },
  ]))

  assert.equal(result.items.find((item) => item.category === 'compression').status, 'ok')
})

test('performance audit warns on large text resources without compression', () => {
  const result = auditPerformanceResources('https://example.com', snapshot({
    performanceInfo: {
      resources: [resource({ url: 'https://example.com/app.js', resourceType: 'script', transferSize: 90000, encodedBodySize: 90000 })],
      renderBlockingCandidates: [],
    },
  }), responses([{ url: 'https://example.com/app.js', resourceType: 'script', contentType: 'application/javascript', contentEncoding: '', statusCode: 200 }]))

  assert.equal(result.items.find((item) => item.category === 'compression').status, 'warn')
})

test('performance audit warns on fingerprinted static assets without cache but allows html no-cache and api no-store', () => {
  const result = auditPerformanceResources('https://example.com', snapshot({
    performanceInfo: {
      resources: [
        resource({ url: 'https://example.com/app-abcdef123456.js', resourceType: 'script', transferSize: 120000, encodedBodySize: 120000 }),
        resource({ url: 'https://example.com/', resourceType: 'document', transferSize: 20000, encodedBodySize: 18000 }),
        resource({ url: 'https://example.com/api/data', resourceType: 'fetch', transferSize: 4000, encodedBodySize: 4000 }),
      ],
      renderBlockingCandidates: [],
    },
  }), responses([
    { url: 'https://example.com/app-abcdef123456.js', resourceType: 'script', contentType: 'application/javascript', cacheControl: 'public, max-age=0', statusCode: 200 },
    { url: 'https://example.com/', resourceType: 'document', contentType: 'text/html', cacheControl: 'no-cache', statusCode: 200 },
    { url: 'https://example.com/api/data', resourceType: 'fetch', contentType: 'application/json', cacheControl: 'no-store', statusCode: 200 },
  ]))

  assert.equal(result.items.find((item) => item.category === 'cache-policy').status, 'warn')
})

test('performance audit detects duplicate static requests and ignores 304 and options noise', () => {
  const result = auditPerformanceResources('https://example.com', snapshot({
    performanceInfo: {
      resources: [
        resource({ url: 'https://example.com/app.js', resourceType: 'script', transferSize: 10000, encodedBodySize: 10000 }),
        resource({ url: 'https://example.com/app.js', resourceType: 'script', transferSize: 10000, encodedBodySize: 10000 }),
        resource({ url: 'https://example.com/revalidate.css', resourceType: 'stylesheet', transferSize: 0, encodedBodySize: 0 }),
      ],
      renderBlockingCandidates: [],
    },
  }), responses([
    { url: 'https://example.com/app.js', resourceType: 'script', method: 'GET', statusCode: 200 },
    { url: 'https://example.com/app.js', resourceType: 'script', method: 'GET', statusCode: 200 },
    { url: 'https://example.com/revalidate.css', resourceType: 'stylesheet', method: 'GET', statusCode: 304 },
    { url: 'https://example.com/revalidate.css', resourceType: 'stylesheet', method: 'OPTIONS', statusCode: 204 },
  ]))

  assert.equal(result.items.find((item) => item.category === 'duplicate-request').status, 'warn')
})

test('performance audit warns on large blocking head scripts without treating stylesheets as automatic errors', () => {
  const result = auditPerformanceResources('https://example.com', snapshot({
    performanceInfo: {
      resources: [resource({ url: 'https://example.com/blocking.js', resourceType: 'script', transferSize: 100000, encodedBodySize: 100000 })],
      renderBlockingCandidates: [
        { kind: 'script', url: 'https://example.com/blocking.js', blocking: true },
        { kind: 'stylesheet', url: 'https://example.com/app.css', blocking: true },
      ],
    },
  }), responses([{ url: 'https://example.com/blocking.js', resourceType: 'script', statusCode: 200 }]))

  const item = result.items.find((entry) => entry.category === 'render-blocking')
  assert.equal(item.status, 'warn')
})

test('performance audit creates error only for failed first-party core resources', () => {
  const result = auditPerformanceResources('https://example.com', snapshot({ performanceInfo: { resources: [], renderBlockingCandidates: [] } }), responses([
    { url: 'https://example.com/app.js', resourceType: 'script', statusCode: 503 },
    { url: 'https://cdn.example.net/sdk.js', resourceType: 'script', statusCode: 503 },
  ]))

  assert.equal(result.items.find((item) => item.category === 'failed-resource').status, 'error')
})

test('performance audit source does not use lighthouse or site-specific hardcoding', () => {
  const source = fs.readFileSync(new URL('./techPerformanceAudit.js', import.meta.url), 'utf8')

  assert.equal(/lighthouse/i.test(source), false)
  assert.equal(/BMW|BMWFS|NAVER/.test(source), false)
  assert.equal(PERFORMANCE_AUDIT_TEST_ONLY.normalizeResourceType('xmlhttprequest'), 'fetch')
})

test('performance audit infers static resource types from URL when performance initiator is css', () => {
  assert.equal(PERFORMANCE_AUDIT_TEST_ONLY.normalizeResourceType('css', 'https://example.com/banner_wrap_pc.jpg'), 'image')
  assert.equal(PERFORMANCE_AUDIT_TEST_ONLY.normalizeResourceType('css', 'https://example.com/footer_top_myfincar.svg'), 'image')
  assert.equal(PERFORMANCE_AUDIT_TEST_ONLY.normalizeResourceType('css', 'https://example.com/font.woff2'), 'font')
  assert.equal(PERFORMANCE_AUDIT_TEST_ONLY.normalizeResourceType('css', 'https://example.com/app.css'), 'stylesheet')
  assert.equal(PERFORMANCE_AUDIT_TEST_ONLY.normalizeResourceType('other', 'https://example.com/app.js'), 'script')
  assert.equal(PERFORMANCE_AUDIT_TEST_ONLY.normalizeResourceType('other', 'https://example.com/video.mp4'), 'media')
  assert.equal(PERFORMANCE_AUDIT_TEST_ONLY.normalizeResourceType('other', 'https://example.com/index.html'), 'document')
})

test('performance audit phase 3-b fixtures cover status boundaries and missing header false positive', () => {
  const problem = auditPerformanceResources('https://example.com', snapshot({ performanceInfo: { resources: [], renderBlockingCandidates: [] } }), responses([{ url: 'https://example.com/app.js', resourceType: 'script', statusCode: 500 }]))
  const review = auditPerformanceResources('https://example.com', snapshot({ performanceInfo: { resources: [resource({ url: 'https://example.com/large.js', resourceType: 'script', transferSize: 360000, encodedBodySize: 360000 })], renderBlockingCandidates: [] } }), responses())
  const normal = auditPerformanceResources('https://example.com', snapshot({ performanceInfo: { resources: [resource({ url: 'https://example.com/app.js', resourceType: 'script', transferSize: 90000, encodedBodySize: 90000 })], renderBlockingCandidates: [] } }), responses([{ url: 'https://example.com/app.js', resourceType: 'script', contentType: 'application/javascript', contentEncoding: 'br', statusCode: 200 }]))
  const notApplicable = auditPerformanceResources('https://example.com', snapshot(), responses())
  const previousFalsePositive = auditPerformanceResources('https://example.com', snapshot({ performanceInfo: { resources: [resource({ url: 'https://example.com/app.js', resourceType: 'script', transferSize: 90000, encodedBodySize: 90000 })], renderBlockingCandidates: [] } }), responses([{ url: 'https://example.com/app.js', resourceType: 'script', statusCode: 200 }]))

  assert.equal(problem.items.find((item) => item.category === 'failed-resource').status, 'error')
  assert.equal(review.items.find((item) => item.category === 'large-resource').status, 'warn')
  assert.equal(normal.items.find((item) => item.category === 'compression').status, 'ok')
  assert.equal(notApplicable.meta.noTarget, true)
  assert.equal(previousFalsePositive.items.find((item) => item.category === 'compression').status, 'ok')
  assert.equal(previousFalsePositive.items.find((item) => item.category === 'overview').issues.some((issue) => issue.includes('검사 환경')), true)
})

function snapshot(overrides = {}) {
  return {
    performanceInfo: { resources: [], renderBlockingCandidates: [] },
    ...overrides,
  }
}

function resource(overrides = {}) {
  return {
    url: 'https://example.com/resource.js',
    resourceType: 'script',
    initiatorType: 'script',
    transferSize: 10000,
    encodedBodySize: 9000,
    decodedBodySize: 12000,
    duration: 120,
    renderBlockingStatus: '',
    ...overrides,
  }
}

function responses(items = []) {
  return items.map((item) => ({
    method: 'GET',
    statusCode: 200,
    contentType: '',
    contentLength: null,
    contentEncoding: '',
    cacheControl: '',
    expires: '',
    etag: '',
    lastModified: '',
    resourceType: 'script',
    ...item,
  }))
}
