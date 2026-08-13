import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chromium } from 'playwright'
import { applySafeClickResult, auditClickableActions, classifyClickableCandidate, mergeClickActionObservations, summarizeClickActionAudit } from './techClickAudit.js'

let browser

before(async () => {
  browser = await chromium.launch({ headless: true })
})

after(async () => {
  await browser?.close().catch(() => {})
})

test('A normal anchor is valid-url and ok', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', label: 'Product' }))
  assert.equal(item.hrefState, 'valid-url')
  assert.equal(item.status, 'ok')
  assert.equal(item.actionClassification, 'verified-working')
  assert.equal(item.verificationMethod, 'valid-navigation-url')
  assert.equal(item.clickExecuted, false)
})

test('valid navigation href wins over generic menu or search wording', () => {
  const searchLink = classifyClickableCandidate(candidate({ tagName: 'a', kind: 'a', href: '/search', url: 'https://example.com/search', label: 'Search', className: 'menu-link search-link' }))
  const explicitTabLink = classifyClickableCandidate(candidate({ tagName: 'a', kind: 'a', href: '/tab-one', url: 'https://example.com/tab-one', label: 'Tab one', ariaControls: 'tabpanel-one' }))

  assert.equal(searchLink.actionClassification, 'verified-working')
  assert.equal(searchLink.category, 'valid-url')
  assert.equal(explicitTabLink.actionClassification, 'ui-control-no-url-required')
})

test('valid href anchor with inferred UI-control semantic stays valid-url when not clicked', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', kind: 'a', href: '/normal/path', url: 'https://example.com/normal/path', requestedUrl: 'https://example.com/normal/path', landingUrl: 'https://example.com/normal/path', hrefState: 'valid-url', label: 'Normal path', uiControlSemantic: 'semantic-ui-control', hitTestStatus: 'hitTestNotRun', unrelatedOverlay: false, clickExecuted: false, interactionOutcome: 'ui-change' }))

  assert.equal(item.hrefState, 'valid-url')
  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'valid-url')
  assert.equal(item.actionClassification, 'verified-working')
  assert.notEqual(item.category, 'UI-control-no-url-required')
})

test('valid href navigation remains ok even when click was not executed', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', kind: 'a', href: '/details', url: 'https://example.com/details', label: 'View details', clickExecuted: false, interactionOutcome: 'unknown' }))

  assert.equal(item.hrefState, 'valid-url')
  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'valid-url')
  assert.equal(item.actionClassification, 'verified-working')
  assert.equal(item.clickExecuted, false)
})

test('true generic UI control without href remains ok', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', kind: 'button', label: 'Open menu', className: 'menu-toggle' }))

  assert.equal(item.hrefState, 'missing-href')
  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'UI-control-no-url-required')
  assert.equal(item.actionClassification, 'ui-control-no-url-required')
})

test('generic expandable sidebar or menu control without href is not ambiguous when semantic evidence is sufficient', () => {
  const sidebar = classifyClickableCandidate(candidate({ tagName: 'button', kind: 'button', label: 'Open panel', selector: '.layout-sidebar > button.toggle', domPath: 'main > aside.sidebar > button.toggle', hitTestStatus: 'hitTestPassed', descendantMatch: true, ancestorMatch: true }))
  const drawer = classifyClickableCandidate(candidate({ tagName: 'button', kind: 'button', label: 'Toggle', className: 'drawer-toggle', ariaExpanded: 'false' }))

  assert.equal(sidebar.status, 'ok')
  assert.equal(sidebar.actionClassification, 'ui-control-no-url-required')
  assert.notEqual(sidebar.category, 'ambiguous-action')
  assert.equal(drawer.actionClassification, 'ui-control-no-url-required')
})

test('button with aria-controls and controlled target is URL-free UI control', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', kind: 'button', label: 'Open panel', ariaControls: 'panel-1', controlledTargetExists: true, actionEvidence: 'aria-controls' }))

  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'UI-control-no-url-required')
  assert.equal(item.actionClassification, 'ui-control-no-url-required')
})

test('button with expandable state and controlled target is URL-free UI control', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', kind: 'button', label: 'Expand section', ariaExpanded: 'false', controlledTargetExists: true, actionEvidence: 'aria-expanded' }))

  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'UI-control-no-url-required')
  assert.equal(item.actionClassification, 'ui-control-no-url-required')
})

test('button with aria-haspopup state is URL-free UI control', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', kind: 'button', label: 'Open options', ariaHaspopup: 'menu', actionEvidence: 'aria-haspopup' }))

  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'UI-control-no-url-required')
  assert.equal(item.actionClassification, 'ui-control-no-url-required')
})

test('button with pressed toggle state is URL-free UI control', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', kind: 'button', label: 'Toggle option', ariaPressed: 'false', actionEvidence: 'aria-pressed' }))

  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'UI-control-no-url-required')
  assert.equal(item.actionClassification, 'ui-control-no-url-required')
})

test('javascript pseudo-link with sufficient generic UI-control evidence becomes UI-control-no-url-required', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', kind: 'a', href: 'javascript:void(0);', url: '', label: 'Current option', selector: '.custom-select-area > a.current', domPath: 'footer > div.select-wrap > div.custom-select-area > a.current', uiControlSemantic: 'semantic-ui-control' }))

  assert.equal(item.hrefState, 'javascript-pseudo-url')
  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'UI-control-no-url-required')
  assert.equal(item.actionClassification, 'ui-control-no-url-required')
})

test('javascript pseudo-link with aria-controls becomes URL-free UI control', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', kind: 'a', href: 'javascript:void(0)', url: '', label: 'Current option', ariaControls: 'listbox-1', controlledTargetExists: true, actionEvidence: 'aria-controls' }))

  assert.equal(item.hrefState, 'javascript-pseudo-url')
  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'UI-control-no-url-required')
  assert.equal(item.actionClassification, 'ui-control-no-url-required')
})

