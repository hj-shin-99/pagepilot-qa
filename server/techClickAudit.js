const MAX_SAFE_CLICK_CANDIDATES = 12
const SAFE_CLICK_TIMEOUT_MS = 2500
const DANGEROUS_ACTION_PATTERN = /\b(delete|remove|logout|log\s*out|sign\s*out|pay|payment|purchase|order|checkout|submit|send|confirm|complete|download|tel|mailto)\b/i
const DANGEROUS_ACTION_KO_PATTERN = /(삭제|로그아웃|결제|주문|구매\s*완료|신청\s*완료|제출|전송|다운로드|탈퇴)/i
const UI_CONTROL_PATTERN = /\b(close|dismiss|cancel|modal|dialog|accordion|tab|tabpanel|carousel|slide|slider|prev|previous|next|dropdown|popover|menu|sitemap|site-map|search|video|play|pause|cookie|checkbox|radio|pagination|expand|collapse)\b/i
const UI_CONTROL_KO_PATTERN = /(닫기|취소|모달|팝업|아코디언|탭|캐러셀|슬라이드|이전|다음|드롭다운|메뉴|사이트\s*맵|검색|동영상|재생|정지|쿠키|체크박스|라디오|페이지|펼치기|접기)/i
const NAVIGATION_PATTERN = /\b(link|cta|button|btn|more|details|learn|view|read|shop|buy|apply|reserve|book|contact|start|continue|go|quote|estimate)\b/i
const NAVIGATION_KO_PATTERN = /(바로가기|더보기|더 보기|더 알아보기|자세히|상세|보기|구매|신청|예약|문의|상담|견적|이동|계속)/i

export function classifyClickableCandidate(candidate = {}) {
  const hrefState = getHrefState(candidate)
  const technicalTerm = getHrefTechnicalTerm(hrefState)
  const isUiControl = isUiControlCandidate(candidate)
  const isDangerous = isDangerousCandidate(candidate)
  const hasAction = hasActionEvidence(candidate, hrefState, isUiControl)
  const isNavigation = looksLikeNavigation(candidate)
  const hitTestStatus = getHitTestStatus(candidate)

  const base = {
    ...candidate,
    hrefState,
    hitTestStatus,
    technicalTerm,
    displayName: getHrefDisplayName(hrefState),
    easyExplanation: getHrefEasyExplanation(hrefState),
    actionType: inferActionType(candidate, hrefState, isUiControl),
    safeClickEligible: false,
    safeClickSkippedReason: '',
    actionClassification: 'actionable-warning',
  }

  if (candidate.disabled || candidate.ariaDisabled === 'true') {
    const isActionableNavigation = hrefState === 'valid-url' || isNavigation
    return {
      ...base,
      status: isActionableNavigation ? 'error' : 'warn',
      category: 'disabled-action',
      actionClassification: isActionableNavigation ? 'actual-error' : 'actionable-warning',
      reason: isActionableNavigation ? '유효 URL 또는 이동 목적이 있지만 요소가 비활성 상태라 상호작용할 수 없습니다.' : '비활성 요소로 표시되어 실제 클릭 대상인지 확인이 필요합니다.',
    }
  }

  if (candidate.pointerEvents === 'none') {
    return { ...base, status: 'error', category: 'covered-or-not-interactable', actionClassification: 'actual-error', reason: 'pointer-events:none 상태라 사용자가 클릭할 수 없습니다.' }
  }

  if (hitTestStatus === 'hitTestFailed' && candidate.unrelatedOverlay !== false) {
    const overlay = textOf(candidate.overlaySelector || candidate.hitTargetSelector)
    return { ...base, status: 'error', category: 'covered-or-not-interactable', actionClassification: 'actual-error', reason: overlay ? 'hit-test 결과 unrelated overlay가 실제 클릭 지점을 막고 있습니다.' : 'hit-test 결과 실제 클릭 지점을 막는 unrelated overlay가 감지되었습니다.' }
  }

  if (isUiControl && (isStrongUiControlCandidate(candidate) || hrefState !== 'valid-url')) {
    return { ...base, status: 'ok', category: 'UI-control-no-url-required', technicalTerm: 'UI 제어 동작', displayName: 'UI 제어 동작', easyExplanation: '모달, 메뉴, 검색, 캐러셀, 탭처럼 URL 이동 없이 화면 상태를 바꾸는 클릭 제어입니다.', actionClassification: 'ui-control-no-url-required', clickExecuted: false, reason: 'URL이 필요 없는 UI 제어로 분류했습니다.', safeClickEligible: false }
  }

  if (hrefState === 'valid-url') {
    return { ...base, status: 'ok', category: 'valid-url', actionClassification: 'verified-working', verificationMethod: 'valid-navigation-url', clickExecuted: false, observableChange: false, reason: '정상 이동 URL이 확인되었습니다.' }
  }

  if (isDangerous && hasAction) {
    return { ...base, status: 'ok', category: 'skipped-safe-click', actionClassification: 'safe-click-skipped', clickExecuted: false, reason: '위험할 수 있는 동작이라 실제 클릭 검증을 생략했습니다.', safeClickSkippedReason: 'dangerous-action' }
  }

  if (hrefState === 'missing-href' && isNavigation) {
    if (!hasAction) {
      return { ...base, status: 'warn', category: 'missing-navigation-action', actionClassification: 'actionable-warning', clickExecuted: false, reason: '이동 목적 요소처럼 보이지만 href, action, form action 근거가 모두 없어 확인이 필요합니다.' }
    }
    return { ...base, status: 'warn', category: 'ambiguous-action', actionClassification: 'actionable-warning', clickExecuted: false, reason: '이동 버튼처럼 보이지만 action evidence가 불완전합니다.', safeClickEligible: !isDangerous }
  }

  if (hrefState === 'empty-href' || hrefState === 'hash-only' || hrefState === 'javascript-pseudo-url') {
    return { ...base, status: 'warn', category: hrefState, actionClassification: 'actionable-warning', clickExecuted: false, reason: '실제 이동 버튼이라면 목적지 URL이 누락됐을 수 있습니다.', safeClickEligible: !isDangerous && hasAction }
  }

  if (!hasAction) {
    return { ...base, status: 'warn', category: 'ambiguous-action', actionClassification: 'actionable-warning', clickExecuted: false, reason: '유효한 href, role, 이벤트, UI 제어 근거가 없어 UID팀 확인이 필요합니다.' }
  }

  return { ...base, status: 'warn', category: 'ambiguous-action', actionClassification: 'actionable-warning', clickExecuted: false, reason: '클릭 이벤트는 있으나 목적을 자동으로 확정할 수 없습니다.', safeClickEligible: true }
}

