import fs from 'node:fs'
import { request as playwrightRequest } from 'playwright'

const DOWNLOAD_AUDIT_TIMEOUT_MS = 6000
const DOWNLOAD_AUDIT_CONCURRENCY = 4
const MAX_DOWNLOAD_CANDIDATES = 12
const MAX_DOWNLOAD_REDIRECTS = 3
const DOWNLOAD_EXTENSIONS = new Set(['pdf', 'zip', 'csv', 'xls', 'xlsx', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'json', 'xml', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'])

export async function auditDownloadResources(targetUrl, linkItems = [], instrumentation = null, apiFactory = () => playwrightRequest.newContext({ ignoreHTTPSErrors: true })) {
  const candidates = createDownloadAuditCandidates(linkItems, targetUrl).slice(0, MAX_DOWNLOAD_CANDIDATES)
  if (candidates.length === 0) {
    return { items: [], meta: createDownloadAuditMeta([], { candidateCount: 0, noTarget: true }) }
  }

  const api = await apiFactory()
  try {
    const items = await mapWithLimit(candidates, DOWNLOAD_AUDIT_CONCURRENCY, async (candidate) => {
      incrementAuditCount(instrumentation, 'downloadAuditRequestCount')
      if (candidate.skipReason) return classifyDownloadInspection(candidate, { skipped: true })
      try {
        let inspection = await requestDownloadHeaders(api, candidate.requestedUrl, 'HEAD')
        if (inspection.statusCode === 405 || inspection.statusCode === 403 || inspection.statusCode === 0) {
          inspection = await requestDownloadHeaders(api, candidate.requestedUrl, 'GET')
          inspection.usedGetFallback = true
        }
        return classifyDownloadInspection(candidate, inspection)
      } catch (error) {
        return classifyDownloadInspection(candidate, { error: error instanceof Error ? error.message : 'download-audit-failed' })
      }
    })

    return { items, meta: createDownloadAuditMeta(items, { candidateCount: candidates.length }) }
  } finally {
    await api.dispose()
  }
}

export function createDownloadAuditCandidates(linkItems = [], targetUrl = '') {
  const merged = new Map()
  ;(Array.isArray(linkItems) ? linkItems : []).forEach((item, index) => {
    const candidate = normalizeDownloadAuditCandidate(item, targetUrl, index)
    if (!candidate) return
    const dedupeKey = candidate.skipReason ? `${candidate.category}:${candidate.rawHref || candidate.requestedUrl || candidate.selector || index}` : candidate.requestedUrl
    const existing = merged.get(dedupeKey)
    if (existing) {
      existing.sourceCount += 1
      existing.sources.push({ label: candidate.label, selector: candidate.selector, requestedUrl: candidate.requestedUrl || candidate.rawHref || '' })
      return
    }
    merged.set(dedupeKey, {
      ...candidate,
      sourceCount: 1,
      sources: [{ label: candidate.label, selector: candidate.selector, requestedUrl: candidate.requestedUrl || candidate.rawHref || '' }],
    })
  })
  return Array.from(merged.values())
}

export function classifyDownloadInspection(candidate = {}, inspection = {}) {
  if (candidate.skipReason || inspection.skipped === true) {
    return {
      ...candidate,
      status: 'info',
      note: candidate.skipReason || '정적 HTTP 검사로 확인할 수 없는 다운로드입니다.',
      owner: 'UID팀',
    }
  }

  const errorText = String(inspection.error || '')
  if (errorText) {
    const category = /timeout/i.test(errorText) ? 'timeout' : 'network-failed'
    return {
      ...candidate,
      status: 'error',
      category,
      note: category === 'timeout' ? '다운로드 리소스 응답 시간이 초과되었습니다.' : '다운로드 리소스 요청에 실패했습니다.',
      issues: [errorText],
      owner: '개발팀',
    }
  }

  const statusCode = Number(inspection.statusCode || 0)
  const contentType = String(inspection.contentType || '').toLowerCase()
  const contentLength = inspection.contentLength === null || inspection.contentLength === undefined || inspection.contentLength === '' ? Number.NaN : Number(inspection.contentLength)
  const contentDisposition = String(inspection.contentDisposition || '')
  const issues = []
  let status = 'ok'
  let owner = 'UID팀'

  if (statusCode >= 500 || statusCode === 404 || statusCode === 410) {
    status = 'error'
    owner = statusCode >= 500 ? '개발팀' : 'UID팀'
    issues.push(statusCode >= 500 ? '다운로드 서버가 오류를 반환했습니다.' : '다운로드 리소스를 찾을 수 없습니다.')
  } else if (statusCode === 429) {
    status = 'warn'
    issues.push('요청 제한 응답이라 자동 검사에서 다운로드 가능 여부를 확정하지 못했습니다.')
  } else if (statusCode === 401 || statusCode === 403) {
    status = 'warn'
    issues.push('인증 또는 권한이 필요해 다운로드를 완전히 확인하지 못했습니다.')
  }

  if (contentLength === 0) {
    const method = String(inspection.method || '').toUpperCase()
    if (method === 'HEAD' && /attachment/i.test(contentDisposition)) {
      status = status === 'error' ? 'error' : 'warn'
      issues.push('HEAD 응답의 Content-Length가 0이라 실제 파일 크기 확인이 필요합니다.')
    } else {
      status = 'error'
      issues.push('0 byte 다운로드 응답이 감지되었습니다.')
    }
  }

  if (hasDownloadMimeMismatch(candidate.expectedExtension, contentType)) {
    status = status === 'error' ? 'error' : 'warn'
    issues.push('파일 확장자와 Content-Type이 명확하게 일치하지 않습니다.')
  }

  if (candidate.expectedExtension === 'pdf' && /text\/html/.test(contentType)) {
    status = 'error'
    issues.push('PDF 링크가 HTML 응답을 반환했습니다.')
  }

  if (!contentType && inspection.usedGetFallback === true) {
    status = status === 'error' ? 'error' : 'warn'
    issues.push('HEAD 미지원으로 제한된 GET fallback만 수행했습니다.')
  }

  return {
    ...candidate,
    status,
    category: status === 'error' ? 'download-error' : status === 'warn' ? 'needs-review' : 'download-ok',
    note: issues[0] || '다운로드 링크의 응답 상태와 주요 헤더를 확인했습니다.',
    issues,
    owner,
    statusCode,
    finalUrl: inspection.finalUrl || candidate.requestedUrl,
    contentType,
    contentLength: Number.isFinite(contentLength) ? contentLength : null,
    contentDisposition,
    filename: inspection.filename || candidate.inferredFilename,
    usedGetFallback: inspection.usedGetFallback === true,
  }
}

function createDownloadAuditMeta(items = [], context = {}) {
  const sourceItems = Array.isArray(items) ? items : []
  return {
    candidateCount: Number(context.candidateCount || sourceItems.length || 0),
    inspectedCount: sourceItems.length,
    okCount: sourceItems.filter((item) => item.status === 'ok').length,
    warningCount: sourceItems.filter((item) => item.status === 'warn').length,
    errorCount: sourceItems.filter((item) => item.status === 'error').length,
    skippedCount: sourceItems.filter((item) => item.status === 'info').length,
    noTarget: context.noTarget === true || sourceItems.length === 0,
  }
}

function normalizeDownloadAuditCandidate(item = {}, targetUrl = '', index = 0) {
  const rawHref = String(item.href || item.url || '').trim()
  const resolvedUrl = resolveDownloadUrl(rawHref, targetUrl)
  const label = String(item.label || item.text || item.ariaLabel || `다운로드 ${index + 1}`).trim() || `다운로드 ${index + 1}`
  const selector = String(item.selector || '')
  const downloadAttribute = String(item.download || item.downloadAttribute || '').trim()
  const method = String(item.method || item.formMethod || '').toUpperCase()
  if (!rawHref && !downloadAttribute) return null

  if (method && method !== 'GET') {
    return {
      auditId: `download-${index + 1}`,
      label,
      selector,
      category: 'skipped',
      requestedUrl: resolvedUrl,
      rawHref,
      skipReason: 'POST 또는 form submit 기반 다운로드는 자동 실행하지 않았습니다.',
      expectedExtension: getDownloadExtension(downloadAttribute || rawHref),
      inferredFilename: inferDownloadFilename(downloadAttribute, rawHref),
    }
  }

  const specialScheme = getSpecialDownloadScheme(rawHref)
  if (specialScheme) {
    return {
      auditId: `download-${index + 1}`,
      label,
      selector,
      category: 'skipped',
      requestedUrl: resolvedUrl,
      rawHref,
      skipReason: specialScheme === 'blob' || specialScheme === 'data'
        ? '브라우저 런타임에서 생성된 다운로드라 정적 HTTP 검사로 확인하지 않았습니다.'
        : '정적 다운로드 HTTP 검사 대상이 아닌 링크입니다.',
      expectedExtension: getDownloadExtension(downloadAttribute || rawHref),
      inferredFilename: inferDownloadFilename(downloadAttribute, rawHref),
    }
  }

  const expectedExtension = getDownloadExtension(downloadAttribute || rawHref)
  const looksLikeDownload = Boolean(downloadAttribute || expectedExtension || looksLikeDownloadLabel(label))
  if (!resolvedUrl || !looksLikeDownload) return null

  return {
    auditId: `download-${index + 1}`,
    label,
    selector,
    category: expectedExtension || 'download',
    requestedUrl: resolvedUrl,
    rawHref,
    downloadAttribute,
    expectedExtension,
    inferredFilename: inferDownloadFilename(downloadAttribute, resolvedUrl),
  }
}

async function requestDownloadHeaders(api, url, method = 'HEAD') {
  const response = await api.fetch(url, {
    method,
    timeout: DOWNLOAD_AUDIT_TIMEOUT_MS,
    maxRedirects: MAX_DOWNLOAD_REDIRECTS,
    headers: method === 'GET' ? { Range: 'bytes=0-0' } : undefined,
  })

  try {
    const headers = response.headers()
    const contentType = headers['content-type'] || headers['Content-Type'] || ''
    const contentDisposition = headers['content-disposition'] || headers['Content-Disposition'] || ''
    const contentLength = Number(headers['content-length'] || headers['Content-Length'])
    return {
      statusCode: response.status(),
      method,
      finalUrl: typeof response.url === 'function' ? response.url() : url,
      contentType,
      contentDisposition,
      contentLength: Number.isFinite(contentLength) ? contentLength : null,
      filename: extractFilenameFromDisposition(contentDisposition),
    }
  } finally {
    await response.dispose()
  }
}

function resolveDownloadUrl(value, targetUrl = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  try {
    return new URL(text, targetUrl).toString()
  } catch {
    return ''
  }
}

function getSpecialDownloadScheme(value = '') {
  const text = String(value || '').trim().toLowerCase()
  if (text.startsWith('blob:')) return 'blob'
  if (text.startsWith('data:')) return 'data'
  if (text.startsWith('javascript:')) return 'javascript'
  if (text.startsWith('mailto:')) return 'mailto'
  if (text.startsWith('tel:')) return 'tel'
  return ''
}

function getDownloadExtension(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  const clean = text.split('?')[0].split('#')[0]
  const match = clean.match(/\.([a-z0-9]{1,8})$/i)
  if (!match) return ''
  const extension = match[1].toLowerCase()
  return DOWNLOAD_EXTENSIONS.has(extension) ? extension : ''
}

function inferDownloadFilename(downloadAttribute = '', value = '') {
  const explicit = String(downloadAttribute || '').trim()
  if (explicit) return explicit
  const text = String(value || '').trim().split('?')[0].split('#')[0]
  const parts = text.split('/')
  return parts[parts.length - 1] || ''
}

function extractFilenameFromDisposition(value = '') {
  const text = String(value || '')
  const match = text.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i)
  return match ? decodeURIComponent(match[1].replace(/"/g, '').trim()) : ''
}

function looksLikeDownloadLabel(value = '') {
  return /download|pdf|zip|파일|다운로드|문서|브로슈어|카탈로그/i.test(String(value || ''))
}

function hasDownloadMimeMismatch(expectedExtension = '', contentType = '') {
  if (!expectedExtension || !contentType) return false
  if (/application\/octet-stream/i.test(contentType)) return false
  if (expectedExtension === 'pdf') return !/application\/pdf/i.test(contentType)
  if (['xls', 'xlsx'].includes(expectedExtension)) return !/sheet|excel|spreadsheet|octet-stream/i.test(contentType)
  if (['doc', 'docx'].includes(expectedExtension)) return !/word|document|octet-stream/i.test(contentType)
  if (['ppt', 'pptx'].includes(expectedExtension)) return !/presentation|powerpoint|octet-stream/i.test(contentType)
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(expectedExtension)) return !/image\//i.test(contentType)
  if (expectedExtension === 'csv') return !/csv|plain|octet-stream/i.test(contentType)
  if (expectedExtension === 'json') return !/json|octet-stream/i.test(contentType)
  if (expectedExtension === 'xml') return !/xml|octet-stream/i.test(contentType)
  if (expectedExtension === 'zip') return !/zip|compressed|octet-stream/i.test(contentType)
  if (expectedExtension === 'txt') return !/plain|octet-stream/i.test(contentType)
  return false
}

async function mapWithLimit(items, limit, mapper) {
  const results = []
  let index = 0

  async function worker() {
    while (index < items.length) {
      const currentIndex = index
      index += 1
      results[currentIndex] = await mapper(items[currentIndex])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

function incrementAuditCount(instrumentation, key) {
  if (!instrumentation || typeof instrumentation !== 'object') return
  instrumentation[key] = Number(instrumentation[key] || 0) + 1
}

export const DOWNLOAD_AUDIT_TEST_ONLY = {
  createDownloadAuditMeta,
  getDownloadExtension,
  hasDownloadMimeMismatch,
  normalizeDownloadAuditCandidate,
}

export function assertDownloadAuditSourceSafety() {
  const source = fs.readFileSync(new URL('./techDownloadAudit.js', import.meta.url), 'utf8')
  return !/saveAs\(|download\.path\(|acceptDownloads\s*:/i.test(source)
}