test('javascript pseudo-link with listbox semantic evidence becomes URL-free UI control', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', kind: 'a', href: 'javascript:void(0)', url: '', label: 'Current option', role: 'combobox', ariaHaspopup: 'listbox', actionEvidence: 'aria-haspopup' }))

  assert.equal(item.hrefState, 'javascript-pseudo-url')
  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'UI-control-no-url-required')
  assert.equal(item.actionClassification, 'ui-control-no-url-required')
})

test('javascript pseudo-link without UI-control evidence remains warning', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', kind: 'a', href: 'javascript:void(0)', url: '', label: 'Apply now', hasOnClick: true, selector: '.primary-cta' }))

  assert.equal(item.hrefState, 'javascript-pseudo-url')
  assert.equal(item.status, 'warn')
  assert.equal(item.category, 'javascript-pseudo-url')
  assert.equal(item.actionClassification, 'actionable-warning')
})

test('button without href action or UI-control evidence remains ambiguous-action', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', kind: 'button', label: 'Continue', className: 'primary-cta', hasOnClick: false, actionEvidence: '' }))

  assert.equal(item.hrefState, 'missing-href')
  assert.equal(item.status, 'warn')
  assert.equal(item.category, 'ambiguous-action')
  assert.equal(item.actionClassification, 'actionable-warning')
})

test('B role button CTA without href is ambiguous action for UID follow-up', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'div', role: 'button', className: 'primary-cta', label: 'Product' }))
  assert.equal(item.hrefState, 'missing-href')
  assert.equal(item.category, 'ambiguous-action')
  assert.equal(item.status, 'warn')
  assert.equal(item.actionClassification, 'actionable-warning')
})

test('C javascript pseudo CTA keeps actual href and technical term', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: 'javascript:void(0)', label: 'Product', hasOnClick: true }))
  assert.equal(item.hrefState, 'javascript-pseudo-url')
  assert.equal(item.technicalTerm, 'javascript:void(0)')
  assert.equal(item.href, 'javascript:void(0)')
  assert.equal(item.status, 'warn')
})

test('D modal button is UI-control-no-url-required and not URL error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', ariaControls: 'modal', label: 'Detail' }))
  assert.equal(item.category, 'UI-control-no-url-required')
  assert.equal(item.status, 'ok')
  assert.equal(item.actionClassification, 'ui-control-no-url-required')
})

test('E pointer-events none CTA is not interactable', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', pointerEvents: 'none', label: 'Product' }))
  assert.equal(item.category, 'covered-or-not-interactable')
  assert.equal(item.status, 'error')
})

test('visible unique pointer-events none control remains an actual error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Open panel', pointerEvents: 'none', ariaControls: 'panel', ariaExpanded: 'false', relatedUsableTarget: false }))

  assert.equal(item.category, 'covered-or-not-interactable')
  assert.equal(item.status, 'error')
  assert.equal(item.actionClassification, 'actual-error')
})

test('inactive alternate pointer-events none control with usable related target is not actual site error', () => {
  const item = classifyClickableCandidate(candidate({
    tagName: 'button',
    label: 'Products',
    pointerEvents: 'none',
    ariaControls: 'panel',
    ariaExpanded: 'false',
    viewportState: 'inViewport',
    hitTestStatus: 'hitTestFailed',
    relatedUsableTarget: true,
    relatedUsableTargetTag: 'a',
    relatedUsableTargetHref: '/products',
    relatedUsableTargetLabel: 'Products',
  }))

  assert.equal(item.status, 'warn')
  assert.equal(item.category, 'inactive-alternate-control')
  assert.equal(item.actionClassification, 'actionable-warning')
  assert.notEqual(item.category, 'covered-or-not-interactable')
})

test('F overlay covered CTA is covered-or-not-interactable', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', hitTargetSame: false, hitTestStatus: 'hitTestFailed', label: 'Product' }))
  assert.equal(item.category, 'covered-or-not-interactable')
  assert.equal(item.status, 'error')
})

test('G safe click with observable dialog or DOM change becomes ok', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Open details', hasOnClick: true }))
  const checked = applySafeClickResult(item, { clicked: true, changed: true, after: { dialogVisible: true } })
  assert.equal(checked.category, 'observable-action')
  assert.equal(checked.status, 'ok')
  assert.equal(checked.actionClassification, 'verified-working')
})

test('pre-existing runtime errors are preserved but not attributed to a successful click', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Open details', hasOnClick: true }))
  const checked = applySafeClickResult(item, {
    clicked: true,
    changed: true,
    interactionOutcome: 'ui-change',
    interactionEvidence: ['DOM mutation 감지'],
    consoleErrors: ['ReferenceError: existed before click'],
    runtimeErrors: [{ eventType: 'console', message: 'ReferenceError: existed before click' }],
    preClickRuntimeErrors: [{ eventType: 'console', message: 'ReferenceError: existed before click' }],
    firstPartyRuntimeErrors: [],
  })

  assert.equal(checked.actionClassification, 'verified-working')
  assert.equal(checked.status, 'ok')
  assert.equal(checked.safeClickResult.preClickRuntimeErrors.length, 1)
})

test('new first-party runtime error after click remains an actual error even with observable change', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Open details', hasOnClick: true }))
  const checked = applySafeClickResult(item, {
    clicked: true,
    changed: true,
    interactionOutcome: 'ui-change',
    interactionEvidence: ['DOM mutation 감지'],
    attributedRuntimeErrors: [{ eventType: 'pageerror', message: 'ReferenceError: click handler failed', source: 'pageerror' }],
    firstPartyRuntimeErrors: [{ eventType: 'pageerror', message: 'ReferenceError: click handler failed', party: 'first-party' }],
  })

  assert.equal(checked.category, 'click-runtime-error')
  assert.equal(checked.actionClassification, 'actual-error')
  assert.equal(checked.observableChange, true)
})

