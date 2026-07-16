const URLLESS_UI_CONTROL_PATTERN = /\b(tab|tabpanel|accordion|modal|dialog|drawer|carousel|slider|swiper|pagination|prev|previous|next|play|pause|mute|unmute|volume|close|dismiss|menu|hamburger|toggle|scroll|top|search|filter|sort|submit|reset)\b/i
const URLLESS_UI_CONTROL_KO_PATTERN = /(닫기|이전|다음|재생|정지|음소거|메뉴|탭|토글|검색|필터|정렬|맨 위|위로|제출|초기화|열기|접기|펼치기)/i
const NAVIGATION_ACTION_PATTERN = /\b(link|navigation|nav|cta|button|btn|more|details|learn|view|read|shop|buy|apply|reserve|book|download|contact|start|continue|go|quote|estimate)\b/i
const NAVIGATION_ACTION_KO_PATTERN = /(바로가기|더보기|더 보기|더 알아보기|자세히|상세|보기|구매|신청|예약|문의|상담|견적|다운로드|이동|계속)/i
const SOCIAL_HOST_PATTERN = /(^|\.)(facebook|instagram|twitter|x|linkedin|youtube|youtu|tiktok|pinterest|threads)\./i
const DOWNLOAD_EXT_PATTERN = /\.(pdf|zip|xlsx?|docx?|pptx?|hwp|csv|jpg|jpeg|png|gif|webp|svg)(?:[?#]|$)/i

export function createTechLinkAudit(targets = [], baseUrl = '') {
  const sourceTargets = Array.isArray(targets) ? targets.filter((target) => target && typeof target === 'object') : []
  const resultItems = []
  const requestableByUrl = new Map()
  const missingHrefLinks = []
  const uiControlsWithoutUrl = []

  sourceTargets.forEach((target, index) => {
    const candidate = normalizeCandidate(target, index + 1, baseUrl)
    if (!candidate) return

    if (candidate.classification === 'requestable') {
      const existing = requestableByUrl.get(candidate.normalizedUrl)
      if (existing) {
        existing.sourceCount += 1
        existing.sources.push(createSource(candidate))
        return
      }
      requestableByUrl.set(candidate.normalizedUrl, {
        ...candidate,
        sourceCount: 1,
        sources: [createSource(candidate)],
      })
      return
    }

    const item = createClassifiedResultItem(candidate)
    if (!item) return
    resultItems.push(item)
    if (item.category === 'missing-navigation-url') missingHrefLinks.push(item)
    if (item.category === 'url-not-required-ui-control') uiControlsWithoutUrl.push(item)
  })

  const requestableLinks = Array.from(requestableByUrl.values()).sort(sortAuditLinks)
  const meta = {
    discoveredLinkCount: sourceTargets.length,
    uniqueRequestUrlCount: requestableLinks.length,
    dedupedLinkCount: requestableLinks.reduce((count, item) => count + Math.max(0, item.sourceCount - 1), 0),
    skippedLinkCount: resultItems.filter((item) => item.status === 'ok' && item.requestSkipped).length,
    missingNavigationHrefCount: missingHrefLinks.length,
    uiControlWithoutUrlCount: uiControlsWithoutUrl.length,
  }

  return {
    requestableLinks,
    staticLinkResults: resultItems.sort(sortAuditLinks),
    missingHrefLinks,
    uiControlsWithoutUrl,
    meta,
  }
}

export function mergeTechLinkAuditResults(audit = {}, checkedLinks = []) {
  const checked = Array.isArray(checkedLinks) ? checkedLinks : []
  const staticResults = Array.isArray(audit.staticLinkResults) ? audit.staticLinkResults : []
  const links = staticResults.concat(checked).sort(sortAuditLinks)
  const status4xxCount = links.filter((link) => Number(link.statusCode) >= 400 && Number(link.statusCode) < 500).length
  const status5xxCount = links.filter((link) => Number(link.statusCode) >= 500).length
  const timeoutCount = links.filter((link) => link.category === 'timeout' || /timeout|timed out/i.test(`${link.note || ''} ${link.requestError || ''}`)).length

  return {
    links,
    meta: {
      ...(audit.meta || {}),
      actualHttpRequestCount: checked.length,
      normalLinkCount: links.filter((link) => link.status === 'ok').length,
      warningLinkCount: links.filter((link) => link.status === 'warn').length,
      errorLinkCount: links.filter((link) => link.status === 'error').length,
      redirectCount: checked.filter((link) => link.redirected).length,
      status4xxCount,
      status5xxCount,
      timeoutCount,
    },
  }
}

export function normalizeCheckedLinkResult(link = {}, response = {}) {
  const statusCode = Number(response.statusCode || 0) || null
  const finalUrl = textOf(response.finalUrl) || link.url || ''
  const redirected = Boolean(finalUrl && link.url && finalUrl !== link.url) || statusCode >= 300 && statusCode < 400
  return {
    ...link,
    finalUrl,
    statusCode,
    status: getLinkStatus(statusCode),
    category: statusCode >= 500 ? 'http-5xx' : statusCode >= 400 ? 'http-4xx' : redirected ? 'redirect' : 'http-ok',
    note: getLinkNote(statusCode),
    redirected,
  }
}

export function createCheckedLinkFailure(link = {}, error) {
  const message = error instanceof Error ? error.message : '응답 상태 확인 실패'
  return {
    ...link,
    statusCode: null,
    status: 'error',
    category: /timeout|timed out/i.test(message) ? 'timeout' : 'request-failed',
    note: sanitizeMessage(message),
    requestError: sanitizeMessage(message),
  }
}

export function getLinkStatus(statusCode) {
  if (!statusCode) return 'error'
  if (statusCode >= 400) return 'error'
  if (statusCode >= 300) return 'warn'
  return 'ok'
}

export function getLinkNote(statusCode) {
  if (!statusCode) return '응답 상태 확인 실패'
  if (statusCode === 404) return '404 Not Found'
  if (statusCode >= 500) return '5xx 서버 오류'
  if (statusCode >= 400) return '4xx 응답 확인 필요'
  if (statusCode >= 300) return '리다이렉트 후 응답 확인 완료'
  return '정상 응답'
}

function normalizeCandidate(target, order, baseUrl) {
  const href = textOf(target.href)
  const resolvedUrl = textOf(target.url) || resolveHttpUrl(href, baseUrl)
  const hrefState = getHrefState(target, href, resolvedUrl)
  const text = createTargetText(target)
  const isUiControl = isUrlOptionalUiControl(target, text)
  const isNavigation = looksLikeNavigationAction(target, text)
  const base = {
    index: Number(target.index || order),
    order,
    kind: textOf(target.kind || target.tagName) || 'element',
    label: textOf(target.label || target.text || target.ariaLabel) || `Link ${order}`,
    text: textOf(target.text),
    ariaLabel: textOf(target.ariaLabel),
    href,
    hrefState,
    technicalTerm: getHrefTechnicalTerm(hrefState),
    easyExplanation: getHrefEasyExplanation(hrefState),
    url: resolvedUrl,
    normalizedUrl: normalizeRequestUrl(resolvedUrl),
    selector: textOf(target.selector),
    domPath: textOf(target.domPath),
    section: textOf(target.section),
    role: textOf(target.role),
    type: textOf(target.type),
    target: textOf(target.target),
    rel: textOf(target.rel),
    boundingBox: target.boundingBox || null,
    y: target.y,
    intent: isUiControl ? 'ui-control' : isNavigation ? 'navigation' : 'unknown',
  }

  if (isUiControl && !resolvedUrl) return { ...base, hrefState: 'UI-control-no-url-required', technicalTerm: 'URL이 필요 없는 UI 제어', easyExplanation: getHrefEasyExplanation('UI-control-no-url-required'), classification: 'ui-control-without-url' }
  if (!href && !resolvedUrl) return { ...base, classification: isNavigation ? 'missing-navigation-url' : 'unknown-clickable-without-url' }
  if (isSamePageAnchor(href, resolvedUrl, baseUrl)) return { ...base, classification: isNavigation ? 'same-page-anchor-navigation' : 'same-page-anchor' }
  if (isPseudoUrl(href)) return { ...base, classification: isNavigation ? 'pseudo-navigation-url' : 'pseudo-ui-url' }
  if (isSpecialScheme(href)) return { ...base, classification: 'special-scheme' }
  if (isDownloadLink(href, resolvedUrl)) return { ...base, classification: 'download' }
  if (isSocialUrl(resolvedUrl)) return { ...base, classification: 'external-social' }
  if (resolvedUrl) return { ...base, classification: 'requestable' }
  return { ...base, classification: isNavigation ? 'missing-navigation-url' : 'unknown-clickable-without-url' }
}

function createClassifiedResultItem(candidate) {
  const base = {
    ...candidate,
    sourceCount: 1,
    sources: [createSource(candidate)],
    statusCode: null,
    requestSkipped: true,
  }

  if (candidate.classification === 'missing-navigation-url') {
    return { ...base, status: 'error', category: 'missing-navigation-url', note: '이동 목적의 클릭 요소에 URL 또는 action 근거가 없습니다.' }
  }
  if (candidate.classification === 'same-page-anchor-navigation') {
    return { ...base, status: 'warn', category: 'same-page-anchor', note: '이동 목적 CTA가 페이지 내부 anchor 또는 #로 연결되어 확인이 필요합니다.' }
  }
  if (candidate.classification === 'pseudo-navigation-url') {
    return { ...base, status: 'warn', category: 'javascript-pseudo-url', note: '이동 목적 CTA가 javascript pseudo URL로 연결되어 확인이 필요합니다.' }
  }
  if (candidate.classification === 'unknown-clickable-without-url') {
    return { ...base, status: 'warn', category: 'unknown-clickable-without-url', note: 'URL이 필요한지 의도 확인이 필요한 클릭 요소입니다.' }
  }
  if (candidate.classification === 'pseudo-ui-url') {
    return { ...base, status: 'ok', category: 'url-not-required-ui-control', note: '페이지 내부 UI 제어로 보이며 URL 오류로 분류하지 않았습니다.' }
  }
  if (candidate.classification === 'ui-control-without-url') {
    return { ...base, status: 'ok', category: 'url-not-required-ui-control', note: '모달, 탭, 아코디언 등 URL이 필요 없는 UI control로 분류했습니다.' }
  }
  if (candidate.classification === 'special-scheme') {
    return { ...base, status: 'ok', category: 'special-scheme', note: '전화, 메일 등 브라우저 외부 앱으로 연결되는 링크로 실제 HTTP 검사를 제외했습니다.' }
  }
  if (candidate.classification === 'download') {
    return { ...base, status: 'ok', category: 'download', note: '파일 다운로드 링크로 실제 HTTP 검사를 별도 분류했습니다.' }
  }
  if (candidate.classification === 'external-social') {
    return { ...base, status: 'ok', category: 'external-social', note: '명확한 외부 소셜 링크로 실제 HTTP 검사를 제외했습니다.' }
  }
  if (candidate.classification === 'same-page-anchor') {
    return { ...base, status: 'ok', category: 'same-page-anchor', note: '같은 페이지 내부 이동 anchor입니다.' }
  }
  return null
}

function getHrefState(target = {}, href, resolvedUrl) {
  const hasHrefAttribute = target.hasHrefAttribute === true || Boolean(href)
  if (!hasHrefAttribute && !resolvedUrl) return 'missing-href'
  if (hasHrefAttribute && !href && !resolvedUrl) return 'empty-href'
  if (/^#/.test(href)) return 'hash-only'
  if (/^javascript:/i.test(href)) return 'javascript-pseudo-url'
  if (resolvedUrl) return 'valid-url'
  return 'ambiguous-action'
}

function getHrefTechnicalTerm(state) {
  if (state === 'missing-href') return 'href 누락'
  if (state === 'empty-href') return '빈 href'
  if (state === 'hash-only') return '페이지 내부 앵커'
  if (state === 'javascript-pseudo-url') return 'javascript:void(0)'
  if (state === 'valid-url') return 'valid-url'
  if (state === 'UI-control-no-url-required') return 'URL이 필요 없는 UI 제어'
  return 'ambiguous-action'
}

function getHrefEasyExplanation(state) {
  if (state === 'missing-href') return 'href는 링크가 이동할 주소를 지정하는 HTML 속성입니다. href가 없으면 사용자가 눌러도 다른 페이지로 이동하지 않을 수 있습니다.'
  if (state === 'empty-href') return 'href 속성은 있지만 값이 비어 있습니다. 이동 목적 버튼이라면 목적지 URL이 누락됐을 수 있습니다.'
  if (state === 'hash-only') return '같은 페이지 내부 위치로 이동하는 앵커입니다. 이동 CTA라면 실제 목적지 URL이 필요한지 확인해야 합니다.'
  if (state === 'javascript-pseudo-url') return '링크 주소 대신 JavaScript 동작만 지정된 상태입니다. 실제 이동 버튼이라면 목적지 URL이 누락됐을 수 있습니다.'
  if (state === 'valid-url') return 'HTTP 또는 상대 URL 목적지가 확인된 링크입니다.'
  if (state === 'UI-control-no-url-required') return '모달, 탭, 아코디언처럼 페이지 내부 상태를 바꾸는 UI 제어는 이동 URL이 없어도 정상일 수 있습니다.'
  return '클릭 이벤트나 커스텀 동작이 있어 목적 확인이 필요합니다.'
}

function createSource(candidate) {
  return {
    label: candidate.label,
    href: candidate.href,
    selector: candidate.selector,
    domPath: candidate.domPath,
    section: candidate.section,
    kind: candidate.kind,
  }
}

function sortAuditLinks(first, second) {
  const rankDiff = getAuditPriority(first) - getAuditPriority(second)
  if (rankDiff !== 0) return rankDiff
  return Number(first.order || first.index || 0) - Number(second.order || second.index || 0)
}

function getAuditPriority(link = {}) {
  if (link.category === 'request-failed') return 0
  if (link.category === 'timeout') return 1
  if (Number(link.statusCode) >= 500) return 2
  if (Number(link.statusCode) >= 400) return 3
  if (link.category === 'missing-navigation-url') return 4
  if (link.category === 'same-page-anchor') return 5
  if (link.category === 'javascript-pseudo-url') return 6
  if (link.category === 'unknown-clickable-without-url') return 7
  if (link.category === 'redirect') return 8
  if (link.status === 'warn') return 9
  return 10
}

function isUrlOptionalUiControl(target = {}, text = '') {
  if (textOf(target.ariaControls) || textOf(target.ariaExpanded) || textOf(target.dataTarget) || textOf(target.dataToggle)) return true
  if (textOf(target.role).toLowerCase() === 'tab') return true
  if (/submit|reset/i.test(textOf(target.type))) return true
  return URLLESS_UI_CONTROL_PATTERN.test(text) || URLLESS_UI_CONTROL_KO_PATTERN.test(text)
}

function looksLikeNavigationAction(target = {}, text = '') {
  if (String(target.kind || '').toLowerCase() === 'a' && /\S/.test(`${target.label || ''}${target.text || ''}${target.ariaLabel || ''}`)) return true
  return NAVIGATION_ACTION_PATTERN.test(text) || NAVIGATION_ACTION_KO_PATTERN.test(text)
}

function createTargetText(target = {}) {
  return [
    target.kind,
    target.role,
    target.type,
    target.label,
    target.text,
    target.ariaLabel,
    target.href,
    target.selector,
    target.domPath,
    target.section,
  ].map(textOf).filter(Boolean).join(' ').toLowerCase()
}

function resolveHttpUrl(href, baseUrl) {
  try {
    const url = href ? new URL(href, baseUrl) : null
    if (!url || !/^https?:$/.test(url.protocol)) return ''
    return url.href
  } catch {
    return ''
  }
}

function normalizeRequestUrl(url) {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    return parsed.href
  } catch {
    return textOf(url)
  }
}

function isSamePageAnchor(href, resolvedUrl, baseUrl) {
  if (!href || !href.startsWith('#')) return false
  try {
    const resolved = new URL(resolvedUrl || href, baseUrl)
    const base = new URL(baseUrl)
    resolved.hash = ''
    base.hash = ''
    return resolved.href === base.href
  } catch {
    return href.startsWith('#')
  }
}

function isPseudoUrl(href) {
  return /^javascript:/i.test(textOf(href)) || /^void\(/i.test(textOf(href))
}

function isSpecialScheme(href) {
  return /^(mailto|tel|sms):/i.test(textOf(href))
}

function isDownloadLink(href, url) {
  return DOWNLOAD_EXT_PATTERN.test(textOf(href)) || DOWNLOAD_EXT_PATTERN.test(textOf(url))
}

function isSocialUrl(url) {
  try {
    return SOCIAL_HOST_PATTERN.test(new URL(url).hostname)
  } catch {
    return false
  }
}

function sanitizeMessage(value) {
  return String(value || '').split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 2).join(' ')
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim()
}
