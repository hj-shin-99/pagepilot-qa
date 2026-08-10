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
    interactionOutcome: 'unknown',
    interactionEvidence: [],
    landingUrl: resolveLandingUrl(candidate),
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
    return { ...base, status: 'error', category: 'covered-or-not-interactable', actionClassification: 'actual-error', interactionOutcome: 'blocked', reason: 'pointer-events:none 상태라 사용자가 클릭할 수 없습니다.' }
  }

  if (hitTestStatus === 'hitTestFailed' && candidate.unrelatedOverlay !== false) {
    const overlay = textOf(candidate.overlaySelector || candidate.hitTargetSelector)
    return { ...base, status: 'error', category: 'covered-or-not-interactable', actionClassification: 'actual-error', interactionOutcome: 'blocked', reason: overlay ? 'hit-test 결과 unrelated overlay가 실제 클릭 지점을 막고 있습니다.' : 'hit-test 결과 실제 클릭 지점을 막는 unrelated overlay가 감지되었습니다.' }
  }

  if (isUiControl && (hasExplicitUiControlEvidence(candidate) || hrefState !== 'valid-url')) {
    return {
      ...base,
      status: 'ok',
      category: 'UI-control-no-url-required',
      technicalTerm: 'UI 제어 동작',
      displayName: 'UI 제어 동작',
      easyExplanation: '모달, 메뉴, 검색, 캐러셀, 탭처럼 URL 이동 없이 화면 상태를 바꾸는 클릭 제어입니다.',
      actionClassification: 'ui-control-no-url-required',
      clickExecuted: false,
      interactionOutcome: inferUiControlOutcome(candidate),
      reason: 'URL이 필요 없는 UI 제어로 분류했고 안전한 범위에서 실제 클릭 변화를 확인합니다.',
      safeClickEligible: !isDangerous,
    }
  }

  if (hrefState === 'valid-url') {
    return {
      ...base,
      status: 'ok',
      category: 'valid-url',
      actionClassification: 'verified-working',
      verificationMethod: 'valid-navigation-url',
      clickExecuted: false,
      observableChange: false,
      interactionOutcome: candidate.target === '_blank' ? 'new-window' : 'navigation',
      interactionEvidence: [candidate.target === '_blank' ? 'target=_blank 새 창 링크' : 'href 목적지 URL 확인'],
      reason: '정상 이동 URL이 확인되었습니다.',
    }
  }

  if (isDangerous && hasAction) {
    return { ...base, status: 'ok', category: 'skipped-safe-click', actionClassification: 'safe-click-skipped', clickExecuted: false, interactionOutcome: 'skipped', reason: '위험할 수 있는 동작이라 실제 클릭 검증을 생략했습니다.', safeClickSkippedReason: 'dangerous-action' }
  }

  if (hrefState === 'missing-href' && isNavigation) {
    if (!hasAction) {
      return { ...base, status: 'warn', category: 'missing-navigation-action', actionClassification: 'actionable-warning', clickExecuted: false, interactionOutcome: 'no-change', reason: '이동 목적 요소처럼 보이지만 href, action, form action 근거가 모두 없어 확인이 필요합니다.' }
    }
    return { ...base, status: 'warn', category: 'ambiguous-action', actionClassification: 'actionable-warning', clickExecuted: false, interactionOutcome: 'unknown', reason: '이동 버튼처럼 보이지만 action evidence가 불완전합니다.', safeClickEligible: !isDangerous }
  }

  if (hrefState === 'empty-href' || hrefState === 'hash-only' || hrefState === 'javascript-pseudo-url') {
    return { ...base, status: 'warn', category: hrefState, actionClassification: 'actionable-warning', clickExecuted: false, interactionOutcome: hrefState === 'hash-only' ? 'scroll' : 'unknown', reason: '실제 이동 버튼이라면 목적지 URL이 누락됐을 수 있습니다.', safeClickEligible: !isDangerous && hasAction }
  }

  if (!hasAction) {
    return { ...base, status: 'warn', category: 'ambiguous-action', actionClassification: 'actionable-warning', clickExecuted: false, interactionOutcome: 'unknown', reason: '유효한 href, role, 이벤트, UI 제어 근거가 없어 UID팀 확인이 필요합니다.' }
  }

  return { ...base, status: 'warn', category: 'ambiguous-action', actionClassification: 'actionable-warning', clickExecuted: false, interactionOutcome: 'unknown', reason: '클릭 이벤트는 있으나 목적을 자동으로 확정할 수 없습니다.', safeClickEligible: true }
}

