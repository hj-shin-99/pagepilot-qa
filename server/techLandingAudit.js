import { classifyConsoleMessages } from './techConsoleAudit.js'

const LANDING_AUDIT_TIMEOUT_MS = 12000
const ACCESS_LIMIT_PATTERN = /(access denied|forbidden|not authorized|unauthorized|login|sign in|captcha|bot|blocked|denied|인증|로그인|접근 제한|차단)/i
const REDIRECT_FAILURE_PATTERN = /(redirect|too many redirects|ERR_TOO_MANY_REDIRECTS|maximum redirects)/i
const CRITICAL_CONSOLE_PATTERN = /(ReferenceError|TypeError|SyntaxError|RangeError|ChunkLoadError|Hydration|hydration|cannot read properties|failed to fetch dynamically imported module|route|router|render|mount|unhandled)/i

export async function auditLandingPages(browser, targetUrl, clickItems = [], instrumentation = null) {
  const candidates = createLandingAuditCandidates(clickItems, targetUrl)
  if (candidates.length === 0) {
    return {
      items: [],
      meta: createLandingAuditMeta([], { candidateCount: 0, targetUrl }),
    }
  }

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    serviceWorkers: 'block',
  })

  if (instrumentation && typeof instrumentation === 'object') {
    instrumentation.landingAuditPageCount = Number(instrumentation.landingAuditPageCount || 0) + candidates.length
  }

  try {
    await context.route('**/*', async (route) => {
      if (route.request().method().toUpperCase() === 'POST') {
        await route.abort('blockedbyclient')
        return
      }
      await route.continue()
    })

    const observed = []
    for (const candidate of candidates) {
      const page = await context.newPage()
      try {
        const observation = await inspectLandingPage(page, candidate.requestedUrl)
        observed.push(normalizeLandingAuditItem(candidate, observation))
      } finally {
        await page.close().catch(() => {})
      }
    }

    const items = mergeLandingAuditResults(observed)
    return {
      items,
      meta: createLandingAuditMeta(items, { candidateCount: candidates.length, targetUrl }),
    }
  } finally {
    await context.close()
  }
}

export function createLandingAuditCandidates(clickItems = [], targetUrl = '') {
  const sourceItems = Array.isArray(clickItems) ? clickItems : []
  const merged = new Map()

  sourceItems.forEach((item, index) => {
    const outcome = textOf(item.interactionOutcome)
    if (!['navigation', 'new-window'].includes(outcome)) return

    const requestedUrl = pickLandingAuditUrl(item, targetUrl)
    if (!isHttpUrl(requestedUrl)) return

    const key = normalizeLandingUrl(requestedUrl)
    const existing = merged.get(key)
    const source = createLandingSource(item, index)

    if (existing) {
      existing.sourceCount += 1
      existing.sources.push(source)
      existing.openedInNewWindow = existing.openedInNewWindow || outcome === 'new-window'
      return
    }

    merged.set(key, {
      auditId: `landing-${index + 1}-${key}`,
      requestedUrl,
      openedInNewWindow: outcome === 'new-window',
      sourceCount: 1,
      sources: [source],
    })
  })

  return Array.from(merged.values())
}

export function normalizeLandingAuditItem(candidate = {}, observation = {}) {
  const requestedUrl = textOf(candidate.requestedUrl)
  const finalUrl = textOf(observation.finalUrl || requestedUrl)
  const statusCode = Number(observation.statusCode || 0) || null
  const redirected = Boolean(finalUrl && requestedUrl && normalizeLandingUrl(finalUrl) !== normalizeLandingUrl(requestedUrl))
  const statusInfo = classifyLandingObservation({ ...observation, requestedUrl, finalUrl, statusCode, redirected }, candidate)

  return {
    auditId: candidate.auditId || '',
    label: candidate.sources?.[0]?.label || '랜딩 페이지',
    selector: candidate.sources?.[0]?.selector || '',
    section: candidate.sources?.[0]?.section || '',
    requestedUrl,
    finalUrl,
    statusCode,
    redirected,
    openedInNewWindow: candidate.openedInNewWindow === true,
    pageTitle: textOf(observation.pageTitle),
    hasTitle: Boolean(textOf(observation.pageTitle)),
    bodyChildCount: Number(observation.bodyChildCount || 0),
    visibleElementCount: Number(observation.visibleElementCount || 0),
    bodyTextLength: Number(observation.bodyTextLength || 0),
    hasMainContent: observation.hasMainContent === true,
    hasMedia: observation.hasMedia === true,
    browserErrorPage: observation.browserErrorPage === true,
    consoleErrorCount: Number(observation.consoleErrorCount || 0),
    pageErrorCount: Number(observation.pageErrorCount || 0),
    criticalConsoleErrorCount: Number(observation.criticalConsoleErrorCount || 0),
    advisoryConsoleErrorCount: Number(observation.advisoryConsoleErrorCount || 0),
    thirdPartyConsoleErrorCount: Number(observation.thirdPartyConsoleErrorCount || 0),
    unexpectedRedirect: observation.unexpectedRedirect === true,
    loadWarning: textOf(observation.loadWarning),
    navigationError: textOf(observation.navigationError),
    status: statusInfo.status,
    category: statusInfo.category,
    note: statusInfo.note,
    requestUrl: requestedUrl,
    sourceCount: Number(candidate.sourceCount || 0),
    sources: Array.isArray(candidate.sources) ? candidate.sources : [],
  }
}

