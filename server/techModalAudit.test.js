import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyModalObservation, createModalAuditCandidates, MODAL_AUDIT_TEST_ONLY } from './techModalAudit.js'

test('modal audit keeps healthy modal interaction as ok', () => {
  const item = classifyModalObservation(candidate(), {
    opened: true,
    visibleDialogCount: 1,
    accessibleName: '상세 보기',
    hasCloseButton: true,
    escClosed: true,
    backdropChecked: true,
    backdropClosed: true,
    focusMovedInside: true,
    focusReturned: true,
    scrollLocked: true,
    closable: true,
  })

  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'modal-ok')
})

test('modal audit warns for missing accessible name or escape handling', () => {
  const item = classifyModalObservation(candidate(), {
    opened: true,
    visibleDialogCount: 1,
    accessibleName: '',
    hasCloseButton: false,
    escClosed: false,
    backdropChecked: true,
    backdropClosed: false,
    focusMovedInside: false,
    focusReturned: false,
    scrollLocked: false,
    closable: true,
  })

  assert.equal(item.status, 'warn')
  assert.equal(item.warnings.length > 0, true)
})

test('modal audit verifies ESC independently after close button and treats reopen failure as unchecked', () => {
  const closeAndEscOk = classifyModalObservation(candidate(), MODAL_AUDIT_TEST_ONLY.createModalCloseObservation(openState(), { closeButtonClosed: true, escChecked: true, escClosed: true }, postCloseState()))
  const closeOkEscFail = classifyModalObservation(candidate(), MODAL_AUDIT_TEST_ONLY.createModalCloseObservation(openState(), { closeButtonClosed: true, escChecked: true, escClosed: false }, postCloseState({ visibleDialogCount: 1 })))
  const reopenUnavailable = classifyModalObservation(candidate(), MODAL_AUDIT_TEST_ONLY.createModalCloseObservation(openState(), { closeButtonClosed: true, escChecked: false, escClosed: false }, postCloseState()))
  const noCloseButtonEscOk = classifyModalObservation(candidate(), MODAL_AUDIT_TEST_ONLY.createModalCloseObservation(openState({ closeButtonSelector: '' }), { closeButtonClosed: false, escChecked: true, escClosed: true }, postCloseState()))

  assert.equal(closeAndEscOk.status, 'ok')
  assert.equal(closeOkEscFail.status, 'warn')
  assert.equal(closeOkEscFail.warnings.includes('ESC 닫기 동작을 확인하지 못했습니다.'), true)
  assert.equal(reopenUnavailable.status, 'ok')
  assert.equal(reopenUnavailable.warnings.includes('ESC 닫기 동작을 확인하지 못했습니다.'), false)
  assert.equal(noCloseButtonEscOk.warnings.includes('ESC 닫기 동작을 확인하지 못했습니다.'), false)
  assert.equal(noCloseButtonEscOk.warnings.includes('닫기 버튼이 없습니다.'), true)
})

test('modal audit errors when dialog does not open or close safely', () => {
  const openFailed = classifyModalObservation(candidate(), { opened: false, error: 'dialog-not-visible' })
  const closeFailed = classifyModalObservation(candidate(), { opened: true, visibleDialogCount: 1, closable: false })
  const duplicate = classifyModalObservation(candidate(), { opened: true, visibleDialogCount: 2, closable: true })

  assert.equal(openFailed.status, 'error')
  assert.equal(closeFailed.status, 'error')
  assert.equal(duplicate.status, 'error')
})

test('modal audit candidate builder merges click and dom candidates by selector', () => {
  const candidates = createModalAuditCandidates([
    candidate({ auditId: 'click-1', selector: '#open-modal', label: 'Open modal' }),
  ], [
    candidate({ auditId: 'dom-1', selector: '#open-modal', label: 'Open modal' }),
    candidate({ auditId: 'dom-2', selector: '#second-modal', label: 'Second modal' }),
  ])

  assert.equal(candidates.length, 2)
})

test('modal audit excludes close controls from opener candidates', () => {
  assert.equal(MODAL_AUDIT_TEST_ONLY.isModalCloseCandidate({ label: '닫기', ariaLabel: '닫기', dataDismiss: 'modal' }), true)
  const candidates = createModalAuditCandidates([
    candidate({ auditId: 'close-1', selector: '#close-modal', label: '닫기', dataDismiss: 'modal', interactionOutcome: 'modal' }),
    candidate({ auditId: 'open-1', selector: '#open-modal', label: 'Open modal', interactionOutcome: 'modal' }),
  ])

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].selector, '#open-modal')
})

test('modal audit meta reports no target safely', () => {
  const meta = MODAL_AUDIT_TEST_ONLY.createModalAuditMeta([], { candidateCount: 0, noTarget: true })

  assert.equal(meta.noTarget, true)
  assert.equal(meta.candidateCount, 0)
})

test('modal audit phase 3-b fixtures cover status boundaries and non-scroll page lock false positive', () => {
  const problem = classifyModalObservation(candidate(), { opened: false, error: 'dialog-not-visible' })
  const review = classifyModalObservation(candidate(), { opened: true, visibleDialogCount: 1, accessibleName: '', hasCloseButton: true, escClosed: true, focusMovedInside: true, focusReturned: true, scrollLocked: true, closable: true })
  const normal = classifyModalObservation(candidate(), { opened: true, visibleDialogCount: 1, accessibleName: 'Details', hasCloseButton: true, escClosed: true, focusMovedInside: true, focusReturned: true, scrollLocked: true, closable: true })
  const notApplicable = MODAL_AUDIT_TEST_ONLY.createModalAuditMeta([], { candidateCount: 0, noTarget: true })
  const previousFalsePositive = classifyModalObservation(candidate(), { opened: true, visibleDialogCount: 1, accessibleName: 'Details', hasCloseButton: true, escClosed: true, focusMovedInside: true, focusReturned: true, scrollLocked: false, scrollLockApplicable: false, closable: true })

  assert.equal(problem.status, 'error')
  assert.equal(review.status, 'warn')
  assert.equal(normal.status, 'ok')
  assert.equal(notApplicable.noTarget, true)
  assert.equal(previousFalsePositive.status, 'ok')
})

function candidate(overrides = {}) {
  return {
    auditId: 'modal-1',
    selector: '#open-modal',
    label: 'Open modal',
    ...overrides,
  }
}

function openState(overrides = {}) {
  return {
    visibleDialogCount: 1,
    accessibleName: 'Details',
    closeButtonSelector: '#close-modal',
    focusMovedInside: true,
    scrollLocked: true,
    pageCanScroll: false,
    ...overrides,
  }
}

function postCloseState(overrides = {}) {
  return {
    visibleDialogCount: 0,
    focusReturned: true,
    ...overrides,
  }
}
