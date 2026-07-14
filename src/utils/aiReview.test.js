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
    meta: { openAiCalled: true, fallbackUsed: false, model: 'gpt-4.1-mini', visionInputSummary: [{ label: 'figma-hero', width: 100, height: 80, detail: 'high' }] },
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
  assert.equal(response.meta.visionInputSummary[0].detail, 'high')
  assert.equal(response.review.verify[0].category, 'media')
  assert.equal(response.review.visualDifferences[0].title, 'Hero media differs')
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
