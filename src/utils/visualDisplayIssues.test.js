import test from 'node:test'
import assert from 'node:assert/strict'
import { createVisualDisplayIssueReport, createVisualDisplayIssues } from './visualDisplayIssues.js'

test('final report 3 items plus canonical CTA count difference displays 4 items', () => {
  const result = {
    comparison: { differences: [
      { figmaText: 'Hero A', webText: 'Hero B', yRatio: 0.1, confidence: 'high' },
      { figmaText: 'Body A', webText: 'Body B', yRatio: 0.4, confidence: 'high' },
      { figmaText: 'Footer A', webText: 'Footer B', yRatio: 0.9, confidence: 'high' },
    ] },
    aiHints: { heroCtaGroup: { countDifference: 1, figma: { count: 2, actions: [{ text: 'Apply', role: 'primary-action' }] }, web: { count: 1, actions: [{ text: 'Apply', role: 'primary-action' }] } } },
  }
  const report = createVisualDisplayIssueReport(result)
  assert.equal(report.meta.finalReportItemCount, 3)
  assert.equal(report.meta.comparisonDifferenceCount, 3)
  assert.equal(report.items.length, 4)
  assert.equal(report.items.some((item) => item.category === 'cta' && item.figmaValue === '2개' && item.webValue === '1개'), true)
})

test('final report and canonical text duplicate merge into one item', () => {
  const result = { comparison: { differences: [{ figmaText: 'Hello World', webText: 'Hello Page', confidence: 'high', yRatio: 0.2 }] }, aiHints: {} }
  const aiReview = { meta: { visionUsed: true, fallbackUsed: false }, review: { visualDifferences: [{ category: 'Text', title: 'Copy differs', summary: 'Hero copy differs', figmaValue: 'Hello World', webValue: 'Hello Page', confidence: 'high', yRatio: 0.2 }] } }
  const report = createVisualDisplayIssueReport(result, aiReview)
  assert.equal(report.items.length, 1)
  assert.equal(report.items[0].figmaValue, 'Hello World')
  assert.equal(report.items[0].webValue, 'Hello Page')
})

test('CTA candidates alone do not create a default display issue', () => {
  const result = { comparison: { differences: [] }, aiHints: { heroCtaGroup: { countDifference: 0, figma: { count: 1, actions: [{ text: 'Apply', role: 'primary-action' }] }, web: { count: 1, actions: [{ text: 'Apply', role: 'primary-action' }] } } } }
  const report = createVisualDisplayIssueReport(result)
  assert.equal(report.items.length, 0)
  assert.equal(report.meta.ctaEvidenceCount, 2)
})

test('clear media image video difference is included', () => {
  const result = { comparison: { differences: [] }, aiHints: { heroMediaGroup: { comparisonHint: 'figma-image-vs-web-video', figma: { mediaTypes: ['image'], primaryCandidates: [{ yRatio: 0.1 }] }, web: { mediaTypes: ['video'], primaryCandidates: [{ yRatio: 0.12 }] } } } }
  const report = createVisualDisplayIssueReport(result)
  assert.equal(report.items.length, 1)
  assert.equal(report.items[0].categoryLabel, 'KV / Media')
  assert.equal(report.items[0].figmaValue, 'image')
  assert.equal(report.items[0].webValue, 'video')
})

test('spacing and punctuation only text differences are excluded', () => {
  const result = { comparison: { differences: [{ figmaText: 'Hello, World!', webText: 'Hello World', confidence: 'high' }] }, aiHints: {} }
  const report = createVisualDisplayIssueReport(result)
  assert.equal(report.items.length, 0)
})

test('mixed yRatio input is sorted top to bottom', () => {
  const result = { comparison: { differences: [
    { figmaText: 'Footer A', webText: 'Footer B', confidence: 'high', yRatio: 0.9 },
    { figmaText: 'Hero A', webText: 'Hero B', confidence: 'high', yRatio: 0.1 },
    { figmaText: 'Body A', webText: 'Body B', confidence: 'high', yRatio: 0.5 },
  ] }, aiHints: {} }
  const report = createVisualDisplayIssueReport(result)
  assert.deepEqual(report.items.map((item) => item.figmaValue), ['Hero A', 'Body A', 'Footer A'])
})

test('history compact result creates the same integrated display list', () => {
  const compactResult = {
    comparison: { differences: [{ figmaText: '월 47만원', webText: '월 50만원', confidence: 'high', yRatio: 0.4 }] },
    aiHints: { prices: [
      { source: 'figma', numericType: 'monthly-payment', displayText: '월 47만원', sectionPath: 'product card', yRatio: 0.4 },
      { source: 'web', numericType: 'monthly-payment', displayText: '월 50만원', sectionPath: 'product card', yRatio: 0.4 },
    ] },
  }
  const issues = createVisualDisplayIssues(compactResult)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].categoryLabel, 'Price / Numeric')
  assert.equal(issues.meta.priceNumericEvidenceCount, 2)
})
