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
  assert.equal(source.includes('createVisualDifferenceItems(result, aiReview)'), false)
  assert.equal(source.includes('AI 시각 비교'), true)
  assert.equal(source.includes('visualDifferences'), true)
  assert.equal(source.includes('회신 초안 보기'), false)
  assert.equal(source.includes('clientReplyDraft'), false)
})

test('visual panel removes inaccurate image position highlighting', () => {
  const source = fs.readFileSync('src/components/VisualQaPanel.jsx', 'utf8')
  const css = fs.readFileSync('src/App.css', 'utf8')
  assert.equal(source.includes('scrollTo('), false)
  assert.equal(source.includes('highlightRatio'), false)
  assert.equal(source.includes('setHighlight'), false)
  assert.equal(source.includes('image-highlight-band'), false)
  assert.equal(source.includes('createRatioScrollSynchronizer'), false)
  assert.equal(css.includes('image-highlight-band'), false)
})

test('visual panel uses restored stable image comparison shell', () => {
  const source = fs.readFileSync('src/components/VisualQaPanel.jsx', 'utf8')
  const css = fs.readFileSync('src/App.css', 'utf8')
  assert.equal(source.includes('compare-scroll-shell visual-compare-shell'), true)
  assert.equal(source.includes('compare-grid'), true)
  assert.equal(source.includes('onScroll='), false)
  assert.equal(css.includes('.visual-compare-shell'), true)
  assert.equal(css.includes('.compare-grid'), true)
  assert.equal(fs.existsSync('src/utils/visualScrollSync.js'), false)
})

test('visual panel renders restored stable detail sections', () => {
  const source = fs.readFileSync('src/components/VisualQaPanel.jsx', 'utf8')
  const severityIndex = source.indexOf('visual-severity-grid')
  const imageIndex = source.indexOf('이미지 확인')
  assert.equal(source.includes('다른 부분'), false)
  assert.equal(source.includes('<details className="detail-card visual-detail-accordion">'), false)
  assert.equal(source.includes('<details className="detail-card visual-card-list-card" open>'), true)
  assert.equal(severityIndex > -1, true)
  assert.equal(imageIndex > severityIndex, true)
  assert.equal(source.includes('title="Hero"'), true)
  assert.equal(source.includes('title="CTA"'), true)
  assert.equal(source.includes('title="Price"'), true)
  assert.equal(source.includes('title="Media"'), true)
  assert.equal(source.includes('title="Difference Summary"'), true)
  assert.equal(source.includes('title="System"'), true)
  assert.equal(source.includes('Payload Version'), true)
})