test('third-party-only click runtime noise does not become click-runtime-error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Open details', hasOnClick: true }))
  const checked = applySafeClickResult(item, {
    clicked: true,
    changed: true,
    interactionOutcome: 'ui-change',
    interactionEvidence: ['DOM mutation 감지'],
    attributedRuntimeErrors: [{ eventType: 'console', message: 'Third party script failed', sourceUrl: 'https://cdn.example.test/widget.js' }],
    firstPartyRuntimeErrors: [],
  })

  assert.equal(checked.actionClassification, 'verified-working')
  assert.notEqual(checked.category, 'click-runtime-error')
})

test('H safe click with no observable change becomes no-observable-action', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Custom action', hasOnClick: true }))
  const checked = applySafeClickResult(item, { clicked: true, changed: false })
  assert.equal(checked.category, 'no-observable-action')
  assert.equal(checked.status, 'warn')
  assert.equal(checked.actionClassification, 'actionable-warning')
})

test('I dangerous action skips actual click and is not hard error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Delete item', hasOnClick: true }))
  assert.equal(item.category, 'skipped-safe-click')
  assert.equal(item.status, 'ok')
  assert.equal(item.actionClassification, 'safe-click-skipped')
  assert.equal(item.safeClickSkippedReason, 'dangerous-action')
})

test('click action summary preserves all problem items and meta counts', () => {
  const items = [
    classifyClickableCandidate(candidate({ tagName: 'a', href: '/ok', url: 'https://example.com/ok' })),
    classifyClickableCandidate(candidate({ tagName: 'a', href: 'javascript:void(0)', hasOnClick: true })),
    classifyClickableCandidate(candidate({ tagName: 'a', href: '/blocked', url: 'https://example.com/blocked', pointerEvents: 'none' })),
  ]
  const summary = summarizeClickActionAudit(items, { safeClickAttemptCount: 1 })
  assert.equal(summary.status, 'error')
  assert.equal(summary.items.length, 2)
  assert.equal(summary.meta.candidateCount, 3)
  assert.equal(summary.meta.safeClickAttemptCount, 1)
  assert.equal(summary.meta.actualErrorCount, 1)
  assert.equal(summary.meta.actionableWarningCount, 1)
})

test('click action classifies direct href navigation and new-window outcomes', () => {
  const navigation = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', label: 'Product' }))
  const popup = classifyClickableCandidate(candidate({ tagName: 'a', href: '/brochure', url: 'https://example.com/brochure', target: '_blank', label: 'Brochure' }))

  assert.equal(navigation.interactionOutcome, 'navigation')
  assert.equal(navigation.landingUrl, 'https://example.com/product')
  assert.equal(popup.interactionOutcome, 'new-window')
})

test('click action records modal tab accordion dropdown scroll and ui-change outcomes from safe click', () => {
  const modal = applySafeClickResult(classifyClickableCandidate(candidate({ tagName: 'button', ariaControls: 'dialog-1', label: 'Open modal' })), { clicked: true, changed: true, interactionOutcome: 'modal', interactionEvidence: ['dialog/modal 노출'] })
  const tab = applySafeClickResult(classifyClickableCandidate(candidate({ tagName: 'button', role: 'tab', label: 'Tab 2' })), { clicked: true, changed: true, interactionOutcome: 'tab', interactionEvidence: ['aria-selected 상태 변경'] })
  const accordion = applySafeClickResult(classifyClickableCandidate(candidate({ tagName: 'button', ariaExpanded: 'false', label: 'FAQ' })), { clicked: true, changed: true, interactionOutcome: 'accordion', interactionEvidence: ['aria-expanded 상태 변경'] })
  const dropdown = applySafeClickResult(classifyClickableCandidate(candidate({ tagName: 'button', label: 'Open menu', dataToggle: 'dropdown' })), { clicked: true, changed: true, interactionOutcome: 'dropdown', interactionEvidence: ['메뉴 또는 목록 노출'] })
  const scroll = applySafeClickResult(classifyClickableCandidate(candidate({ tagName: 'a', href: '#top', label: 'Top' })), { clicked: true, changed: true, interactionOutcome: 'scroll', interactionEvidence: ['스크롤 위치 변경'] })
  const uiChange = applySafeClickResult(classifyClickableCandidate(candidate({ tagName: 'button', label: 'Toggle summary', hasOnClick: true })), { clicked: true, changed: true, interactionOutcome: 'ui-change', interactionEvidence: ['DOM mutation 감지'] })

  assert.equal(modal.actionClassification, 'verified-working')
  assert.equal(tab.interactionOutcome, 'tab')
  assert.equal(accordion.interactionOutcome, 'accordion')
  assert.equal(dropdown.interactionOutcome, 'dropdown')
  assert.equal(scroll.interactionOutcome, 'scroll')
  assert.equal(uiChange.interactionOutcome, 'ui-change')
})

test('click action records blocked error and skipped outcomes', () => {
  const skipped = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Delete account', hasOnClick: true }))
  const blocked = applySafeClickResult(classifyClickableCandidate(candidate({ tagName: 'button', label: 'Open panel', hasOnClick: true })), { clicked: false, changed: false, error: 'Element is not visible and another element would receive the click' })
  const errored = applySafeClickResult(classifyClickableCandidate(candidate({ tagName: 'button', label: 'Run action', hasOnClick: true })), { clicked: false, changed: false, error: 'Execution context was destroyed' })

  assert.equal(skipped.interactionOutcome, 'skipped')
  assert.equal(blocked.interactionOutcome, 'blocked')
  assert.equal(blocked.actionClassification, 'actual-error')
  assert.equal(errored.interactionOutcome, 'error')
})

