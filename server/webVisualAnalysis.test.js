import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebVisualAnalysis } from './webVisualAnalysis.js'

const SAMPLE_SCREENSHOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII='

test('createWebVisualAnalysis transforms one scan result and saves screenshot once', () => {
  let saveCallCount = 0
  const scanResult = {
    targetUrl: 'https://example.com/page',
    pageTitle: 'Example Page',
    webScreenshot: {
      dataUrl: SAMPLE_SCREENSHOT,
      width: 1920,
      height: 3200,
      viewport: { width: 1920, height: 1080 },
      capturedAt: '2026-07-12T10:00:00.000Z',
    },
    webCtaHints: [{ text: 'Start Now', href: '/start', selector: 'button.cta', area: 'top', visible: true, y: 120 }],
    images: [{ alt: 'Hero image', selector: 'img.hero', section: 'top', loaded: true, naturalWidth: 1600, naturalHeight: 900 }],
    designElements: [{ text: 'Headline', layerPath: 'main > h1' }],
    visualPayloadData: {
      page: { viewportWidth: 1920, viewportHeight: 1080, scrollWidth: 1920, scrollHeight: 3200 },
      textNodes: [{ text: 'Headline', rawText: 'Headline', tagName: 'h1', selector: 'h1', yRatio: 0.05, role: 'heading', sectionHint: 'hero' }],
      videoCandidates: [{ tagName: 'video', selector: 'video.hero', section: 'top', autoplay: true, controls: true }],
      playwrightRunCount: 1,
    },
  }

  const analysis = createWebVisualAnalysis(scanResult, {
    saveScreenshot() {
      saveCallCount += 1
      return {
        path: '.cache/visual/screenshots/test.png',
        width: 1920,
        height: 3200,
        mimeType: 'image/png',
        created: true,
        sizeBytes: 123,
        capturedAt: '2026-07-12T10:00:00.000Z',
        error: '',
      }
    },
  })

  assert.equal(saveCallCount, 1)
  assert.equal(analysis.url, 'https://example.com/page')
  assert.equal(analysis.screenshot.path, '.cache/visual/screenshots/test.png')
  assert.equal(analysis.textNodes.length, 1)
  assert.equal(analysis.textNodes[0].text, 'Headline')
  assert.equal(analysis.ctaCandidates.length, 1)
  assert.equal(analysis.ctaCandidates[0].source, 'web')
  assert.equal(Array.isArray(analysis.ctaCandidates[0].reasons), true)
  assert.equal(analysis.imageCandidates.length, 1)
  assert.equal(analysis.videoCandidates.length, 1)
  assert.equal(analysis.page.scrollHeight, 3200)
  assert.equal(analysis.meta.playwrightRunCount, 1)
  assert.equal(analysis.scanResult, scanResult)
})

test('createWebVisualAnalysis limits candidate counts', () => {
  const analysis = createWebVisualAnalysis({
    targetUrl: 'https://example.com',
    pageTitle: 'Example',
    webScreenshot: { dataUrl: SAMPLE_SCREENSHOT, width: 100, height: 100, viewport: { width: 100, height: 100 }, capturedAt: '2026-07-12T10:00:00.000Z' },
    webCtaHints: Array.from({ length: 30 }, (_, index) => ({ text: `CTA ${index}`, href: `/cta-${index}`, selector: `button.cta-${index}`, area: 'top', visible: true, y: index })),
    images: Array.from({ length: 30 }, (_, index) => ({ alt: `Image ${index}`, selector: `img.${index}`, section: 'middle', loaded: true, naturalWidth: 100, naturalHeight: 100 })),
    designElements: [],
    visualPayloadData: {
      page: { viewportWidth: 100, viewportHeight: 100, scrollWidth: 100, scrollHeight: 1000 },
      textNodes: Array.from({ length: 40 }, (_, index) => ({ text: `Text ${index}`, rawText: `Text ${index}`, tagName: 'p', selector: `p:nth-of-type(${index + 1})`, yRatio: Math.min(index / 40, 0.95), sectionHint: index % 2 === 0 ? 'top' : 'bottom', role: 'body' })),
      videoCandidates: Array.from({ length: 20 }, (_, index) => ({ tagName: 'video', selector: `video.${index}`, section: 'middle', autoplay: false, controls: true })),
      playwrightRunCount: 1,
    },
  }, {
    saveScreenshot() {
      return { path: '.cache/visual/screenshots/test.png', width: 100, height: 100, mimeType: 'image/png', created: false, sizeBytes: 10, capturedAt: '2026-07-12T10:00:00.000Z', error: '' }
    },
  })

  assert.equal(analysis.ctaCandidates.length, 20)
  assert.equal(analysis.imageCandidates.length, 20)
  assert.equal(analysis.videoCandidates.length, 10)
  assert.equal(analysis.sectionCandidates.length <= 20, true)
})