export function summarizeClickActionAudit(items = [], meta = {}) {
  const sourceItems = Array.isArray(items) ? items : []
  const actualErrors = sourceItems.filter((item) => getActionClassification(item) === 'actual-error')
  const actionableWarnings = sourceItems.filter((item) => getActionClassification(item) === 'actionable-warning')
  const actionable = actualErrors.concat(actionableWarnings)
  return {
    status: actualErrors.length > 0 ? 'error' : actionableWarnings.length > 0 ? 'warn' : 'ok',
    value: actionable.length > 0 ? `실제 오류 ${actualErrors.length} · 확인 필요 ${actionableWarnings.length}` : '정상',
    items: actionable,
    meta: {
      candidateCount: sourceItems.length,
      safeClickAttemptCount: Number(meta.safeClickAttemptCount || 0),
      actualErrorCount: actualErrors.length,
      actionableWarningCount: actionableWarnings.length,
      safeClickSkippedCount: sourceItems.filter((item) => getActionClassification(item) === 'safe-click-skipped').length,
      uiControlNoUrlRequiredCount: sourceItems.filter((item) => getActionClassification(item) === 'ui-control-no-url-required').length,
      verifiedWorkingCount: sourceItems.filter((item) => getActionClassification(item) === 'verified-working').length,
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
    let popupObserved = false
    let navigationRequestObserved = false
    const onRequest = (request) => {
      if (request.isNavigationRequest() && request.resourceType() === 'document') navigationRequestObserved = true
    }
    page.once('popup', (popup) => {
      popupObserved = true
      popup.close().catch(() => {})
    })
    page.on('request', onRequest)
    const before = await getClickState(page, candidate.selector)
    await page.locator(candidate.selector).first().click({ timeout: SAFE_CLICK_TIMEOUT_MS, noWaitAfter: true, trial: false })
    await page.waitForTimeout(350)
    page.off('request', onRequest)
    const after = await getClickState(page, candidate.selector)
    const changed = before.url !== after.url
      || before.ariaExpanded !== after.ariaExpanded
      || after.dialogVisible === true
      || after.targetVisible === true && before.targetVisible !== after.targetVisible
      || after.mutationCount > before.mutationCount
      || popupObserved
      || navigationRequestObserved
    return { clicked: true, changed, before, after, popupObserved, navigationRequestObserved }
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
  if (result.changed) return { ...item, status: 'ok', category: 'observable-action', actionClassification: 'verified-working', verificationMethod: 'safe-click-observed-action', clickExecuted: true, observableChange: true, reason: '안전 클릭 후 URL, navigation request, DOM, popup, dialog 또는 aria 상태 변화가 관찰되었습니다.', safeClickResult: result }
  if (result.clicked) return { ...item, status: 'error', category: 'no-observable-action', actionClassification: 'actual-error', clickExecuted: true, observableChange: false, reason: '안전 클릭 후 관찰 가능한 변화가 없습니다.', safeClickResult: result }
  return { ...item, status: 'warn', category: 'ambiguous-action', actionClassification: 'actionable-warning', clickExecuted: false, observableChange: false, safeClickSkippedReason: 'safe-click-failed', reason: `안전 클릭을 완료하지 못했습니다. ${sanitizeMessage(result.error)}`, safeClickResult: result }
}

function getActionClassification(item = {}) {
  if (item.actionClassification) return item.actionClassification
  if (item.category === 'skipped-safe-click' || item.safeClickSkippedReason) return 'safe-click-skipped'
  if (item.category === 'UI-control-no-url-required') return 'ui-control-no-url-required'
  if (item.status === 'ok' || item.category === 'valid-url' || item.category === 'observable-action') return 'verified-working'
  if (item.category === 'covered-or-not-interactable' || item.category === 'no-observable-action' || item.category === 'disabled-action') return 'actual-error'
  return 'actionable-warning'
}

function getHrefState(candidate = {}) {
  const href = textOf(candidate.href)
  const url = textOf(candidate.url)
  const hasHrefAttribute = candidate.hasHrefAttribute === true || Boolean(href)
  if (!hasHrefAttribute && !url) return 'missing-href'
  if (hasHrefAttribute && !href && !url) return 'empty-href'
  if (/^#/.test(href)) return 'hash-only'
  if (/^javascript:/i.test(href)) return 'javascript-pseudo-url'
  if (isHttpUrl(url) || isHttpUrl(href) || isRelativeNavigationHref(href)) return 'valid-url'
  return 'ambiguous-action'
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(textOf(value))
}

function isRelativeNavigationHref(value) {
  const href = textOf(value)
  if (!href) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false
  return true
}

function getHitTestStatus(candidate = {}) {
  const status = textOf(candidate.hitTestStatus)
  if (['hitTestPassed', 'hitTestFailed', 'hitTestNotRun', 'hitTestUnavailable'].includes(status)) return status
  if (candidate.fullyCovered === true) return 'hitTestFailed'
  if (candidate.unrelatedOverlay === true) return 'hitTestFailed'
  if (candidate.hitTargetSame === true) return 'hitTestPassed'
  return 'hitTestNotRun'
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
  if (candidate.uiControlSemantic) return true
  if (candidate.dataDismiss || candidate.dataSlide) return true
  if (candidate.ariaControls || candidate.ariaExpanded || candidate.dataTarget || candidate.dataToggle) return true
  if (/^(submit|button|reset|checkbox|radio)$/i.test(textOf(candidate.type)) && candidate.formId) return true
  return UI_CONTROL_PATTERN.test(text) || UI_CONTROL_KO_PATTERN.test(text)
}

function isStrongUiControlCandidate(candidate = {}) {
  const text = searchableText(candidate)
  if (candidate.uiControlSemantic || candidate.dataDismiss || candidate.dataSlide) return true
  if (candidate.ariaControls || candidate.ariaExpanded || candidate.dataTarget || candidate.dataToggle) return true
  return /\b(close|dismiss|cancel|prev|previous|next|carousel|slide|slider|menu|sitemap|site-map|search|accordion|tab|dropdown|modal|dialog|play|pause|cookie)\b/i.test(text)
    || /(닫기|취소|이전|다음|캐러셀|슬라이드|메뉴|사이트\s*맵|검색|아코디언|탭|드롭다운|모달|팝업|재생|정지|쿠키)/i.test(text)
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
  return [candidate.tagName, candidate.kind, candidate.role, candidate.type, candidate.label, candidate.text, candidate.ariaLabel, candidate.href, candidate.selector, candidate.domPath, candidate.className, candidate.classTokens, candidate.section, candidate.actionEvidence, candidate.uiControlSemantic, candidate.dataDismiss, candidate.dataSlide, candidate.dataToggle, candidate.dataTarget]
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