test('generic fixture separates five click classifications for counting', () => {
  const items = [
    classifyClickableCandidate(candidate({ auditId: 'pointer', tagName: 'a', href: '/product', url: 'https://example.com/product', pointerEvents: 'none', label: 'Product' })),
    classifyClickableCandidate(candidate({ auditId: 'overlay', tagName: 'a', href: '/covered', url: 'https://example.com/covered', hitTargetSame: false, hitTestStatus: 'hitTestFailed', label: 'Covered' })),
    ...Array.from({ length: 5 }, (_, index) => classifyClickableCandidate(candidate({ auditId: `skip-${index}`, tagName: 'button', label: `Delete ${index}`, hasOnClick: true }))),
    ...Array.from({ length: 8 }, (_, index) => classifyClickableCandidate(candidate({ auditId: `ui-${index}`, tagName: 'button', ariaControls: `panel-${index}`, label: `Accordion ${index}` }))),
    ...Array.from({ length: 3 }, (_, index) => applySafeClickResult(classifyClickableCandidate(candidate({ auditId: `verified-${index}`, tagName: 'button', label: `Custom ${index}`, hasOnClick: true })), { clicked: true, changed: true, interactionOutcome: 'ui-change', interactionEvidence: ['DOM mutation 감지'] })),
    applySafeClickResult(classifyClickableCandidate(candidate({ auditId: 'no-change', tagName: 'button', label: 'Custom action', hasOnClick: true })), { clicked: true, changed: false }),
  ]
  const summary = summarizeClickActionAudit(items)

  assert.equal(summary.meta.actualErrorCount, 2)
  assert.equal(summary.meta.actionableWarningCount, 1)
  assert.equal(summary.meta.safeClickSkippedCount, 5)
  assert.equal(summary.meta.uiControlNoUrlRequiredCount, 8)
  assert.equal(summary.meta.verifiedWorkingCount, 3)
  assert.equal(summary.items.length, 3)
})

test('valid absolute href is verified without safe click', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: 'https://example.com/product', url: 'https://example.com/product', label: 'Product' }))

  assert.equal(item.actionClassification, 'verified-working')
  assert.equal(item.verificationMethod, 'valid-navigation-url')
  assert.equal(item.safeClickEligible, false)
  assert.equal(item.clickExecuted, false)
})

test('valid relative href is verified when resolved URL exists', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', label: 'Product' }))

  assert.equal(item.hrefState, 'valid-url')
  assert.equal(item.actionClassification, 'verified-working')
})

test('target blank href is verified without popup click', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', target: '_blank', label: 'Product' }))

  assert.equal(item.actionClassification, 'verified-working')
  assert.equal(item.clickExecuted, false)
})

test('normal href with hitTestNotRun is not actual error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', hitTargetSame: false, hitTestStatus: 'hitTestNotRun', label: 'Product' }))

  assert.equal(item.hitTestStatus, 'hitTestNotRun')
  assert.equal(item.actionClassification, 'verified-working')
  assert.notEqual(item.category, 'no-observable-action')
})

test('legacy hitTargetSame false without explicit hitTestFailed is not actual error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', hitTargetSame: false, label: 'Product' }))

  assert.equal(item.hitTestStatus, 'hitTestNotRun')
  assert.equal(item.actionClassification, 'verified-working')
})

test('pointer-events none with valid href remains actual error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', pointerEvents: 'none', label: 'Product' }))

  assert.equal(item.actionClassification, 'actual-error')
})

test('hash-only href is actionable warning, not actual error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '#', url: '', label: 'Product' }))

  assert.equal(item.hrefState, 'hash-only')
  assert.equal(item.actionClassification, 'actionable-warning')
})

test('javascript pseudo URL is actionable warning, not actual error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: 'javascript:void(0)', url: '', label: 'Product', hasOnClick: true }))

  assert.equal(item.hrefState, 'javascript-pseudo-url')
  assert.equal(item.actionClassification, 'actionable-warning')
})

test('safe click result records executed and observable states', () => {
  const base = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Open details', hasOnClick: true }))
  const changed = applySafeClickResult(base, { clicked: true, changed: true, interactionOutcome: 'ui-change', interactionEvidence: ['DOM mutation 감지'] })
  const unchanged = applySafeClickResult(base, { clicked: true, changed: false })
  const failed = applySafeClickResult(base, { clicked: false, changed: false, error: 'not clickable' })

  assert.equal(changed.actionClassification, 'verified-working')
  assert.equal(changed.clickExecuted, true)
  assert.equal(changed.observableChange, true)
  assert.equal(unchanged.actionClassification, 'actionable-warning')
  assert.equal(unchanged.clickExecuted, true)
  assert.equal(unchanged.observableChange, false)
  assert.equal(failed.actionClassification, 'actual-error')
  assert.equal(failed.clickExecuted, false)
})

test('bulk normal href regression does not inflate actual errors', () => {
  const items = [
    ...Array.from({ length: 50 }, (_, index) => classifyClickableCandidate(candidate({ auditId: `ok-${index}`, tagName: 'a', href: `/product-${index}`, url: `https://example.com/product-${index}`, label: `Product ${index}`, hitTargetSame: false, hitTestStatus: 'hitTestNotRun' }))),
    ...Array.from({ length: 2 }, (_, index) => classifyClickableCandidate(candidate({ auditId: `blocked-${index}`, tagName: 'a', href: `/blocked-${index}`, url: `https://example.com/blocked-${index}`, pointerEvents: 'none', label: `Blocked ${index}` }))),
    ...Array.from({ length: 3 }, (_, index) => classifyClickableCandidate(candidate({ auditId: `pseudo-${index}`, tagName: 'a', href: 'javascript:void(0)', label: `Pseudo ${index}`, hasOnClick: true }))),
  ]
  const summary = summarizeClickActionAudit(items)

  assert.equal(summary.meta.verifiedWorkingCount, 50)
  assert.equal(summary.meta.actualErrorCount, 2)
  assert.equal(summary.meta.actionableWarningCount, 3)
})

test('modal close control is URL-free UI control', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Close', ariaLabel: 'Close', dataDismiss: 'modal', actionEvidence: 'data-dismiss' }))

  assert.equal(item.actionClassification, 'ui-control-no-url-required')
  assert.equal(item.status, 'ok')
  assert.equal(item.technicalTerm, 'UI 제어 동작')
  assert.notEqual(item.technicalTerm, 'href 누락')
})