export function classifyLandingObservation(observation = {}, candidate = {}) {
  const statusCode = Number(observation.statusCode || 0) || null
  const pageTitle = textOf(observation.pageTitle)
  const navigationError = textOf(observation.navigationError)
  const criticalConsoleErrorCount = Number(observation.criticalConsoleErrorCount || 0)
  const loadWarning = textOf(observation.loadWarning)
  const redirected = observation.redirected === true
  const blankScreenLikely = isBlankScreenLikely(observation)
  const weakContent = hasWeakContentSignal(observation)
  const hasContent = hasContentSignal(observation)
  const unexpectedRedirect = observation.unexpectedRedirect === true

  if (navigationError) {
    if (REDIRECT_FAILURE_PATTERN.test(navigationError)) {
      return { status: 'error', category: 'redirect-loop', note: '리다이렉트 루프 또는 과도한 리다이렉트로 랜딩 페이지를 열지 못했습니다.' }
    }
    if (ACCESS_LIMIT_PATTERN.test(navigationError) || statusCode === 401 || statusCode === 403) {
      return { status: 'warn', category: 'restricted', note: '로그인, 인증 또는 접근 제한으로 자동 확인이 제한될 수 있습니다.' }
    }
    if (/timeout|timed out/i.test(navigationError)) {
      return hasContent
        ? { status: 'warn', category: 'timeout', note: '랜딩 페이지 로딩 시간이 초과되었지만 일부 콘텐츠는 확인되었습니다.' }
        : { status: 'error', category: 'navigation-failed', note: '랜딩 페이지 로딩이 완료되지 않아 정상 화면을 확인하지 못했습니다.' }
    }
    return { status: 'error', category: 'navigation-failed', note: '랜딩 페이지를 열지 못했습니다.' }
  }

  if (statusCode === 401 || statusCode === 403) return { status: 'warn', category: 'restricted', note: '인증 또는 접근 제한으로 자동 검사 결과를 확정하기 어렵습니다.' }
  if (statusCode >= 500) return { status: 'error', category: 'http-5xx', note: '최종 랜딩 페이지가 5xx 서버 오류를 반환했습니다.' }
  if (statusCode >= 400) return { status: 'error', category: 'http-4xx', note: '최종 랜딩 페이지가 4xx 오류를 반환했습니다.' }
  if (observation.browserErrorPage === true) return { status: 'error', category: 'browser-error-page', note: '브라우저 기본 오류 페이지 또는 연결 실패 화면이 감지되었습니다.' }
  if (blankScreenLikely) return { status: 'error', category: 'blank-screen', note: '빈 화면 가능성이 높아 실제 랜딩 페이지 렌더링을 확인해야 합니다.' }
  if (criticalConsoleErrorCount > 0) return { status: 'error', category: 'critical-script-error', note: '페이지 렌더링 또는 라우팅에 영향을 줄 수 있는 치명적 스크립트 오류가 감지되었습니다.' }

  const warningReasons = []
  if (!pageTitle) warningReasons.push('title 누락')
  if (weakContent) warningReasons.push('콘텐츠가 적어 확인 필요')
  if (unexpectedRedirect) warningReasons.push('예기치 않은 최종 도메인 또는 프로토콜 이동')
  if (loadWarning && !hasContent) warningReasons.push('로딩 완료 대기 제한')

  if (warningReasons.length > 0) {
    return {
      status: 'warn',
      category: warningReasons.includes('예기치 않은 최종 도메인 또는 프로토콜 이동') ? 'unexpected-redirect-destination' : warningReasons.includes('title 누락') ? 'missing-title' : 'needs-review',
      note: warningReasons.join(' · '),
    }
  }

  return {
    status: 'ok',
    category: redirected ? candidate.openedInNewWindow ? 'new-window-redirect-ok' : 'landing-redirect-ok' : candidate.openedInNewWindow ? 'new-window-ok' : 'landing-ok',
    note: redirected
      ? '리다이렉트 후 최종 랜딩 페이지가 정상적으로 열렸습니다.'
      : candidate.openedInNewWindow ? '새 창 랜딩 페이지가 정상적으로 열렸습니다.' : '최종 랜딩 페이지가 정상적으로 열렸습니다.',
  }
}