export function summarizeClickActionAudit(items = [], meta = {}) {
  const sourceItems = mergeClickActionObservations(Array.isArray(items) ? items : [])
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

export async function auditClickableActions(browser, targetUrl, candidates = [], instrumentation = null, contextOptions = {}) {
  const classified = (Array.isArray(candidates) ? candidates : []).map(classifyClickableCandidate)
  const safeCandidates = classified.filter((item) => item.safeClickEligible && item.actionClassification !== 'safe-click-skipped' && item.actionClassification !== 'verified-working').slice(0, MAX_SAFE_CLICK_CANDIDATES)
  let safeClickAttemptCount = 0
  const safeResults = new Map()

  if (safeCandidates.length > 0) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 }, serviceWorkers: 'block', ...contextOptions })
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
    items: mergeClickActionObservations(classified.map((item) => applySafeClickResult(item, safeResults.get(item.auditId)))),
    meta: { candidateCount: classified.length, safeClickAttemptCount, safeClickLimit: MAX_SAFE_CLICK_CANDIDATES },
  }
}

export function mergeClickActionObservations(items = []) {
  const sourceItems = Array.isArray(items) ? items : []
  const groups = new Map()
  const merged = []
  sourceItems.forEach((item) => {
    if (!item || typeof item !== 'object') return
    const key = getClickTargetIdentityKey(item)
    if (!key) {
      merged.push(item)
      return
    }
    const previousIndex = groups.get(key)
    if (previousIndex === undefined) {
      groups.set(key, merged.length)
      merged.push(item)
      return
    }
    merged[previousIndex] = mergeClickActionItems(merged[previousIndex], item)
  })
  return merged
}

function getClickTargetIdentityKey(item = {}) {
  const selector = normalizeIdentityPart(item.selector)
  if (selector) return `selector:${[selector, normalizeIdentityPart(item.domPath), normalizeUrlIdentity(item.url || item.href || item.landingUrl), normalizeIdentityPart(item.role || item.tagName || item.kind), normalizeIdentityPart(item.section || item.sectionPath || item.userLocation), normalizeIdentityPart(item.target), normalizeIdentityPart(item.label || item.text || item.ariaLabel)].filter(Boolean).join('|')}`

  const domPath = normalizeIdentityPart(item.domPath)
  if (domPath) return `dom:${[domPath, normalizeUrlIdentity(item.url || item.href || item.landingUrl), normalizeIdentityPart(item.role || item.tagName || item.kind), normalizeIdentityPart(item.section || item.sectionPath || item.userLocation), normalizeIdentityPart(item.label || item.text || item.ariaLabel)].filter(Boolean).join('|')}`

  const stableId = normalizeIdentityPart(item.sourceId || item.stableId || item.elementId)
  if (stableId) return `stable:${stableId}`

  const href = normalizeUrlIdentity(item.url || item.href || item.landingUrl)
  const role = normalizeIdentityPart(item.role || item.tagName || item.kind)
  const section = normalizeIdentityPart(item.section || item.sectionPath || item.userLocation)
  const target = normalizeIdentityPart(item.target)
  if (href && (role || section || target)) return `link:${href}|${role}|${section}|${target}`

  return ''
}

