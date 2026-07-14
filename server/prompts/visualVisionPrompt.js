export function createVisualVisionReviewMessages(payload = {}) {
  const images = getOrderedVisionImages(payload.visionInput)
  const textPayload = createTextPayload(payload)

  return [
    { role: 'system', content: VISUAL_VISION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: createVisualVisionInstructionPrompt(images) },
        { type: 'text', text: createCompactCanonicalEvidencePrompt(textPayload) },
        ...images.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl, detail: image.detail } })),
      ],
    },
  ]
}

const VISUAL_VISION_SYSTEM_PROMPT = [
  'You are PagePilot QA Visual Review, a practical web QA reviewer for Figma-to-Web comparison.',
  'You receive up to four images in this order: Figma overview, Web overview, Figma hero/KV crop, Web hero/KV crop.',
  'First compare the images independently. Do not treat canonical evidence as the conclusion.',
  'Then validate exact strings, prices, CTA text/count/href, and media type against canonical evidence.',
  'Use vision for image content, visual subject, page structure, layout, and visible missing content.',
  'Use canonical evidence for exact text, price, CTA, and media metadata when OCR or vision is uncertain.',
  'Create only practical differences a QA operator should verify or fix. Prefer 3 to 6 visualDifferences.',
  'Omit trivial line breaks, tiny spacing, punctuation, same-meaning wording particles, weak spacing guesses, matched counts, total text-node counts, and repeated Hero issues.',
  'All user-facing fields title, summary, figmaValue, and webValue must be natural Korean.',
  'Return only valid JSON. Do not include markdown, local paths, base64, prompts, selectors, or hidden reasoning.',
].join(' ')

function createVisualVisionInstructionPrompt(images) {
  return [
    '이미지 비교 절차:',
    '1단계: canonical evidence를 결론처럼 따라 쓰지 말고 Figma/Web 이미지에서 실제로 보이는 차이를 먼저 관찰하세요.',
    '관찰 대상은 Hero/KV 이미지 내용, 외관/실내/제품/인물/배경 등 시각적 주제, 이미지와 영상의 차이, 주요 레이아웃, 텍스트 블록 배치, CTA 개수와 배치, 큰 콘텐츠 누락, 섹션 순서입니다.',
    '2단계: 관찰 결과를 canonical evidence와 대조하세요. 정확한 텍스트, 가격/금액/퍼센트, CTA 문구/href/count, media type은 canonical 값을 우선합니다.',
    '3단계: 실제 사용자가 확인할 가치가 있는 차이만 최종 issue로 만드세요.',
    '',
    '이미지 입력 순서:',
    ...images.map((image, index) => `${index + 1}. ${image.label} (${image.width || 0}x${image.height || 0}, detail=${image.detail})`),
    '',
    'Return exactly one JSON object with these keys: releaseDecision, summary, mustFix, verify, developerNotes, clientReplyDraft, visualDifferences.',
    'visualDifferences must be an array of objects with area, category, title, summary, figmaValue, webValue, severity, confidence, and order.',
    'category must be one of: Image, Layout, Text, CTA, Price, Media, Missing.',
    'severity must be one of: critical, warning, check. confidence must be one of: high, medium, low.',
    'visualDifferences는 기본 3~6개로 제한하세요. 같은 Hero Text, Hero CTA, Hero Media, 같은 가격, 같은 Layout 문제는 각각 최대 1건만 남기세요.',
    'CTA 대응 관계가 명확하지 않으면 CTA mismatch를 만들지 마세요. count 차이, canonical pair, 또는 vision+canonical 동시 지지가 필요합니다.',
    '가격/숫자 차이는 canonical 값을 그대로 쓰고, 모델명 숫자를 가격으로 오분류하지 마세요.',
    '이미지 내용 차이는 "이미지" 같은 일반어 대신 눈에 보이는 주제와 장면을 한국어로 구체적으로 설명하세요.',
    '출력 금지 예: Headline text mismatch, Hero media type mismatch, Minor spacing differences, CTA role swap.',
  ].join('\n')
}

function createCompactCanonicalEvidencePrompt(payload) {
  return [
    'Compact canonical evidence for validation only:',
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

function getOrderedVisionImages(visionInput = {}) {
  const rawImages = Array.isArray(visionInput.images)
    ? visionInput.images
    : ['figma-overview', 'web-overview', 'figma-hero', 'web-hero', 'figma', 'web']
      .map((key) => visionInput.images?.[key])
      .filter(Boolean)
  return rawImages
    .map((image) => ({
      label: normalizeLabel(image?.label),
      dataUrl: typeof image?.dataUrl === 'string' ? image.dataUrl : '',
      width: Number(image?.width) || 0,
      height: Number(image?.height) || 0,
      detail: normalizeDetail(image?.detail),
    }))
    .filter((image) => image.dataUrl)
    .slice(0, 4)
}

function normalizeLabel(value) {
  return /^[a-z0-9_-]+$/i.test(String(value || '')) ? String(value) : 'image'
}

function normalizeDetail(value) {
  return ['low', 'high', 'auto'].includes(value) ? value : 'auto'
}
