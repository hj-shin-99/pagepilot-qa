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
  assert.equal(source.includes('createVisualDifferenceItems(result, aiReview)'), true)
  assert.equal(source.includes('AI 시각 비교'), false)
  assert.equal(source.includes('AI Vision Raw Summary'), true)
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
  assert.equal(source.includes('visual-comparison-viewport'), true)
  assert.equal(source.includes('visual-comparison-columns'), true)
  assert.equal(source.includes('onScroll='), false)
  assert.equal(css.includes('.visual-comparison-viewport'), true)
  assert.equal(css.includes('.visual-comparison-columns'), true)
  assert.equal(fs.existsSync('src/utils/visualScrollSync.js'), false)
})

test('visual panel renders simplified default sections and folded details', () => {
  const source = fs.readFileSync('src/components/VisualQaPanel.jsx', 'utf8')
  const imageIndex = source.indexOf('Figma / Web 이미지 비교')
  const differenceIndex = source.indexOf('다른 부분')
  const detailIndex = source.indexOf('<details className="detail-card visual-detail-accordion">')
  assert.equal(source.includes('visual-severity-grid'), false)
  assert.equal(source.includes('<details className="detail-card visual-card-list-card" open>'), false)
  assert.equal(imageIndex > -1, true)
  assert.equal(differenceIndex > imageIndex, true)
  assert.equal(detailIndex > differenceIndex, true)
  assert.equal(source.includes('title="Hero"'), true)
  assert.equal(source.includes('title="CTA"'), true)
  assert.equal(source.includes('title="Price / Numeric"'), true)
  assert.equal(source.includes('title="Media"'), true)
  assert.equal(source.includes('title="Text Difference"'), true)
  assert.equal(source.includes('title="System"'), true)
  assert.equal(source.includes('Payload Version'), true)
})
