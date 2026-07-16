const MAX_SAFE_CLICK_CANDIDATES = 12
const SAFE_CLICK_TIMEOUT_MS = 2500
const DANGEROUS_ACTION_PATTERN = /\b(delete|remove|logout|log\s*out|sign\s*out|pay|payment|purchase|order|checkout|submit|send|confirm|complete|download|tel|mailto)\b/i
const DANGEROUS_ACTION_KO_PATTERN = /(삭제|로그아웃|결제|주문|구매\s*완료|신청\s*완료|제출|전송|다운로드|탈퇴)/i
const UI_CONTROL_PATTERN = /\b(modal|dialog|accordion|tab|tabpanel|carousel|slider|dropdown|popover|video|play|pause|cookie|checkbox|radio|pagination|expand|collapse)\b/i
const UI_CONTROL_KO_PATTERN = /(모달|팝업|아코디언|탭|캐러셀|드롭다운|동영상|재생|쿠키|체크박스|라디오|페이지|펼치기|접기)/i
const NAVIGATION_PATTERN = /\b(link|cta|button|btn|more|details|learn|view|read|shop|buy|apply|reserve|book|contact|start|continue|go|quote|estimate)\b/i
const NAVIGATION_KO_PATTERN = /(바로가기|더보기|더 보기|더 알아보기|자세히|상세|보기|구매|신청|예약|문의|상담|견적|이동|계속)/i

export function classifyClickableCandidate(candidate = {}) {
  const hrefState = getHrefState(candidate)
  const technicalTerm = getHrefTechnicalTerm(hrefState)
  const isUiControl = isUiControlCandidate(candidate)
  const isDangerous = isDangerousCandidate(candidate)
  const hasAction = hasActionEvidence(candidate, hrefState, isUiControl)
  const isNavigation = looksLikeNavigation(candidate)

  const base = {
    ...candidate,
    hrefState,
    technicalTerm,
    displayName: getHrefDisplayName(hrefState),
    easyExplanation: getHrefEasyExplanation(hrefState),
    actionType: inferActionType(candidate, hrefState, isUiControl),
    safeClickEligible: false,
    safeClickSkippedReason: '',
  }

  if (candidate.disabled || candidate.ariaDisabled === 'true') {
    return { ...base, status: 'warn', category: 'disabled-action', reason: '비활성 요소로 표시되어 실제 클릭 대상인지 확인이 필요합니다.' }
  }

  if (candidate.pointerEvents === 'none') {
    return { ...base, status: 'error', category: 'covered-or-not-interactable', reason: 'pointer-events:none 상태라 사용자가 클릭할 수 없습니다.' }
  }

  if (candidate.hitTargetSame === false) {
    return { ...base, status: 'error', category: 'covered-or-not-interactable', reason: 'hit-test 결과 다른 요소가 클릭 지점을 가리고 있습니다.' }
  }

  if (hrefState === 'valid-url') {
    return { ...base, status: 'ok', category: 'valid-url', reason: '정상 이동 URL이 확인되었습니다.' }
  }

  if (isDangerous && hasAction) {
    return { ...base, status: 'warn', category: 'skipped-safe-click', reason: '위험할 수 있는 동작이라 실제 클릭 검증을 생략했습니다.', safeClickSkippedReason: 'dangerous-action' }
  }

  if (isUiControl) {
    return { ...base, status: 'ok', category: 'UI-control-no-url-required', reason: 'URL이 필요 없는 UI 제어로 분류했습니다.', safeClickEligible: !isDangerous }
  }

  if (hrefState === 'missing-href' && isNavigation) {
    return { ...base, status: 'warn', category: 'ambiguous-action', reason: '이동 버튼처럼 보이지만 href 또는 action 근거가 불완전합니다.', safeClickEligible: !isDangerous }
  }

  if (hrefState === 'empty-href' || hrefState === 'hash-only' || hrefState === 'javascript-pseudo-url') {
    return { ...base, status: 'warn', category: hrefState, reason: '실제 이동 버튼이라면 목적지 URL이 누락됐을 수 있습니다.', safeClickEligible: !isDangerous && hasAction }
  }

  if (!hasAction) {
    return { ...base, status: 'error', category: 'no-observable-action', reason: '유효한 href, role, 이벤트, UI 제어 근거가 없습니다.' }
  }

  return { ...base, status: 'warn', category: 'ambiguous-action', reason: '클릭 이벤트는 있으나 목적을 자동으로 확정할 수 없습니다.', safeClickEligible: true }
}

