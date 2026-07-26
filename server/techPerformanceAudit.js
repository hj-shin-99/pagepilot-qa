const MAX_PERFORMANCE_ITEMS = 8
const MAX_RESOURCE_EVIDENCE = 6
const MAX_DUPLICATE_EVIDENCE = 5
const MAX_RENDER_BLOCKING_EVIDENCE = 5
const LARGE_SCRIPT_BYTES = 300 * 1024
const LARGE_STYLESHEET_BYTES = 120 * 1024
const LARGE_IMAGE_BYTES = 500 * 1024
const LARGE_FONT_BYTES = 180 * 1024
const LARGE_MEDIA_BYTES = 1024 * 1024
const LARGE_OTHER_BYTES = 250 * 1024
const LARGE_TOTAL_TRANSFER_BYTES = 5 * 1024 * 1024
const SLOW_FIRST_PARTY_MS = 1500
const SLOW_THIRD_PARTY_MS = 3000
const SMALL_TEXT_RESOURCE_BYTES = 1024
const LONG_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const RENDER_BLOCKING_SCRIPT_BYTES = 60 * 1024
const RENDER_BLOCKING_TOTAL_BYTES = 180 * 1024
const STATIC_DUPLICATE_TYPES = new Set(['script', 'stylesheet', 'image', 'font'])
const TEXT_RESOURCE_TYPES = new Set(['document', 'script', 'stylesheet', 'fetch', 'xhr', 'other'])

export function auditPerformanceResources(targetUrl, snapshot = {}, resourceResponses = []) {
  const evidence = collectPerformanceEvidence(targetUrl, snapshot, resourceResponses)
  if (evidence.resources.length === 0 && evidence.failedResources.length === 0) {
    return { items: [], meta: createPerformanceAuditMeta([], { candidateCount: 0, noTarget: true }) }
  }

  const items = normalizePerformanceResults([
    createOverallResourceItem(evidence),
    createLargeResourceItem(evidence),
    createSlowResourceItem(evidence),
    createCompressionItem(evidence),
    createCachePolicyItem(evidence),
    createDuplicateRequestItem(evidence),
    createRenderBlockingItem(evidence),
    createFailedResourceItem(evidence),
  ].filter(Boolean).slice(0, MAX_PERFORMANCE_ITEMS))

  return {
    items,
    meta: createPerformanceAuditMeta(items, { candidateCount: evidence.resources.length + evidence.failedResources.length }),
  }
}

export function collectPerformanceEvidence(targetUrl, snapshot = {}, resourceResponses = []) {
  const origin = safeOrigin(targetUrl)
  const performanceInfo = snapshot?.performanceInfo && typeof snapshot.performanceInfo === 'object' ? snapshot.performanceInfo : {}
  const responseIndex = createResponseIndex(resourceResponses)
  const resources = arrayOfObjects(performanceInfo.resources).map((entry) => normalizePerformanceResourceEntry(entry, responseIndex, origin)).filter(Boolean)
  const renderBlockingCandidates = arrayOfObjects(performanceInfo.renderBlockingCandidates).map((entry) => normalizeRenderBlockingCandidate(entry, responseIndex, origin)).filter(Boolean)
  const failedResources = createFailedResourceEvidence(resourceResponses, origin)
  const totals = resources.reduce((accumulator, resource) => {
    const transferBytes = Number(resource.transferBytes || 0)
    const encodedBytes = Number(resource.encodedBytes || 0)
    accumulator.totalTransferBytes += transferBytes > 0 ? transferBytes : 0
    accumulator.totalEncodedBytes += encodedBytes > 0 ? encodedBytes : 0
    accumulator.byType[resource.resourceType] = (accumulator.byType[resource.resourceType] || 0) + transferBytes
    return accumulator
  }, { totalTransferBytes: 0, totalEncodedBytes: 0, byType: {} })

  return {
    origin,
    resources,
    renderBlockingCandidates,
    failedResources,
    totals,
  }
}

export function normalizePerformanceResults(items = []) {
  return arrayOfObjects(items).sort((first, second) => getStatusRank(first.status) - getStatusRank(second.status) || String(first.label || '').localeCompare(String(second.label || '')))
}