test('carousel previous and next controls are URL-free UI controls', () => {
  const previous = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Previous slide', ariaLabel: 'Previous slide', dataSlide: 'prev', actionEvidence: 'data-slide' }))
  const next = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Next slide', ariaLabel: 'Next slide', dataSlide: 'next', actionEvidence: 'data-slide' }))

  assert.equal(previous.actionClassification, 'ui-control-no-url-required')
  assert.equal(next.actionClassification, 'ui-control-no-url-required')
})

test('menu toggle with aria controls is URL-free UI control', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Menu', ariaExpanded: 'false', ariaControls: 'menu', actionEvidence: 'aria-controls, aria-expanded' }))

  assert.equal(item.actionClassification, 'ui-control-no-url-required')
})

test('search and sitemap toggles are URL-free UI controls without site-specific copy', () => {
  const search = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Search menu', className: 'header-search-toggle' }))
  const sitemap = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Open sitemap', className: 'site-map-toggle' }))

  assert.equal(search.actionClassification, 'ui-control-no-url-required')
  assert.equal(sitemap.actionClassification, 'ui-control-no-url-required')
})

test('generated Clickable label without action evidence is not actual error', () => {
  const item = classifyClickableCandidate(candidate({ label: 'Clickable 79', text: '', generatedLabel: true, className: 'clickable-looking', hitTestStatus: 'hitTestNotRun' }))

  assert.equal(item.actionClassification, 'actionable-warning')
  assert.notEqual(item.status, 'error')
})

test('unnamed role button with click evidence is actionable warning before safe click', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'div', role: 'button', label: 'Clickable 80', text: '', generatedLabel: true, hasOnClick: true, actionEvidence: 'onclick' }))

  assert.equal(item.actionClassification, 'actionable-warning')
  assert.equal(item.status, 'warn')
})

test('button with child span hit target is hit-test passed', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Close', dataDismiss: 'modal', hitTestStatus: 'hitTestPassed', hitTargetTag: 'span', descendantMatch: true, hitTargetSame: true }))

  assert.equal(item.hitTestStatus, 'hitTestPassed')
  assert.equal(item.actionClassification, 'ui-control-no-url-required')
  assert.notEqual(item.status, 'error')
})

test('unrelated overlay remains actual error with overlay evidence', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Open', hitTestStatus: 'hitTestFailed', unrelatedOverlay: true, overlaySelector: '#overlay', hitTargetSelector: '#overlay' }))

  assert.equal(item.actionClassification, 'actual-error')
  assert.equal(item.reason.includes('unrelated overlay'), true)
})

test('active semantic overlay blocks automation as review instead of target defect', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Custom action', hasOnClick: true, hitTestStatus: 'hitTestFailed', unrelatedOverlay: true, overlaySelector: '[role="dialog"]', hitTargetSelector: '[role="dialog"]', overlayVisible: true, overlayCoversClickPoint: true, overlayPointerEvents: 'auto', overlayOpacity: 1, overlayRole: 'dialog', overlaySemantic: true }))

  assert.equal(item.status, 'warn')
  assert.equal(item.category, 'blocked-by-active-overlay')
  assert.equal(item.actionClassification, 'actionable-warning')
  assert.equal(item.interactionOutcome, 'blocked')
})

test('hidden or non-intercepting overlay evidence is not treated as a blocker', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', hitTestStatus: 'hitTestFailed', unrelatedOverlay: true, overlayVisible: false, overlayCoversClickPoint: false, overlayPointerEvents: 'none', overlayOpacity: 0 }))

  assert.equal(item.category, 'valid-url')
  assert.equal(item.actionClassification, 'verified-working')
})

test('collapsed or hit-test unavailable UI control is not actual error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Next slide', dataSlide: 'next', hitTestStatus: 'hitTestUnavailable', viewportState: 'outsideViewport' }))

  assert.equal(item.actionClassification, 'ui-control-no-url-required')
  assert.notEqual(item.status, 'error')
})

test('safe click timeout is actual error after click execution fails', () => {
  const base = classifyClickableCandidate(candidate({ tagName: 'div', role: 'button', label: 'Open panel', hasOnClick: true, actionEvidence: 'onclick' }))
  const checked = applySafeClickResult(base, { clicked: false, changed: false, error: 'Timeout 2500ms exceeded' })

  assert.equal(checked.actionClassification, 'actual-error')
  assert.equal(checked.status, 'error')
})

test('phase 3A click fixtures keep UI controls out of false positive errors and preserve real failures', () => {
  const problem = applySafeClickResult(classifyClickableCandidate(candidate({ tagName: 'button', label: 'Run action', hasOnClick: true })), { clicked: true, changed: true, consoleErrors: ['ReferenceError: brokenHandler'], interactionOutcome: 'ui-change' })
  const review = applySafeClickResult(classifyClickableCandidate(candidate({ tagName: 'button', label: 'Track analytics', hasOnClick: true })), { clicked: true, changed: false })
  const normal = classifyClickableCandidate(candidate({ tagName: 'a', href: '/ok', url: 'https://example.com/ok', label: 'Open page' }))
  const excluded = classifyClickableCandidate(candidate({ tagName: 'button', role: 'button', ariaControls: 'menu', label: 'Menu' }))
  const falsePositive = applySafeClickResult(classifyClickableCandidate(candidate({ tagName: 'a', href: '#', label: 'Open modal', hasOnClick: true })), { clicked: true, changed: true, interactionOutcome: 'modal', interactionEvidence: ['dialog/modal 노출'] })

  assert.equal(problem.actionClassification, 'actual-error')
  assert.equal(review.actionClassification, 'actionable-warning')
  assert.equal(normal.actionClassification, 'verified-working')
  assert.equal(excluded.actionClassification, 'ui-control-no-url-required')
  assert.equal(falsePositive.actionClassification, 'verified-working')
  assert.notEqual(falsePositive.status, 'error')
})

