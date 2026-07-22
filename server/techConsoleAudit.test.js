import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyConsoleMessages } from './techConsoleAudit.js'

test('first-party pageerror is an error with runtime classification', () => {
  const audit = classifyConsoleMessages([
    { eventType: 'pageerror', level: 'error', message: 'ReferenceError: app is not defined', stack: 'ReferenceError\n at https://example.com/app.js:1:1' },
  ], 'https://example.com/page')

  assert.equal(audit.status, 'error')
  assert.equal(audit.items.length, 1)
  assert.equal(audit.items[0].classification, 'first-party-runtime-error')
  assert.equal(audit.items[0].party, 'first-party')
  assert.equal(audit.items[0].owner, 'UID팀')
})

test('third-party console errors are actionable warnings, not blocking errors', () => {
  const audit = classifyConsoleMessages([
    { eventType: 'console', level: 'error', source: 'https://cdn.example.net/widget.js', message: 'Widget failed' },
    { eventType: 'console', level: 'error', source: 'https://cdn.example.net/widget.js', message: 'Widget failed' },
  ], 'https://example.com/page')

  assert.equal(audit.status, 'warn')
  assert.equal(audit.items.length, 1)
  assert.equal(audit.items[0].classification, 'third-party-script-error')
  assert.equal(audit.items[0].party, 'third-party')
  assert.equal(audit.items[0].repeatCount, 2)
  assert.equal(audit.meta.repeatedDuplicateCount, 1)
})

test('warning and info logs are reference items', () => {
  const audit = classifyConsoleMessages([
    { eventType: 'console', level: 'warning', source: 'https://example.com/app.js', message: 'Deprecated option' },
    { eventType: 'console', level: 'info', source: 'https://example.com/app.js', message: 'Loaded' },
  ], 'https://example.com/page')

  assert.equal(audit.status, 'ok')
  assert.equal(audit.items.length, 0)
  assert.equal(audit.referenceItems.length, 2)
  assert.equal(audit.meta.warningInfoCount, 2)
})