function mergeClickActionItems(first = {}, second = {}) {
  const preferred = compareClickActionSeverity(second, first) < 0 ? second : first
  const fallback = preferred === first ? second : first
  const evidence = uniqueStrings(first.interactionEvidence).concat(uniqueStrings(second.interactionEvidence)).filter((value, index, values) => values.indexOf(value) === index)
  const statuses = uniqueStrings([first.status, second.status])
  const categories = uniqueStrings([first.category, second.category])
  const outcomes = uniqueStrings([first.interactionOutcome, second.interactionOutcome])
  return {
    ...fallback,
    ...preferred,
    interactionEvidence: evidence,
    mergedStatuses: statuses,
    mergedCategories: categories,
    mergedInteractionOutcomes: outcomes,
    observationCount: Number(first.observationCount || 1) + Number(second.observationCount || 1),
    clickExecuted: first.clickExecuted === true || second.clickExecuted === true,
    observableChange: first.observableChange === true || second.observableChange === true,
    reason: preferred.reason || fallback.reason || '',
  }
}

function compareClickActionSeverity(first = {}, second = {}) {
  return getClickActionSeverityRank(first) - getClickActionSeverityRank(second)
}

function getClickActionSeverityRank(item = {}) {
  const classification = getActionClassification(item)
  if (classification === 'actual-error') return 0
  if (classification === 'actionable-warning') return 1
  if (classification === 'safe-click-skipped') return 2
  if (classification === 'ui-control-no-url-required') return 3
  if (classification === 'verified-working') return 4
  return 5
}

function uniqueStrings(values = []) {
  return (Array.isArray(values) ? values : [values]).map(textOf).filter(Boolean).filter((value, index, list) => list.indexOf(value) === index)
}

async function verifySafeClick(page, targetUrl, candidate) {
  const consoleErrors = []
  const pageErrors = []

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: SAFE_CLICK_TIMEOUT_MS })
    const onConsole = (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    }
    const onPageError = (error) => {
      pageErrors.push(error.message || 'page error')
    }
    page.on('console', onConsole)
    page.on('pageerror', onPageError)
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
    let popupUrl = ''
    let navigationRequestObserved = false
    const onRequest = (request) => {
      if (request.isNavigationRequest() && request.resourceType() === 'document') navigationRequestObserved = true
    }
    page.once('popup', (popup) => {
      popupObserved = true
      popupUrl = popup.url() || ''
      popup.waitForLoadState('domcontentloaded', { timeout: SAFE_CLICK_TIMEOUT_MS }).catch(() => {})
      popup.waitForTimeout(250).then(() => {
        popupUrl = popup.url() || popupUrl
      }).catch(() => {})
      popup.close().catch(() => {})
    })
    page.on('request', onRequest)
    const before = await getClickState(page, candidate.selector)
    await page.locator(candidate.selector).first().click({ timeout: SAFE_CLICK_TIMEOUT_MS, noWaitAfter: true, trial: false })
    await page.waitForTimeout(350)
    page.off('request', onRequest)
    page.off('console', onConsole)
    page.off('pageerror', onPageError)
    const after = await getClickState(page, candidate.selector)
    const interaction = deriveInteractionOutcome(candidate, before, after, { popupObserved, popupUrl, navigationRequestObserved, consoleErrors, pageErrors })
    return {
      clicked: true,
      changed: interaction.outcome !== 'no-change',
      before,
      after,
      popupObserved,
      popupUrl,
      navigationRequestObserved,
      consoleErrors,
      pageErrors,
      interactionOutcome: interaction.outcome,
      interactionEvidence: interaction.evidence,
      landingUrl: interaction.landingUrl,
    }
  } catch (error) {
    return {
      clicked: false,
      changed: false,
      error: error instanceof Error ? error.message : 'safe click failed',
      interactionOutcome: classifySafeClickFailure(error).outcome,
      interactionEvidence: [classifySafeClickFailure(error).reason],
    }
  }
}