test('clickable candidate source dedupes parent descendant actions generically', () => {
  const source = fs.readFileSync('server/index.js', 'utf8')

  assert.equal(source.includes('shouldSkipDescendantClickableCandidate'), true)
  assert.equal(source.includes('isPrimaryInteractiveElement'), true)
  assert.equal(source.includes('hasPrimaryInteractiveDescendant'), true)
  assert.equal(source.includes('generatedLabel'), true)
  assert.equal(source.includes('uiControlSemantic'), true)
  assert.equal(source.includes('shouldKeepVisualEvidenceCandidate'), true)
  assert.equal(source.includes('isPlainTextContainer'), true)
  assert.equal(source.includes('[data-action]'), true)
})

test('one anchor with text descendants stays one verified action in classification summary', () => {
  const items = [classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', label: 'Product title Description' }))]
  const summary = summarizeClickActionAudit(items)

  assert.equal(summary.meta.verifiedWorkingCount, 1)
  assert.equal(summary.meta.actualErrorCount, 0)
  assert.equal(summary.meta.actionableWarningCount, 0)
})

test('click action observations merge only when generic target identity matches', () => {
  const sameTargetWarning = classifyClickableCandidate(candidate({ auditId: 'warn-1', selector: '#promo', domPath: 'main>a:nth-child(1)', label: 'Promotion', href: 'javascript:void(0)', hasOnClick: true, section: 'hero' }))
  const sameTargetOk = applySafeClickResult(classifyClickableCandidate(candidate({ auditId: 'ok-1', selector: '#promo', domPath: 'main>a:nth-child(1)', label: 'Promotion', href: 'javascript:void(0)', hasOnClick: true, section: 'hero' })), { clicked: true, changed: true, interactionOutcome: 'navigation', interactionEvidence: ['현재 창 URL 변경'] })
  const distinctSameLabel = classifyClickableCandidate(candidate({ auditId: 'warn-2', selector: '#footer-promo', domPath: 'footer>a:nth-child(1)', label: 'Promotion', href: 'javascript:void(0)', hasOnClick: true, section: 'footer' }))

  const merged = mergeClickActionObservations([sameTargetWarning, sameTargetOk, distinctSameLabel])

  assert.equal(merged.length, 2)
  assert.equal(merged[0].selector, '#promo')
  assert.equal(merged[0].actionClassification, 'actionable-warning')
  assert.equal(merged[0].observationCount, 2)
  assert.deepEqual(merged[0].mergedInteractionOutcomes.sort(), ['navigation', 'unknown'])
  assert.equal(merged[1].selector, '#footer-promo')
})

test('click action summary counts merged target observations once and keeps distinct same-label elements', () => {
  const items = [
    classifyClickableCandidate(candidate({ auditId: 'blocked', selector: '#cta', label: 'Open', pointerEvents: 'none' })),
    applySafeClickResult(classifyClickableCandidate(candidate({ auditId: 'safe', selector: '#cta', label: 'Open', hasOnClick: true })), { clicked: false, changed: false, error: 'Timeout 2500ms exceeded' }),
    classifyClickableCandidate(candidate({ auditId: 'other', selector: '#other-cta', label: 'Open', href: '/open', url: 'https://example.com/open' })),
  ]
  const summary = summarizeClickActionAudit(items)

  assert.equal(summary.meta.candidateCount, 2)
  assert.equal(summary.meta.actualErrorCount, 1)
  assert.equal(summary.meta.verifiedWorkingCount, 1)
})

test('valid href anchor stays verified when merged with weaker UI-control observation', () => {
  const validHref = classifyClickableCandidate(candidate({ auditId: 'href', tagName: 'a', kind: 'a', selector: '#normal-link', domPath: 'main>a:nth-child(1)', href: '/normal/path', url: 'https://example.com/normal/path', requestedUrl: 'https://example.com/normal/path', landingUrl: 'https://example.com/normal/path', label: 'Normal link' }))
  const uiControlObservation = classifyClickableCandidate(candidate({ auditId: 'ui', tagName: 'a', kind: 'a', selector: '#normal-link', domPath: 'main>a:nth-child(1)', href: '', url: '', landingUrl: 'https://example.com/normal/path', label: 'Normal link', uiControlSemantic: 'semantic-ui-control', ariaExpanded: 'false' }))

  const [merged] = mergeClickActionObservations([validHref, uiControlObservation])

  assert.equal(merged.actionClassification, 'verified-working')
  assert.equal(merged.category, 'valid-url')
  assert.equal(merged.hrefState, 'valid-url')
  assert.equal(merged.landingUrl, 'https://example.com/normal/path')
})

test('URL-free UI controls and runtime errors keep existing Click policies', () => {
  const buttonControl = classifyClickableCandidate(candidate({ tagName: 'button', kind: 'button', href: '', url: '', ariaControls: 'panel', ariaExpanded: 'false', uiControlSemantic: 'controlled-ui', label: 'Open panel' }))
  const pseudoControl = classifyClickableCandidate(candidate({ tagName: 'a', kind: 'a', href: 'javascript:void(0)', url: '', ariaControls: 'panel', ariaExpanded: 'false', label: 'Toggle panel' }))
  const clickedNavigation = applySafeClickResult(classifyClickableCandidate(candidate({ tagName: 'a', kind: 'a', href: '/normal/path', url: 'https://example.com/normal/path', label: 'Normal link' })), { clicked: true, changed: true, interactionOutcome: 'navigation', interactionEvidence: ['현재 창 URL 변경'] })
  const runtimeError = applySafeClickResult(classifyClickableCandidate(candidate({ tagName: 'a', kind: 'a', href: '/normal/path', url: 'https://example.com/normal/path', label: 'Normal link' })), { clicked: true, changed: true, interactionOutcome: 'navigation', interactionEvidence: ['현재 창 URL 변경'], firstPartyRuntimeErrors: [{ eventType: 'pageerror', message: 'ReferenceError: click failed', party: 'first-party' }] })

  assert.equal(buttonControl.category, 'UI-control-no-url-required')
  assert.equal(buttonControl.actionClassification, 'ui-control-no-url-required')
  assert.equal(pseudoControl.actionClassification, 'ui-control-no-url-required')
  assert.equal(clickedNavigation.actionClassification, 'verified-working')
  assert.equal(clickedNavigation.category, 'observable-action')
  assert.equal(runtimeError.category, 'click-runtime-error')
  assert.equal(runtimeError.actionClassification, 'actual-error')
})

test('URL-free semantic button keeps source URL out of href and formAction fields', () => {
  const sourceUrl = 'https://example.com/current-page'
  const item = classifyClickableCandidate(candidate({ tagName: 'button', kind: 'button', label: 'Open menu', className: 'menu-toggle', href: '', url: '', formAction: '', sourceUrl }))

  assert.equal(item.hrefState, 'missing-href')
  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'UI-control-no-url-required')
  assert.equal(item.actionClassification, 'ui-control-no-url-required')
  assert.equal(item.href, '')
  assert.equal(item.formAction, '')
  assert.equal(item.url, '')
  assert.equal(item.sourceUrl, sourceUrl)
})

