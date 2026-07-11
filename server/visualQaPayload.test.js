import test from 'node:test'
import assert from 'node:assert/strict'
import { createVisualQaPayload } from './visualQaPayload.js'

function createPriceNode(index, source = 'figma') {
  if (source === 'figma') {
    return {
      characters: `월 ${index}만원`,
      layerPath: `Hero / Price ${index}`,
      yRatio: 0.1,
      fontSize: 32,
      fontWeight: 700,
      parentFrameName: 'Hero',
    }
  }

  return {
    text: `월 ${index}만원`,
    rawText: `월 ${index}만원`,
    selector: `.price-${index}`,
    yRatio: 0.1,
    role: 'price',
    sectionHint: 'hero',
    tagName: 'p',
  }
}

test('createVisualQaPayload applies limits and excludes raw internals', () => {
  const payload = createVisualQaPayload({
    figmaAnalysis: {
      render: { imageUrl: '/api/figma/render/render-1', localImagePath: '.cache/figma/renders/render-1.png', renderId: 'render-1' },
      textNodes: Array.from({ length: 25 }, (_, index) => createPriceNode(index, 'figma')),
      flatNodes: Array.from({ length: 25 }, (_, index) => ({
        name: `Image ${index}`,
        layerPath: `Hero / Image ${index}`,
        yRatio: index < 5 ? 0.1 : 0.5,
        effectivelyVisible: true,
        hasImageFill: true,
        hasVideoLikeContent: index < 12,
        isInteractiveCandidate: index % 2 === 0,
      })),
      structureSummary: { totalNodeCount: 25 },
      figmaStructure: { secret: 'raw-json-should-not-appear' },
    },
    webAnalysis: {
      screenshot: { path: '.cache/visual/screenshots/web.png', width: 1920, height: 3000, mimeType: 'image/png' },
      page: { viewportWidth: 1920, viewportHeight: 1080, scrollWidth: 1920, scrollHeight: 3000 },
      textNodes: Array.from({ length: 25 }, (_, index) => createPriceNode(index, 'web')),
      ctaCandidates: Array.from({ length: 25 }, (_, index) => ({ type: 'cta', source: 'web', text: `CTA ${index}`, confidence: 'high', reasons: ['visible', 'interactive selector'], section: 'top' })),
      imageCandidates: Array.from({ length: 25 }, (_, index) => ({ type: 'image', source: 'web', text: `Image ${index}`, confidence: 'medium', reasons: ['img element'], section: 'middle' })),
      videoCandidates: Array.from({ length: 15 }, (_, index) => ({ type: 'video', source: 'web', text: `Video ${index}`, confidence: 'medium', reasons: ['video element'], section: 'middle' })),
      sectionCandidates: Array.from({ length: 25 }, (_, index) => ({ type: 'section', source: 'web', name: `section-${index}`, confidence: 'low', reasons: ['grouped elements'] })),
      scanResult: { rawHtml: '<html>secret</html>' },
    },
    textComparison: {
      summary: { matchedCount: 30, differenceCount: 30, figmaOnlyCount: 12, webOnlyCount: 11 },
      differences: Array.from({ length: 30 }, (_, index) => ({ figmaText: `Figma ${index}`, webText: `Web ${index}`, matchConfidence: index % 2 === 0 ? 'high' : 'medium', evidence: ['same region'] })),
      figmaOnlyPreview: Array.from({ length: 12 }, (_, index) => ({ text: `Figma Only ${index}` })),
      webOnlyPreview: Array.from({ length: 11 }, (_, index) => ({ text: `Web Only ${index}` })),
      matchedPairs: [{ secret: true }],
      allPairs: [{ secret: true }],
    },
  })

  assert.equal(payload.comparison.differences.length, 20)
  assert.equal(payload.aiHints.ctaButtons.length, 20)
  assert.equal(payload.aiHints.images.length, 20)
  assert.equal(payload.aiHints.videos.length, 10)
  assert.equal(payload.aiHints.prices.length, 20)
  assert.equal(Array.isArray(payload.aiHints.heroSection.reasons), true)
  assert.equal(Array.isArray(payload.aiHints.navigation.reasons), true)
  assert.equal(payload.aiHints.ctaButtons[0].source.length > 0, true)
  assert.equal(payload.aiHints.ctaButtons[0].confidence.length > 0, true)
  assert.equal(Array.isArray(payload.aiHints.ctaButtons[0].reasons), true)

  const serialized = JSON.stringify(payload)
  assert.equal(serialized.includes('matchedPairs'), false)
  assert.equal(serialized.includes('allPairs'), false)
  assert.equal(serialized.includes('<html>secret</html>'), false)
  assert.equal(serialized.includes('raw-json-should-not-appear'), false)
})
