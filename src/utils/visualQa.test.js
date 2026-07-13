import test from 'node:test'
import assert from 'node:assert/strict'
import {
  countIssueCards,
  createActionItems,
  createFigmaImageUrl,
  createMediaSummary,
  createVisualIssueCards,
  createVisualSummary,
  createWebDisplayImageUrl,
  createWebScreenshotUrl,
  hasInternalLabels,
} from './visualQa.js'

test('figma render URL prefers renderId API endpoint', () => {
  assert.equal(createFigmaImageUrl({ image: '.cache/figma/renders/a.png', imageUrl: '.cache/figma/renders/a.png', renderId: 'render-1' }), '/api/figma/render/render-1')
})

test('display image URLs are preferred over local paths', () => {
  assert.equal(createFigmaImageUrl({ displayImageUrl: '/api/figma/render/render-1', renderId: 'render-2' }), '/api/figma/render/render-1')
  assert.equal(createWebDisplayImageUrl({ displayImageUrl: '/api/visual/screenshot/7ab5b706fd88d75e7418254e.png', localImagePath: '.cache/visual/screenshots/aaaaaaaaaaaaaaaaaaaaaaaa.png' }), '/api/visual/screenshot/7ab5b706fd88d75e7418254e.png')
})

test('web screenshot URL supports Windows and Unix cache paths', () => {
  assert.equal(createWebScreenshotUrl('.cache/visual/screenshots/7ab5b706fd88d75e7418254e.png'), '/api/visual/screenshot/7ab5b706fd88d75e7418254e.png')
  assert.equal(createWebScreenshotUrl('.cache\\visual\\screenshots\\7ab5b706fd88d75e7418254e.png'), '/api/visual/screenshot/7ab5b706fd88d75e7418254e.png')
})

test('web screenshot URL rejects direct cache and unsafe filenames', () => {
  assert.equal(createWebScreenshotUrl('.cache/visual/screenshots/test.png'), '')
  assert.equal(createWebScreenshotUrl('../screenshots/7ab5b706fd88d75e7418254e.png'), '')
})

test('semantic issue dedupe removes duplicate cards but keeps distinct CTA differences', () => {
  const result = {
    comparison: {
      differences: [
        { text: 'Apply', figmaText: 'Apply now', webText: 'Apply', confidence: 'medium', webSelector: 'a.one' },
        { text: 'Apply', figmaText: 'Apply now', webText: 'Apply', confidence: 'medium', webSelector: 'a.one' },
        { text: 'Consult', figmaText: 'Consult now', webText: 'Consult', confidence: 'medium', webSelector: 'a.two' },
      ],
    },
    aiHints: {},
  }

  const cards = createVisualIssueCards(result)
  assert.equal(cards.filter((card) => card.title === 'CTA 문구가 다릅니다.').length, 2)
})

test('hero CTA text difference is deduped against related comparison difference', () => {
  const cards = createVisualIssueCards({
    comparison: { differences: [{ text: 'Apply', figmaText: 'Apply now', webText: 'Apply', confidence: 'medium' }] },
    aiHints: { heroCtaGroup: { textDifferences: [{ source: 'figma', text: 'Apply now' }, { source: 'web', text: 'Consult' }] } },
  })

  assert.equal(cards.filter((card) => card.title.includes('CTA')).length, 2)
  assert.equal(cards.some((card) => card.detail.includes('Consult')), true)
})

test('system metadata is not emitted as QA cards', () => {
  const cards = createVisualIssueCards({ meta: { payloadVersion: '1.0', openAiCalled: false, playwrightRunCount: 1 }, comparison: {}, aiHints: {} })
  assert.equal(cards.some(hasInternalLabels), false)
  assert.equal(cards.some((card) => card.title.includes('Payload')), false)
})

test('critical warning check classification follows rule based criteria', () => {
  const cards = createVisualIssueCards({
    comparison: {
      differences: [
        { text: '월 47만원', figmaText: '월 47만원', webText: '월 50만원', confidence: 'medium' },
        { text: 'Hero title', figmaText: 'THE NEW X', webText: 'THE X', confidence: 'high', role: 'heading' },
        { text: '일반 문구', figmaText: 'A', webText: 'B', confidence: 'medium' },
      ],
    },
    aiHints: { heroMediaGroup: { comparisonHint: 'figma-image-vs-web-video', figma: { mediaTypes: ['image'] }, web: { mediaTypes: ['video'] } } },
  })
  const counts = countIssueCards(cards)

  assert.equal(counts.critical, 2)
  assert.equal(counts.warning, 1)
  assert.equal(counts.check, 1)
})

test('reference and non-CTA actions are excluded from default CTA items', () => {
  const items = createActionItems({
    ctaButtons: [
      { entityId: '1', source: 'web', role: 'primary-action', comparisonScope: 'primary', text: 'Apply', href: '/apply', sectionRole: 'hero' },
      { entityId: '2', source: 'web', role: 'navigation', comparisonScope: 'primary', text: 'Menu' },
      { entityId: '3', source: 'figma', role: 'primary-action', comparisonScope: 'reference-only', text: 'Reference' },
    ],
  })

  assert.deepEqual(items.map((item) => item.title), ['Apply'])
})

test('decorative media are not listed in default media summary', () => {
  const summary = createMediaSummary({
    canonicalEvidence: { media: [{ entityId: 'decorative', mediaType: 'image', role: 'decorative' }] },
    heroMediaGroup: {
      comparisonHint: '',
      figma: { primaryCandidates: [{ entityId: 'hero-image', source: 'figma', mediaType: 'image', role: 'foreground-primary' }] },
      web: { primaryCandidates: [] },
    },
    evidenceSummary: { content: { figmaImageCount: 3, webImageCount: 2, webVideoCount: 1 } },
  })

  assert.deepEqual(summary.heroPrimary.map((item) => item.id), ['hero-image'])
  assert.equal(summary.counts.figmaImage, 3)
})

test('OpenAI false visual summary does not use AI Summary label', () => {
  const summary = createVisualSummary({ meta: { webUrl: 'https://example.com', openAiCalled: false }, comparison: { matchedCount: 1, differenceCount: 0 }, aiHints: {} })
  assert.equal(summary.includes('AI Summary'), false)
})