test('URL-free close modal button keeps source URL out of href and formAction fields', () => {
  const sourceUrl = 'https://example.com/current-page'
  const item = classifyClickableCandidate(candidate({ tagName: 'button', kind: 'button', label: 'Close', ariaLabel: 'Close', dataDismiss: 'modal', actionEvidence: 'data-dismiss', href: '', url: '', formAction: '', sourceUrl }))

  assert.equal(item.hrefState, 'missing-href')
  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'UI-control-no-url-required')
  assert.equal(item.interactionOutcome, 'modal')
  assert.equal(item.href, '')
  assert.equal(item.formAction, '')
  assert.equal(item.url, '')
  assert.equal(item.sourceUrl, sourceUrl)
})

test('valid href anchor keeps actual href and resolved request URL separate from source URL', () => {
  const sourceUrl = 'https://example.com/current-page'
  const item = classifyClickableCandidate(candidate({ tagName: 'a', kind: 'a', label: 'Details', href: '/details', url: 'https://example.com/details', requestedUrl: 'https://example.com/details', sourceUrl }))

  assert.equal(item.hrefState, 'valid-url')
  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'valid-url')
  assert.equal(item.interactionOutcome, 'navigation')
  assert.equal(item.href, '/details')
  assert.equal(item.url, 'https://example.com/details')
  assert.equal(item.requestedUrl, 'https://example.com/details')
  assert.equal(item.sourceUrl, sourceUrl)
})

test('actual form action is preserved without treating source URL as href fallback', () => {
  const sourceUrl = 'https://example.com/current-page'
  const item = classifyClickableCandidate(candidate({ tagName: 'button', kind: 'button', label: 'Submit search', type: 'submit', formId: 'search-form', href: '', url: '', formAction: 'https://example.com/search', sourceUrl }))

  assert.equal(item.hrefState, 'missing-href')
  assert.equal(item.href, '')
  assert.equal(item.url, '')
  assert.equal(item.formAction, 'https://example.com/search')
  assert.equal(item.sourceUrl, sourceUrl)
})

test('javascript pseudo-link keeps actual href and never resolves to source URL', () => {
  const sourceUrl = 'https://example.com/current-page'
  const item = classifyClickableCandidate(candidate({ tagName: 'a', kind: 'a', label: 'Apply now', href: 'javascript:void(0)', url: '', hasOnClick: true, sourceUrl }))

  assert.equal(item.hrefState, 'javascript-pseudo-url')
  assert.equal(item.status, 'warn')
  assert.equal(item.category, 'javascript-pseudo-url')
  assert.equal(item.href, 'javascript:void(0)')
  assert.equal(item.url, '')
  assert.equal(item.sourceUrl, sourceUrl)
})

test('clickable DOM collection does not read implicit browser formAction current-page fallback', () => {
  const source = fs.readFileSync('server/index.js', 'utf8')

  assert.equal(source.includes('formAction: getActualFormAction(button)'), true)
  assert.equal(source.includes('formAction: getActualFormAction(element)'), true)
  assert.equal(source.includes('function getActualFormAction'), true)
  assert.equal(source.includes("element.form?.getAttribute('action')"), true)
  assert.equal(source.includes('sourceUrl: location.href || baseUrl'), true)
  assert.equal(source.includes('formAction: button.formAction ||'), false)
  assert.equal(source.includes('formAction: element.formAction ||'), false)
})

test('clickable DOM collection records generic related usable targets for inactive alternates', () => {
  const source = fs.readFileSync('server/index.js', 'utf8')
  const relatedTargetSource = source.slice(source.indexOf('function getRelatedUsableTargetInfo'), source.indexOf('function shouldKeepVisualEvidenceCandidate'))

  assert.equal(relatedTargetSource.includes('getRelatedUsableTargetInfo'), true)
  assert.equal(relatedTargetSource.includes('relatedUsableTarget'), true)
  assert.equal(relatedTargetSource.includes('shareSemanticActionContainer'), true)
  assert.equal(/Apple|apple\.com|MDN|developer\.mozilla|BMW|BMWFS|스토어|Mac|iPad|iPhone|Watch/.test(relatedTargetSource), false)
})

test('offscreen safe button is viewport-prepared, clicked, and verified by UI change', async () => {
  const result = await auditClickableActions(browser, pageFixture(`
    <style>body{margin:0}.spacer{height:1200px}</style>
    <div class="spacer"></div>
    <button id="offscreen">Reveal details</button>
    <p id="state">Before</p>
    <script>document.querySelector('#offscreen').addEventListener('click', () => { document.querySelector('#state').textContent = 'After' })</script>
  `), [offscreenCandidate({ label: 'Reveal details' })])

  assert.equal(result.items[0].status, 'ok')
  assert.equal(result.items[0].actionClassification, 'verified-working')
  assert.equal(result.items[0].clickExecuted, true)
  assert.equal(result.items[0].safeClickResult.viewportPreparation.succeeded, true)
})

