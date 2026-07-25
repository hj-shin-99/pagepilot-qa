import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyFormAuditItem, FORM_AUDIT_TEST_ONLY } from './techFormAudit.js'

test('form audit keeps well-labeled required email field as ok when browser validation reacts', () => {
  const item = classifyFormAuditItem(candidate({ label: 'Email', inputType: 'email', required: true, autocomplete: 'email', hasLabel: true, hasAccessibleName: true }), {
    requiredChecked: true,
    emailChecked: true,
    submitAttempted: true,
    submitBlocked: true,
    validationState: { valueMissing: true, typeMismatch: true },
    validationMessage: '형식이 올바르지 않습니다.',
    invalidEventCount: 1,
  })

  assert.equal(item.status, 'ok')
})

test('form audit warns when label or accessible name is missing', () => {
  const item = classifyFormAuditItem(candidate({ label: 'Text 1', inputType: 'text', hasLabel: false, hasAccessibleName: false, staticIssues: ['label 또는 접근성 이름이 없습니다.'] }), {})

  assert.equal(item.status, 'warn')
  assert.equal(item.note.includes('label'), true)
})

test('form audit warns when autocomplete is missing on text-like fields', () => {
  const item = classifyFormAuditItem(candidate({ label: 'Name', inputType: 'text', hasLabel: true, hasAccessibleName: true, staticIssues: ['autocomplete 설정이 없습니다.'] }), {})

  assert.equal(item.status, 'warn')
})

test('form audit keeps checkbox or radio label issue as warn', () => {
  const item = classifyFormAuditItem(candidate({ label: 'Checkbox 1', inputType: 'checkbox', isCheckbox: true, hasLabel: false, hasAccessibleName: false, staticIssues: ['체크박스 또는 라디오의 label 연결이 없습니다.'] }), {})

  assert.equal(item.status, 'warn')
})

test('form audit errors when mutating submit request is observed', () => {
  const item = classifyFormAuditItem(candidate({ label: 'Email', inputType: 'email', required: true, hasLabel: true, hasAccessibleName: true }), {
    requiredChecked: true,
    validationState: { valueMissing: true },
    submitAttempted: true,
    submitBlocked: false,
    networkRequestCount: 1,
    requestMethods: ['POST'],
  })

  assert.equal(item.status, 'error')
  assert.equal(item.category, 'submit-not-blocked')
})

test('form audit marks risky or excluded candidates as skipped/info', () => {
  const risky = classifyFormAuditItem(candidate({ label: '로그인 폼', skipReason: '실제 개인정보 입력 또는 제출 위험이 있는 폼이라 자동 입력 검사를 생략했습니다.' }), { skipped: true })
  const fileInput = classifyFormAuditItem(candidate({ label: 'File', inputType: 'file', skipReason: '파일 input은 안전 정책상 조작하지 않습니다.' }), { skipped: true })

  assert.equal(risky.status, 'info')
  assert.equal(fileInput.status, 'info')
})

test('form audit meta reports no target safely', () => {
  const meta = FORM_AUDIT_TEST_ONLY.createFormAuditMeta([], { candidateCount: 0, noTarget: true })

  assert.equal(meta.noTarget, true)
  assert.equal(meta.candidateCount, 0)
  assert.equal(meta.inspectedCount, 0)
})

function candidate(overrides = {}) {
  return {
    auditId: 'form-1',
    kind: 'form-control',
    label: 'Field',
    title: 'Field',
    inputType: 'text',
    required: false,
    disabled: false,
    readOnly: false,
    hasLabel: true,
    hasAccessibleName: true,
    staticIssues: [],
    ...overrides,
  }
}