export function mergeLandingAuditResults(items = []) {
  const sourceItems = Array.isArray(items) ? items : []
  const merged = new Map()

  sourceItems.forEach((item) => {
    const key = normalizeLandingUrl(item.finalUrl || item.requestedUrl)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...item })
      return
    }

    existing.sourceCount = Number(existing.sourceCount || 0) + Number(item.sourceCount || 0)
    existing.sources = (existing.sources || []).concat(item.sources || [])
    existing.openedInNewWindow = existing.openedInNewWindow || item.openedInNewWindow === true
    if (getStatusRank(item.status) < getStatusRank(existing.status)) {
      existing.status = item.status
      existing.category = item.category
      existing.note = item.note
    }
  })

  return Array.from(merged.values()).sort((first, second) => getStatusRank(first.status) - getStatusRank(second.status))
}

function createLandingAuditMeta(items = [], context = {}) {
  const sourceItems = Array.isArray(items) ? items : []
  return {
    targetUrl: textOf(context.targetUrl),
    candidateCount: Number(context.candidateCount || 0),
    inspectedCount: sourceItems.length,
    okCount: sourceItems.filter((item) => item.status === 'ok').length,
    warningCount: sourceItems.filter((item) => item.status === 'warn').length,
    errorCount: sourceItems.filter((item) => item.status === 'error').length,
    redirectCount: sourceItems.filter((item) => item.redirected === true).length,
    newWindowCount: sourceItems.filter((item) => item.openedInNewWindow === true).length,
    noTarget: Number(context.candidateCount || 0) === 0,
  }
}

async function inspectLandingPage(page, requestedUrl) {
  const consoleErrors = []
  const pageErrors = []
  const consoleMessages = []
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const location = message.location()
    consoleErrors.push(message.text())
    consoleMessages.push({
      eventType: 'console',
      level: 'error',
      source: location.url || 'inline-script',
      sourceUrl: location.url || '',
      lineNumber: location.lineNumber ?? null,
      columnNumber: location.columnNumber ?? null,
      message: message.text(),
    })
  })
  page.on('pageerror', (error) => {
    pageErrors.push(error.message || 'page error')
    consoleMessages.push({
      eventType: 'pageerror',
      level: 'error',
      source: 'pageerror',
      sourceUrl: '',
      message: error.message || 'page error',
      stack: error.stack || '',
    })
  })

  let response = null
  let navigationError = ''
  let loadWarning = ''

  try {
    response = await page.goto(requestedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: LANDING_AUDIT_TIMEOUT_MS,
    })
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch((error) => {
      loadWarning = sanitizeMessage(error.message)
    })
  } catch (error) {
    navigationError = sanitizeMessage(error instanceof Error ? error.message : 'landing page navigation failed')
  }

  const pageTitle = await page.title().catch(() => '')
  const finalUrl = page.url() || requestedUrl
  const consoleAudit = createLandingConsoleAudit(consoleMessages, finalUrl || requestedUrl)
  const metrics = await page.evaluate(() => {
    const body = document.body
    const bodyText = String(body?.innerText || '').replace(/\s+/g, ' ').trim()
    const all = Array.from(document.body?.querySelectorAll('*') || [])
    const visibleElementCount = all.filter((element) => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
    }).length
    const title = String(document.title || '').trim()
    const combinedText = `${title} ${bodyText}`.slice(0, 1200)
    return {
      bodyChildCount: Number(body?.children?.length || 0),
      bodyTextLength: bodyText.length,
      visibleElementCount,
      hasMainContent: Boolean(document.querySelector('main, [role="main"], article, section, #app, #root')),
      hasMedia: Boolean(document.querySelector('img, video, canvas, svg')),
      browserErrorPage: /this site can[’']?t be reached|page isn[’']?t working|err_|404|500|access denied|forbidden|not found|페이지를 찾을 수 없습니다|접근이 거부되었습니다/i.test(combinedText),
    }
  }).catch(() => ({ bodyChildCount: 0, bodyTextLength: 0, visibleElementCount: 0, hasMainContent: false, hasMedia: false, browserErrorPage: false }))
  const redirectInfo = analyzeRedirect(requestedUrl, finalUrl)

  return {
    requestedUrl,
    finalUrl,
    statusCode: response?.status() ?? null,
    pageTitle,
    navigationError,
    loadWarning,
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
    criticalConsoleErrorCount: consoleAudit.criticalCount,
    advisoryConsoleErrorCount: consoleAudit.advisoryCount,
    thirdPartyConsoleErrorCount: consoleAudit.thirdPartyCount,
    unexpectedRedirect: redirectInfo.unexpected,
    ...metrics,
  }
}