test('offscreen safe button is viewport-prepared inside horizontal scroll containers', async () => {
  const result = await auditClickableActions(browser, pageFixture(`
    <style>.scroller{width:320px;overflow:auto}.wide{width:1400px;height:120px;position:relative}#offscreen{position:absolute;left:1100px;top:40px}</style>
    <div class="scroller"><div class="wide"><button id="offscreen">Reveal panel</button></div></div>
    <p id="state">Before</p>
    <script>document.querySelector('#offscreen').addEventListener('click', () => { document.querySelector('#state').textContent = 'After' })</script>
  `), [offscreenCandidate({ label: 'Reveal panel', boundingBox: { x: 1100, y: 40, width: 120, height: 32 } })])

  assert.equal(result.items[0].status, 'ok')
  assert.equal(result.items[0].clickExecuted, true)
  assert.equal(result.items[0].safeClickResult.viewportPreparation.hitTestStatus, 'hitTestPassed')
})

test('offscreen safe button with anchor or scroll change is verified as observable action', async () => {
  const result = await auditClickableActions(browser, pageFixture(`
    <style>body{margin:0}.spacer{height:1200px}.target{margin-top:900px;height:80px}</style>
    <div class="spacer"></div>
    <button id="offscreen">Jump to details</button>
    <div id="target" class="target">Target</div>
    <script>document.querySelector('#offscreen').addEventListener('click', () => { document.querySelector('#target').scrollIntoView() })</script>
  `), [offscreenCandidate({ label: 'Jump to details' })])

  assert.equal(result.items[0].status, 'ok')
  assert.equal(result.items[0].interactionOutcome, 'scroll')
  assert.equal(result.items[0].clickExecuted, true)
})

test('viewport preparation failure does not force an offscreen button to ok', async () => {
  const result = await auditClickableActions(browser, pageFixture(`
    <button id="offscreen" style="position:fixed;left:-10000px;top:20px">Hidden action</button>
  `), [offscreenCandidate({ label: 'Hidden action', boundingBox: { x: -10000, y: 20, width: 120, height: 32 } })])

  assert.equal(result.items[0].status, 'warn')
  assert.equal(result.items[0].actionClassification, 'actionable-warning')
  assert.equal(result.items[0].clickExecuted, false)
  assert.equal(result.items[0].safeClickResult.viewportPreparation.succeeded, false)
})

test('viewport preparation success with no observable action remains a warning', async () => {
  const result = await auditClickableActions(browser, pageFixture(`
    <style>body{margin:0}.spacer{height:1200px}</style>
    <div class="spacer"></div>
    <button id="offscreen">Plain action</button>
  `), [offscreenCandidate({ label: 'Plain action' })])

  assert.equal(result.items[0].status, 'warn')
  assert.equal(result.items[0].category, 'no-observable-action')
  assert.equal(result.items[0].clickExecuted, true)
})

test('first-party runtime error during safe click remains an actual error', async () => {
  const result = await auditClickableActions(browser, pageFixture(`
    <button id="offscreen" onclick="throw new Error('click failed')">Run action</button>
  `), [candidate({ selector: '#offscreen', label: 'Run action', hasOnClick: true })])

  assert.equal(result.items[0].status, 'error')
  assert.equal(result.items[0].category, 'click-runtime-error')
  assert.equal(result.items[0].actionClassification, 'actual-error')
})

test('real overlay blocker after viewport preparation remains blocked', async () => {
  const result = await auditClickableActions(browser, pageFixture(`
    <style>body{margin:0}.spacer{height:1200px}.overlay{position:fixed;inset:0;background:rgba(0,0,0,.1);z-index:10}</style>
    <div class="spacer"></div>
    <button id="offscreen">Reveal details</button>
    <div class="overlay"></div>
  `), [offscreenCandidate({ label: 'Reveal details' })])

  assert.equal(result.items[0].status, 'error')
  assert.equal(result.items[0].category, 'covered-or-not-interactable')
  assert.equal(result.items[0].interactionOutcome, 'blocked')
  assert.equal(result.items[0].clickExecuted, false)
})

test('dangerous offscreen action remains skipped and is not safe-clicked', async () => {
  const result = await auditClickableActions(browser, pageFixture(`
    <style>body{margin:0}.spacer{height:1200px}</style>
    <div class="spacer"></div>
    <button id="offscreen" onclick="document.body.dataset.deleted='true'">Delete item</button>
  `), [offscreenCandidate({ label: 'Delete item', hasOnClick: true })])

  assert.equal(result.items[0].category, 'skipped-safe-click')
  assert.equal(result.items[0].actionClassification, 'safe-click-skipped')
  assert.equal(result.items[0].clickExecuted, false)
  assert.equal(result.meta.safeClickAttemptCount, 0)
})

function candidate(overrides = {}) {
  return {
    auditId: 'candidate-1',
    tagName: 'button',
    kind: 'button',
    label: 'Button',
    text: 'Button',
    href: '',
    url: '',
    role: '',
    type: '',
    selector: '#button',
    domPath: 'main > button',
    section: 'main',
    pointerEvents: 'auto',
    hitTargetSame: true,
    boundingBox: { width: 120, height: 32 },
    ...overrides,
  }
}

function offscreenCandidate(overrides = {}) {
  return candidate({
    selector: '#offscreen',
    domPath: 'main > button#offscreen',
    viewportState: 'outsideViewport',
    hitTestStatus: 'hitTestNotRun',
    hitTargetSame: false,
    boundingBox: { x: 0, y: 1200, width: 120, height: 32 },
    ...overrides,
  })
}

function pageFixture(body) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><body>${body}</body></html>`)}`
}