export function summarizeClickActionAudit(items = [], meta = {}) {
  const sourceItems = Array.isArray(items) ? items : []
  const actionable = sourceItems.filter((item) => item.status !== 'ok')
  return {
    status: actionable.some((item) => item.status === 'error') ? 'error' : actionable.length > 0 ? 'warn' : 'ok',
    value: actionable.length > 0 ? `${actionable.length}개 확인 필요` : '정상',
    items: actionable,
    meta: {
      candidateCount: sourceItems.length,
      safeClickAttemptCount: Number(meta.safeClickAttemptCount || 0),
      safeClickSkippedCount: sourceItems.filter((item) => item.category === 'skipped-safe-click' || item.safeClickSkippedReason).length,
    },
  }
}

export async function auditClickableActions(browser, targetUrl, candidates = [], instrumentation = null) {
  const classified = (Array.isArray(candidates) ? candidates : []).map(classifyClickableCandidate)
  const safeCandidates = classified.filter((item) => item.safeClickEligible && item.status !== 'ok').slice(0, MAX_SAFE_CLICK_CANDIDATES)
  let safeClickAttemptCount = 0
  const safeResults = new Map()

  if (safeCandidates.length > 0) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' })
    try {
      await context.route('**/*', async (route) => {
        if (route.request().method().toUpperCase() === 'POST') {
          await route.abort('blockedbyclient')
          return
        }
        await route.continue()
      })
      const page = await context.newPage()
      if (instrumentation) instrumentation.safeClickPageCount = Number(instrumentation.safeClickPageCount || 0) + 1
      for (const candidate of safeCandidates) {
        safeClickAttemptCount += 1
        safeResults.set(candidate.auditId, await verifySafeClick(page, targetUrl, candidate))
      }
    } finally {
      await context.close()
    }
  }

  return {
    items: classified.map((item) => applySafeClickResult(item, safeResults.get(item.auditId))),
    meta: { candidateCount: classified.length, safeClickAttemptCount, safeClickLimit: MAX_SAFE_CLICK_CANDIDATES },
  }
}

async function verifySafeClick(page, targetUrl, candidate) {
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: SAFE_CLICK_TIMEOUT_MS })
    await page.evaluate(() => {
      window.__pagepilotMutationCount = 0
      window.__pagepilotDialogObserved = false
      window.__pagepilotObserver?.disconnect?.()
      window.__pagepilotObserver = new MutationObserver(() => { window.__pagepilotMutationCount += 1 })
      window.__pagepilotObserver.observe(document.documentElement, { attributes: true, childList: true, subtree: true })
    })
    page.once('dialog', (dialog) => {
      page.evaluate(() => { window.__pagepilotDialogObserved = true }).catch(() => {})
      dialog.dismiss().catch(() => {})
    })
    const before = await getClickState(page, candidate.selector)
    await page.locator(candidate.selector).first().click({ timeout: SAFE_CLICK_TIMEOUT_MS, noWaitAfter: true, trial: false })
    await page.waitForTimeout(350)
    const after = await getClickState(page, candidate.selector)
    const changed = before.url !== after.url
      || before.ariaExpanded !== after.ariaExpanded
      || after.dialogVisible === true
      || after.targetVisible === true && before.targetVisible !== after.targetVisible
      || after.mutationCount > before.mutationCount
    return { clicked: true, changed, before, after }
  } catch (error) {
    return { clicked: false, changed: false, error: error instanceof Error ? error.message : 'safe click failed' }
  }
}

async function getClickState(page, selector) {
  return page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector)
    const controlsId = target?.getAttribute('aria-controls') || ''
    const controlled = controlsId ? document.getElementById(controlsId) : null
    const rect = controlled?.getBoundingClientRect()
    return {
      url: location.href,
      ariaExpanded: target?.getAttribute('aria-expanded') || '',
      dialogVisible: Boolean(document.querySelector('dialog[open], [role="dialog"]:not([hidden])')),
      targetVisible: Boolean(controlled && rect && rect.width > 0 && rect.height > 0 && getComputedStyle(controlled).display !== 'none' && getComputedStyle(controlled).visibility !== 'hidden'),
      mutationCount: Number(window.__pagepilotMutationCount || 0),
    }
  }, selector).catch(() => ({ url: '', ariaExpanded: '', dialogVisible: false, targetVisible: false, mutationCount: 0 }))
}

export function applySafeClickResult(item, result) {
  if (!result) return item
  if (result.changed) return { ...item, status: 'ok', category: 'observable-action', reason: '안전 클릭 후 URL, DOM, dialog 또는 aria 상태 변화가 관찰되었습니다.', safeClickResult: result }
  if (result.clicked) return { ...item, status: 'error', category: 'no-observable-action', reason: '안전 클릭 후 관찰 가능한 변화가 없습니다.', safeClickResult: result }
  return { ...item, status: 'warn', category: 'ambiguous-action', reason: `안전 클릭을 완료하지 못했습니다. ${sanitizeMessage(result.error)}`, safeClickResult: result }
}

