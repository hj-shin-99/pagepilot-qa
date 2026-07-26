import fs from 'node:fs'

const COOKIE_AUDIT_TIMEOUT_MS = 6000
const COOKIE_AUDIT_NETWORK_IDLE_TIMEOUT_MS = 2500
const MAX_COOKIE_ITEMS = 40
const LONG_LIVED_COOKIE_DAYS = 400

export async function auditCookies(browser, targetUrl, instrumentation = null) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    serviceWorkers: 'block',
  })

  try {
    await blockMutatingRequests(context)
    const page = await context.newPage()
    incrementAuditCount(instrumentation, 'cookieAuditPageCount')

    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: COOKIE_AUDIT_TIMEOUT_MS })
      await page.waitForLoadState('networkidle', { timeout: COOKIE_AUDIT_NETWORK_IDLE_TIMEOUT_MS }).catch(() => {})
      const evidence = await collectCookieEvidence(page, targetUrl, () => context.cookies([targetUrl]))
      const items = normalizeCookieResults(auditCookieItems(evidence.cookies, evidence))
      return {
        items,
        meta: createCookieAuditMeta(items, {
          candidateCount: evidence.candidateCount,
          bannerHintCount: evidence.bannerHints.length,
        }),
      }
    } finally {
      await page.close().catch(() => {})
    }
  } finally {
    await context.close().catch(() => {})
  }
}

export async function collectCookieEvidence(page, targetUrl, getCookies) {
  const pageUrl = typeof page.url === 'function' ? page.url() : targetUrl
  const pageHostname = safeHostname(pageUrl)
  const bannerHints = await page.evaluate(() => {
    const matches = []
    const elements = Array.from(document.querySelectorAll('dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"], section, aside, div, form'))
    elements.forEach((element) => {
      if (matches.length >= 3) return
      if (!isVisible(element)) return
      const text = normalizeText([
        element.getAttribute('aria-label') || '',
        element.getAttribute('aria-labelledby') || '',
        element.innerText || element.textContent || '',
      ].join(' '))
      if (!text) return
      if (!/\bcookie\b|\bconsent\b|\bprivacy\b|쿠키|개인정보|동의/i.test(text)) return
      matches.push(text.slice(0, 160))
    })
    return matches

    function isVisible(element) {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0
    }

    function normalizeText(value) {
      return String(value || '').replace(/\s+/g, ' ').trim()
    }
  }).catch(() => [])
  const cookieList = await getCookies()
  const cookies = Array.isArray(cookieList) ? cookieList : []

  return {
    targetUrl,
    pageUrl,
    pageHostname,
    isHttps: String(pageUrl || targetUrl).startsWith('https://'),
    cookies,
    bannerHints: Array.isArray(bannerHints) ? bannerHints : [],
    candidateCount: cookies.length,
  }
}

export function auditCookieItems(cookies = [], evidence = {}) {
  const items = Array.isArray(cookies) ? cookies.slice(0, MAX_COOKIE_ITEMS) : []
  const conflicts = createCookieConflictMap(items)
  return items.map((cookie, index) => normalizeCookieResult(cookie, index, evidence, conflicts))
}

export function normalizeCookieResults(items = []) {
  return arrayOfObjects(items).sort((first, second) => getStatusRank(first.status) - getStatusRank(second.status) || String(first.label || '').localeCompare(String(second.label || '')))
}

export function createCookieAuditMeta(items = [], context = {}) {
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
    bannerHintCount: Number(context.bannerHintCount || 0),
  }
}

function normalizeCookieResult(cookie = {}, index = 0, evidence = {}, conflicts = new Map()) {
  const name = String(cookie.name || '').trim() || `쿠키 ${index + 1}`
  const domain = normalizeCookieDomain(cookie.domain)
  const path = String(cookie.path || '/').trim() || '/'
  const sameSite = normalizeSameSite(cookie.sameSite)
  const session = isSessionCookie(cookie)
  const expiresAt = getCookieExpiry(cookie.expires)
  const party = classifyCookieParty(evidence.pageHostname, domain)
  const hostOnly = domain ? !domain.startsWith('.') : null
  const conflictCount = Number(conflicts.get(name)?.length || 0)
  const issues = []
  let owner = 'UID팀'
  let status = 'ok'

  if (sameSite === 'None' && cookie.secure !== true) {
    status = 'error'
    owner = '개발팀'
    issues.push('SameSite=None 쿠키에 Secure 속성이 없습니다.')
  }

  const likelySensitive = isLikelySensitiveCookie(name, { session, party, path })
  if (evidence.isHttps === true && likelySensitive && cookie.secure !== true) {
    status = 'error'
    owner = '개발팀'
    issues.push('HTTPS 페이지의 중요한 first-party 쿠키에 Secure 속성이 없습니다.')
  }

  if (likelySensitive && cookie.httpOnly !== true) {
    status = status === 'error' ? 'error' : 'warn'
    owner = '개발팀'
    issues.push('중요한 세션성 쿠키일 가능성이 있어 HttpOnly 설정 확인이 필요합니다.')
  }

  const broadScope = getBroadScopeWarning(evidence.pageHostname, domain, path, hostOnly)
  if (broadScope) {
    status = status === 'error' ? 'error' : 'warn'
    issues.push(broadScope)
  }

  const longLivedDays = getLongLivedDays(cookie.expires)
  if (longLivedDays !== null && longLivedDays > LONG_LIVED_COOKIE_DAYS) {
    status = status === 'error' ? 'error' : 'warn'
    issues.push(`만료 기간이 약 ${longLivedDays}일로 길어 장기 유지 필요성을 확인해 주세요.`)
  }

  if (conflictCount > 1) {
    status = status === 'error' ? 'error' : 'warn'
    issues.push(`동일 이름 쿠키가 ${conflictCount}개 scope에서 감지되어 충돌 가능성이 있습니다.`)
  }

  if (!session && !expiresAt) {
    status = status === 'error' ? 'error' : 'warn'
    issues.push('expires 값을 정상적으로 해석하지 못했습니다.')
  }

  if (status === 'ok' && party === 'third-party') {
    status = 'info'
    issues.push('third-party 쿠키가 감지되어 출처와 필요성을 참고로 확인해 주세요.')
  }

  if (status === 'ok' && sameSite === 'Unspecified') {
    status = 'warn'
    issues.push('SameSite 속성을 명확히 확인하지 못했습니다.')
  }

  return {
    label: name,
    title: name,
    category: party,
    type: 'cookie',
    status,
    severity: status,
    note: issues[0] || '쿠키 출처와 보안 속성을 확인했습니다.',
    issues,
    owner,
    name,
    domain,
    path,
    sameSite,
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    session,
    hostOnly,
    party,
    expiresAt,
    sourceOrigin: safeOrigin(evidence.pageUrl || evidence.targetUrl),
    hasValue: String(cookie.value || '').length > 0,
    valueLength: String(cookie.value || '').length,
    bannerHints: evidence.bannerHints || [],
    technicalTerm: 'cookie-attributes',
  }
}

