import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAiReviewPayloadFromQaResult, sanitizeAiReviewResponse } from './aiReview.js'

test('client AI Review payload keeps numeric differences blocking and spacing differences non-blocking', () => {
  const payload = buildAiReviewPayloadFromQaResult(createQaResult())

  assert.equal(payload.visualEvidence.textDifferences.find((item) => item.category === 'numeric').severity, 'critical')
  assert.equal(payload.visualEvidence.textDifferences.find((item) => item.webText === 'HelloWorld').severity, 'check')
  assert.equal(JSON.stringify(payload).includes('data:image'), false)
  assert.equal(JSON.stringify(payload).includes('.cache/'), false)
  assert.equal(payload.visualAssets.figmaRenderId, 'render_1')
  assert.equal(payload.visualAssets.webScreenshotFileName, 'aaaaaaaaaaaaaaaaaaaaaaaa.png')
  assert.equal(payload.visualEvidence.hero.sections.length, 2)
})

test('client AI Review response uses review as single source of truth', () => {
  const response = sanitizeAiReviewResponse({
    success: true,
    meta: { openAiCalled: true, fallbackUsed: false, model: 'gpt-4.1-mini', rawVisionCount: 12, visionInputSummary: [{ label: 'figma-hero', width: 100, height: 80, detail: 'high' }] },
    releaseDecision: 'blocked',
    review: {
      releaseDecision: 'caution',
      summary: '확인 필요 항목이 있습니다.',
      mustFix: [],
      verify: [{ category: 'media', title: '미디어 확인', description: '의도 확인', severity: 'warning' }],
      developerNotes: [],
      visualDifferences: [{ area: 'Main Visual', category: 'Media', title: 'Hero media differs', summary: 'Image versus video.', figmaValue: 'Image', webValue: 'Video', severity: 'warning', confidence: 'high', order: 0 }],
      clientReplyDraft: '확인 후 진행하겠습니다.',
    },
  })

  assert.equal(response.review.releaseDecision, 'caution')
  assert.equal(response.meta.openAiCalled, true)
  assert.equal(response.meta.model, 'gpt-4.1-mini')
  assert.equal(response.meta.rawVisionCount, 12)
  assert.equal(response.meta.visionInputSummary[0].detail, 'high')
  assert.equal(response.review.verify[0].category, 'media')
  assert.equal(response.review.visualDifferences[0].title, 'Hero media differs')
})

test('client AI Review payload preserves lightweight hero spatial evidence for vision crops', () => {
  const qaResult = createQaResult()
  qaResult.visual.result.aiHints.canonicalEvidence = {
    texts: [
      { entityId: 'text:web:hero-title', source: 'web', text: 'Generic headline', role: 'heading', sectionId: 'web-hero', xRatio: 0.1, yRatio: 0.08, widthRatio: 0.5, heightRatio: 0.04 },
    ],
  }
  qaResult.visual.result.aiHints.heroCtaGroup = {
    figma: { count: 1, actions: [{ entityId: 'action:figma:start', source: 'figma', text: 'Start', role: 'primary-action', comparisonScope: 'primary', sectionId: 'figma-hero', rect: { left: 120, top: 600, width: 220, height: 64 } }] },
    web: { count: 1, actions: [{ entityId: 'action:web:start', source: 'web', text: 'Start', role: 'primary-action', comparisonScope: 'primary', sectionId: 'web-hero', xRatio: 0.12, yRatio: 0.32, widthRatio: 0.18, heightRatio: 0.05 }] },
  }
  qaResult.visual.result.aiHints.heroMediaGroup = {
    figma: { mediaTypes: ['image'], primaryCandidates: [{ entityId: 'media:figma:image', source: 'figma', type: 'image', sectionId: 'figma-hero', xRatio: 0.5, yRatio: 0.2, widthRatio: 0.4, heightRatio: 0.18 }] },
    web: { mediaTypes: ['video'], primaryCandidates: [{ entityId: 'media:web:video', source: 'web', type: 'video', sectionId: 'web-hero', boundingBox: { x: 700, y: 420, width: 640, height: 360 } }] },
  }

  const payload = buildAiReviewPayloadFromQaResult(qaResult)
  const descendants = payload.visualEvidence.hero.descendants

  assert.equal(descendants.some((item) => item.source === 'web' && item.kind === 'text' && item.yRatio === 0.08), true)
  assert.equal(descendants.some((item) => item.source === 'web' && item.kind === 'media' && item.height === 360), true)
  assert.equal(payload.visualEvidence.cta.webActions[0].widthRatio, 0.18)
  assert.equal(payload.visualEvidence.media.figmaPrimaryCandidates[0].spatialEvidence.coordinateSpace, 'ratio')
  assert.equal(JSON.stringify(payload).includes('data:image'), false)
})

function createQaResult() {
  return {
    visual: {
      result: {
        meta: { webUrl: 'https://example.com', figmaNodeId: '1:2' },
        web: { displayImageUrl: '/api/visual/screenshot/aaaaaaaaaaaaaaaaaaaaaaaa.png', screenshot: { dataUrl: 'data:image/png;base64,AAAA' } },
        figma: { renderId: 'render_1', localImagePath: '.cache/figma/renders/a.png' },
        comparison: {
          differences: [
            { figmaText: '월 47만원', webText: '월 50만원', confidence: 'high' },
            { figmaText: 'Hello World', webText: 'HelloWorld', confidence: 'high' },
          ],
        },
        aiHints: { evidenceSummary: { hero: {}, content: {} }, heroCtaGroup: { figma: { count: 2 }, web: { count: 2 } }, heroSection: { figmaSectionId: 'figma-hero', webSectionId: 'web-hero', sections: [{ sectionId: 'figma-hero', source: 'figma', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.2 }, { sectionId: 'web-hero', source: 'web', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.2 }] } },
      },
    },
    tech: { result: { targetUrl: 'https://example.com', checks: [] } },
  }
}