export function createPerformanceAuditMeta(items = [], context = {}) {
  const sourceItems = arrayOfObjects(items)
  const candidateCount = Number(context.candidateCount || sourceItems.length || 0)
  return {
    candidateCount,
    inspectedCount: sourceItems.length,
    okCount: sourceItems.filter((item) => item.status === 'ok').length,
    warningCount: sourceItems.filter((item) => item.status === 'warn').length,
    errorCount: sourceItems.filter((item) => item.status === 'error').length,
    skippedCount: sourceItems.filter((item) => item.status === 'info').length,
    noTarget: context.noTarget === true || (candidateCount === 0 && sourceItems.length === 0),
  }
}

function createOverallResourceItem(evidence = {}) {
  const resourceCount = evidence.resources.length
  const transferBytes = Number(evidence.totals?.totalTransferBytes || 0)
  const lines = Object.entries(evidence.totals?.byType || {})
    .filter(([, bytes]) => Number(bytes || 0) > 0)
    .sort((first, second) => Number(second[1]) - Number(first[1]))
    .slice(0, MAX_RESOURCE_EVIDENCE)
    .map(([type, bytes]) => `${type} ${formatBytes(bytes)}`)
  return {
    auditId: 'performance-overview',
    label: '전체 리소스',
    title: '전체 리소스',
    category: 'overview',
    type: 'performance',
    status: transferBytes > LARGE_TOTAL_TRANSFER_BYTES ? 'warn' : 'ok',
    note: resourceCount > 0 ? `리소스 ${resourceCount}개 · 총 전송 ${formatBytes(transferBytes)}` : '리소스 전송량을 계산할 수 없었습니다.',
    issues: lines,
    owner: 'UID팀',
    sourceCount: resourceCount,
    contentLength: transferBytes || null,
    technicalTerm: 'resource-summary',
  }
}

function createLargeResourceItem(evidence = {}) {
  const largeResources = evidence.resources
    .filter((resource) => Number(resource.encodedBytes || resource.transferBytes || 0) >= getLargeResourceThreshold(resource.resourceType))
    .sort((first, second) => Number(second.encodedBytes || second.transferBytes || 0) - Number(first.encodedBytes || first.transferBytes || 0))
  return {
    auditId: 'performance-large-resource',
    label: '대형 리소스',
    title: '대형 리소스',
    category: 'large-resource',
    type: 'performance',
    status: largeResources.length > 0 ? 'warn' : 'ok',
    note: largeResources.length > 0 ? `기준을 넘는 리소스 ${largeResources.length}개가 있습니다.` : '명확히 큰 리소스는 감지되지 않았습니다.',
    issues: largeResources.slice(0, MAX_RESOURCE_EVIDENCE).map((resource) => `${resource.resourceType} · ${formatBytes(resource.encodedBytes || resource.transferBytes)} · ${resource.url}`),
    owner: 'UID팀',
    sourceCount: largeResources.length,
    technicalTerm: 'large-resource',
  }
}

function createSlowResourceItem(evidence = {}) {
  const slowResources = evidence.resources
    .filter((resource) => Number(resource.durationMs || 0) >= (resource.party === 'third-party' ? SLOW_THIRD_PARTY_MS : SLOW_FIRST_PARTY_MS))
    .sort((first, second) => Number(second.durationMs || 0) - Number(first.durationMs || 0))
  return {
    auditId: 'performance-slow-resource',
    label: '느린 리소스',
    title: '느린 리소스',
    category: 'slow-resource',
    type: 'performance',
    status: slowResources.length > 0 ? 'warn' : 'ok',
    note: slowResources.length > 0 ? `응답 시간이 긴 리소스 ${slowResources.length}개가 있습니다.` : '특별히 느린 리소스는 감지되지 않았습니다.',
    issues: slowResources.slice(0, MAX_RESOURCE_EVIDENCE).map((resource) => `${resource.party} · ${Math.round(resource.durationMs)}ms · ${resource.url}`),
    owner: '개발팀',
    sourceCount: slowResources.length,
    technicalTerm: 'slow-resource',
  }
}

