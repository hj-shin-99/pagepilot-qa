import { request as playwrightRequest } from 'playwright'

const SEO_AUDIT_TIMEOUT_MS = 4000
const SEO_MAX_REDIRECTS = 2
const MAX_SEO_ISSUES = 6
const MAX_JSON_LD_SCRIPTS = 10
const TITLE_WARNING_MIN = 10
const TITLE_WARNING_MAX = 70
const DESCRIPTION_WARNING_MIN = 50
const DESCRIPTION_WARNING_MAX = 180

export async function auditSeoReadiness(targetUrl, snapshot = {}, resourceResponses = [], instrumentation = null, apiFactory = () => playwrightRequest.newContext({ ignoreHTTPSErrors: true })) {
  const evidence = collectSeoEvidence(targetUrl, snapshot, resourceResponses)
  const api = await apiFactory()
  try {
    const robotsResult = await inspectRobotsTxt(api, evidence.origin, instrumentation)
    const sitemapResult = await inspectSitemapXml(api, evidence.origin, robotsResult, instrumentation)
    const items = normalizeSeoResults([
      createSearchMetaItem(evidence),
      createCanonicalItem(evidence),
      createIndexingDirectiveItem(evidence),
      createSocialMetaItem(evidence),
      createHreflangItem(evidence),
      createStructuredDataItem(evidence),
      createRobotsTxtItem(robotsResult),
      createSitemapItem(sitemapResult),
    ])
    const candidateCount = evidence.hasTarget ? items.length : 0
    return {
      items,
      meta: createSeoAuditMeta(items, { candidateCount, noTarget: !evidence.hasTarget }),
    }
  } finally {
    await api.dispose()
  }
}

export function collectSeoEvidence(targetUrl, snapshot = {}, resourceResponses = []) {
  const seoInfo = snapshot?.seoInfo && typeof snapshot.seoInfo === 'object' ? snapshot.seoInfo : {}
  const origin = safeOrigin(targetUrl)
  const documentResponse = arrayOfObjects(resourceResponses).find((response) => normalizeResourceType(response.resourceType) === 'document') || {}
  const titleText = String(seoInfo.titleText || '').trim()
  const descriptionItems = arrayOfStrings(seoInfo.metaDescriptions)
  return {
    origin,
    targetUrl,
    hasTarget: Boolean(origin) || Boolean(titleText) || descriptionItems.length > 0,
    titleText,
    titleCount: Number(seoInfo.titleCount || 0),
    metaDescriptions: descriptionItems,
    canonicalLinks: arrayOfStrings(seoInfo.canonicalLinks),
    robotsMetas: arrayOfObjects(seoInfo.robotsMetas),
    htmlLang: String(seoInfo.htmlLang || '').trim(),
    og: seoInfo.og && typeof seoInfo.og === 'object' ? normalizeMetaValueMap(seoInfo.og) : {},
    twitter: seoInfo.twitter && typeof seoInfo.twitter === 'object' ? normalizeMetaValueMap(seoInfo.twitter) : {},
    hreflangs: arrayOfObjects(seoInfo.hreflangs),
    jsonLdScripts: arrayOfStrings(seoInfo.jsonLdScripts).slice(0, MAX_JSON_LD_SCRIPTS),
    h1Texts: arrayOfStrings(seoInfo.h1Texts),
    xRobotsTag: String(documentResponse.xRobotsTag || '').trim(),
    documentContentType: String(documentResponse.contentType || '').trim().toLowerCase(),
  }
}

export function normalizeSeoResults(items = []) {
  return arrayOfObjects(items).sort((first, second) => getStatusRank(first.status) - getStatusRank(second.status) || String(first.label || '').localeCompare(String(second.label || '')))
}