function createCookieConflictMap(cookies = []) {
  const scopesByName = new Map()
  cookies.forEach((cookie) => {
    const name = String(cookie?.name || '').trim()
    if (!name) return
    const scopeKey = `${normalizeCookieDomain(cookie.domain)}|${String(cookie.path || '/').trim() || '/'}`
    const scopes = scopesByName.get(name) || new Set()
    scopes.add(scopeKey)
    scopesByName.set(name, scopes)
  })
  return new Map(Array.from(scopesByName.entries()).map(([name, scopes]) => [name, Array.from(scopes)]))
}

function classifyCookieParty(pageHostname = '', domain = '') {
  const hostname = String(pageHostname || '').trim().toLowerCase()
  const normalizedDomain = String(domain || '').trim().replace(/^\.+/, '').toLowerCase()
  if (!hostname || !normalizedDomain) return 'unknown'
  if (hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`)) return 'first-party'
  return 'third-party'
}

function isLikelySensitiveCookie(name = '', context = {}) {
  const text = String(name || '').toLowerCase()
  if (context.party !== 'first-party') return false
  if (!/sess|session|auth|token|jwt|login|sid|account/.test(text)) return false
  return context.session === true || String(context.path || '') === '/'
}

function getBroadScopeWarning(pageHostname = '', domain = '', path = '/', hostOnly = null) {
  const hostname = String(pageHostname || '').trim().toLowerCase()
  const normalizedDomain = String(domain || '').trim().replace(/^\.+/, '').toLowerCase()
  if (!hostname || !normalizedDomain) return ''
  const hostParts = hostname.split('.').filter(Boolean)
  const domainParts = normalizedDomain.split('.').filter(Boolean)
  if (hostOnly === false && hostParts.length >= 4 && domainParts.length <= hostParts.length - 2 && String(path || '/') === '/') {
    return 'cookie domain/path 범위가 넓어 불필요한 하위 경로 또는 서브도메인에 공유될 수 있습니다.'
  }
  return ''
}

function normalizeSameSite(value) {
  const text = String(value || '').trim().toLowerCase()
  if (text === 'lax') return 'Lax'
  if (text === 'strict') return 'Strict'
  if (text === 'none') return 'None'
  return 'Unspecified'
}

function normalizeCookieDomain(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.startsWith('.') ? text.toLowerCase() : text.toLowerCase()
}

function isSessionCookie(cookie = {}) {
  const expires = Number(cookie.expires)
  return !Number.isFinite(expires) || expires <= 0
}

function getCookieExpiry(value) {
  const expires = Number(value)
  if (!Number.isFinite(expires) || expires <= 0) return ''
  const date = new Date(expires * 1000)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function getLongLivedDays(value) {
  const expires = Number(value)
  if (!Number.isFinite(expires) || expires <= 0) return null
  return Math.round((expires * 1000 - Date.now()) / (24 * 60 * 60 * 1000))
}

async function blockMutatingRequests(context) {
  await context.route('**/*', async (route) => {
    const method = String(route.request().method() || '').toUpperCase()
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
}

function incrementAuditCount(instrumentation, key) {
  if (!instrumentation || typeof instrumentation !== 'object') return
  instrumentation[key] = Number(instrumentation[key] || 0) + 1
}

function getStatusRank(status) {
  if (status === 'error') return 0
  if (status === 'warn') return 1
  if (status === 'ok') return 2
  return 3
}

function safeHostname(value = '') {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function safeOrigin(value = '') {
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

function arrayOfObjects(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

export const COOKIE_AUDIT_TEST_ONLY = {
  classifyCookieParty,
  createCookieConflictMap,
  createCookieAuditMeta,
  isLikelySensitiveCookie,
  normalizeCookieResults,
  normalizeSameSite,
  normalizeCookieResult,
}

export function assertCookieAuditSourceSafety() {
  const source = fs.readFileSync(new URL('./techCookieAudit.js', import.meta.url), 'utf8')
  const implementationSource = source.split('export function assertCookieAuditSourceSafety')[0]
  return !/page\.click\(|locator\.click\(|setCookie|addCookies|clearCookies|localStorage|sessionStorage/i.test(implementationSource)
}