function getHrefState(candidate = {}) {
  const href = textOf(candidate.href)
  const url = textOf(candidate.url)
  const hasHrefAttribute = candidate.hasHrefAttribute === true || Boolean(href)
  if (!hasHrefAttribute && !url) return 'missing-href'
  if (hasHrefAttribute && !href && !url) return 'empty-href'
  if (/^#/.test(href)) return 'hash-only'
  if (/^javascript:/i.test(href)) return 'javascript-pseudo-url'
  if (url || /^https?:\/\//i.test(href) || /^\//.test(href)) return 'valid-url'
  return 'ambiguous-action'
}

function getHrefTechnicalTerm(state) {
  if (state === 'missing-href') return 'href 누락'
  if (state === 'empty-href') return '빈 href'
  if (state === 'hash-only') return '페이지 내부 앵커'
  if (state === 'javascript-pseudo-url') return 'javascript:void(0)'
  if (state === 'valid-url') return 'valid-url'
  return 'ambiguous-action'
}

function getHrefDisplayName(state) {
  if (state === 'missing-href') return 'href 누락'
  if (state === 'empty-href') return '빈 href'
  if (state === 'hash-only') return '페이지 내부 앵커'
  if (state === 'javascript-pseudo-url') return 'JavaScript 임시 URL'
  if (state === 'valid-url') return '정상 이동 URL'
  return '동작 확인 필요'
}

function getHrefEasyExplanation(state) {
  if (state === 'missing-href') return 'href는 링크가 이동할 주소를 지정하는 HTML 속성입니다. href가 없으면 사용자가 눌러도 다른 페이지로 이동하지 않을 수 있습니다.'
  if (state === 'empty-href') return 'href 속성은 있지만 값이 비어 있습니다. 이동 목적 버튼이라면 목적지 URL이 누락됐을 수 있습니다.'
  if (state === 'hash-only') return '같은 페이지 내부 위치로 이동하는 앵커입니다. 이동 CTA라면 실제 목적지 URL이 필요한지 확인해야 합니다.'
  if (state === 'javascript-pseudo-url') return '링크 주소 대신 JavaScript 동작만 지정된 상태입니다. 실제 이동 버튼이라면 목적지 URL이 누락됐을 수 있습니다.'
  if (state === 'valid-url') return 'HTTP 또는 상대 URL 목적지가 확인된 링크입니다.'
  return '클릭 이벤트나 커스텀 동작이 있어 목적 확인이 필요합니다.'
}

function hasActionEvidence(candidate, hrefState, isUiControl) {
  return hrefState === 'valid-url'
    || isUiControl
    || candidate.hasOnClick === true
    || Boolean(textOf(candidate.dataHref || candidate.dataUrl || candidate.formAction || candidate.actionEvidence))
}

function isUiControlCandidate(candidate = {}) {
  const text = searchableText(candidate)
  if (candidate.ariaControls || candidate.ariaExpanded || candidate.dataTarget || candidate.dataToggle) return true
  if (/^(submit|button|reset|checkbox|radio)$/i.test(textOf(candidate.type)) && candidate.formId) return true
  return UI_CONTROL_PATTERN.test(text) || UI_CONTROL_KO_PATTERN.test(text)
}

function looksLikeNavigation(candidate = {}) {
  return NAVIGATION_PATTERN.test(searchableText(candidate)) || NAVIGATION_KO_PATTERN.test(searchableText(candidate))
}

function isDangerousCandidate(candidate = {}) {
  const text = searchableText(candidate)
  if (/^(submit)$/i.test(textOf(candidate.type)) || candidate.formId) return true
  if (/^(mailto|tel|sms):/i.test(textOf(candidate.href))) return true
  return DANGEROUS_ACTION_PATTERN.test(text) || DANGEROUS_ACTION_KO_PATTERN.test(text)
}

function inferActionType(candidate, hrefState, isUiControl) {
  if (hrefState === 'valid-url') return 'href-navigation'
  if (isUiControl) return 'ui-control'
  if (candidate.hasOnClick) return 'click-handler'
  return 'unknown'
}

function searchableText(candidate = {}) {
  return [candidate.tagName, candidate.kind, candidate.role, candidate.type, candidate.label, candidate.text, candidate.ariaLabel, candidate.href, candidate.selector, candidate.domPath, candidate.className, candidate.classTokens, candidate.section]
    .map(textOf)
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function sanitizeMessage(value) {
  return String(value || '').split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 2).join(' ')
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim()
}
