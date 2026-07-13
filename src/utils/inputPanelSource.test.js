import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('input panel exposes one scan start button only', () => {
  const source = fs.readFileSync('src/components/InputPanel.jsx', 'utf8')
  assert.equal((source.match(/type="submit"/g) || []).length, 1)
  assert.equal(source.includes('onStartVisualScan'), false)
  assert.equal(source.includes('onStartTechScan'), false)
  assert.equal(source.includes('Visual QA\n'), false)
  assert.equal(source.includes('Tech QA\n'), false)
})

test('app default scan flow calls integrated qa endpoint only', () => {
  const source = fs.readFileSync('src/App.jsx', 'utf8')
  assert.equal(source.includes("fetch('/api/qa/run'"), true)
  assert.equal(source.includes("fetch('/api/ai-review/from-payload'"), true)
  assert.equal(source.includes("fetch('/api/scan'"), false)
  assert.equal(source.includes("fetch('/api/visual/payload'"), false)
})

test('visual panel renders AI Review from review object', () => {
  const source = fs.readFileSync('src/components/VisualQaPanel.jsx', 'utf8')
  assert.equal(source.includes('배포 판단'), true)
  assert.equal(source.includes('aiReview?.review'), true)
  assert.equal(source.includes('회신 초안 보기'), false)
  assert.equal(source.includes('clientReplyDraft'), false)
})

test('visual panel keeps detailed comparison behind accordion', () => {
  const source = fs.readFileSync('src/components/VisualQaPanel.jsx', 'utf8')
  const imageIndex = source.indexOf('<ImageComparisonCard')
  const detailIndex = source.indexOf('세부 비교 보기')
  assert.equal(source.includes('핵심 발견 문제'), true)
  assert.equal(detailIndex > imageIndex, true)
  assert.equal(source.indexOf('title="Hero"') > detailIndex, true)
  assert.equal(source.indexOf('title="CTA"') > detailIndex, true)
  assert.equal(source.indexOf('title="Price"') > detailIndex, true)
  assert.equal(source.indexOf('title="Media"') > detailIndex, true)
  assert.equal(source.indexOf('title="Text Difference"') > detailIndex, true)
  assert.equal(source.indexOf('title="System"') > detailIndex, true)
  assert.equal(source.includes('Payload Version'), true)
})
