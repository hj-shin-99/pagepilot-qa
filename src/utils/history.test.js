import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHistoryItems, saveHistoryItem } from './history.js'

function installLocalStorage() {
  const store = new Map()
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

test('history stores visual and tech type separately', () => {
  installLocalStorage()
  saveHistoryItem({ type: 'visual', id: 'v1', url: 'https://example.com', figmaUrl: 'https://figma.com/design/a', scannedAt: '2026-01-01T00:00:00.000Z', counts: { total: 1, high: 1 }, topIssueSummaries: ['Visual'], result: { meta: { webUrl: 'https://example.com' } } })
  saveHistoryItem({ type: 'tech', id: 't1', url: 'https://example.com', scannedAt: '2026-01-02T00:00:00.000Z', counts: { total: 2, high: 0 }, topIssueSummaries: ['Tech'], result: { targetUrl: 'https://example.com' } })

  const items = loadHistoryItems()
  assert.deepEqual(items.map((item) => item.type), ['tech', 'visual'])
  assert.equal(items[1].figmaUrl, 'https://figma.com/design/a')
})

test('history reads legacy items without type safely', () => {
  installLocalStorage()
  localStorage.setItem('pagepilot-qa-history-v3', JSON.stringify([
    { id: 'legacy-tech', url: 'https://example.com', scannedAt: '2026-01-01T00:00:00.000Z', counts: { error: 1, warn: 1 }, topIssueSummaries: ['Legacy'], result: { targetUrl: 'https://example.com', scannedAt: '2026-01-01T00:00:00.000Z' } },
    { id: 'legacy-visual', url: 'https://example.com', figmaUrl: 'https://figma.com/design/a', scannedAt: '2026-01-01T00:00:00.000Z', counts: { total: 0 }, topIssueSummaries: ['Legacy Visual'], result: { meta: { webUrl: 'https://example.com' }, comparison: {} } },
  ]))

  const items = loadHistoryItems()
  assert.equal(items[0].type, 'tech')
  assert.equal(items[1].type, 'visual')
})

test('history stores and restores combined sessions', () => {
  installLocalStorage()
  saveHistoryItem({
    type: 'combined',
    id: 'c1',
    webUrl: 'https://example.com',
    figmaUrl: 'https://www.figma.com/design/a',
    createdAt: '2026-01-03T00:00:00.000Z',
    counts: { total: 3, high: 1 },
    topIssueSummaries: ['Combined'],
    aiReview: {
      meta: { openAiCalled: true, model: 'gpt-4.1-mini', fallbackUsed: false },
      review: {
        releaseDecision: 'caution',
        summary: '확인 필요 항목이 있습니다.',
        mustFix: [],
        verify: [{ category: 'media', title: '미디어 확인', description: '의도 확인', evidence: ['video'], severity: 'warning' }],
        developerNotes: [{ category: 'tech', title: '개발 확인', description: '확인', evidence: [], severity: 'check' }],
        visualDifferences: [{ area: 'Main Visual', category: 'Media', title: 'Hero KV 비주얼 차이', summary: '이미지와 영상 차이', figmaValue: 'Image', webValue: 'Video', severity: 'warning', confidence: 'high', order: 0 }],
        clientReplyDraft: '확인 후 진행하겠습니다.',
      },
    },
    visual: { status: 'success', summary: 'Visual ok', compactResult: { meta: { webUrl: 'https://example.com' } } },
    tech: { status: 'error', summary: 'Tech failed', compactResult: null, error: 'failed' },
  })

  const [item] = loadHistoryItems()
  assert.equal(item.type, 'combined')
  assert.equal(item.url, 'https://example.com')
  assert.equal(item.visual.status, 'success')
  assert.equal(item.tech.status, 'error')
  assert.equal(item.tech.error, 'failed')
  assert.equal(item.aiReview.meta.openAiCalled, true)
  assert.equal(item.aiReview.meta.model, 'gpt-4.1-mini')
  assert.equal(item.aiReview.review.releaseDecision, 'caution')
  assert.equal(item.aiReview.review.verify[0].title, '미디어 확인')
  assert.equal(item.aiReview.review.visualDifferences[0].title, 'Hero KV 비주얼 차이')
})