async function getClickState(page, selector) {
  return page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector)
    const controlsId = target?.getAttribute('aria-controls') || ''
    const controlled = controlsId ? document.getElementById(controlsId) : null
    const rect = controlled?.getBoundingClientRect()
    const visibleMenu = document.querySelector('[role="menu"]:not([hidden]), [data-state="open"], [aria-expanded="true"]')
    return {
      url: location.href,
      originPath: `${location.origin}${location.pathname}${location.search}`,
      hash: location.hash,
      scrollY: Number(window.scrollY || window.pageYOffset || 0),
      ariaExpanded: target?.getAttribute('aria-expanded') || '',
      ariaSelected: target?.getAttribute('aria-selected') || '',
      dialogVisible: Boolean(document.querySelector('dialog[open], [role="dialog"]:not([hidden])')),
      targetVisible: Boolean(controlled && rect && rect.width > 0 && rect.height > 0 && getComputedStyle(controlled).display !== 'none' && getComputedStyle(controlled).visibility !== 'hidden'),
      menuVisible: Boolean(visibleMenu),
      bodyTextSample: String(document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 240),
      targetClassName: target && typeof target.className === 'string' ? target.className : '',
      mutationCount: Number(window.__pagepilotMutationCount || 0),
    }
  }, selector).catch(() => ({ url: '', ariaExpanded: '', dialogVisible: false, targetVisible: false, mutationCount: 0 }))
}

export function applySafeClickResult(item, result) {
  if (!result) return item
  const outcome = result.interactionOutcome || (result.changed ? 'ui-change' : 'no-change')
  const evidence = Array.isArray(result.interactionEvidence) ? result.interactionEvidence : []
  const firstPartyErrorCount = countFirstPartyClickErrors(result)
  if (firstPartyErrorCount > 0) {
    return {
      ...item,
      status: 'error',
      category: 'click-runtime-error',
      actionClassification: 'actual-error',
      clickExecuted: result.clicked === true,
      observableChange: result.changed === true,
      interactionOutcome: 'error',
      interactionEvidence: evidence.concat(`first-party runtime error ${firstPartyErrorCount}건`),
      reason: '클릭 과정에서 first-party JavaScript error가 확인되었습니다.',
      safeClickResult: result,
    }
  }
  if (result.clicked && outcome !== 'no-change') {
    return {
      ...item,
      status: outcome === 'error' || outcome === 'blocked' ? 'error' : 'ok',
      category: outcome === 'navigation' || outcome === 'new-window' || outcome === 'modal' || outcome === 'tab' || outcome === 'accordion' || outcome === 'dropdown' || outcome === 'scroll' || outcome === 'ui-change' ? 'observable-action' : outcome,
      actionClassification: outcome === 'error' || outcome === 'blocked' ? 'actual-error' : 'verified-working',
      verificationMethod: 'safe-click-observed-action',
      clickExecuted: true,
      observableChange: true,
      interactionOutcome: outcome,
      interactionEvidence: evidence,
      landingUrl: result.landingUrl || item.landingUrl,
      reason: formatInteractionReason(outcome, evidence),
      safeClickResult: result,
    }
  }
  if (result.clicked) {
    return {
      ...item,
      status: 'warn',
      category: 'no-observable-action',
      actionClassification: 'actionable-warning',
      clickExecuted: true,
      observableChange: false,
      interactionOutcome: 'no-change',
      interactionEvidence: evidence,
      reason: '안전 클릭은 수행됐지만 관찰 가능한 변화가 없어 실제 동작 여부를 추가 확인해야 합니다.',
      safeClickResult: result,
    }
  }

  const failure = classifySafeClickFailure(result.error)
  return {
    ...item,
    status: failure.outcome === 'blocked' || failure.outcome === 'error' ? 'error' : 'warn',
    category: failure.outcome === 'blocked' ? 'covered-or-not-interactable' : 'click-error',
    actionClassification: failure.outcome === 'blocked' || failure.outcome === 'error' ? 'actual-error' : 'actionable-warning',
    clickExecuted: false,
    observableChange: false,
    interactionOutcome: failure.outcome,
    interactionEvidence: [failure.reason],
    safeClickSkippedReason: 'safe-click-failed',
    reason: `안전 클릭을 완료하지 못했습니다. ${failure.reason}`,
    safeClickResult: result,
  }
}

