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
    visual: { status: 'success', summary: 'Visual ok', compactResult: { meta: { webUrl: 'https://example.com' } } },
    tech: { status: 'error', summary: 'Tech failed', compactResult: null, error: 'failed' },
  })

  const [item] = loadHistoryItems()
  assert.equal(item.type, 'combined')
  assert.equal(item.url, 'https://example.com')
  assert.equal(item.visual.status, 'success')
  assert.equal(item.tech.status, 'error')
  assert.equal(item.tech.error, 'failed')
})
