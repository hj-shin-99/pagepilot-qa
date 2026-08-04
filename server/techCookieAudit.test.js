import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { assertCookieAuditSourceSafety, auditCookies, auditCookieItems, COOKIE_AUDIT_TEST_ONLY } from './techCookieAudit.js'

test('cookie audit classifies secure first-party cookie as ok', () => {
  const [item] = auditCookieItems([
    cookie({ name: 'sid', domain: '.example.com', secure: true, httpOnly: true, sameSite: 'Lax' }),
  ], evidence())

  assert.equal(item.status, 'ok')
  assert.equal(item.party, 'first-party')
})

test('cookie audit keeps third-party cookie as reference without escalating to error', () => {
  const [item] = auditCookieItems([
    cookie({ name: '_ga', domain: '.analytics.example', secure: true, httpOnly: false, sameSite: 'None' }),
  ], evidence())

  assert.equal(['info', 'warn'].includes(item.status), true)
  assert.equal(item.party, 'third-party')
})

test('cookie audit errors on SameSite None without Secure', () => {
  const [item] = auditCookieItems([
    cookie({ name: 'tracking', domain: '.example.com', secure: false, httpOnly: false, sameSite: 'None' }),
  ], evidence())

  assert.equal(item.status, 'error')
  assert.equal(item.note.includes('Secure'), true)
})

test('cookie audit avoids overflagging normal settings cookie with HttpOnly false', () => {
  const [item] = auditCookieItems([
    cookie({ name: 'theme', domain: '.example.com', secure: true, httpOnly: false, sameSite: 'Lax' }),
  ], evidence())

  assert.equal(item.status, 'ok')
})

test('cookie audit warns on likely auth session cookie missing HttpOnly', () => {
  const [item] = auditCookieItems([
    cookie({ name: 'session_token', domain: '.example.com', secure: true, httpOnly: false, sameSite: 'Lax', expires: -1 }),
  ], evidence())

  assert.equal(item.status, 'warn')
  assert.equal(item.note.includes('HttpOnly'), true)
})

test('cookie audit warns on duplicate scope conflicts and long expiry', () => {
  const items = auditCookieItems([
    cookie({ name: 'prefs', domain: '.example.com', path: '/', expires: futureDays(800) }),
    cookie({ name: 'prefs', domain: '.shop.example.com', path: '/shop', expires: futureDays(800) }),
  ], evidence())

  assert.equal(items.every((item) => item.status === 'warn'), true)
  assert.equal(items.some((item) => item.issues.some((issue) => issue.includes('충돌'))), true)
  assert.equal(items.some((item) => item.issues.some((issue) => issue.includes('만료 기간'))), true)
})

test('cookie audit meta reports empty targets safely', () => {
  const meta = COOKIE_AUDIT_TEST_ONLY.createCookieAuditMeta([], { candidateCount: 0, noTarget: true })

  assert.equal(meta.noTarget, true)
  assert.equal(meta.candidateCount, 0)
})

test('cookie audit never keeps raw cookie value in normalized items', () => {
  const [item] = auditCookieItems([
    cookie({ name: 'sid', value: 'SECRET_TOKEN_VALUE_123', domain: '.example.com', secure: true, httpOnly: true }),
  ], evidence())

  const serialized = JSON.stringify(item)
  assert.equal('value' in item, false)
  assert.equal(serialized.includes('SECRET_TOKEN_VALUE_123'), false)
  assert.equal(item.valueLength > 0, true)
})

test('cookie audit high-level runner reads cookies without clicking consent UI', async () => {
  let cookieCalls = 0
  let clickCalls = 0
  const browser = {
    async newContext() {
      return {
        async route() {},
        async newPage() {
          return {
            async goto() {},
            async waitForLoadState() {},
            async evaluate() { return ['cookie consent dialog'] },
            url() { return 'https://www.example.com/' },
            click() { clickCalls += 1 },
            async close() {},
          }
        },
        async cookies() {
          cookieCalls += 1
          return []
        },
        async close() {},
      }
    },
  }

  const result = await auditCookies(browser, 'https://www.example.com')

  assert.equal(result.meta.noTarget, true)
  assert.equal(cookieCalls, 1)
  assert.equal(clickCalls, 0)
})

test('cookie audit source safety avoids mutation APIs and site hardcoding', () => {
  const source = fs.readFileSync(new URL('./techCookieAudit.js', import.meta.url), 'utf8')
  assert.equal(assertCookieAuditSourceSafety(), true)
  assert.equal(/BMW|BMWFS|NAVER/.test(source), false)
})

test('cookie audit phase 3-b fixtures cover status boundaries and unspecified SameSite false positive', () => {
  const [problem] = auditCookieItems([cookie({ name: 'tracking', secure: false, sameSite: 'None' })], evidence())
  const [review] = auditCookieItems([cookie({ name: 'session_token', secure: true, httpOnly: false, expires: -1 })], evidence())
  const [normal] = auditCookieItems([cookie({ name: 'sid', secure: true, httpOnly: true, sameSite: 'Lax' })], evidence())
  const notApplicable = COOKIE_AUDIT_TEST_ONLY.createCookieAuditMeta([], { candidateCount: 0, noTarget: true })
  const [previousFalsePositive] = auditCookieItems([cookie({ name: 'theme', sameSite: '', secure: true, httpOnly: false })], evidence())

  assert.equal(problem.status, 'error')
  assert.equal(review.status, 'warn')
  assert.equal(normal.status, 'ok')
  assert.equal(notApplicable.noTarget, true)
  assert.equal(previousFalsePositive.status, 'ok')
})

function evidence(overrides = {}) {
  return {
    targetUrl: 'https://www.example.com',
    pageUrl: 'https://www.example.com',
    pageHostname: 'www.example.com',
    isHttps: true,
    bannerHints: [],
    ...overrides,
  }
}

function cookie(overrides = {}) {
  return {
    name: 'cookie',
    value: 'opaque',
    domain: '.example.com',
    path: '/',
    expires: futureDays(30),
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    ...overrides,
  }
}

function futureDays(days) {
  return Math.floor((Date.now() + days * 24 * 60 * 60 * 1000) / 1000)
}
