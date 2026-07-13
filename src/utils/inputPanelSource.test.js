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

test('input panel keeps scan scope copy out of the sidebar', () => {
  const source = fs.readFileSync('src/components/InputPanel.jsx', 'utf8')
  assert.equal(source.includes('실행 범위'), false)
  assert.equal(source.includes('MVP'), false)
  assert.equal(source.includes('/api/scan'), false)
  assert.equal(source.includes('/api/visual/payload'), false)
  assert.equal(source.includes('Web URL을 입력하면 Tech QA를 실행합니다.'), true)
})

test('app default scan flow calls integrated qa endpoint only', () => {
  const source = fs.readFileSync('src/App.jsx', 'utf8')
  assert.equal(source.includes("fetch('/api/qa/run'"), true)
  assert.equal(source.includes("fetch('/api/ai-review/from-payload'"), true)
  assert.equal(source.includes("fetch('/api/scan'"), false)
  assert.equal(source.includes("fetch('/api/visual/payload'"), false)
})

test('visual panel keeps AI review report UI out of the default view', () => {
  const source = fs.readFileSync('src/components/VisualQaPanel.jsx', 'utf8')
  assert.equal(source.includes('배포 판단'), false)
  assert.equal(source.includes('AI 종합 검토'), false)
  assert.equal(source.includes('ReleaseDecisionCard'), false)
  assert.equal(source.includes('KeyIssueList'), false)
  assert.equal(source.includes('MetricPill'), false)
  assert.equal(source.includes('aiReview?.review'), true)
  assert.equal(source.includes('회신 초안 보기'), false)
  assert.equal(source.includes('clientReplyDraft'), false)
})

test('visual panel renders image comparison before differences and details', () => {
  const source = fs.readFileSync('src/components/VisualQaPanel.jsx', 'utf8')
  const imageIndex = source.indexOf('<ImageComparisonCard')
  const differenceIndex = source.indexOf('<DifferenceList')
  const detailIndex = source.indexOf('세부 정보 보기')
  assert.equal(source.includes('다른 부분'), true)
  assert.equal(imageIndex > -1, true)
  assert.equal(differenceIndex > imageIndex, true)
  assert.equal(detailIndex > imageIndex, true)
  assert.equal(detailIndex > differenceIndex, true)
  assert.equal(source.includes('<details className="detail-card visual-detail-accordion">'), true)
  assert.equal(source.indexOf('title="Hero"') > detailIndex, true)
  assert.equal(source.indexOf('title="CTA"') > detailIndex, true)
  assert.equal(source.indexOf('title="Price"') > detailIndex, true)
  assert.equal(source.indexOf('title="Media"') > detailIndex, true)
  assert.equal(source.indexOf('title="Text Difference"') > detailIndex, true)
  assert.equal(source.indexOf('title="System"') > detailIndex, true)
  assert.equal(source.includes('Payload Version'), true)
})