function pickLandingAuditUrl(item = {}, targetUrl = '') {
  const candidates = [
    item.landingUrl,
    item.finalUrl,
    item.url,
    item.href,
    item.safeClickResult?.popupUrl,
    item.safeClickResult?.after?.url,
  ]

  for (const candidate of candidates) {
    const resolved = resolveHttpUrl(candidate, targetUrl)
    if (resolved) return resolved
  }

  return ''
}

function createLandingSource(item = {}, index = 0) {
  return {
    auditId: item.auditId || `click-${index + 1}`,
    label: textOf(item.label || item.text || item.ariaLabel) || `클릭 요소 ${index + 1}`,
    selector: textOf(item.selector),
    section: textOf(item.section),
    interactionOutcome: textOf(item.interactionOutcome),
    requestedUrl: textOf(item.landingUrl || item.url || item.href),
  }
}

function hasWeakContentSignal(observation = {}) {
  if (isBlankScreenLikely(observation)) return false
  return observation.hasMainContent !== true && Number(observation.visibleElementCount || 0) <= 1 && Number(observation.bodyTextLength || 0) < 30 && observation.hasMedia !== true
}

function hasContentSignal(observation = {}) {
  return Number(observation.bodyChildCount || 0) > 0
    && (
      Number(observation.visibleElementCount || 0) > 0
      || Number(observation.bodyTextLength || 0) >= 10
      || observation.hasMedia === true
      || observation.hasMainContent === true
    )
}

function isBlankScreenLikely(observation = {}) {
  return Number(observation.bodyChildCount || 0) <= 1
    && Number(observation.visibleElementCount || 0) === 0
    && Number(observation.bodyTextLength || 0) < 10
    && observation.hasMedia !== true
}

function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function resolveHttpUrl(value, baseUrl = '') {
  try {
    const url = new URL(String(value || '').trim(), baseUrl || undefined)
    if (!/^https?:$/.test(url.protocol)) return ''
    return url.href
  } catch {
    return ''
  }
}

function normalizeLandingUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    url.hash = ''
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.href
  } catch {
    return textOf(value)
  }
}

function getStatusRank(status) {
  if (status === 'error') return 0
  if (status === 'warn') return 1
  return 2
}

function sanitizeMessage(value) {
  return String(value || '').split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 3).join(' ')
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim()
}

function createLandingConsoleAudit(messages = [], pageUrl = '') {
  const audit = classifyConsoleMessages(messages, pageUrl)
  const criticalItems = audit.items.filter((item) => isCriticalLandingConsoleItem(item))
  const advisoryItems = audit.items.filter((item) => !isCriticalLandingConsoleItem(item))
  return {
    criticalCount: criticalItems.length,
    advisoryCount: advisoryItems.length,
    thirdPartyCount: advisoryItems.filter((item) => item.party === 'third-party').length,
  }
}

function isCriticalLandingConsoleItem(item = {}) {
  if (item.classification === 'first-party-runtime-error') return true
  if (item.classification !== 'first-party-console-error') return false
  return CRITICAL_CONSOLE_PATTERN.test(`${item.message || ''} ${item.stackSnippet || ''}`)
}

function analyzeRedirect(requestedUrl, finalUrl) {
  const requested = safeUrl(requestedUrl)
  const final = safeUrl(finalUrl)
  if (!requested || !final) return { unexpected: false }

  const requestedHost = normalizeComparableHost(requested.hostname)
  const finalHost = normalizeComparableHost(final.hostname)
  const unexpectedHost = requestedHost !== finalHost
  const unexpectedProtocol = requested.protocol === 'https:' && final.protocol !== 'https:'
  return { unexpected: unexpectedHost || unexpectedProtocol }
}

function normalizeComparableHost(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/^www\./, '')
}

function safeUrl(value) {
  try {
    return new URL(String(value || '').trim())
  } catch {
    return null
  }
}
