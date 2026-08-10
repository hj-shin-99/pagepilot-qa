import test from 'node:test'
import assert from 'node:assert/strict'
import { assertDownloadAuditSourceSafety, auditDownloadResources, classifyDownloadInspection, createDownloadAuditCandidates, DOWNLOAD_AUDIT_TEST_ONLY } from './techDownloadAudit.js'

test('download audit collects a[download] and file-extension candidates and dedupes identical URLs', () => {
  const candidates = createDownloadAuditCandidates([
    { label: 'Catalog', href: '/files/catalog', url: 'https://example.com/files/catalog', download: 'catalog.pdf', selector: '#catalog' },
    { label: 'Brochure', href: '/files/brochure.pdf', url: 'https://example.com/files/brochure.pdf', selector: '#brochure-a' },
    { label: 'Brochure duplicate', href: '/files/brochure.pdf', url: 'https://example.com/files/brochure.pdf', selector: '#brochure-b' },
  ], 'https://example.com')

  assert.equal(candidates.length, 2)
  assert.equal(candidates[1].sourceCount, 2)
})

test('download audit classifies normal file responses and redirects as ok', () => {
  const item = classifyDownloadInspection(candidate({ expectedExtension: 'pdf' }), {
    statusCode: 200,
    finalUrl: 'https://cdn.example.com/brochure.pdf',
    contentType: 'application/pdf',
    contentDisposition: 'attachment; filename="brochure.pdf"',
    contentLength: 1024,
    filename: 'brochure.pdf',
  })

  assert.equal(item.status, 'ok')
  assert.equal(item.finalUrl, 'https://cdn.example.com/brochure.pdf')
})

test('download audit classifies 404 5xx timeout and zero-byte responses as errors', () => {
  const notFound = classifyDownloadInspection(candidate({ expectedExtension: 'pdf' }), { statusCode: 404, contentType: 'application/pdf', contentLength: 12 })
  const serverError = classifyDownloadInspection(candidate({ expectedExtension: 'zip' }), { statusCode: 503, contentType: 'application/zip', contentLength: 12 })
  const timeout = classifyDownloadInspection(candidate(), { error: 'Timeout 6000ms exceeded' })
  const zeroByte = classifyDownloadInspection(candidate({ expectedExtension: 'pdf' }), { statusCode: 200, contentType: 'application/pdf', contentLength: 0 })

  assert.equal(notFound.status, 'error')
  assert.equal(serverError.status, 'error')
  assert.equal(timeout.status, 'error')
  assert.equal(zeroByte.status, 'error')
})

test('download audit warns on auth restrictions and mime mismatch but allows octet-stream and missing length', () => {
  const restricted = classifyDownloadInspection(candidate({ expectedExtension: 'pdf' }), { statusCode: 403, contentType: 'application/pdf', contentLength: null })
  const rateLimited = classifyDownloadInspection(candidate({ expectedExtension: 'pdf' }), { statusCode: 429, contentType: 'application/pdf', contentLength: null })
  const mismatch = classifyDownloadInspection(candidate({ expectedExtension: 'pdf' }), { statusCode: 200, contentType: 'text/html', contentLength: 1200 })
  const octet = classifyDownloadInspection(candidate({ expectedExtension: 'xlsx' }), { statusCode: 200, contentType: 'application/octet-stream', contentLength: null })

  assert.equal(restricted.status, 'warn')
  assert.equal(rateLimited.status, 'warn')
  assert.equal(rateLimited.note.includes('요청 제한'), true)
  assert.equal(mismatch.status, 'error')
  assert.equal(octet.status, 'ok')
})

test('download audit skips blob data and post-based candidates safely', () => {
  const skipped = createDownloadAuditCandidates([
    { label: 'Blob', href: 'blob:https://example.com/1', selector: '#blob' },
    { label: 'Data', href: 'data:application/pdf;base64,AAAA', selector: '#data' },
    { label: 'Post export', href: '/export', url: 'https://example.com/export', method: 'POST', selector: '#post' },
  ], 'https://example.com')

  assert.equal(skipped.length, 3)
  assert.equal(skipped.every((item) => item.skipReason), true)
})

test('download audit source safety avoids file save APIs', () => {
  assert.equal(assertDownloadAuditSourceSafety(), true)
})

test('download audit supports HEAD fallback to limited GET and avoids requests when no candidates exist', async () => {
  const requests = []
  const result = await auditDownloadResources('https://example.com', [
    { label: 'PDF', href: '/brochure.pdf', url: 'https://example.com/brochure.pdf', selector: '#pdf' },
  ], {}, async () => ({
    async fetch(url, options) {
      requests.push(options.method)
      return {
        status() { return options.method === 'HEAD' ? 405 : 200 },
        headers() { return { 'content-type': 'application/pdf', 'content-length': '2048' } },
        url() { return url },
        async dispose() {},
      }
    },
    async dispose() {},
  }))

  assert.deepEqual(requests, ['HEAD', 'GET'])
  assert.equal(result.items[0].status, 'ok')

  const empty = await auditDownloadResources('https://example.com', [], {}, async () => {
    throw new Error('should not create api context')
  })
  assert.equal(empty.meta.noTarget, true)
})

test('download audit helpers expose extension and mime matching rules', () => {
  assert.equal(DOWNLOAD_AUDIT_TEST_ONLY.getDownloadExtension('/files/report.pdf?x=1'), 'pdf')
  assert.equal(DOWNLOAD_AUDIT_TEST_ONLY.hasDownloadMimeMismatch('pdf', 'application/pdf'), false)
  assert.equal(DOWNLOAD_AUDIT_TEST_ONLY.hasDownloadMimeMismatch('pdf', 'text/html'), true)
  assert.equal(DOWNLOAD_AUDIT_TEST_ONLY.normalizeDownloadAuditCandidate({ label: 'Export', href: '/export', url: 'https://example.com/export', method: 'POST' }, 'https://example.com', 0).skipReason.includes('POST'), true)
})

test('download audit phase 3-b fixtures cover status boundaries and HEAD zero-length false positive', () => {
  const problem = classifyDownloadInspection(candidate(), { statusCode: 404, contentType: 'application/pdf', contentLength: 12 })
  const review = classifyDownloadInspection(candidate(), { statusCode: 403, contentType: 'application/pdf', contentLength: null })
  const normal = classifyDownloadInspection(candidate(), { statusCode: 200, contentType: 'application/pdf', contentLength: 2048 })
  const excluded = classifyDownloadInspection(candidate({ skipReason: '정적 HTTP 검사 대상이 아닌 링크입니다.' }), { skipped: true })
  const previousFalsePositive = classifyDownloadInspection(candidate(), { method: 'HEAD', statusCode: 200, contentType: 'application/pdf', contentDisposition: 'attachment; filename="file.pdf"', contentLength: 0 })

  assert.equal(problem.status, 'error')
  assert.equal(review.status, 'warn')
  assert.equal(normal.status, 'ok')
  assert.equal(excluded.status, 'info')
  assert.equal(previousFalsePositive.status, 'warn')
})

function candidate(overrides = {}) {
  return {
    auditId: 'download-1',
    label: 'Download file',
    selector: '#download',
    requestedUrl: 'https://example.com/file.pdf',
    expectedExtension: 'pdf',
    inferredFilename: 'file.pdf',
    ...overrides,
  }
}
