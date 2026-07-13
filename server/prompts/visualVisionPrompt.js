export function createVisualVisionReviewMessages(payload = {}) {
  const visionInput = payload.visionInput || {}
  const figmaImage = visionInput.images?.figma?.dataUrl || ''
  const webImage = visionInput.images?.web?.dataUrl || ''
  const textPayload = createTextPayload(payload)

  return [
    { role: 'system', content: VISUAL_VISION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: createVisualVisionUserPrompt(textPayload) },
        { type: 'image_url', image_url: { url: figmaImage, detail: 'high' } },
        { type: 'image_url', image_url: { url: webImage, detail: 'high' } },
      ],
    },
  ]
}

const VISUAL_VISION_SYSTEM_PROMPT = [
  'You are PagePilot QA Visual Review, a practical web QA reviewer.',
  'You receive two images: first is the Figma design render, second is the actual web screenshot.',
  'You also receive compact canonical evidence for exact text, CTA, price, and media metadata.',
  'Use image comparison for visual content, layout, missing major elements, and hero/KV media composition.',
  'Use canonical evidence for exact strings, prices, CTA text/count, and media type values when it conflicts with visual/OCR guesses.',
  'Do not invent small differences that are not visible or not supported by canonical evidence.',
  'Low-confidence differences should be omitted or marked severity check and confidence low.',
  'Return only valid JSON. Do not include markdown, local paths, base64, prompts, selectors, or hidden reasoning.',
].join(' ')

function createVisualVisionUserPrompt(payload) {
  return [
    'Compare the Figma image and Web screenshot with the canonical QA evidence.',
    'Return exactly one JSON object with these keys: releaseDecision, summary, mustFix, verify, developerNotes, clientReplyDraft, visualDifferences.',
    'visualDifferences must be an array of objects with area, category, title, summary, figmaValue, webValue, severity, confidence, and order.',
    'category must be one of: Image, Layout, Text, CTA, Price, Media, Missing.',
    'severity must be one of: critical, warning, check. confidence must be one of: high, medium, low.',
    'Focus on major visible differences: hero/KV image content, image versus video, missing major elements, large layout structure changes, major CTA placement/count, and obvious text placement differences.',
    'If image content is effectively the same, do not create an image issue.',
    'If exact text or price differs, prefer canonicalEvidence values over OCR or visual guesses.',
    'Do not include client-facing prose in visualDifferences. Keep each summary concise and actionable.',
    'Deduplicate equivalent issues across vision and canonical evidence.',
    '',
    JSON.stringify(payload),
  ].join('\n')
}

function createTextPayload(payload) {
  const rest = { ...(payload || {}) }
  delete rest.visionInput
  const visualAssets = rest.visualAssets
  return {
    ...rest,
    visualAssets: visualAssets ? {
      figmaRenderAvailable: Boolean(visualAssets.figmaRenderId),
      webScreenshotAvailable: Boolean(visualAssets.webScreenshotFileName),
    } : {},
    requestedOutputSchema: {
      ...(payload.requestedOutputSchema || {}),
      visualDifferences: [{ area: '', category: 'Image | Layout | Text | CTA | Price | Media | Missing', title: '', summary: '', figmaValue: '', webValue: '', severity: 'critical | warning | check', confidence: 'high | medium | low', order: 0 }],
    },
  }
}