export function createSeoAuditMeta(items = [], context = {}) {
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

function createSearchMetaItem(evidence = {}) {
  const issues = []
  let status = 'ok'
  if (!evidence.titleText) {
    issues.push('title이 비어 있거나 수집되지 않았습니다.')
    status = isPublicPageEvidence(evidence) ? 'error' : 'warn'
  }
  if (evidence.titleCount > 1) issues.push(`title 요소가 ${evidence.titleCount}개 감지되었습니다.`)
  if (evidence.titleText && (evidence.titleText.length < TITLE_WARNING_MIN || evidence.titleText.length > TITLE_WARNING_MAX)) issues.push(`title 길이 ${evidence.titleText.length}자가 검색 결과 표시 기준과 다를 수 있습니다.`)
  if (evidence.metaDescriptions.length === 0) issues.push('meta description이 없습니다.')
  if (evidence.metaDescriptions.length > 1) issues.push(`meta description이 ${evidence.metaDescriptions.length}개 감지되었습니다.`)
  const description = evidence.metaDescriptions[0] || ''
  if (description && (description.length < DESCRIPTION_WARNING_MIN || description.length > DESCRIPTION_WARNING_MAX)) issues.push(`meta description 길이 ${description.length}자가 검색 결과 표시 기준과 다를 수 있습니다.`)
  if (description && evidence.titleText && normalizeComparableText(description) === normalizeComparableText(evidence.titleText)) issues.push('title과 meta description이 동일합니다.')
  if (evidence.h1Texts.length === 0) issues.push('H1이 없습니다.')
  if (evidence.h1Texts.length > 1) issues.push(`H1이 ${evidence.h1Texts.length}개 감지되었습니다.`)
  return createSeoItem({
    auditId: 'seo-search-meta',
    label: '검색 메타',
    category: 'search-meta',
    status: status === 'error' ? 'error' : issues.length > 0 ? 'warn' : 'ok',
    note: issues[0] || 'title, description, H1 구성이 전반적으로 양호합니다.',
    issues,
    owner: 'UID팀',
    titleLength: evidence.titleText.length,
    descriptionLength: description.length,
    sourceCount: evidence.titleCount + evidence.metaDescriptions.length + evidence.h1Texts.length,
    titleText: evidence.titleText,
    metaDescription: description,
    h1Text: evidence.h1Texts[0] || '',
    technicalTerm: 'search-meta',
  })
}

function isPublicPageEvidence(evidence = {}) {
  const directives = evidence.robotsMetas.flatMap((entry) => parseDirectiveTokens(entry.content)).concat(parseDirectiveTokens(evidence.xRobotsTag))
  const blockedByRobots = hasDirective(directives, 'noindex') || hasDirective(directives, 'none')
  if (blockedByRobots) return false
  return evidence.metaDescriptions.length > 0 || evidence.h1Texts.length > 0
}

function createCanonicalItem(evidence = {}) {
  const canonicals = evidence.canonicalLinks.filter(Boolean).map((value) => resolveCanonicalUrl(value, evidence.targetUrl))
  const uniqueCanonicals = Array.from(new Set(canonicals.filter(Boolean)))
  const issues = []
  let status = 'ok'
  let canonicalUrl = uniqueCanonicals[0] || ''
  if (uniqueCanonicals.length === 0) {
    status = 'warn'
    issues.push('canonical 링크가 없습니다.')
  }
  if (uniqueCanonicals.length > 1) {
    status = 'error'
    issues.push(`canonical 링크가 ${uniqueCanonicals.length}개로 서로 충돌할 수 있습니다.`)
  }
  if (canonicalUrl) {
    try {
      const resolved = new URL(canonicalUrl, evidence.targetUrl)
      canonicalUrl = resolved.toString()
      if (resolved.hash) {
        status = status === 'error' ? 'error' : 'warn'
        issues.push('canonical URL에 fragment가 포함되어 있습니다.')
      }
      if (safeOrigin(canonicalUrl) && safeOrigin(canonicalUrl) !== evidence.origin) {
        status = status === 'error' ? 'error' : 'warn'
        issues.push('canonical이 현재 origin과 달라 의도를 확인해 주세요.')
      }
    } catch {
      status = 'error'
      issues.push('canonical URL 형식을 해석하지 못했습니다.')
    }
  }
  return createSeoItem({
    auditId: 'seo-canonical',
    label: 'Canonical',
    category: 'canonical',
    status,
    note: issues[0] || 'canonical 구성이 전반적으로 양호합니다.',
    issues,
    owner: 'UID팀',
    canonicalUrl,
    sourceCount: uniqueCanonicals.length,
    technicalTerm: 'canonical-link',
  })
}

function resolveCanonicalUrl(value = '', baseUrl = '') {
  try {
    return new URL(String(value || '').trim(), baseUrl).toString()
  } catch {
    return String(value || '').trim()
  }
}

function createIndexingDirectiveItem(evidence = {}) {
  const metaDirectiveEntries = evidence.robotsMetas.map((entry) => ({ ...entry, directives: parseDirectiveTokens(entry.content) }))
  const xRobotsDirectives = parseDirectiveTokens(evidence.xRobotsTag)
  const issues = []
  let status = 'ok'

  if (metaDirectiveEntries.some((entry) => hasDirective(entry.directives, 'noindex') || hasDirective(entry.directives, 'none'))) {
    status = 'warn'
    issues.push('meta robots에 noindex 또는 none 지시가 포함되어 있습니다.')
  }
  if (xRobotsDirectives.length > 0 && (hasDirective(xRobotsDirectives, 'noindex') || hasDirective(xRobotsDirectives, 'none'))) {
    status = 'warn'
    issues.push('X-Robots-Tag에 noindex 또는 none 지시가 포함되어 있습니다.')
  }
  if (metaDirectiveEntries.some((entry) => hasConflictingDirectives(entry.directives))) {
    status = 'error'
    issues.push('meta robots 지시가 서로 충돌합니다.')
  }
  if (xRobotsDirectives.length > 0 && hasConflictingDirectives(xRobotsDirectives)) {
    status = 'error'
    issues.push('X-Robots-Tag 지시가 서로 충돌합니다.')
  }
  if (metaDirectiveEntries.length > 0 && xRobotsDirectives.length > 0 && hasCrossDirectiveConflict(metaDirectiveEntries[0].directives, xRobotsDirectives)) {
    status = 'error'
    issues.push('meta robots와 X-Robots-Tag 지시가 서로 충돌합니다.')
  }
  if (!evidence.htmlLang) {
    status = status === 'error' ? 'error' : 'warn'
    issues.push('html lang 속성이 없습니다.')
  } else if (!isValidLangCode(evidence.htmlLang)) {
    status = status === 'error' ? 'error' : 'warn'
    issues.push('html lang 형식이 표준 언어 코드와 다를 수 있습니다.')
  }

  return createSeoItem({
    auditId: 'seo-indexing',
    label: '인덱싱 지시',
    category: 'indexing',
    status,
    note: issues[0] || 'robots와 lang 구성이 전반적으로 양호합니다.',
    issues,
    owner: 'UID팀',
    robotsMeta: metaDirectiveEntries.map((entry) => `${entry.name}:${entry.content}`).join(' | '),
    xRobotsTag: evidence.xRobotsTag,
    htmlLang: evidence.htmlLang,
    sourceCount: metaDirectiveEntries.length + (evidence.xRobotsTag ? 1 : 0),
    technicalTerm: 'indexing-directive',
  })
}

function createSocialMetaItem(evidence = {}) {
  const ogMissing = ['title', 'description', 'image', 'url', 'type'].filter((key) => arrayOfStrings(evidence.og[key]).length === 0)
  const twitterMissing = ['card', 'title', 'description', 'image'].filter((key) => arrayOfStrings(evidence.twitter[key]).length === 0)
  const hasAnyOg = Object.values(evidence.og).some((value) => arrayOfStrings(value).length > 0)
  const hasAnyTwitter = Object.values(evidence.twitter).some((value) => arrayOfStrings(value).length > 0)
  const issues = []
  let status = 'ok'

  if (hasAnyOg && ogMissing.length > 0) {
    status = 'warn'
    issues.push(`Open Graph 메타 중 ${ogMissing.join(', ')} 값이 없습니다.`)
  }
  if (hasAnyTwitter && twitterMissing.length > 0) {
    status = status === 'error' ? 'error' : 'warn'
    issues.push(`Twitter Card 메타 중 ${twitterMissing.join(', ')} 값이 없습니다.`)
  }
  if (!hasAnyOg && !hasAnyTwitter) {
    status = 'info'
    issues.push('OG/Twitter 소셜 메타가 명시되지 않았습니다.')
  }

  return createSeoItem({
    auditId: 'seo-social-meta',
    label: '소셜 메타',
    category: 'social-meta',
    status,
    note: issues[0] || 'OG/Twitter 메타 구성이 전반적으로 양호합니다.',
    issues,
    owner: 'UID팀',
    ogTitle: arrayOfStrings(evidence.og.title)[0] || '',
    ogDescription: arrayOfStrings(evidence.og.description)[0] || '',
    ogImage: arrayOfStrings(evidence.og.image)[0] || '',
    twitterCard: arrayOfStrings(evidence.twitter.card)[0] || '',
    sourceCount: countMetaValues(evidence.og) + countMetaValues(evidence.twitter),
    technicalTerm: 'social-meta',
  })
}

function createHreflangItem(evidence = {}) {
  const issues = []
  const seen = new Set()
  arrayOfObjects(evidence.hreflangs).forEach((entry) => {
    const code = String(entry.hreflang || '').trim()
    if (!isValidLangCode(code)) issues.push(`hreflang 형식 확인 필요: ${code || '빈 값'}`)
    if (code && seen.has(code.toLowerCase())) issues.push(`중복 hreflang이 감지되었습니다: ${code}`)
    seen.add(code.toLowerCase())
    if (!entry.href) issues.push(`hreflang ${code || 'entry'}에 href가 없습니다.`)
  })
  const status = evidence.hreflangs.length === 0 ? 'info' : issues.length > 0 ? 'warn' : 'ok'
  return createSeoItem({
    auditId: 'seo-hreflang',
    label: '다국어 링크',
    category: 'hreflang',
    status,
    note: issues[0] || (evidence.hreflangs.length === 0 ? 'hreflang 링크가 없어도 자동 오류로 보지 않았습니다.' : 'hreflang 구성이 전반적으로 양호합니다.'),
    issues,
    owner: 'UID팀',
    sourceCount: evidence.hreflangs.length,
    technicalTerm: 'hreflang',
  })
}

function createStructuredDataItem(evidence = {}) {
  const issues = []
  const scripts = evidence.jsonLdScripts.slice(0, MAX_JSON_LD_SCRIPTS)
  if (scripts.length === 0) {
    return createSeoItem({
      auditId: 'seo-structured-data',
      label: '구조화 데이터',
      category: 'structured-data',
      status: 'info',
      note: 'JSON-LD 구조화 데이터가 없습니다.',
      issues: ['JSON-LD 구조화 데이터가 없습니다.'],
      owner: 'UID팀',
      sourceCount: 0,
      technicalTerm: 'json-ld',
    })
  }

  scripts.forEach((text, index) => {
    try {
      const parsed = JSON.parse(text)
      const nodes = Array.isArray(parsed) ? parsed : [parsed]
      nodes.forEach((node) => {
        if (!node || typeof node !== 'object') return
        if (!node['@context']) issues.push(`JSON-LD ${index + 1}에 @context가 없습니다.`)
        if (!node['@type']) issues.push(`JSON-LD ${index + 1}에 @type이 없습니다.`)
      })
    } catch {
      issues.push(`JSON-LD ${index + 1} 파싱에 실패했습니다.`)
    }
  })

  const status = issues.some((issue) => issue.includes('파싱')) ? 'error' : issues.length > 0 ? 'warn' : 'ok'
  return createSeoItem({
    auditId: 'seo-structured-data',
    label: '구조화 데이터',
    category: 'structured-data',
    status,
    note: issues[0] || 'JSON-LD 구조가 기본적으로 정상입니다.',
    issues,
    owner: 'UID팀',
    sourceCount: scripts.length,
    technicalTerm: 'json-ld',
  })
}

async function inspectRobotsTxt(api, origin = '', instrumentation = null) {
  if (!origin) return { status: 'info', note: 'robots.txt 대상 origin이 없습니다.', issues: [], sourceCount: 0, technicalTerm: 'robots-txt', noTarget: true }
  incrementAuditCount(instrumentation, 'seoAuditRequestCount')
  try {
    const response = await api.fetch(`${origin}/robots.txt`, {
      method: 'GET',
      timeout: SEO_AUDIT_TIMEOUT_MS,
      maxRedirects: SEO_MAX_REDIRECTS,
    })
    try {
      const headers = response.headers()
      const body = await response.text().catch(() => '')
      const lines = String(body || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      const sitemapDirectives = lines.filter((line) => /^sitemap\s*:/i.test(line)).map((line) => line.replace(/^sitemap\s*:/i, '').trim())
      const hasDisallowAll = lines.some((line) => /^disallow\s*:\s*\/\s*$/i.test(line))
      const issues = []
      let status = 'ok'
      if (response.status() === 404) {
        status = 'info'
        issues.push('robots.txt가 404 응답을 반환했습니다.')
      } else if (hasDisallowAll) {
        status = 'warn'
        issues.push('robots.txt에 전체 경로 차단으로 보이는 Disallow: / 지시가 있습니다.')
      } else if (!body.trim()) {
        status = 'warn'
        issues.push('robots.txt 응답 본문이 비어 있습니다.')
      }
      return {
        status,
        note: issues[0] || 'robots.txt를 확인했습니다.',
        issues: issues.slice(0, MAX_SEO_ISSUES),
        owner: 'UID팀',
        statusCode: response.status(),
        contentType: headers['content-type'] || headers['Content-Type'] || '',
        sourceCount: sitemapDirectives.length,
        technicalTerm: 'robots-txt',
        sitemapDirectives,
        preview: lines.slice(0, 4).join(' | ').slice(0, 240),
      }
    } finally {
      await response.dispose()
    }
  } catch (error) {
    return {
      status: 'warn',
      note: 'robots.txt를 완전히 확인하지 못했습니다.',
      issues: [error instanceof Error ? error.message : 'robots request failed'],
      owner: 'UID팀',
      technicalTerm: 'robots-txt',
      sourceCount: 0,
      preview: '',
    }
  }
}

async function inspectSitemapXml(api, origin = '', robotsResult = {}, instrumentation = null) {
  if (!origin) return { status: 'info', note: 'sitemap 대상 origin이 없습니다.', issues: [], sourceCount: 0, technicalTerm: 'sitemap-xml', noTarget: true }
  const sitemapUrl = resolveSitemapUrl(origin, robotsResult.sitemapDirectives)
  incrementAuditCount(instrumentation, 'seoAuditRequestCount')
  try {
    const response = await api.fetch(sitemapUrl, {
      method: 'GET',
      timeout: SEO_AUDIT_TIMEOUT_MS,
      maxRedirects: SEO_MAX_REDIRECTS,
    })
    try {
      const headers = response.headers()
      const body = await response.text().catch(() => '')
      const issues = []
      let status = 'ok'
      if (response.status() === 404) {
        status = 'info'
        issues.push('sitemap.xml이 404 응답을 반환했습니다.')
      } else if (!looksLikeXml(body, headers['content-type'] || headers['Content-Type'] || '')) {
        status = 'error'
        issues.push('sitemap 응답이 XML 형식으로 보이지 않습니다.')
      } else if (!/<(?:urlset|sitemapindex)\b/i.test(body)) {
        status = 'error'
        issues.push('sitemap XML의 루트가 urlset 또는 sitemapindex가 아닙니다.')
      }
      const urlCount = (body.match(/<url\b/gi) || []).length
      const sitemapCount = (body.match(/<sitemap\b/gi) || []).length
      return {
        status,
        note: issues[0] || 'sitemap.xml을 확인했습니다.',
        issues: issues.slice(0, MAX_SEO_ISSUES),
        owner: 'UID팀',
        statusCode: response.status(),
        contentType: headers['content-type'] || headers['Content-Type'] || '',
        sourceCount: urlCount || sitemapCount,
        technicalTerm: 'sitemap-xml',
        sitemapUrl,
        preview: String(body || '').replace(/\s+/g, ' ').trim().slice(0, 240),
      }
    } finally {
      await response.dispose()
    }
  } catch (error) {
    return {
      status: 'warn',
      note: 'sitemap.xml을 완전히 확인하지 못했습니다.',
      issues: [error instanceof Error ? error.message : 'sitemap request failed'],
      owner: 'UID팀',
      technicalTerm: 'sitemap-xml',
      sourceCount: 0,
      sitemapUrl,
      preview: '',
    }
  }
}

function createRobotsTxtItem(result = {}) {
  return createSeoItem({
    auditId: 'seo-robots-txt',
    label: 'robots.txt',
    category: 'robots-txt',
    status: result.status || 'info',
    note: result.note || 'robots.txt를 확인하지 않았습니다.',
    issues: arrayOfStrings(result.issues),
    owner: result.owner || 'UID팀',
    statusCode: result.statusCode,
    contentType: result.contentType,
    sourceCount: result.sourceCount,
    preview: result.preview,
    technicalTerm: result.technicalTerm || 'robots-txt',
  })
}

function createSitemapItem(result = {}) {
  return createSeoItem({
    auditId: 'seo-sitemap-xml',
    label: 'sitemap.xml',
    category: 'sitemap-xml',
    status: result.status || 'info',
    note: result.note || 'sitemap.xml을 확인하지 않았습니다.',
    issues: arrayOfStrings(result.issues),
    owner: result.owner || 'UID팀',
    statusCode: result.statusCode,
    contentType: result.contentType,
    sourceCount: result.sourceCount,
    preview: result.preview,
    finalUrl: result.sitemapUrl,
    technicalTerm: result.technicalTerm || 'sitemap-xml',
  })
}

function createSeoItem(item = {}) {
  return {
    title: item.label,
    type: 'seo',
    ...item,
  }
}

function resolveSitemapUrl(origin = '', sitemapDirectives = []) {
  const sameOriginDirective = arrayOfStrings(sitemapDirectives).find((value) => safeOrigin(value) === origin)
  if (sameOriginDirective) return sameOriginDirective
  return `${origin}/sitemap.xml`
}

function normalizeMetaValueMap(value = {}) {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, arrayOfStrings(entry)]))
}