function createCompressionItem(evidence = {}) {
  const missingCompression = evidence.resources
    .filter((resource) => TEXT_RESOURCE_TYPES.has(resource.resourceType))
    .filter((resource) => Number(resource.encodedBytes || resource.transferBytes || 0) > SMALL_TEXT_RESOURCE_BYTES)
    .filter((resource) => !/\b(br|gzip|deflate|zstd)\b/i.test(String(resource.contentEncoding || '')))
    .filter((resource) => !/image\//i.test(String(resource.contentType || '')))
    .sort((first, second) => Number(second.encodedBytes || second.transferBytes || 0) - Number(first.encodedBytes || first.transferBytes || 0))
  return {
    auditId: 'performance-compression',
    label: '압축',
    title: '압축',
    category: 'compression',
    type: 'performance',
    status: missingCompression.length > 0 ? 'warn' : 'ok',
    note: missingCompression.length > 0 ? `압축이 명확하지 않은 텍스트 리소스 ${missingCompression.length}개가 있습니다.` : '텍스트 기반 리소스의 압축 상태가 전반적으로 양호합니다.',
    issues: missingCompression.slice(0, MAX_RESOURCE_EVIDENCE).map((resource) => `${resource.resourceType} · ${formatBytes(resource.encodedBytes || resource.transferBytes)} · ${resource.url}`),
    owner: '개발팀',
    sourceCount: missingCompression.length,
    technicalTerm: 'content-encoding',
  }
}

function createCachePolicyItem(evidence = {}) {
  const uncachedStaticResources = evidence.resources
    .filter((resource) => STATIC_DUPLICATE_TYPES.has(resource.resourceType))
    .filter((resource) => resource.party === 'first-party')
    .filter((resource) => looksFingerprintedAsset(resource.url) || resource.resourceType === 'font')
    .filter((resource) => !hasStrongCachePolicy(resource))
  return {
    auditId: 'performance-cache-policy',
    label: '캐시 정책',
    title: '캐시 정책',
    category: 'cache-policy',
    type: 'performance',
    status: uncachedStaticResources.length > 0 ? 'warn' : 'ok',
    note: uncachedStaticResources.length > 0 ? `정적 asset 캐시 정책 확인이 필요한 리소스 ${uncachedStaticResources.length}개가 있습니다.` : '정적 리소스의 캐시 정책이 전반적으로 양호합니다.',
    issues: uncachedStaticResources.slice(0, MAX_RESOURCE_EVIDENCE).map((resource) => `${resource.resourceType} · cache-control ${resource.cacheControl || '없음'} · ${resource.url}`),
    owner: '개발팀',
    sourceCount: uncachedStaticResources.length,
    technicalTerm: 'cache-control',
  }
}

function createDuplicateRequestItem(evidence = {}) {
  const groups = new Map()
  evidence.resources.forEach((resource) => {
    if (!STATIC_DUPLICATE_TYPES.has(resource.resourceType)) return
    if (resource.method !== 'GET') return
    if (!resource.url || resource.statusCode === 304 || resource.statusCode === 206) return
    const key = resource.normalizedUrl
    const entry = groups.get(key) || { ...resource, requestCount: 0, totalTransferBytes: 0 }
    entry.requestCount += 1
    entry.totalTransferBytes += Number(resource.transferBytes || 0)
    groups.set(key, entry)
  })
  const duplicates = Array.from(groups.values()).filter((entry) => entry.requestCount > 1).sort((first, second) => second.requestCount - first.requestCount)
  return {
    auditId: 'performance-duplicate-request',
    label: '중복 요청',
    title: '중복 요청',
    category: 'duplicate-request',
    type: 'performance',
    status: duplicates.length > 0 ? 'warn' : 'ok',
    note: duplicates.length > 0 ? `중복 요청으로 보이는 정적 리소스 ${duplicates.length}개가 있습니다.` : '명확한 정적 리소스 중복 요청은 감지되지 않았습니다.',
    issues: duplicates.slice(0, MAX_DUPLICATE_EVIDENCE).map((resource) => `${resource.resourceType} · ${resource.requestCount}회 · ${formatBytes(resource.totalTransferBytes)} · ${resource.url}`),
    owner: '개발팀',
    sourceCount: duplicates.length,
    technicalTerm: 'duplicate-request',
  }
}

function createRenderBlockingItem(evidence = {}) {
  const blockingScripts = evidence.renderBlockingCandidates.filter((candidate) => candidate.kind === 'script' && candidate.blocking === true)
  const blockingStylesheets = evidence.renderBlockingCandidates.filter((candidate) => candidate.kind === 'stylesheet')
  const totalBlockingBytes = blockingScripts.reduce((sum, candidate) => sum + getCandidateBlockingBytes(candidate, evidence.resources), 0)
  const shouldWarn = blockingScripts.some((candidate) => getCandidateBlockingBytes(candidate, evidence.resources) >= RENDER_BLOCKING_SCRIPT_BYTES)
    || (blockingScripts.length > 1 && totalBlockingBytes >= RENDER_BLOCKING_TOTAL_BYTES)
  const evidenceLines = blockingScripts.slice(0, MAX_RENDER_BLOCKING_EVIDENCE).map((candidate) => `head script · ${formatBytes(getCandidateBlockingBytes(candidate, evidence.resources))} · ${candidate.url}`)
    .concat(blockingStylesheets.slice(0, Math.max(0, MAX_RENDER_BLOCKING_EVIDENCE - blockingScripts.length)).map((candidate) => `stylesheet · ${candidate.url}`))
  return {
    auditId: 'performance-render-blocking',
    label: '렌더링 차단 가능 리소스',
    title: '렌더링 차단 가능 리소스',
    category: 'render-blocking',
    type: 'performance',
    status: shouldWarn ? 'warn' : 'ok',
    note: shouldWarn ? 'head의 동기 script 또는 초기 stylesheet 구성을 확인해 주세요.' : '명확한 렌더링 차단 가능 리소스 경고는 감지되지 않았습니다.',
    issues: evidenceLines,
    owner: '개발팀',
    sourceCount: blockingScripts.length + blockingStylesheets.length,
    technicalTerm: 'render-blocking-resource',
  }
}

function getCandidateBlockingBytes(candidate = {}, resources = []) {
  const directBytes = Number(candidate.encodedBytes || candidate.transferBytes || 0)
  if (directBytes > 0) return directBytes
  const match = arrayOfObjects(resources).find((resource) => resource.normalizedUrl === candidate.normalizedUrl)
  return Number(match?.encodedBytes || match?.transferBytes || 0)
}

function createFailedResourceItem(evidence = {}) {
  const failedResources = evidence.failedResources.filter((resource) => resource.party === 'first-party' && ['document', 'script', 'stylesheet'].includes(resource.resourceType))
  return {
    auditId: 'performance-failed-resource',
    label: '실패 리소스',
    title: '실패 리소스',
    category: 'failed-resource',
    type: 'performance',
    status: failedResources.length > 0 ? 'error' : 'ok',
    note: failedResources.length > 0 ? `핵심 first-party 리소스 실패 ${failedResources.length}개가 있습니다.` : '핵심 first-party 리소스 실패는 감지되지 않았습니다.',
    issues: failedResources.slice(0, MAX_RESOURCE_EVIDENCE).map((resource) => `${resource.resourceType} · HTTP ${resource.statusCode || resource.message || 'failed'} · ${resource.url}`),
    owner: '개발팀',
    sourceCount: failedResources.length,
    technicalTerm: 'failed-resource',
  }
}

function createResponseIndex(resourceResponses = []) {
  return arrayOfObjects(resourceResponses).reduce((index, response) => {
    const key = `${String(response.method || 'GET').toUpperCase()} ${normalizeResourceUrl(response.url)}`
    if (!key.trim()) return index
    const list = index.get(key) || []
    list.push(response)
    index.set(key, list)
    return index
  }, new Map())
}

function normalizePerformanceResourceEntry(entry = {}, responseIndex = new Map(), origin = '') {
  const url = String(entry.url || entry.name || '').trim()
  if (!/^https?:/i.test(url)) return null
  const normalizedUrl = normalizeResourceUrl(url)
  const responseRecords = responseIndex.get(`GET ${normalizedUrl}`) || []
  const response = responseRecords[0] || {}
  const resourceType = normalizeResourceType(entry.resourceType || entry.initiatorType)
  return {
    url,
    normalizedUrl,
    method: String(response.method || 'GET').toUpperCase(),
    resourceType,
    party: isSameOrigin(url, origin) ? 'first-party' : 'third-party',
    transferBytes: getPositiveNumber(entry.transferSize || response.transferSize),
    encodedBytes: getPositiveNumber(entry.encodedBodySize || response.encodedBodySize || response.contentLength),
    decodedBytes: getPositiveNumber(entry.decodedBodySize || response.decodedBodySize),
    durationMs: getPositiveNumber(entry.duration),
    renderBlockingStatus: String(entry.renderBlockingStatus || '').trim(),
    statusCode: Number(response.statusCode || 0) || 0,
    contentType: String(response.contentType || '').trim().toLowerCase(),
    contentEncoding: String(response.contentEncoding || '').trim().toLowerCase(),
    cacheControl: String(response.cacheControl || '').trim().toLowerCase(),
    expires: String(response.expires || '').trim(),
    etag: String(response.etag || '').trim(),
    lastModified: String(response.lastModified || '').trim(),
  }
}

function normalizeRenderBlockingCandidate(entry = {}, responseIndex = new Map(), origin = '') {
  const url = String(entry.url || '').trim()
  if (!/^https?:/i.test(url)) return null
  const response = (responseIndex.get(`GET ${normalizeResourceUrl(url)}`) || [])[0] || {}
  return {
    url,
    normalizedUrl: normalizeResourceUrl(url),
    kind: String(entry.kind || '').trim(),
    blocking: entry.blocking === true,
    party: isSameOrigin(url, origin) ? 'first-party' : 'third-party',
    transferBytes: getPositiveNumber(response.transferSize),
    encodedBytes: getPositiveNumber(response.encodedBodySize || response.contentLength),
    statusCode: Number(response.statusCode || 0) || 0,
  }
}

function createFailedResourceEvidence(resourceResponses = [], origin = '') {
  return arrayOfObjects(resourceResponses)
    .filter((response) => Number(response.statusCode || 0) >= 400 || String(response.failureMessage || '').trim())
    .map((response) => ({
      url: String(response.url || '').trim(),
      resourceType: normalizeResourceType(response.resourceType),
      statusCode: Number(response.statusCode || 0) || 0,
      message: String(response.failureMessage || '').trim(),
      party: isSameOrigin(String(response.url || '').trim(), origin) ? 'first-party' : 'third-party',
    }))
}

function normalizeResourceType(value = '') {
  const type = String(value || '').trim().toLowerCase()
  if (type === 'script') return 'script'
  if (type === 'stylesheet' || type === 'css' || type === 'link') return 'stylesheet'
  if (type === 'image' || type === 'img') return 'image'
  if (type === 'font') return 'font'
  if (type === 'media' || type === 'video' || type === 'audio') return 'media'
  if (type === 'fetch' || type === 'xmlhttprequest' || type === 'xhr') return type === 'xhr' ? 'xhr' : 'fetch'
  if (type === 'navigation' || type === 'document') return 'document'
  return type || 'other'
}

function getLargeResourceThreshold(resourceType = '') {
  if (resourceType === 'script') return LARGE_SCRIPT_BYTES
  if (resourceType === 'stylesheet') return LARGE_STYLESHEET_BYTES
  if (resourceType === 'image') return LARGE_IMAGE_BYTES
  if (resourceType === 'font') return LARGE_FONT_BYTES
  if (resourceType === 'media') return LARGE_MEDIA_BYTES
  return LARGE_OTHER_BYTES
}

function hasStrongCachePolicy(resource = {}) {
  const cacheControl = String(resource.cacheControl || '').toLowerCase()
  if (/immutable/.test(cacheControl)) return true
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/)
  if (maxAgeMatch && Number(maxAgeMatch[1]) >= LONG_CACHE_MAX_AGE_SECONDS) return true
  if (resource.etag || resource.lastModified || resource.expires) return true
  return false
}

function looksFingerprintedAsset(url = '') {
  return /[-._][a-f0-9]{8,}(?=\.)/i.test(String(url || ''))
}

function normalizeResourceUrl(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  try {
    const url = new URL(text)
    return `${url.origin.toLowerCase()}${url.pathname}${url.search}`
  } catch {
    return text
  }
}

function isSameOrigin(url = '', origin = '') {
  return Boolean(origin) && safeOrigin(url) === origin
}

function safeOrigin(value = '') {
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

function getPositiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function formatBytes(value) {
  const size = Number(value || 0)
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

function getStatusRank(status = '') {
  if (status === 'error') return 0
  if (status === 'warn') return 1
  if (status === 'ok') return 2
  return 3
}

function arrayOfObjects(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

export const PERFORMANCE_AUDIT_TEST_ONLY = {
  collectPerformanceEvidence,
  createPerformanceAuditMeta,
  hasStrongCachePolicy,
  looksFingerprintedAsset,
  normalizePerformanceResourceEntry,
  normalizeResourceType,
}