function getActionClassification(item = {}) {
  if (item.actionClassification) return item.actionClassification
  if (item.category === 'skipped-safe-click' || item.safeClickSkippedReason) return 'safe-click-skipped'
  if (item.category === 'UI-control-no-url-required') return 'ui-control-no-url-required'
  if (item.status === 'ok' || item.category === 'valid-url' || item.category === 'observable-action') return 'verified-working'
  if (item.category === 'covered-or-not-interactable' || item.category === 'disabled-action' || item.interactionOutcome === 'blocked' || item.interactionOutcome === 'error') return 'actual-error'
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

function hasExplicitUiControlEvidence(candidate = {}) {
  if (candidate.uiControlSemantic || candidate.dataDismiss || candidate.dataBsDismiss || candidate.dataSlide) return true
  if (candidate.ariaControls || candidate.ariaExpanded || candidate.dataTarget || candidate.dataToggle) return true
  if (textOf(candidate.role).toLowerCase() === 'tab') return true
  if (/^(submit|reset|checkbox|radio)$/i.test(textOf(candidate.type)) && candidate.formId) return true
  return false
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

function inferUiControlOutcome(candidate = {}) {
  const text = searchableText(candidate)
  if (/dialog|modal|popup|닫기|모달|팝업/.test(text)) return 'modal'
  if (/tab|tabpanel|aria-selected|탭/.test(text)) return 'tab'
  if (/accordion|collapse|expand|faq|접기|펼치기/.test(text)) return 'accordion'
  if (/dropdown|menu|popover|메뉴|드롭다운/.test(text)) return 'dropdown'
  if (/scroll|top|위로/.test(text)) return 'scroll'
  return 'ui-change'
}

function resolveLandingUrl(candidate = {}) {
  if (isHttpUrl(candidate.url)) return candidate.url
  if (isHttpUrl(candidate.href)) return candidate.href
  return ''
}

function deriveInteractionOutcome(candidate = {}, before = {}, after = {}, context = {}) {
  const evidence = []
  const sameDocument = before.originPath && after.originPath && before.originPath === after.originPath
  const urlChanged = before.url && after.url && before.url !== after.url
  const hashChanged = before.hash !== after.hash && sameDocument
  const scrollChanged = Math.abs(Number(after.scrollY || 0) - Number(before.scrollY || 0)) >= 40
  const ariaExpandedChanged = before.ariaExpanded !== after.ariaExpanded
  const ariaSelectedChanged = before.ariaSelected !== after.ariaSelected
  const dialogAppeared = after.dialogVisible === true && before.dialogVisible !== true
  const menuAppeared = after.menuVisible === true && before.menuVisible !== true
  const controlledVisibilityChanged = before.targetVisible !== after.targetVisible
  const textChanged = before.bodyTextSample !== after.bodyTextSample
  const classChanged = before.targetClassName !== after.targetClassName
  const mutationChanged = Number(after.mutationCount || 0) > Number(before.mutationCount || 0)
  const errorCount = (context.consoleErrors || []).length + (context.pageErrors || []).length

  if (context.popupObserved) {
    evidence.push('새 창 또는 새 탭 열림')
    return { outcome: 'new-window', evidence, landingUrl: context.popupUrl || candidate.landingUrl || '' }
  }
  if (urlChanged && !hashChanged) {
    evidence.push('현재 창 URL 변경')
    return { outcome: 'navigation', evidence, landingUrl: after.url || candidate.landingUrl || '' }
  }
  if (dialogAppeared) {
    evidence.push('dialog/modal 노출')
    return { outcome: 'modal', evidence, landingUrl: '' }
  }
  if (ariaSelectedChanged) {
    evidence.push('aria-selected 상태 변경')
    return { outcome: 'tab', evidence, landingUrl: '' }
  }
  if (ariaExpandedChanged || controlledVisibilityChanged) {
    evidence.push(ariaExpandedChanged ? 'aria-expanded 상태 변경' : '연결 패널 visibility 변경')
    return { outcome: inferUiControlOutcome(candidate), evidence, landingUrl: '' }
  }
  if (menuAppeared) {
    evidence.push('메뉴 또는 목록 노출')
    return { outcome: 'dropdown', evidence, landingUrl: '' }
  }
  if (hashChanged || scrollChanged) {
    evidence.push(hashChanged ? '같은 페이지 hash 이동' : '스크롤 위치 변경')
    return { outcome: 'scroll', evidence, landingUrl: '' }
  }
  if (mutationChanged || textChanged || classChanged) {
    evidence.push(mutationChanged ? 'DOM mutation 감지' : textChanged ? '주요 텍스트 변화' : 'class 상태 변화')
    if (errorCount > 0) evidence.push(`console/page error ${errorCount}건`)
    return { outcome: 'ui-change', evidence, landingUrl: '' }
  }
  if (context.navigationRequestObserved) {
    evidence.push('문서 navigation request 감지')
    return { outcome: 'navigation', evidence, landingUrl: after.url || candidate.landingUrl || '' }
  }
  return { outcome: 'no-change', evidence: errorCount > 0 ? [`console/page error ${errorCount}건 감지`] : ['관찰 가능한 변화 없음'], landingUrl: '' }
}

function classifySafeClickFailure(error) {
  const message = sanitizeMessage(error instanceof Error ? error.message : error)
  if (/intercept|pointer|not visible|element is outside|another element would receive|not enabled/i.test(message)) {
    return { outcome: 'blocked', reason: message || '클릭이 다른 요소에 가로막혔습니다.' }
  }
  if (/timeout|timed out/i.test(message)) {
    return { outcome: 'error', reason: message || '클릭 제한 시간 안에 동작을 완료하지 못했습니다.' }
  }
  return { outcome: 'error', reason: message || '클릭 중 예외가 발생했습니다.' }
}

function countFirstPartyClickErrors(result = {}) {
  const consoleErrors = Array.isArray(result.consoleErrors) ? result.consoleErrors : []
  const pageErrors = Array.isArray(result.pageErrors) ? result.pageErrors : []
  const evidence = Array.isArray(result.interactionEvidence) ? result.interactionEvidence : []
  return consoleErrors.length + pageErrors.length + evidence.filter((entry) => /first-party|page error|runtime error/i.test(String(entry || ''))).length
}

function formatInteractionReason(outcome, evidence = []) {
  const detail = Array.isArray(evidence) && evidence.length > 0 ? ` (${evidence.join(' · ')})` : ''
  if (outcome === 'navigation') return `현재 창에서 URL 이동이 감지되었습니다.${detail}`
  if (outcome === 'new-window') return `새 창 또는 새 탭 열림이 감지되었습니다.${detail}`
  if (outcome === 'modal') return `모달 또는 dialog 노출이 감지되었습니다.${detail}`
  if (outcome === 'tab') return `탭 또는 패널 상태 변경이 감지되었습니다.${detail}`
  if (outcome === 'accordion') return `아코디언 펼침/접힘 변화가 감지되었습니다.${detail}`
  if (outcome === 'dropdown') return `메뉴 또는 목록 노출이 감지되었습니다.${detail}`
  if (outcome === 'scroll') return `동일 페이지 내 스크롤 또는 anchor 이동이 감지되었습니다.${detail}`
  if (outcome === 'ui-change') return `기타 화면 상태 변화가 감지되었습니다.${detail}`
  if (outcome === 'blocked') return `클릭이 가로막혀 동작하지 않았습니다.${detail}`
  if (outcome === 'error') return `클릭 중 예외 또는 오류가 발생했습니다.${detail}`
  if (outcome === 'skipped') return `안전 정책에 따라 클릭을 생략했습니다.${detail}`
  return `관찰 가능한 변화가 없습니다.${detail}`
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

function normalizeIdentityPart(value) {
  return textOf(value).replace(/\s+/g, ' ').toLowerCase()
}

function normalizeUrlIdentity(value) {
  const text = textOf(value)
  if (!text) return ''
  try {
    const url = new URL(text, 'https://pagepilot.local')
    const path = url.pathname.replace(/\/$/, '') || '/'
    return `${url.origin.toLowerCase()}${path}${url.search}`.replace(/^https:\/\/pagepilot\.local/i, '')
  } catch {
    return normalizeIdentityPart(text)
  }
}