function parseDirectiveTokens(value = '') {
  return String(value || '').split(',').map((token) => token.trim().toLowerCase()).filter(Boolean)
}

function hasDirective(tokens = [], value = '') {
  return tokens.includes(String(value || '').toLowerCase())
}

function hasConflictingDirectives(tokens = []) {
  return (hasDirective(tokens, 'index') && hasDirective(tokens, 'noindex'))
    || (hasDirective(tokens, 'follow') && hasDirective(tokens, 'nofollow'))
    || (hasDirective(tokens, 'none') && (hasDirective(tokens, 'index') || hasDirective(tokens, 'follow')))
}

function hasCrossDirectiveConflict(first = [], second = []) {
  return (hasDirective(first, 'index') && hasDirective(second, 'noindex'))
    || (hasDirective(first, 'noindex') && hasDirective(second, 'index'))
    || (hasDirective(first, 'follow') && hasDirective(second, 'nofollow'))
    || (hasDirective(first, 'nofollow') && hasDirective(second, 'follow'))
}

function isValidLangCode(value = '') {
  return /^(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})*|x-default)$/i.test(String(value || '').trim())
}

function looksLikeXml(body = '', contentType = '') {
  return /xml/i.test(String(contentType || '')) || /^\s*<\?xml|^\s*<(?:urlset|sitemapindex)\b/i.test(String(body || ''))
}

function normalizeComparableText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function normalizeResourceType(value = '') {
  const type = String(value || '').trim().toLowerCase()
  if (type === 'navigation') return 'document'
  return type
}

function safeOrigin(value = '') {
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

function incrementAuditCount(instrumentation, key) {
  if (!instrumentation || typeof instrumentation !== 'object') return
  instrumentation[key] = Number(instrumentation[key] || 0) + 1
}

function getStatusRank(status = '') {
  if (status === 'error') return 0
  if (status === 'warn') return 1
  if (status === 'ok') return 2
  return 3
}

function countMetaValues(value = {}) {
  return Object.values(value).reduce((sum, entries) => sum + arrayOfStrings(entries).length, 0)
}

function arrayOfObjects(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : []
}

export const SEO_AUDIT_TEST_ONLY = {
  collectSeoEvidence,
  createSeoAuditMeta,
  hasConflictingDirectives,
  hasCrossDirectiveConflict,
  isValidLangCode,
  looksLikeXml,
  parseDirectiveTokens,
  resolveSitemapUrl,
}
