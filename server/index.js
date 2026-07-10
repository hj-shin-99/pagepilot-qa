import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { chromium, request as playwrightRequest } from 'playwright'

const PORT = Number(process.env.PORT || 3001)
const AI_QA_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const AI_QA_TIMEOUT_MS = 60000
const MAX_AI_IMAGE_DATA_URL_LENGTH = 50_000_000
const MAX_MOCKUP_AI_TEXT_HINTS = 100
const MAX_MOCKUP_AI_TEXT_LENGTH = 160
const MAX_MOCKUP_AI_ISSUES = 5
const MAX_CTA_HINTS = 40
const MAX_AI_ELEMENT_SUMMARY_ITEMS = 80
const MAX_AI_SECTION_SUMMARY_ITEMS = 24
const MAX_AI_CROP_PAIRS = 3
const MOCKUP_AI_STATUSES = ['수정 필요', '확인 필요', '무시 가능']
const MOCKUP_AI_TYPES = ['문구', '이미지', 'CTA', '레이아웃', '섹션', '금액']
const MOCKUP_AI_AREAS = ['top', 'middle', 'bottom', 'unknown']
const MAX_TEXT_MISMATCH_HINTS = 20
const MAX_TEXT_QA_CANDIDATES = 8
const MAX_LINKS_TO_CHECK = null
const MAX_DESIGN_ELEMENTS = 120
const DESKTOP_DESIGN_VIEWPORT = { width: 1920, height: 1080 }
const DESKTOP_SCREENSHOT_SCALE = 2
const NAVIGATION_TIMEOUT_MS = 15000
const LINK_TIMEOUT_MS = 7000
const LINK_CHECK_CONCURRENCY = 8
const NAV_CTA_CONTEXT_PATTERNS = [
  'global navigation',
  'navigation',
  'nav',
  'gnb',
  'header',
  'search',
  'menu',
  'bar items',
]
const PAGE_UNDERSTANDING_TYPES = ['home', 'landing', 'promotion', 'product-detail', 'calculator', 'form', 'listing', 'article', 'policy', 'other']
const SECTION_ROLES = ['hero', 'navigation', 'promotion', 'product', 'form', 'calculator', 'content', 'table', 'legal', 'footer', 'other']

const app = express()

loadLocalEnv()

app.use(express.json({ limit: '80mb' }))

app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

app.post('/api/scan', async (req, res) => {
  const targetUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : ''

  if (!isHttpUrl(targetUrl)) {
    res.status(400).json({ message: 'http:// 또는 https://로 시작하는 URL만 검사할 수 있습니다.' })
    return
  }

  try {
    const result = await scanUrl(targetUrl)
    res.json(result)
  } catch (error) {
    res.status(500).json({
      message: 'Playwright 검사 중 오류가 발생했습니다.',
      detail: error instanceof Error ? error.message : 'Unknown scan error',
    })
  }
})

app.post('/api/ai-mockup-qa', async (req, res) => {
  console.log('[Mockup AI QA] request received')

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    res.status(400).json({ message: 'OpenAI API Key가 설정되지 않았습니다.', code: 'missing_api_key' })
    return
  }

  const payload = createSafeMockupAiQaPayload(req.body)
  console.log(`[Mockup AI QA] web image attached: ${Boolean(payload.webScreenshotDataUrl)}`)
  console.log(`[Mockup AI QA] figma image attached: ${Boolean(payload.figmaImageDataUrl)}`)
  console.log('[Mockup AI QA] figma text hints:', payload.figmaTexts)
  console.log('[Mockup AI QA] web text hints:', payload.webTexts)
  console.log('[Mockup AI QA] text mismatch hints:', payload.textMismatchHints)
  console.log('[Mockup AI QA] figma CTA hints:', payload.figmaCtaHints)
  console.log('[Mockup AI QA] web CTA hints:', payload.webCtaHints)

  if (!payload.webScreenshotDataUrl || !payload.figmaImageDataUrl) {
    res.status(400).json({ message: '웹 캡처 이미지와 Figma 시안 이미지가 필요합니다.', code: 'missing_image' })
    return
  }

  try {
    const client = new OpenAI({ apiKey, timeout: AI_QA_TIMEOUT_MS })
    const result = await createMockupAiQaV3Result(client, payload)
    result.model = AI_QA_MODEL
    console.log('[Mockup AI QA] filtered issues:', result.issues)
    console.log('[Mockup AI QA] issues:', result.issues.map((issue) => ({ title: issue.title, status: issue.status, area: issue.area })))
    console.log('[Mockup AI QA] sending response')
    res.json({ ok: true, model: AI_QA_MODEL, result })
  } catch (error) {
    const mappedError = mapOpenAiError(error)
    console.log('[Mockup AI QA] sending response')
    res.status(mappedError.status).json(mappedError.body)
  }
})

if (process.env.PAGEPILOT_NO_LISTEN !== '1') {
  app.listen(PORT, () => {
    console.log(`PagePilot QA API listening on http://127.0.0.1:${PORT}`)
  })
}

function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function loadLocalEnv() {
  if (process.env.OPENAI_API_KEY) return

  try {
    const currentFile = fileURLToPath(import.meta.url)
    const envPath = path.resolve(path.dirname(currentFile), '..', '.env')
    if (!fs.existsSync(envPath)) return

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    lines.forEach((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return
      const separatorIndex = trimmed.indexOf('=')
      if (separatorIndex <= 0) return
      const key = trimmed.slice(0, separatorIndex).trim()
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '')
      if (key && process.env[key] === undefined) process.env[key] = value
    })
  } catch {
    // Missing or unreadable local .env is handled by the API route.
  }
}

function createSafeMockupAiQaPayload(body = {}) {
  const figmaTexts = normalizeTextHints(body.figmaTexts)
  const webTexts = normalizeTextHints(body.webTexts)

  return {
    url: isHttpUrl(body.url) ? body.url : '',
    pageTitle: limitText(body.pageTitle, 140),
    webScreenshotDataUrl: normalizeImageDataUrl(body.webScreenshotDataUrl),
    figmaImageDataUrl: normalizeImageDataUrl(body.figmaImageDataUrl),
    figmaTexts,
    webTexts,
    figmaCtaHints: normalizeCtaHints(body.figmaCtaHints, 'figma'),
    webCtaHints: normalizeCtaHints(body.webCtaHints, 'web'),
    figmaElementSummary: normalizeElementSummary(body.figmaElementSummary, 'figma'),
    webElementSummary: normalizeElementSummary(body.webElementSummary, 'web'),
    webDomSummary: normalizeWebDomSummary(body.webDomSummary),
    textMismatchHints: createTextMismatchHints(figmaTexts, webTexts),
  }
}

function normalizeElementSummary(value, source) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const items = []

  value.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const text = limitStrictText(item.text || item.label || item.name || '', 180)
    const role = normalizeSectionRole(item.role || item.kind || item.qaImportance || item.tag || 'other')
    const area = normalizeMockupArea(item.area || getAreaFromYRatio(item.yRatio ?? item.positionRatio))
    const yRatio = normalizeYRatio(item.yRatio ?? item.positionRatio)
    const sectionId = limitText(item.sectionId || '', 80)
    const sectionTitle = limitText(item.sectionTitle || item.sectionName || item.section || '', 120)
    const selector = source === 'web' ? limitText(item.selector || item.layerPath || '', 180) : ''
    const layerPath = source === 'figma' ? limitText(item.layerPath || '', 220) : limitText(item.layerPath || '', 160)
    const key = `${text}:${role}:${area}:${sectionId}:${sectionTitle}:${Math.round((yRatio ?? 0) * 100)}`
    if ((!text && !sectionTitle && !layerPath) || seen.has(key)) return
    seen.add(key)
    items.push({
      id: limitText(item.id || `${source}-element-${index + 1}`, 80),
      text,
      role,
      tag: limitText(item.tag || '', 40),
      href: limitText(item.href || '', 180),
      selector,
      layerPath,
      sectionId,
      sectionTitle,
      area,
      yRatio,
      isCta: Boolean(item.isCta || item.isButton || role === 'button' || item.tag === 'button'),
      isNavigation: Boolean(item.isNavigation),
      isFooterDisclaimer: Boolean(item.isFooterDisclaimer),
    })
  })

  return items.slice(0, MAX_AI_ELEMENT_SUMMARY_ITEMS)
}

function normalizeWebDomSummary(value) {
  if (!value || typeof value !== 'object') return {}
  return {
    pageTitle: limitText(value.pageTitle || '', 140),
    headings: normalizeElementSummary(value.headings, 'web').slice(0, 30),
    visibleTextBlocks: normalizeElementSummary(value.visibleTextBlocks, 'web').slice(0, 60),
    ctas: normalizeElementSummary(value.ctas, 'web').slice(0, 40),
    formFields: normalizeElementSummary(value.formFields, 'web').slice(0, 40),
    priceOrNumberCandidates: normalizeElementSummary(value.priceOrNumberCandidates, 'web').slice(0, 40),
    images: normalizeElementSummary(value.images, 'web').slice(0, 40),
    sections: normalizePrimarySections(value.sections, 'web'),
  }
}

function normalizeCtaHints(value, source) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const hints = []

  value.forEach((item) => {
    const text = normalizeCtaText(item?.text || item?.label || '')
    if (!isMeaningfulCtaText(text)) return

    const area = normalizeMockupArea(item?.area)
    const href = limitText(item?.href || '', 260)
    const key = `${normalizeComparableQaText(text)}:${area}:${href}`
    if (seen.has(key)) return
    seen.add(key)

    const contextText = [item?.layerPath, item?.name, item?.selector, item?.ariaLabel, item?.label]
      .map((part) => limitText(part || '', 220))
      .filter(Boolean)
      .join(' ')

    hints.push({
      text,
      href,
      selector: source === 'web' ? limitText(item?.selector || '', 180) : '',
      area,
      y: Number.isFinite(Number(item?.y)) ? Math.round(Number(item.y)) : null,
      visible: item?.visible !== false,
      layerPath: source === 'figma' ? limitText(item?.layerPath || '', 220) : '',
      yRatio: Number.isFinite(Number(item?.yRatio)) ? Math.max(0, Math.min(1, Number(item.yRatio))) : null,
      navCandidate: isNavigationCtaContext(contextText),
    })
  })

  return hints.slice(0, MAX_CTA_HINTS)
}

function normalizeCtaText(value) {
  return limitText(String(value || '').replace(/\s+/g, ' ').trim(), 80)
}

function isMeaningfulCtaText(value) {
  const text = String(value || '').trim()
  if (text.length < 2) return false
  if (/^[\p{Emoji_Presentation}\p{Symbol}\s]+$/u.test(text)) return false
  if (/^[<>+\-_=|/\\•·.]+$/.test(text)) return false
  return true
}

function normalizeImageDataUrl(value) {
  return typeof value === 'string' && /^data:image\//.test(value) && value.length <= MAX_AI_IMAGE_DATA_URL_LENGTH ? value : ''
}

function normalizeTextHints(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const hints = []

  value.forEach((item) => {
    const text = limitText(typeof item === 'string' ? item : item?.text || item?.label || '', MAX_MOCKUP_AI_TEXT_LENGTH)
    if (!text || seen.has(text)) return
    seen.add(text)
    hints.push(text)
  })

  return hints.slice(0, MAX_MOCKUP_AI_TEXT_HINTS)
}

function createTextMismatchHints(figmaTexts, webTexts) {
  const hints = []
  const seen = new Set()

  for (const figmaText of figmaTexts) {
    for (const webText of webTexts) {
      const reason = getTextMismatchReason(figmaText, webText)
      if (!reason || !areRelatedMismatchTexts(figmaText, webText, reason)) continue

      const key = `${reason}:${normalizeCriticalMockupText(figmaText)}:${normalizeCriticalMockupText(webText)}`
      if (seen.has(key)) continue
      seen.add(key)
      hints.push({ reason, figma: figmaText, web: webText })
      if (hints.length >= MAX_TEXT_MISMATCH_HINTS) return hints
    }
  }

  return hints
}

function getTextMismatchReason(figmaText, webText) {
  if (hasTermPairMismatch(figmaText, webText, '금융상품', '금융프로그램')) return '금융 상품/금융 프로그램'
  if (hasTermPairMismatch(figmaText, webText, '운용리스', '리스')) return '운용리스/리스'
  if (hasTermPairMismatch(figmaText, webText, '상품', '프로그램')) return '상품/프로그램'
  if (hasRateMismatch(figmaText, webText)) return '금리/숫자 패턴 다름'
  if (hasCtaMismatch(figmaText, webText)) return 'CTA 문구 다름'
  return ''
}

function hasTermPairMismatch(firstText, secondText, firstTerm, secondTerm) {
  const first = normalizeCriticalMockupText(firstText)
  const second = normalizeCriticalMockupText(secondText)

  return hasCriticalPairDifference(first, second, firstTerm, secondTerm)
}

function hasRateMismatch(figmaText, webText) {
  const figmaRates = extractRateTokens(figmaText)
  const webRates = extractRateTokens(webText)
  if (figmaRates.length === 0 || webRates.length === 0) return false
  return figmaRates.join('|') !== webRates.join('|')
}

function extractRateTokens(value) {
  const text = String(value || '').toLowerCase()
  const shouldCheck = /%|금리|이율|할부|리스/.test(text)
  if (!shouldCheck) return []
  return (text.match(/\d+(?:[.,]\d+)?\s*(?:~|-)\s*\d+(?:[.,]\d+)?\s*%?|\d+(?:[.,]\d+)?\s*%/g) || [])
    .map((token) => token.replace(/\s+/g, '').replace(/,/g, '.'))
}

function hasCtaMismatch(figmaText, webText) {
  if (!hasCtaTerm(figmaText) || !hasCtaTerm(webText)) return false
  return !isMinorMockupTextDifference(figmaText, webText)
}

function hasCtaTerm(value) {
  return /구매상담|프로모션|바로가기|신청|상담|자세히|더\s*보기|더\s*알아보기/i.test(String(value || ''))
}

function areRelatedMismatchTexts(figmaText, webText, reason) {
  if (reason === '운용리스/리스') return true
  if (reason === '금리/숫자 패턴 다름') return hasMeaningfulTextOverlap(figmaText, webText) || hasRateContext(figmaText, webText)
  return hasMeaningfulTextOverlap(figmaText, webText) || reason === 'CTA 문구 다름'
}

function hasRateContext(figmaText, webText) {
  return /금리|이율|할부|리스|%/.test(`${figmaText} ${webText}`)
}

function hasMeaningfulTextOverlap(figmaText, webText) {
  const figmaTokens = getComparableHintTokens(figmaText)
  const webTokens = getComparableHintTokens(webText)

  return figmaTokens.some((figmaToken) => webTokens.some((webToken) => {
    if (figmaToken === webToken) return true
    return figmaToken.length >= 3 && webToken.length >= 3 && (figmaToken.includes(webToken) || webToken.includes(figmaToken))
  }))
}

function getComparableHintTokens(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^0-9a-z가-힣.%~-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !['상품', '프로그램', '리스'].includes(token))
}

async function createMockupAiQaV3Result(client, payload) {
  const debug = createMockupAiDebugState(payload)
  let pageUnderstanding = createFallbackPageUnderstanding(payload)
  let pageUnderstandingFallback = true

  try {
    console.log('[Mockup AI QA] calling page understanding')
    const rawUnderstanding = await requestPageUnderstanding(client, payload)
    const parsedUnderstanding = parseAiQaJson(rawUnderstanding)
    if (parsedUnderstanding) {
      pageUnderstanding = normalizePageUnderstanding(parsedUnderstanding, payload)
      pageUnderstandingFallback = false
    }
  } catch (error) {
    console.log('[Mockup AI QA] page understanding failed:', error instanceof Error ? error.message : error)
  }

  const sectionMapping = createSectionMapping(pageUnderstanding, payload)
  const cropComparisons = await createSectionCropComparisons(payload, sectionMapping)
  debug.pageType = pageUnderstanding.pageType
  debug.pagePurpose = pageUnderstanding.pagePurpose
  debug.figmaSectionCount = pageUnderstanding.figmaStructure.primarySections.length
  debug.webSectionCount = pageUnderstanding.webStructure.primarySections.length
  debug.mappedSectionCount = sectionMapping.mappedSections.length
  debug.unmappedFigmaSections = sectionMapping.unmappedFigmaSections.map((section) => section.id)
  debug.unmappedWebSections = sectionMapping.unmappedWebSections.map((section) => section.id)
  debug.cropPairCount = cropComparisons.length

  const textResult = createTextQaComparisonResult(payload, { pageUnderstanding, sectionMapping })
  debug.textIssueCount = textResult.issues.length

  let evidenceResult
  let evidenceFallback = false
  try {
    console.log('[Mockup AI QA] calling evidence-based comparison')
    const rawComparison = await requestMockupAiQa(client, payload, { pageUnderstanding, sectionMapping, cropComparisons, textQaIssues: textResult.issues })
    const parsedComparison = parseAiQaJson(rawComparison)
    if (!parsedComparison) throw new Error('Evidence comparison JSON parse failed')
    evidenceResult = normalizeMockupAiQaResult(parsedComparison, payload, { pageUnderstanding, sectionMapping })
  } catch (error) {
    evidenceFallback = true
    console.log('[Mockup AI QA] evidence comparison failed:', error instanceof Error ? error.message : error)
    evidenceResult = { issues: [], ignoredDifferences: [], removedIssues: [{ title: 'AI 비교 fallback', reason: '증거 기반 비교 응답을 해석하지 못했습니다.' }] }
  }

  const ctaResult = createCtaComparisonResult(payload, { pageUnderstanding, sectionMapping })
  const imageResult = await createImageOnlyMockupQaResult(client, payload, { pageUnderstanding, sectionMapping, cropComparisons })
  const candidateResult = createFinalMockupQaResult({ textResult, visionResult: evidenceResult, ctaResult, imageResult, payload })
  debug.rawIssueCount = textResult.issues.length + evidenceResult.issues.length + ctaResult.issues.length + imageResult.issues.length
  debug.dedupedIssueCount = candidateResult.issues.length

  const { result: verifiedResult, verification } = await createVerifiedMockupAiQaResult(client, payload, candidateResult, { pageUnderstanding, sectionMapping })
  const protectedResult = restoreProtectedTextIssues(verifiedResult, textResult.issues)
  debug.verifiedIssueCount = protectedResult.issues.length
  debug.removedMismatchCount = protectedResult.removedIssues.length
  debug.finalIssueCount = protectedResult.issues.filter((issue) => issue.status !== '무시 가능' && issue.priorityLevel !== 'low').length
  debug.issueEvidence = protectedResult.issues.map((issue) => ({
    title: issue.title,
    sourceAgreement: issue.evidence?.sourceAgreement ?? null,
    confidence: issue.confidence,
  }))

  console.log('[Mockup AI QA] v0.3 debug:', debug)

  return {
    ...protectedResult,
    verification: {
      ...verification,
      pageUnderstandingFallback,
      evidenceFallback,
    },
    debug: {
      ...(candidateResult.debug || {}),
      ...debug,
      ctaError: ctaResult?.error || '',
      imageError: imageResult?.error || '',
    },
  }
}

function createMockupAiDebugState(payload) {
  return {
    pageType: 'other',
    pagePurpose: '',
    figmaSectionCount: 0,
    webSectionCount: 0,
    mappedSectionCount: 0,
    unmappedFigmaSections: [],
    unmappedWebSections: [],
    rawIssueCount: 0,
    verifiedIssueCount: 0,
    removedMismatchCount: 0,
    dedupedIssueCount: 0,
    finalIssueCount: 0,
    cropPairCount: 0,
    textIssueCount: 0,
    source: {
      figmaTexts: payload.figmaTexts.length,
      webTexts: payload.webTexts.length,
      figmaElements: payload.figmaElementSummary.length,
      webElements: payload.webElementSummary.length,
    },
    issueEvidence: [],
  }
}

async function requestPageUnderstanding(client, payload) {
  const completion = await client.chat.completions.create({
    model: AI_QA_MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: getPageUnderstandingSystemPrompt() },
      {
        role: 'user',
        content: [
          { type: 'text', text: createPageUnderstandingPrompt(payload) },
          { type: 'image_url', image_url: { url: payload.figmaImageDataUrl, detail: 'auto' } },
          { type: 'image_url', image_url: { url: payload.webScreenshotDataUrl, detail: 'auto' } },
        ],
      },
    ],
    response_format: createJsonSchemaResponseFormat('page_understanding', getPageUnderstandingSchema()),
    max_completion_tokens: 1800,
  })

  return completion.choices?.[0]?.message?.content || ''
}

function getPageUnderstandingSystemPrompt() {
  return [
    '너는 범용 웹페이지 QA를 위한 페이지 구조 분석 담당자다.',
    '첫 번째 이미지는 Figma 시안이고 두 번째 이미지는 실제 웹 캡처다.',
    '아직 차이를 보고하지 말고, 페이지 유형/목적/주요 섹션/비교 초점만 구조화한다.',
    '특정 브랜드, 테스트 케이스, 정답 문구를 추정하지 않는다.',
    'Figma JSON과 Web DOM은 이미지 판단을 보조하는 힌트이며 절대 기준이 아니다.',
    '페이지 유형은 억지로 하나에 끼워 맞추지 말고 secondaryTraits로 보완한다.',
    '섹션 role은 시각적 위치보다 제목, 주변 문맥, 요소 구성, DOM/layer path를 함께 보고 판단한다.',
    '반드시 JSON으로만 응답한다.',
  ].join('\n')
}

function createPageUnderstandingPrompt(payload) {
  const hints = {
    url: payload.url,
    urlPath: getUrlPath(payload.url),
    pageTitle: payload.pageTitle,
    figma: createFigmaAiSummary(payload),
    web: createWebAiSummary(payload),
  }

  return [
    '입력 페이지를 먼저 이해하세요. 차이점 이슈는 아직 만들지 마세요.',
    '페이지 유형 참고: home, landing, promotion, product-detail, calculator, form, listing, article, policy, other.',
    '유형별 중요 대상은 페이지 목적에 따라 달라집니다. form은 필드/라벨/동의/버튼, product-detail은 상품명/이미지/사양/가격/CTA, policy는 조항/날짜/표/법적 고지를 중점으로 봅니다.',
    '출력 JSON은 pageType, primaryPageType, secondaryTraits, pagePurpose, figmaStructure.primarySections, webStructure.primarySections, comparisonFocus, uncertainties를 포함하세요.',
    'primarySections 항목은 id, role, title, area, approxYRatio, importantElements를 포함하세요.',
    JSON.stringify(hints, null, 2),
  ].join('\n\n')
}

function getPageUnderstandingSchema() {
  return {
    type: 'object',
    properties: {
      pageType: { type: 'string' },
      primaryPageType: { type: 'string' },
      secondaryTraits: { type: 'array', items: { type: 'string' } },
      pagePurpose: { type: 'string' },
      figmaStructure: { type: 'object' },
      webStructure: { type: 'object' },
      comparisonFocus: { type: 'array', items: { type: 'string' } },
      uncertainties: { type: 'array', items: { type: 'string' } },
    },
  }
}

function createJsonSchemaResponseFormat(name, schema) {
  return {
    type: 'json_schema',
    json_schema: {
      name,
      strict: false,
      schema,
    },
  }
}

function createFigmaAiSummary(payload) {
  return {
    visibleTexts: payload.figmaTexts,
    elements: payload.figmaElementSummary,
    ctas: payload.figmaCtaHints,
    sections: inferSectionsFromElements(payload.figmaElementSummary, 'figma'),
    numberCandidates: payload.figmaElementSummary.filter((item) => hasNumberLikeText(item.text)).slice(0, 30),
  }
}

function createWebAiSummary(payload) {
  return {
    pageTitle: payload.pageTitle || payload.webDomSummary.pageTitle || '',
    visibleTexts: payload.webTexts,
    elements: payload.webElementSummary,
    ctas: payload.webCtaHints,
    dom: payload.webDomSummary,
    sections: payload.webDomSummary.sections?.length ? payload.webDomSummary.sections : inferSectionsFromElements(payload.webElementSummary, 'web'),
    numberCandidates: payload.webElementSummary.filter((item) => hasNumberLikeText(item.text)).slice(0, 30),
  }
}

function normalizePageUnderstanding(value, payload) {
  const pageType = normalizePageType(value?.pageType || value?.primaryPageType)
  const fallback = createFallbackPageUnderstanding(payload)
  return {
    pageType,
    primaryPageType: normalizePageType(value?.primaryPageType || pageType),
    secondaryTraits: normalizeStringArray(value?.secondaryTraits).slice(0, 6),
    pagePurpose: limitText(value?.pagePurpose || fallback.pagePurpose, 220),
    figmaStructure: {
      primarySections: normalizePrimarySections(value?.figmaStructure?.primarySections, 'figma', fallback.figmaStructure.primarySections),
    },
    webStructure: {
      primarySections: normalizePrimarySections(value?.webStructure?.primarySections, 'web', fallback.webStructure.primarySections),
    },
    comparisonFocus: normalizeStringArray(value?.comparisonFocus).slice(0, 12),
    uncertainties: normalizeStringArray(value?.uncertainties).slice(0, 12),
  }
}

function createFallbackPageUnderstanding(payload) {
  const inferredType = inferPageTypeFromHints(payload)
  return {
    pageType: inferredType,
    primaryPageType: inferredType,
    secondaryTraits: [],
    pagePurpose: payload.pageTitle ? `${payload.pageTitle} 페이지의 주요 콘텐츠와 사용자 행동을 확인하는 페이지` : '입력된 웹페이지의 주요 콘텐츠와 사용자 행동을 확인하는 페이지',
    figmaStructure: { primarySections: inferSectionsFromElements(payload.figmaElementSummary, 'figma') },
    webStructure: { primarySections: payload.webDomSummary.sections?.length ? payload.webDomSummary.sections : inferSectionsFromElements(payload.webElementSummary, 'web') },
    comparisonFocus: inferComparisonFocus(inferredType),
    uncertainties: ['Page Understanding AI가 실패하거나 구조 정보가 부족해 힌트 기반 fallback을 사용했습니다.'],
  }
}

function normalizePrimarySections(value, source, fallback = []) {
  const sections = Array.isArray(value) ? value : []
  const normalized = sections.map((section, index) => ({
    id: limitText(section?.id || `${source}-section-${index + 1}`, 80),
    role: normalizeSectionRole(section?.role),
    title: limitText(section?.title || section?.name || section?.sectionTitle || `${source} section ${index + 1}`, 140),
    area: normalizeMockupArea(section?.area || getAreaFromYRatio(section?.approxYRatio ?? section?.yRatio)),
    approxYRatio: normalizeYRatio(section?.approxYRatio ?? section?.yRatio),
    importantElements: normalizeStringArray(section?.importantElements).slice(0, 8),
  })).filter((section) => section.title || section.role !== 'other')

  return (normalized.length > 0 ? normalized : fallback).slice(0, MAX_AI_SECTION_SUMMARY_ITEMS)
}

function inferSectionsFromElements(elements, source) {
  const sourceItems = Array.isArray(elements) ? elements : []
  const groups = new Map()
  sourceItems.forEach((item) => {
    const area = normalizeMockupArea(item.area || getAreaFromYRatio(item.yRatio))
    const title = limitText(item.sectionTitle || area, 120)
    const role = inferSectionRoleFromText(`${item.role || ''} ${title} ${item.layerPath || ''} ${item.selector || ''}`)
    const key = `${area}:${role}:${title || 'section'}`
    const current = groups.get(key) || {
      id: `${source}-section-${groups.size + 1}`,
      role,
      title: title || `${area} section`,
      area,
      approxYRatio: Number.isFinite(item.yRatio) ? item.yRatio : getAreaDefaultYRatio(area),
      importantElements: new Set(),
      count: 0,
    }
    current.count += 1
    if (item.text) current.importantElements.add('text')
    if (item.isCta || item.tag === 'button') current.importantElements.add('cta')
    if (item.tag === 'img' || /image|img|visual|photo|video/i.test(item.role || item.layerPath || '')) current.importantElements.add('image')
    if (hasNumberLikeText(item.text)) current.importantElements.add('price')
    groups.set(key, current)
  })

  return Array.from(groups.values())
    .sort((first, second) => first.approxYRatio - second.approxYRatio || second.count - first.count)
    .slice(0, MAX_AI_SECTION_SUMMARY_ITEMS)
    .map((section) => ({
      id: section.id,
      role: section.role,
      title: section.title,
      area: section.area,
      approxYRatio: section.approxYRatio,
      importantElements: Array.from(section.importantElements),
    }))
}

function createSectionMapping(pageUnderstanding) {
  const figmaSections = pageUnderstanding.figmaStructure.primarySections
  const webSections = pageUnderstanding.webStructure.primarySections
  const usedWebIds = new Set()
  const mappedSections = []

  figmaSections.forEach((figmaSection) => {
    let best = null
    let bestScore = 0
    webSections.forEach((webSection) => {
      if (usedWebIds.has(webSection.id)) return
      const score = getSectionMatchScore(figmaSection, webSection)
      if (score > bestScore) {
        best = webSection
        bestScore = score
      }
    })
    if (best && bestScore >= 0.46) {
      usedWebIds.add(best.id)
      mappedSections.push({
        figmaSectionId: figmaSection.id,
        webSectionId: best.id,
        figmaRole: figmaSection.role,
        webRole: best.role,
        role: figmaSection.role === best.role ? figmaSection.role : 'other',
        figmaTitle: figmaSection.title,
        webTitle: best.title,
        area: figmaSection.area === best.area ? figmaSection.area : 'unknown',
        figmaYRatio: figmaSection.approxYRatio,
        webYRatio: best.approxYRatio,
        confidence: Math.round(bestScore * 100) / 100,
      })
    }
  })

  return {
    mappedSections,
    unmappedFigmaSections: figmaSections.filter((section) => !mappedSections.some((match) => match.figmaSectionId === section.id)),
    unmappedWebSections: webSections.filter((section) => !usedWebIds.has(section.id)),
  }
}

function getSectionMatchScore(figmaSection, webSection) {
  if (!figmaSection || !webSection) return 0
  let score = 0
  const incompatibleRoles = new Set(['navigation:legal', 'navigation:footer', 'hero:legal', 'form:footer', 'form:legal', 'product:navigation'])
  if (incompatibleRoles.has(`${figmaSection.role}:${webSection.role}`) || incompatibleRoles.has(`${webSection.role}:${figmaSection.role}`)) return 0
  if (figmaSection.role === webSection.role) score += 0.42
  if (figmaSection.area === webSection.area && figmaSection.area !== 'unknown') score += 0.16
  score += Math.max(0, 0.18 - Math.abs(Number(figmaSection.approxYRatio || 0) - Number(webSection.approxYRatio || 0)) * 0.22)
  score += Math.min(0.22, getQaTextSimilarity(normalizeComparableQaText(figmaSection.title), normalizeComparableQaText(webSection.title)) * 0.22)
  const figmaElements = new Set(figmaSection.importantElements || [])
  const webElements = new Set(webSection.importantElements || [])
  let overlap = 0
  figmaElements.forEach((item) => {
    if (webElements.has(item)) overlap += 1
  })
  if (figmaElements.size > 0 || webElements.size > 0) score += (overlap / Math.max(figmaElements.size, webElements.size, 1)) * 0.18
  return Math.min(1, score)
}

async function createSectionCropComparisons(payload, sectionMapping) {
  try {
    const cropPlans = sectionMapping.mappedSections
      .filter((match) => Number.isFinite(match.figmaYRatio) && Number.isFinite(match.webYRatio))
      .sort((first, second) => second.confidence - first.confidence)
      .slice(0, MAX_AI_CROP_PAIRS)
      .map((match, index) => ({
        id: `crop-${index + 1}`,
        label: `${match.figmaTitle || match.figmaSectionId} / ${match.webTitle || match.webSectionId}`,
        figmaYRatio: match.figmaYRatio,
        webYRatio: match.webYRatio,
        figmaSectionId: match.figmaSectionId,
        webSectionId: match.webSectionId,
      }))
    if (cropPlans.length === 0) return []
    return await cropImagePairs(payload.figmaImageDataUrl, payload.webScreenshotDataUrl, cropPlans)
  } catch (error) {
    console.log('[Mockup AI QA] crop failed:', error instanceof Error ? error.message : error)
    return []
  }
}

async function cropImagePairs(figmaDataUrl, webDataUrl, cropPlans) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    return await page.evaluate(async ({ figmaUrl, webUrl, plans }) => {
      async function loadImage(src) {
        return await new Promise((resolve, reject) => {
          const image = new globalThis.Image()
          image.onload = () => resolve(image)
          image.onerror = () => reject(new Error('image load failed'))
          image.src = src
        })
      }

      function cropImage(image, yRatio) {
        const height = Math.max(160, Math.min(image.naturalHeight, Math.round(image.naturalHeight * 0.28)))
        const y = Math.max(0, Math.min(image.naturalHeight - height, Math.round(image.naturalHeight * Math.max(0, Math.min(1, yRatio)) - height * 0.25)))
        const canvas = globalThis.document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = height
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, y, image.naturalWidth, height, 0, 0, image.naturalWidth, height)
        return { dataUrl: canvas.toDataURL('image/png'), y, height, width: image.naturalWidth }
      }

      const figmaImage = await loadImage(figmaUrl)
      const webImage = await loadImage(webUrl)
      return plans.map((plan) => ({
        ...plan,
        figma: cropImage(figmaImage, plan.figmaYRatio),
        web: cropImage(webImage, plan.webYRatio),
      }))
    }, { figmaUrl: figmaDataUrl, webUrl: webDataUrl, plans: cropPlans })
  } finally {
    await browser.close()
  }
}

function createTextQaComparisonResult(payload = {}, context = {}) {
  try {
    const figmaItems = createStrictTextItems(payload, 'figma')
    const webItems = createStrictTextItems(payload, 'web')
    if (figmaItems.length === 0 || webItems.length === 0) return { issues: [], removedIssues: [], ignoredDifferences: [], error: '' }

    const matches = createStrictTextMatches(figmaItems, webItems, context)
    const matchedFigmaIds = new Set(matches.map((match) => match.figmaItem.id))
    const matchedWebIds = new Set(matches.map((match) => match.webItem.id))
    const issues = matches
      .filter((match) => hasStrictRawTextDifference(match.figmaItem.strictText, match.webItem.strictText))
      .map((match) => createStrictTextIssue(match, context))
      .concat(createUnmatchedTextIssues(figmaItems, webItems, matchedFigmaIds, matchedWebIds, context))

    const sortedIssues = sortFinalMockupIssues(issues.map((issue) => applyIssuePriorityRules(issue))).slice(0, MAX_TEXT_QA_CANDIDATES)
    const summary = normalizeMockupSummary(sortedIssues, [], [])
    return { summary, counts: summary, issues: sortedIssues, removedIssues: [], ignoredDifferences: [], error: '' }
  } catch (error) {
    console.log('[Mockup AI QA] Text QA comparison failed:', error instanceof Error ? error.message : error)
    return { issues: [], removedIssues: [], ignoredDifferences: [], error: 'text_compare_failed' }
  }
}

function createStrictTextItems(payload, source) {
  const summaryItems = source === 'figma' ? payload.figmaElementSummary : payload.webElementSummary
  const ctaHints = source === 'figma' ? payload.figmaCtaHints : payload.webCtaHints
  const fallbackTexts = source === 'figma' ? payload.figmaTexts : payload.webTexts
  const items = []
  const seen = new Set()

  ;(Array.isArray(summaryItems) ? summaryItems : []).forEach((item, index) => {
    pushStrictTextItem(items, seen, normalizeStrictTextItem(item, source, index))
  })

  ;(Array.isArray(ctaHints) ? ctaHints : []).forEach((item, index) => {
    pushStrictTextItem(items, seen, normalizeStrictTextItem({ ...item, isCta: true, role: 'cta', tag: 'button' }, source, index + 1000))
  })

  if (items.length === 0) {
    ;(Array.isArray(fallbackTexts) ? fallbackTexts : []).forEach((text, index) => {
      pushStrictTextItem(items, seen, normalizeStrictTextItem({ text }, source, index + 2000))
    })
  }

  return items.filter(isStrictTextQaTarget).slice(0, MAX_AI_ELEMENT_SUMMARY_ITEMS)
}

function normalizeStrictTextItem(item, source, index) {
  const text = String(item?.text || item?.label || item?.name || '').trim()
  const yRatio = normalizeYRatio(item?.yRatio ?? item?.positionRatio)
  const area = normalizeMockupArea(item?.area || getAreaFromYRatio(yRatio))
  const contextText = `${item?.role || ''} ${item?.tag || ''} ${item?.layerPath || ''} ${item?.selector || ''} ${item?.sectionTitle || item?.sectionName || item?.section || ''}`
  return {
    id: limitText(item?.id || `${source}-text-${index + 1}`, 80),
    source,
    text,
    strictText: text,
    comparableText: normalizeStrictComparableText(text),
    looseText: normalizeComparableQaText(text),
    category: getStrictTextCategory(item, text),
    elementRole: getStrictElementRole(item, text),
    sectionRole: normalizeSectionRole(contextText),
    tag: limitText(item?.tag || '', 40),
    role: limitText(item?.role || '', 80),
    href: limitText(item?.href || '', 180),
    sectionId: limitText(item?.sectionId || '', 80),
    sectionTitle: limitText(item?.sectionTitle || item?.sectionName || item?.section || '', 120),
    area,
    yRatio,
    layerPath: limitText(item?.layerPath || '', 220),
    selector: limitText(item?.selector || '', 180),
    isCta: Boolean(item?.isCta),
    isNavigation: Boolean(item?.isNavigation),
    visible: item?.visible !== false,
    width: Number.isFinite(Number(item?.width)) ? Number(item.width) : null,
    height: Number.isFinite(Number(item?.height)) ? Number(item.height) : null,
  }
}

function pushStrictTextItem(items, seen, item) {
  if (!item.strictText) return
  const key = `${item.strictText}:${item.category}:${item.area}:${item.sectionTitle}`
  if (seen.has(key)) return
  seen.add(key)
  items.push(item)
}

function isStrictTextQaTarget(item) {
  if (!item || !item.strictText) return false
  if (item.category !== 'body') return true
  return hasCriticalTextToken(item.strictText)
}

function getStrictTextCategory(item, text) {
  const context = `${item?.role || ''} ${item?.tag || ''} ${item?.layerPath || ''} ${item?.selector || ''} ${item?.sectionTitle || ''}`.toLowerCase()
  if (hasMoneyText(text)) return 'money'
  if (hasPercentText(text)) return 'percent'
  if (hasDateOrPeriodText(text)) return 'date-period'
  if (hasModelNameText(text)) return 'model'
  if (item?.isCta || /button|btn|cta|link-button|submit|role.?button/i.test(context)) return 'cta'
  if (/^h[1-6]$/.test(String(item?.tag || '').toLowerCase()) || /title|heading|headline|제목|타이틀/i.test(context)) return 'title'
  if (item?.href || /^a$/i.test(item?.tag || '') || /link|링크/i.test(context)) return 'link'
  if (/button|btn|버튼/i.test(context)) return 'button'
  if (/\d/.test(text)) return 'number'
  return 'body'
}

function getStrictElementRole(item, text) {
  const context = `${item?.role || ''} ${item?.tag || ''} ${item?.layerPath || ''} ${item?.selector || ''} ${item?.sectionTitle || ''}`.toLowerCase()
  if (item?.isCta || /button|btn|cta|submit|role.?button|버튼/i.test(context)) return 'cta'
  if (item?.href || /^a$/i.test(item?.tag || '') || /link|링크/i.test(context)) return 'link'
  if (/^h[1-6]$/.test(String(item?.tag || '').toLowerCase()) || /title|heading|headline|제목|타이틀/i.test(context)) return 'heading'
  if (/legal|disclaimer|약관|고지|유의|footer|푸터|copyright/i.test(context)) return 'legal'
  if (/nav|gnb|menu|navigation|tab|탭/.test(context)) return 'navigation'
  if (hasMoneyText(text) || hasPercentText(text) || hasDateOrPeriodText(text)) return 'quantitative'
  return 'body'
}

function createStrictTextMatches(figmaItems, webItems, context = {}) {
  const pairCandidates = []
  figmaItems.forEach((figmaItem) => {
    webItems.forEach((webItem) => {
      const candidate = createStrictTextPairCandidate(figmaItem, webItem, context)
      if (!candidate || candidate.matchConfidence === 'low') return
      pairCandidates.push(candidate)
    })
  })

  const usedFigmaIds = new Set()
  const usedWebIds = new Set()
  return pairCandidates
    .sort((first, second) => second.matchScore - first.matchScore)
    .filter((candidate) => {
      if (usedFigmaIds.has(candidate.figmaItem.id) || usedWebIds.has(candidate.webItem.id)) return false
      usedFigmaIds.add(candidate.figmaItem.id)
      usedWebIds.add(candidate.webItem.id)
      return true
    })
}

function createStrictTextPairCandidate(figmaItem, webItem, context = {}) {
  const mapping = findMappedSectionForTextItems(figmaItem, webItem, context.sectionMapping)
  const scoreDetails = getStrictTextMatchScore(figmaItem, webItem, mapping)
  const rejectReason = getStrictTextPairRejectReason(figmaItem, webItem, scoreDetails, mapping)
  if (rejectReason) return null
  const matchConfidence = getStrictTextMatchConfidence(scoreDetails.score, scoreDetails, mapping)
  return {
    figmaItem,
    webItem,
    mapping,
    matchScore: scoreDetails.score,
    matchConfidence,
    protectedTextQa: matchConfidence === 'high',
    scoreDetails,
  }
}

function getStrictTextMatchScore(figmaItem, webItem, mapping) {
  let score = 0
  const sameMappedSection = Boolean(mapping?.sameMappedSection)
  const compatibleRole = areStrictElementRolesCompatible(figmaItem, webItem)
  const yDelta = getStrictYRatioDelta(figmaItem, webItem)
  const sectionContextScore = getSectionContextScore(figmaItem, webItem)
  const textShapeScore = getStrictTextShapeScore(figmaItem, webItem)

  if (sameMappedSection) score += 0.34
  if (figmaItem.area === webItem.area && figmaItem.area !== 'unknown') score += 0.1
  if (compatibleRole) score += 0.18
  if (Number.isFinite(yDelta)) score += Math.max(0, 0.14 - yDelta * 0.18)
  score += sectionContextScore * 0.14
  score += textShapeScore * 0.1
  if (figmaItem.category === webItem.category) score += 0.08
  if (shareImportantNonNumericToken(figmaItem.strictText, webItem.strictText)) score += 0.07

  return {
    score: Math.round(Math.min(1, score) * 100) / 100,
    sameMappedSection,
    compatibleRole,
    yDelta,
    sectionContextScore,
    textShapeScore,
  }
}

function createStrictTextIssue(match) {
  const { figmaItem, webItem, mapping, matchConfidence, matchScore, protectedTextQa } = match
  const category = getCombinedStrictTextCategory(figmaItem, webItem)
  const type = getStrictTextIssueType(category)
  const highPriority = isHighPriorityTextCategory(category)
  const diffKind = getStrictRawTextDiffKind(figmaItem.strictText, webItem.strictText)
  return {
    id: `text-${category}-${normalizeComparableQaText(figmaItem.strictText).slice(0, 24)}`,
    source: 'text-qa',
    textQa: true,
    protectedTextQa,
    matchConfidence,
    matchScore,
    diffKind,
    area: mapping?.area || figmaItem.area || webItem.area || 'unknown',
    type,
    status: highPriority && matchConfidence === 'high' && diffKind !== 'whitespace' ? '수정 필요' : '확인 필요',
    priority: highPriority ? 1 : 8,
    title: createStrictTextIssueTitle(category),
    figma: figmaItem.strictText,
    web: webItem.strictText,
    figmaRawText: figmaItem.strictText,
    webRawText: webItem.strictText,
    figmaNormalizedText: figmaItem.looseText,
    webNormalizedText: webItem.looseText,
    reason: 'Figma JSON 텍스트와 Playwright DOM 텍스트가 문자열 기준으로 다릅니다.',
    memo: 'Text QA는 숫자, 금액, 퍼센트, 날짜, 기간, 모델명, CTA, 버튼, 제목, 링크명을 의미 유사도가 아니라 실제 문자열 차이로 비교합니다.',
    figmaSectionId: figmaItem.sectionId || mapping?.figmaSectionId || '',
    webSectionId: webItem.sectionId || mapping?.webSectionId || '',
    evidence: { visual: false, figmaJson: true, webDom: true, sourceAgreement: 2 },
    confidence: matchConfidence === 'high' ? 0.96 : 0.78,
    verification: 'kept',
  }
}

function findMappedSectionForTextItems(figmaItem, webItem, sectionMapping = {}) {
  const mappedSections = Array.isArray(sectionMapping.mappedSections) ? sectionMapping.mappedSections : []
  const exact = mappedSections.find((match) => figmaItem.sectionId && webItem.sectionId && match.figmaSectionId === figmaItem.sectionId && match.webSectionId === webItem.sectionId)
  if (exact) return { ...exact, sameMappedSection: true }
  const sameArea = mappedSections.find((match) => match.area !== 'unknown' && match.area === figmaItem.area && match.area === webItem.area && areSectionRolesCompatible(figmaItem.sectionRole, webItem.sectionRole))
  if (sameArea) return { ...sameArea, sameMappedSection: true }
  return null
}

function getStrictTextPairRejectReason(figmaItem, webItem, scoreDetails, mapping) {
  if (!figmaItem.visible || !webItem.visible) return 'hidden_or_invisible'
  if (hasZeroSizeTextItem(figmaItem) || hasZeroSizeTextItem(webItem)) return 'zero_size'
  if (isLayerNameLikeText(figmaItem.strictText) || isLayerNameLikeText(webItem.strictText)) return 'layer_name'
  if (isShortCodeToLongTextMismatch(figmaItem.strictText, webItem.strictText)) return 'short_code_to_long_text'
  if (!mapping?.sameMappedSection && !scoreDetails.compatibleRole) return 'different_section_and_role'
  if (!areSectionRolesCompatible(figmaItem.sectionRole, webItem.sectionRole)) return 'incompatible_section_role'
  if (!areStrictElementRolesCompatible(figmaItem, webItem)) return 'incompatible_element_role'
  if (hasExcessiveTextLengthRatio(figmaItem.strictText, webItem.strictText)) return 'length_ratio'
  if (hasQuantitativeToLongBodyMismatch(figmaItem, webItem)) return 'quantitative_to_body'
  if (Number.isFinite(scoreDetails.yDelta) && scoreDetails.yDelta > 0.35 && !mapping?.sameMappedSection) return 'far_y_ratio'
  if (scoreDetails.score < 0.5) return 'low_score'
  return ''
}

function getStrictTextMatchConfidence(score, scoreDetails, mapping) {
  if (mapping?.sameMappedSection && scoreDetails.compatibleRole && score >= 0.74 && (scoreDetails.yDelta <= 0.18 || !Number.isFinite(scoreDetails.yDelta))) return 'high'
  if ((mapping?.sameMappedSection || scoreDetails.sectionContextScore >= 0.45) && scoreDetails.compatibleRole && score >= 0.58) return 'medium'
  return 'low'
}

function hasStrictRawTextDifference(firstText, secondText) {
  return getStrictRawTextDiffKind(firstText, secondText) !== 'none'
}

function getStrictRawTextDiffKind(firstText, secondText) {
  const first = String(firstText || '')
  const second = String(secondText || '')
  if (first === second) return 'none'
  if (normalizeLinebreakText(first) === normalizeLinebreakText(second)) return 'none'
  if (normalizeRepeatedWhitespaceText(first) === normalizeRepeatedWhitespaceText(second)) return 'whitespace'
  return 'content'
}

function normalizeLinebreakText(value) {
  return String(value || '').replace(/\s*\r?\n\s*/g, ' ')
}

function normalizeRepeatedWhitespaceText(value) {
  return normalizeLinebreakText(value).replace(/[\t ]{2,}/g, ' ')
}

function getStrictYRatioDelta(figmaItem, webItem) {
  if (!Number.isFinite(figmaItem.yRatio) || !Number.isFinite(webItem.yRatio)) return Number.NaN
  return Math.abs(figmaItem.yRatio - webItem.yRatio)
}

function getSectionContextScore(figmaItem, webItem) {
  const sectionScore = getQaTextSimilarity(normalizeComparableQaText(figmaItem.sectionTitle), normalizeComparableQaText(webItem.sectionTitle))
  const pathScore = getQaTextSimilarity(normalizeComparableQaText(figmaItem.layerPath), normalizeComparableQaText(webItem.selector || webItem.layerPath))
  return Math.max(sectionScore, pathScore)
}

function getStrictTextShapeScore(figmaItem, webItem) {
  let score = 0
  if (figmaItem.category === webItem.category) score += 0.45
  if (shareCriticalTextShape(figmaItem.strictText, webItem.strictText)) score += 0.25
  score += getTokenOverlapScore(figmaItem.strictText, webItem.strictText) * 0.3
  return Math.min(1, score)
}

function areSectionRolesCompatible(firstRole, secondRole) {
  if (!firstRole || !secondRole || firstRole === 'other' || secondRole === 'other') return true
  if (firstRole === secondRole) return true
  const compatibleGroups = [
    new Set(['hero', 'promotion', 'content']),
    new Set(['product', 'promotion', 'content']),
    new Set(['legal', 'footer']),
    new Set(['form', 'calculator']),
  ]
  return compatibleGroups.some((group) => group.has(firstRole) && group.has(secondRole))
}

function areStrictElementRolesCompatible(figmaItem, webItem) {
  const firstRole = figmaItem.elementRole
  const secondRole = webItem.elementRole
  if (firstRole === secondRole) return true
  if (firstRole === 'quantitative' && ['body', 'quantitative'].includes(secondRole)) return true
  if (secondRole === 'quantitative' && ['body', 'quantitative'].includes(firstRole)) return true
  if (['cta', 'button', 'link'].includes(firstRole) || ['cta', 'button', 'link'].includes(secondRole)) return false
  if (firstRole === 'heading' || secondRole === 'heading') return false
  if ((firstRole === 'navigation' && secondRole !== 'navigation') || (secondRole === 'navigation' && firstRole !== 'navigation')) return false
  if ((firstRole === 'legal' && !['legal', 'body'].includes(secondRole)) || (secondRole === 'legal' && !['legal', 'body'].includes(firstRole))) return false
  return true
}

function hasZeroSizeTextItem(item) {
  return item.width === 0 || item.height === 0
}

function hasExcessiveTextLengthRatio(firstText, secondText) {
  const firstLength = normalizeComparableQaText(firstText).length
  const secondLength = normalizeComparableQaText(secondText).length
  const shorter = Math.min(firstLength, secondLength)
  const longer = Math.max(firstLength, secondLength)
  return shorter > 0 && shorter <= 8 && longer >= 32 && longer / shorter >= 4
}

function hasQuantitativeToLongBodyMismatch(figmaItem, webItem) {
  const firstCritical = ['money', 'percent', 'date-period', 'number', 'model'].includes(figmaItem.category)
  const secondCritical = ['money', 'percent', 'date-period', 'number', 'model'].includes(webItem.category)
  const firstLongBody = figmaItem.category === 'body' && normalizeComparableQaText(figmaItem.strictText).length >= 50
  const secondLongBody = webItem.category === 'body' && normalizeComparableQaText(webItem.strictText).length >= 50
  return (firstCritical && secondLongBody) || (secondCritical && firstLongBody)
}

function isShortCodeToLongTextMismatch(firstText, secondText) {
  return (isInternalCodeLikeText(firstText) && normalizeComparableQaText(secondText).length >= 12)
    || (isInternalCodeLikeText(secondText) && normalizeComparableQaText(firstText).length >= 12)
}

function isInternalCodeLikeText(value) {
  return /^(?:TAB|Tab|tab|FRAME|Frame|frame|BUTTON|Button|button|RECTANGLE|Rectangle|GROUP|Group)\s*\d{1,3}$/i.test(String(value || '').trim())
}

function isLayerNameLikeText(value) {
  const text = String(value || '').trim()
  if (!text) return true
  if (isInternalCodeLikeText(text)) return true
  if (/^(?:Frame|Group|Rectangle|Button|Text|Image|Layer|Component|Instance)\s*\d*$/i.test(text)) return true
  if (/^[A-Z_]+\d{1,4}$/.test(text) && !hasModelNameText(text)) return true
  return false
}

function createUnmatchedTextIssues(figmaItems, webItems, matchedFigmaIds, matchedWebIds, context = {}) {
  const issues = []
  figmaItems
    .filter((item) => !matchedFigmaIds.has(item.id) && shouldCreateUnmatchedTextIssue(item, webItems, 'figma', context))
    .slice(0, 2)
    .forEach((item) => issues.push(createUnmatchedTextIssue(item, 'figma')))
  webItems
    .filter((item) => !matchedWebIds.has(item.id) && shouldCreateUnmatchedTextIssue(item, figmaItems, 'web', context))
    .slice(0, 2)
    .forEach((item) => issues.push(createUnmatchedTextIssue(item, 'web')))
  return issues
}

function shouldCreateUnmatchedTextIssue(item, oppositeItems, source, context = {}) {
  if (!item.visible || hasZeroSizeTextItem(item)) return false
  if (isLayerNameLikeText(item.strictText)) return false
  if (item.isNavigation || ['navigation', 'footer', 'legal'].includes(item.sectionRole)) return false
  if (!isHighPriorityTextCategory(item.category)) return false
  const hasSectionCounterpart = oppositeItems.some((opposite) => {
    const mapping = source === 'figma'
      ? findMappedSectionForTextItems(item, opposite, context.sectionMapping)
      : findMappedSectionForTextItems(opposite, item, context.sectionMapping)
    return Boolean(mapping?.sameMappedSection) && areStrictElementRolesCompatible(item, opposite)
  })
  return hasSectionCounterpart
}

function createUnmatchedTextIssue(item, source) {
  const isFigmaOnly = source === 'figma'
  const category = item.category
  return {
    id: `text-unmatched-${source}-${normalizeComparableQaText(item.strictText).slice(0, 24)}`,
    source: 'text-qa',
    textQa: true,
    protectedTextQa: false,
    matchConfidence: 'medium',
    matchScore: 0.58,
    diffKind: 'unmatched',
    area: item.area || 'unknown',
    type: getStrictTextIssueType(category),
    status: '확인 필요',
    priority: isHighPriorityTextCategory(category) ? 3 : 9,
    title: isFigmaOnly ? '시안 문구 누락 가능성이 있습니다.' : '웹 추가 문구 가능성이 있습니다.',
    figma: isFigmaOnly ? item.strictText : '대응 문구 확인 필요',
    web: isFigmaOnly ? '대응 문구 확인 필요' : item.strictText,
    figmaRawText: isFigmaOnly ? item.strictText : '',
    webRawText: isFigmaOnly ? '' : item.strictText,
    figmaNormalizedText: isFigmaOnly ? item.looseText : '',
    webNormalizedText: isFigmaOnly ? '' : item.looseText,
    reason: '동일 mapped section에 대응 요소 후보는 있으나 이 문구와 직접 매칭되는 텍스트를 찾지 못했습니다.',
    memo: '매칭되지 않은 Text QA 후보는 이미지/섹션 문맥 확인이 필요하므로 최종 검증에서 제거될 수 있습니다.',
    figmaSectionId: isFigmaOnly ? item.sectionId : '',
    webSectionId: isFigmaOnly ? '' : item.sectionId,
    evidence: { visual: false, figmaJson: isFigmaOnly, webDom: !isFigmaOnly, sourceAgreement: 1 },
    confidence: 0.68,
    verification: 'kept',
  }
}

function getCombinedStrictTextCategory(figmaItem, webItem) {
  const categories = [figmaItem.category, webItem.category]
  return ['money', 'percent', 'date-period', 'model', 'cta', 'button', 'title', 'link', 'number']
    .find((category) => categories.includes(category)) || figmaItem.category || webItem.category || 'body'
}

function createStrictTextIssueTitle(category) {
  const titleByCategory = {
    money: '금액 문구가 다릅니다.',
    percent: '퍼센트 문구가 다릅니다.',
    'date-period': '날짜/기간 문구가 다릅니다.',
    model: '모델명이 다릅니다.',
    cta: 'CTA 문구가 다릅니다.',
    button: '버튼 문구가 다릅니다.',
    title: '제목 문구가 다릅니다.',
    link: '링크명이 다릅니다.',
    number: '숫자 문구가 다릅니다.',
  }
  return titleByCategory[category] || '문구가 다릅니다.'
}

function getStrictTextIssueType(category) {
  if (category === 'money' || category === 'percent' || category === 'date-period' || category === 'number') return '금액'
  if (category === 'cta' || category === 'button' || category === 'link') return 'CTA'
  return '문구'
}

function isHighPriorityTextCategory(category) {
  return ['money', 'percent', 'date-period', 'model', 'cta', 'button', 'title', 'link', 'number'].includes(category)
}

function normalizeStrictComparableText(value) {
  return String(value || '').normalize('NFKC')
}

function hasCriticalTextToken(value) {
  return hasMoneyText(value) || hasPercentText(value) || hasDateOrPeriodText(value) || hasModelNameText(value) || /\d/.test(String(value || ''))
}

function hasMoneyText(value) {
  return /(?:₩|원|만원|억원|KRW|USD|\$|€|¥)|\d[\d,]*(?:\.\d+)?\s*(?:원|만원|억원)/i.test(String(value || ''))
}

function hasPercentText(value) {
  return /\d+(?:\.\d+)?\s*%|퍼센트|percent/i.test(String(value || ''))
}

function hasDateOrPeriodText(value) {
  return /\d{4}[.\-/년]\s*\d{1,2}|\d{1,2}[.\-/월]\s*\d{1,2}|\d+\s*(?:일|개월|월|년|주|분기|days?|months?|years?)|기간|날짜|마감|부터|까지|~/.test(String(value || ''))
}

function hasModelNameText(value) {
  return /\b[A-Z]{1,4}[- ]?\d{1,4}[A-Z0-9-]*\b|\b[A-Z]+\d+[A-Z0-9-]*\b|\b\d+[A-Z]{1,3}\b/.test(String(value || ''))
}

function getTokenOverlapScore(firstText, secondText) {
  const firstTokens = getStrictComparableTokens(firstText)
  const secondTokens = getStrictComparableTokens(secondText)
  if (firstTokens.length === 0 || secondTokens.length === 0) return 0
  const overlap = firstTokens.filter((token) => secondTokens.includes(token)).length
  return overlap / Math.max(firstTokens.length, secondTokens.length)
}

function getStrictComparableTokens(value) {
  return String(value || '')
    .split(/[^0-9A-Za-z가-힣%₩$€¥]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

function shareImportantNonNumericToken(firstText, secondText) {
  const secondTokens = new Set(getStrictComparableTokens(secondText).filter((token) => !/^\d/.test(token)))
  return getStrictComparableTokens(firstText).some((token) => !/^\d/.test(token) && secondTokens.has(token))
}

function shareCriticalTextShape(firstText, secondText) {
  return (hasMoneyText(firstText) && hasMoneyText(secondText))
    || (hasPercentText(firstText) && hasPercentText(secondText))
    || (hasDateOrPeriodText(firstText) && hasDateOrPeriodText(secondText))
    || (hasModelNameText(firstText) && hasModelNameText(secondText))
}

async function requestMockupAiQa(client, payload, context = {}) {
  const completion = await client.chat.completions.create({
    model: AI_QA_MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: getMockupAiQaSystemPrompt() },
      {
        role: 'user',
        content: createEvidenceComparisonContent(payload, context),
      },
    ],
    response_format: createJsonSchemaResponseFormat('evidence_comparison', getEvidenceComparisonSchema()),
    max_completion_tokens: 2600,
  })

  return completion.choices?.[0]?.message?.content || ''
}

function createEvidenceComparisonContent(payload, context = {}) {
  const content = [
    { type: 'text', text: createMockupAiQaPrompt(payload, context) },
    { type: 'image_url', image_url: { url: payload.figmaImageDataUrl, detail: 'auto' } },
    { type: 'image_url', image_url: { url: payload.webScreenshotDataUrl, detail: 'auto' } },
  ]

  ;(context.cropComparisons || []).forEach((crop, index) => {
    content.push({ type: 'text', text: `구간 crop ${index + 1}: ${crop.label}. 먼저 Figma crop, 다음 Web crop입니다. figmaSectionId=${crop.figmaSectionId}, webSectionId=${crop.webSectionId}` })
    content.push({ type: 'image_url', image_url: { url: crop.figma.dataUrl, detail: 'auto' } })
    content.push({ type: 'image_url', image_url: { url: crop.web.dataUrl, detail: 'auto' } })
  })

  return content
}

async function createVerifiedMockupAiQaResult(client, payload, firstPassResult, context = {}) {
  try {
    console.log('[Mockup AI QA] calling OpenAI verification')
    const rawText = await requestMockupAiQaVerification(client, payload, firstPassResult, context)
    const parsed = parseAiQaJson(rawText)
    if (!parsed) {
      return {
        result: { ...firstPassResult },
        verification: { used: false, fallback: true, message: '2차 AI 응답 JSON을 해석하지 못해 1차 결과를 사용했습니다.' },
      }
    }

    const verifiedResult = normalizeMockupAiQaResult(parsed, payload, {
      priorRemovedIssues: firstPassResult.removedIssues,
      verificationUsed: true,
    })
    return {
      result: verifiedResult,
      verification: { used: true, fallback: false, message: '2차 AI 오탐 검증을 적용했습니다.' },
    }
  } catch (error) {
    console.log('[Mockup AI QA] verification failed:', error instanceof Error ? error.message : error)
    return {
      result: { ...firstPassResult },
      verification: { used: false, fallback: true, message: '2차 AI 검증 실패로 1차 결과를 사용했습니다.' },
    }
  }
}

async function requestMockupAiQaVerification(client, payload, firstPassResult, context = {}) {
  const completion = await client.chat.completions.create({
    model: AI_QA_MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: getMockupAiQaVerificationSystemPrompt() },
      {
        role: 'user',
        content: [
          { type: 'text', text: createMockupAiQaVerificationPrompt(payload, firstPassResult, context) },
          { type: 'image_url', image_url: { url: payload.figmaImageDataUrl, detail: 'auto' } },
          { type: 'image_url', image_url: { url: payload.webScreenshotDataUrl, detail: 'auto' } },
        ],
      },
    ],
    response_format: createJsonSchemaResponseFormat('final_verification', getVerificationSchema()),
    max_completion_tokens: 2200,
  })

  return completion.choices?.[0]?.message?.content || ''
}

async function createImageOnlyMockupQaResult(client, payload, context = {}) {
  try {
    console.log('[Mockup AI QA] calling image-only comparison')
    const rawText = await requestMockupImageOnlyQa(client, payload, context)
    const parsed = parseAiQaJson(rawText)
    if (!parsed) return { issues: [], removedIssues: [], ignoredDifferences: [], error: 'image_only_parse_error' }

    const normalized = normalizeMockupAiQaResult(parsed, payload)
    const issues = normalized.issues
      .filter((issue) => issue.type === '이미지')
      .map((issue) => ({
        ...issue,
        memo: appendMemoBasis(issue.memo, '이미지 전용 검토 기준'),
        priorityLevel: issue.area === 'top' ? 'high' : issue.priorityLevel,
      }))
    return { ...normalized, issues, error: '' }
  } catch (error) {
    console.log('[Mockup AI QA] image-only comparison failed:', error instanceof Error ? error.message : error)
    return { issues: [], removedIssues: [], ignoredDifferences: [], error: 'image_only_failed' }
  }
}

async function requestMockupImageOnlyQa(client, payload, context = {}) {
  const completion = await client.chat.completions.create({
    model: AI_QA_MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: getMockupImageOnlySystemPrompt() },
      {
        role: 'user',
        content: [
          { type: 'text', text: createMockupImageOnlyPrompt(payload, context) },
          { type: 'image_url', image_url: { url: payload.figmaImageDataUrl, detail: 'auto' } },
          { type: 'image_url', image_url: { url: payload.webScreenshotDataUrl, detail: 'auto' } },
        ],
      },
    ],
    response_format: createJsonSchemaResponseFormat('image_comparison', getEvidenceComparisonSchema()),
    max_completion_tokens: 1200,
  })

  return completion.choices?.[0]?.message?.content || ''
}

function getMockupAiQaSystemPrompt() {
  return [
    '너는 범용 웹페이지 시안 비교 QA 담당자다.',
    '첫 번째 이미지는 Figma 시안이고 두 번째 이미지는 실제 웹 캡처다.',
    '사용자가 원하는 것은 분석 보고서가 아니라 수정 요청용 QA 체크리스트다.',
    'Page Understanding 결과의 페이지 유형, 목적, comparisonFocus, section mapping을 먼저 따른다.',
    '이 단계는 Vision 기반 이미지/레이아웃/구조 비교 담당이다. 텍스트 문구 차이는 별도 Text QA 결과를 우선한다.',
    'Figma 시안 이미지와 실제 웹 캡처의 시각적 차이가 핵심이며 Figma JSON과 Web DOM은 섹션 문맥 보조 근거다.',
    '서로 대응되는 섹션과 같은 역할의 요소만 비교한다. hero와 legal, form과 footer, product card와 navigation처럼 다른 역할을 억지로 매칭하지 않는다.',
    '대응 섹션을 찾지 못하면 섹션 누락/추가 가능성을 검토하되 근거가 부족하면 이슈를 만들지 않거나 확인 필요로 낮춘다.',
    '실제 운영자가 수정하거나 확인해야 할 핵심 차이만 최대 5건 작성한다. 5건을 채우려고 만들지 않는다.',
    '단순 줄바꿈, 미세한 자간, 폰트 렌더링 차이, 브라우저 안티앨리어싱, 공백, 마침표, 쉼표, 미세한 위치 차이, 이미지 크롭 차이는 무시한다.',
    '가격, 금액, 비율, 날짜, 기간, 모델명, CTA/버튼/제목/링크명 텍스트 차이는 Text QA가 문자열 기준으로 생성한다. Vision 단계에서 의미 유사도로 제거하지 않는다.',
    '같은 역할과 같은 섹션의 주요 CTA는 위치, 시각적 버튼 형태, 누락 여부처럼 Vision으로 확인되는 차이를 비교한다.',
    '대응되는 주요 시각 요소가 명확히 다를 경우 이미지 차이로 보고하되, 영상 프레임/캐러셀 상태 차이는 확인 필요 가능성을 고려한다.',
    'Figma JSON과 Web DOM 텍스트는 참고용 힌트일 뿐이며 절대 기준이 아니다.',
    'JSON에만 존재하고 Figma 시안 이미지에 보이지 않는 항목은 이슈로 만들지 않는다.',
    'DOM에만 있고 웹 캡처 이미지에 보이지 않는 항목은 즉시 이슈로 만들지 않는다.',
    'header/nav/footer의 반복 링크는 navigation으로 보고 main content CTA나 form action과 구분한다.',
    '이미지 OCR로 텍스트 차이를 새로 만들지 않는다. 텍스트 차이는 Figma JSON과 Playwright DOM 기반 Text QA를 따른다.',
    '법적/약관/푸터 키워드는 낮은 우선순위 제거 기준이 아니라 섹션 role과 오매칭 방지용 문맥 힌트로만 사용한다.',
    '각 이슈는 시안: A / 현재: B 형태로 짧게 작성한다.',
    '확실하지 않은 것은 status를 확인 필요로 표시하고 장황하게 설명하지 않는다.',
    'issues 배열은 최대 5개까지만 반환한다.',
    'status는 수정 필요, 확인 필요, 무시 가능 중 하나만 사용한다.',
    'type은 문구, 이미지, CTA, 레이아웃, 섹션, 금액 중 하나만 사용한다.',
    'area는 top, middle, bottom, unknown 중 하나만 사용한다.',
    '각 이슈에는 reason, figmaSectionId, webSectionId, evidence.visual, evidence.figmaJson, evidence.webDom, evidence.sourceAgreement, confidence를 포함한다.',
    '정확한 normalized boundingBox를 모르면 figmaBox/webBox를 절대 만들지 않는다.',
    '반드시 JSON으로만 응답한다.',
  ].join('\n')
}

function createMockupAiQaPrompt(payload, context = {}) {
  const hints = {
    url: payload.url,
    urlPath: getUrlPath(payload.url),
    pageTitle: payload.pageTitle,
    pageUnderstanding: context.pageUnderstanding || createFallbackPageUnderstanding(payload),
    sectionMapping: context.sectionMapping || { mappedSections: [], unmappedFigmaSections: [], unmappedWebSections: [] },
    cropPairs: (context.cropComparisons || []).map((crop, index) => ({ index: index + 1, label: crop.label, figmaSectionId: crop.figmaSectionId, webSectionId: crop.webSectionId })),
    figmaSummary: createFigmaAiSummary(payload),
    webSummary: createWebAiSummary(payload),
    textQaIssues: context.textQaIssues || [],
    figmaCtaHints: payload.figmaCtaHints,
    webCtaHints: payload.webCtaHints,
    textMismatchHints: payload.textMismatchHints,
  }

  return [
    '첫 번째 전체 이미지는 Figma 시안, 두 번째 전체 이미지는 실제 웹 캡처입니다. 이후 crop 이미지가 있으면 각 구간의 Figma/Web 쌍입니다.',
    'Page Understanding과 sectionMapping을 기준으로 대응 섹션끼리만 비교하세요.',
    'section role, 제목, 주변 문맥, 요소 구성, crop 이미지를 종합하고 yRatio만으로 제거하거나 매칭하지 마세요.',
    '다른 역할의 섹션을 억지로 비교하지 마세요. 대응 근거가 약하면 이슈를 만들지 않거나 확인 필요로 낮추세요.',
    '페이지 목적에 맞는 핵심 시각 차이만 반환하세요. 차이가 없거나 약하면 issues는 빈 배열이어도 됩니다.',
    '텍스트 문구 차이, 숫자 차이, CTA/버튼 문구 차이는 만들지 마세요. 해당 항목은 textQaIssues가 별도로 처리합니다.',
    '이미지/레이아웃/배너/사진/아이콘/구조/CTA 위치 차이를 페이지 유형과 comparisonFocus에 맞춰 판단하세요.',
    '영상, 캐러셀, 애니메이션 프레임 차이는 동일 콘텐츠의 다른 순간인지 완전히 다른 캠페인/상품/비주얼인지 구분하세요.',
    '각 이슈는 “시안: A / 현재: B” 형태로 짧게 작성하세요.',
    '수정 필요성이 애매하거나 확실하지 않은 것은 “확인 필요”로 표시하세요.',
    '정확한 normalized boundingBox를 모르면 figmaBox/webBox를 반환하지 마세요.',
    'issues 배열은 실제 수정/확인 필요한 핵심 차이만 5개 이하로 반환하세요.',
    '반드시 아래 JSON 형식으로만 응답해라.',
    '{"summary":{"fixNeeded":0,"checkNeeded":0,"ignored":0},"issues":[{"status":"수정 필요 | 확인 필요 | 무시 가능","priority":1,"area":"top | middle | bottom | unknown","type":"문구 | 이미지 | CTA | 레이아웃 | 섹션 | 금액","title":"짧고 구체적인 제목","figma":"시안 값","web":"현재 값","reason":"왜 차이라고 판단했는지","memo":"짧은 QA 메모","figmaSectionId":"figma-section-id","webSectionId":"web-section-id","evidence":{"visual":true,"figmaJson":true,"webDom":true,"sourceAgreement":2},"confidence":0.9}],"ignoredDifferences":["줄바꿈 차이","미세한 렌더링 차이"]}',
    JSON.stringify(hints, null, 2),
  ].join('\n\n')
}

function getEvidenceComparisonSchema() {
  return {
    type: 'object',
    properties: {
      summary: { type: 'object' },
      issues: { type: 'array', items: { type: 'object' } },
      ignoredDifferences: { type: 'array', items: { type: 'string' } },
      removedIssues: { type: 'array', items: { type: 'object' } },
    },
  }
}

function getMockupAiQaVerificationSystemPrompt() {
  return [
    '너는 범용 웹 QA 최종 검증 담당자다.',
    '아래 이슈 목록은 1차 AI가 찾은 QA 후보이며 사용자에게 보여주기 전에 반드시 오탐을 제거한다.',
    '각 이슈가 실제 시안 이미지와 웹 이미지에서 확인되는지 재검토한다.',
    '서로 다른 섹션/역할이 잘못 매칭된 이슈는 제거하거나 확인 필요로 낮춘다.',
    'DOM 또는 JSON 한 소스에서만 나온 주장, OCR이 만든 문구, 이미지에서 보이지 않는 항목은 수정 필요로 두지 않는다.',
    '같은 차이를 표현만 바꾼 중복은 하나로 합친다.',
    '페이지 유형과 목적에 비추어 중요하지 않거나 근거가 약한 항목은 제거한다.',
    '최대 5개를 채우려고 근거 약한 항목을 남기지 않는다. 이슈 0개도 가능하다.',
    '최종 결과는 수정 필요 또는 확인 필요만 남긴다.',
    '반드시 JSON으로만 응답한다.',
  ].join('\n')
}

function getMockupImageOnlySystemPrompt() {
  return [
    '너는 웹 QA 이미지/비주얼 차이 전담 검토자다.',
    '첫 번째 이미지는 Figma 시안이고 두 번째 이미지는 실제 웹 캡처다.',
    'Page Understanding의 section role과 comparisonFocus에 맞는 주요 시각 요소만 검토한다.',
    '텍스트 차이는 무시하고 이미지, 배경, 영상 캡처 장면, 제품/인물/사물, 색감, 구도 차이를 찾는다.',
    '동일 콘텐츠의 다른 영상 프레임이나 캐러셀 상태로 보이면 확인 필요로 낮추거나 이슈를 만들지 않는다.',
    '완전히 다른 캠페인/상품/비주얼, 이미지 누락, 깨짐, 명확한 이미지 교체는 이슈 후보로 만든다.',
    '미세한 크롭, 압축, 렌더링 차이는 무시한다.',
    '최대 3개 이슈만 JSON으로 반환한다. 없으면 빈 배열을 반환한다.',
  ].join('\n')
}

function createMockupImageOnlyPrompt(payload, context = {}) {
  const hints = {
    url: payload.url,
    pageTitle: payload.pageTitle,
    pageUnderstanding: context.pageUnderstanding || createFallbackPageUnderstanding(payload),
    sectionMapping: context.sectionMapping || { mappedSections: [], unmappedFigmaSections: [], unmappedWebSections: [] },
    figmaCtaHints: payload.figmaCtaHints,
    webCtaHints: payload.webCtaHints,
  }

  return [
    '텍스트는 무시하고 Page Understanding에서 중요한 것으로 판별된 이미지/비주얼 차이만 비교하세요.',
    '페이지가 home이 아닐 수 있으므로 특정 영역을 무조건 최우선으로 보지 마세요.',
    '같은 섹션 role과 문맥에서 대응되는 주요 이미지끼리만 비교하세요.',
    '동영상/캐러셀 프레임 차이인지 실제 이미지 교체인지 구분하고, 애매하면 확인 필요로 두세요.',
    '이미지 차이가 확실하지 않으면 이슈를 만들지 마세요.',
    '결과는 아래 JSON 형식만 사용하세요.',
    '{"issues":[{"status":"수정 필요 | 확인 필요","priority":1,"area":"top | middle | bottom | unknown","type":"이미지","title":"주요 이미지가 다릅니다.","figma":"시안의 이미지 설명","web":"웹의 이미지 설명","reason":"같은 역할의 섹션에서 대응되는 이미지가 다르다고 판단한 이유","figmaSectionId":"...","webSectionId":"...","evidence":{"visual":true,"figmaJson":false,"webDom":false,"sourceAgreement":1},"memo":"짧은 QA 메모","confidence":0.9}],"ignoredDifferences":["미세한 크롭 차이"]}',
    JSON.stringify(hints, null, 2),
  ].join('\n\n')
}

function createMockupAiQaVerificationPrompt(payload, firstPassResult, context = {}) {
  const verificationInput = {
    pageUnderstanding: context.pageUnderstanding || createFallbackPageUnderstanding(payload),
    sectionMapping: context.sectionMapping || { mappedSections: [], unmappedFigmaSections: [], unmappedWebSections: [] },
    firstPassIssues: firstPassResult.issues,
    textQaIssues: firstPassResult.issues.filter(isTextQaIssue),
    protectedTextQaIssues: firstPassResult.issues.filter(isProtectedTextIssue),
    firstPassRemovedIssues: firstPassResult.removedIssues || [],
    figmaTextHints: payload.figmaTexts,
    webTextHints: payload.webTexts,
    textMismatchHints: payload.textMismatchHints,
  }

  return [
    '아래 이슈 목록은 1차 후보입니다. 실제 사용자에게 보여주기 전에 오탐, 오매칭, 중복, 근거 약한 항목을 제거하세요.',
    'textQaIssues는 Figma JSON Text와 Playwright DOM Text를 먼저 요소 매칭한 뒤 rawText 기준으로 비교한 결과입니다.',
    'Text QA 후보라도 대응 요소가 실제로 같은 역할/같은 섹션인지 다시 확인하세요. 서로 다른 위치/역할/섹션의 문구라면 제거하세요.',
    '숫자나 한 글자 차이는 같은 요소로 확인될 경우 반드시 유지하세요.',
    '오매칭 Text QA 후보는 삭제 가능합니다. 단, protectedTextQaIssues(high confidence)는 값이 실제로 같거나 명확한 오매칭일 때만 삭제하세요.',
    '각 이슈가 Figma 전체 이미지와 Web 전체 이미지에서 확인되는지 다시 보세요.',
    'pageUnderstanding과 sectionMapping에 맞지 않는 다른 역할 섹션 간 비교는 제거하거나 확인 필요로 낮추세요.',
    'Vision/OCR만 주장하는 문구 이슈는 오탐 가능성으로 제거하거나 확인 필요 이하로 낮추세요. 단, protectedTextQaIssues는 JSON+DOM 두 소스 비교 결과로 우선 유지하세요.',
    '정량 정보 차이는 페이지 문맥에서 사용자 의사결정에 영향을 주고 시각/보조 근거가 충분할 때만 유지하세요.',
    '동적 콘텐츠, 애니메이션, 캐러셀, 시안 버전 차이 가능성이 있으면 확인 필요로 판단하세요.',
    '최종적으로 실제 수정/확인이 필요한 핵심 이슈만 최대 5개 남기세요. 없으면 빈 배열을 반환하세요.',
    '반드시 아래 JSON 형식으로만 응답하세요.',
    '{"issues":[{"status":"수정 필요 | 확인 필요","priority":1,"area":"top | middle | bottom | unknown","type":"문구 | 이미지 | CTA | 레이아웃 | 섹션 | 금액","title":"...","figma":"...","web":"...","reason":"...","memo":"...","figmaSectionId":"...","webSectionId":"...","evidence":{"visual":true,"figmaJson":true,"webDom":true,"sourceAgreement":2},"confidence":0.9,"verification":"kept | downgraded | removed"}],"removedIssues":[{"title":"...","reason":"오매칭/중복/근거 부족 등 제거 사유"}]}',
    JSON.stringify(verificationInput, null, 2),
  ].join('\n\n')
}

function getVerificationSchema() {
  return {
    type: 'object',
    properties: {
      issues: { type: 'array', items: { type: 'object' } },
      removedIssues: { type: 'array', items: { type: 'object' } },
      ignoredDifferences: { type: 'array', items: { type: 'string' } },
    },
  }
}

function normalizeMockupAiQaResult(result, payload = {}, options = {}) {
  const rawIssues = Array.isArray(result.issues) ? result.issues.map((issue) => ({
    id: limitText(issue?.id || '', 80),
    area: normalizeMockupArea(issue?.area || issue?.region),
    type: normalizeMockupIssueType(issue?.type),
    status: normalizeMockupStatus(issue?.status || issue?.severity, issue?.confidence),
    priority: normalizeMockupPriority(issue?.priority),
    title: normalizeMockupTitle(issue),
    figma: normalizeMockupSideValue(issue, 'figma'),
    web: normalizeMockupSideValue(issue, 'web'),
    reason: limitText(issue?.reason || '', 300),
    memo: normalizeMockupMemo(issue),
    figmaSectionId: limitText(issue?.figmaSectionId || issue?.figmaSection || '', 80),
    webSectionId: limitText(issue?.webSectionId || issue?.webSection || '', 80),
    evidence: normalizeIssueEvidence(issue?.evidence),
    source: limitText(issue?.source || issue?.qaSource || '', 40),
    textQa: Boolean(issue?.textQa || issue?.source === 'text-qa'),
    protectedTextQa: Boolean(issue?.protectedTextQa),
    matchConfidence: normalizeTextMatchConfidence(issue?.matchConfidence),
    matchScore: normalizeConfidence(issue?.matchScore),
    diffKind: limitText(issue?.diffKind || '', 40),
    figmaRawText: limitStrictText(issue?.figmaRawText || issue?.figma || '', 300),
    webRawText: limitStrictText(issue?.webRawText || issue?.web || '', 300),
    figmaNormalizedText: limitText(issue?.figmaNormalizedText || '', 300),
    webNormalizedText: limitText(issue?.webNormalizedText || '', 300),
    figmaEvidence: limitText(issue?.figmaEvidence || issue?.figma || '', 300),
    webEvidence: limitText(issue?.webEvidence || issue?.web || '', 300),
    confidence: normalizeConfidence(issue?.confidence),
    verification: normalizeVerificationStatus(issue?.verification),
    figmaBox: normalizeMockupBox(issue?.figmaBox),
    webBox: normalizeMockupBox(issue?.webBox),
  })) : []
  const postProcessed = postProcessMockupIssues(rawIssues, payload)
  const issues = sortMockupIssues(filterMinorMockupTextIssues(postProcessed.issues)).slice(0, MAX_MOCKUP_AI_ISSUES)

  const ignoredDifferences = normalizeIgnoredDifferences(result.ignoredDifferences)
  const removedIssues = normalizeRemovedIssues([
    ...(options.priorRemovedIssues || []),
    ...(result.removedIssues || []),
    ...postProcessed.removedIssues,
  ])
  const summary = normalizeMockupSummary(issues, ignoredDifferences, removedIssues)
  return { summary, counts: summary, issues, ignoredDifferences, removedIssues }
}

function createCtaComparisonResult(payload = {}, context = {}) {
  try {
    const figmaHints = filterDefaultCtaHints(Array.isArray(payload.figmaCtaHints) ? payload.figmaCtaHints : [])
    const webHints = filterDefaultCtaHints(Array.isArray(payload.webCtaHints) ? payload.webCtaHints : [])
    if (figmaHints.length === 0 || webHints.length === 0) return { issues: [], removedIssues: [], ignoredDifferences: [], error: '' }

    const mappedAreas = new Set((context.sectionMapping?.mappedSections || []).map((match) => match.area).filter((area) => area && area !== 'unknown'))
    const areas = mappedAreas.size > 0 ? Array.from(mappedAreas) : MOCKUP_AI_AREAS.filter((area) => area !== 'unknown')
    const issues = areas.flatMap((area) => createCtaAreaIssues(area, figmaHints, webHints))
      .map((issue) => applyIssuePriorityRules(issue))
      .slice(0, 3)
    const summary = normalizeMockupSummary(issues, [], [])
    return { summary, counts: summary, issues, removedIssues: [], ignoredDifferences: [], error: '' }
  } catch (error) {
    console.log('[Mockup AI QA] CTA comparison failed:', error instanceof Error ? error.message : error)
    return { issues: [], removedIssues: [], ignoredDifferences: [], error: 'cta_compare_failed' }
  }
}

function filterDefaultCtaHints(hints) {
  return hints.filter((hint) => !isNavigationCtaHint(hint))
}

function isNavigationCtaHint(hint) {
  if (!hint) return false
  if (hint.navCandidate) return true
  return isNavigationCtaContext(`${hint.layerPath || ''} ${hint.name || ''} ${hint.selector || ''}`)
}

function isNavigationCtaContext(value) {
  const text = String(value || '').toLowerCase()
  return NAV_CTA_CONTEXT_PATTERNS.some((pattern) => text.includes(pattern))
}

function createCtaAreaIssues(area, figmaHints, webHints) {
  if (area === 'unknown') return []

  const figmaAreaHints = figmaHints.filter((hint) => hint.area === area)
  const webAreaHints = webHints.filter((hint) => hint.area === area)
  if (figmaAreaHints.length === 0 && webAreaHints.length === 0) return []
  if (figmaAreaHints.length === 0 || webAreaHints.length === 0) return []

  const figmaTexts = uniqueCtaTexts(figmaAreaHints)
  const webTexts = uniqueCtaTexts(webAreaHints)
  const missingTexts = figmaTexts.filter((text) => !hasSimilarCtaText(text, webTexts))
  const addedTexts = webTexts.filter((text) => !hasSimilarCtaText(text, figmaTexts))
  if (missingTexts.length === 0 && addedTexts.length === 0 && figmaTexts.length === webTexts.length) return []

  return [{
    id: `cta-${area}`,
    area,
    type: 'CTA',
    status: '확인 필요',
    priority: 12,
    title: 'CTA 버튼 구성이 다릅니다.',
    figma: figmaTexts.join(' / ') || 'CTA 없음',
    web: webTexts.join(' / ') || 'CTA 없음',
    reason: '같은 화면 영역의 CTA 후보 목록이 다릅니다. 최종 검증에서 섹션 역할과 시각 근거를 재확인해야 합니다.',
    memo: createCtaIssueMemo(missingTexts, addedTexts),
    evidence: { visual: false, figmaJson: true, webDom: true, sourceAgreement: 2 },
    confidence: 0.72,
    verification: 'kept',
  }]
}

function uniqueCtaTexts(hints) {
  const seen = new Set()
  const texts = []
  hints.forEach((hint) => {
    const text = normalizeCtaText(hint.text)
    const key = normalizeComparableQaText(text)
    if (!key || seen.has(key)) return
    seen.add(key)
    texts.push(text)
  })
  return texts
}

function hasSimilarCtaText(text, candidates) {
  const normalizedText = normalizeComparableQaText(text)
  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeComparableQaText(candidate)
    return normalizedText === normalizedCandidate || getQaTextSimilarity(normalizedText, normalizedCandidate) >= 0.86
  })
}

function createCtaIssueMemo(missingTexts, addedTexts) {
  const parts = []
  if (missingTexts.length > 0) parts.push(`시안의 ${missingTexts.join(' / ')} 버튼이 웹에서 확인되지 않습니다.`)
  if (addedTexts.length > 0) parts.push(`웹에는 ${addedTexts.join(' / ')} 버튼이 추가로 노출됩니다.`)
  return appendMemoBasis(parts.join(' '), 'CTA 리스트 비교 기준')
}

function createFinalMockupQaResult({ textResult, visionResult, ctaResult, imageResult, payload }) {
  const textIssues = Array.isArray(textResult?.issues) ? textResult.issues : []
  const visionIssues = Array.isArray(visionResult?.issues) ? visionResult.issues : []
  const ctaIssues = Array.isArray(ctaResult?.issues) ? ctaResult.issues : []
  const imageIssues = Array.isArray(imageResult?.issues) ? imageResult.issues : []
  const mergedIssues = mergeMockupIssues({ textIssues, visionIssues, ctaIssues, imageIssues })
  const ignoredDifferences = normalizeIgnoredDifferences([
    ...(textResult?.ignoredDifferences || []),
    ...(visionResult?.ignoredDifferences || []),
    ...(ctaResult?.ignoredDifferences || []),
    ...(imageResult?.ignoredDifferences || []),
  ])
  const removedIssues = normalizeRemovedIssues([
    ...(textResult?.removedIssues || []),
    ...(visionResult?.removedIssues || []),
    ...(ctaResult?.removedIssues || []),
    ...(imageResult?.removedIssues || []),
  ])
  const summary = normalizeMockupSummary(mergedIssues, ignoredDifferences, removedIssues)

  return {
    summary,
    counts: summary,
    issues: mergedIssues,
    ignoredDifferences,
    removedIssues,
    debug: {
      webCtaHints: payload.webCtaHints.length,
      figmaCtaHints: payload.figmaCtaHints.length,
      textIssues: textIssues.length,
      visionIssues: visionIssues.length,
      ctaIssues: ctaIssues.length,
      imageIssues: imageIssues.length,
      finalIssues: mergedIssues.length,
      ctaError: ctaResult?.error || '',
      imageError: imageResult?.error || '',
    },
  }
}

function mergeMockupIssues({ textIssues = [], visionIssues, ctaIssues, imageIssues }) {
  const selected = []
  const allIssues = [
    ...textIssues.map((issue) => ({ ...issue, mergeSource: 'text' })),
    ...imageIssues.map((issue) => ({ ...issue, mergeSource: 'image' })),
    ...ctaIssues.map((issue) => ({ ...issue, mergeSource: 'cta' })),
    ...visionIssues.map((issue) => ({ ...issue, mergeSource: 'vision' })),
  ]

  allIssues.forEach((issue) => {
    const normalizedIssue = applyIssuePriorityRules(issue)
    const duplicateIndex = selected.findIndex((candidate) => areDuplicateMockupIssues(candidate, normalizedIssue))
    if (duplicateIndex === -1) {
      selected.push(normalizedIssue)
      return
    }

    selected[duplicateIndex] = choosePreferredMockupIssue(selected[duplicateIndex], normalizedIssue)
  })

  return sortFinalMockupIssues(selected).slice(0, MAX_MOCKUP_AI_ISSUES).map((issue) => {
    const result = { ...issue }
    delete result.mergeSource
    return result
  })
}

function areDuplicateMockupIssues(first, second) {
  if (first.type === second.type && first.area === second.area) {
    if (first.type === 'CTA') return true
    if (first.type === '이미지' && getQaTextSimilarity(normalizeComparableQaText(first.title), normalizeComparableQaText(second.title)) >= 0.65) return true

    const firstTitle = normalizeComparableQaText(first.title)
    const secondTitle = normalizeComparableQaText(second.title)
    if (getQaTextSimilarity(firstTitle, secondTitle) >= 0.76) return true
  }

  const firstText = normalizeComparableQaText(`${first.title} ${first.figma} ${first.web}`)
  const secondText = normalizeComparableQaText(`${second.title} ${second.figma} ${second.web}`)
  if (!firstText || !secondText) return false
  return getQaTextSimilarity(firstText, secondText) >= 0.82
}

function choosePreferredMockupIssue(first, second) {
  if (isProtectedTextIssue(first) || isProtectedTextIssue(second)) return isProtectedTextIssue(first) ? first : second
  if (first.type === 'CTA' || second.type === 'CTA') return first.mergeSource === 'cta' ? first : second
  if (first.type === '이미지' || second.type === '이미지') return first.mergeSource === 'image' ? first : second
  if (getFinalIssueRank(second) < getFinalIssueRank(first)) return second
  return Number(second.confidence || 0) > Number(first.confidence || 0) ? second : first
}

function restoreProtectedTextIssues(result, protectedIssues = []) {
  const textIssues = protectedIssues.filter(isProtectedTextIssue)
  if (textIssues.length === 0) return result
  const selected = Array.isArray(result?.issues) ? result.issues.slice() : []
  const removedIssues = Array.isArray(result?.removedIssues) ? result.removedIssues : []

  textIssues.forEach((issue) => {
    if (wasExplicitlyRemovedAsMismatch(issue, removedIssues)) return
    const exists = selected.some((candidate) => areDuplicateMockupIssues(candidate, issue))
    if (!exists) selected.push(issue)
  })

  const issues = sortFinalMockupIssues(selected.map((issue) => applyIssuePriorityRules(issue))).slice(0, MAX_MOCKUP_AI_ISSUES)
  const ignoredDifferences = Array.isArray(result?.ignoredDifferences) ? result.ignoredDifferences : []
  const summary = normalizeMockupSummary(issues, ignoredDifferences, removedIssues)
  return { ...result, summary, counts: summary, issues, ignoredDifferences, removedIssues }
}

function isProtectedTextIssue(issue) {
  return Boolean(issue?.protectedTextQa === true && issue?.matchConfidence === 'high' && hasStrictRawTextDifference(issue?.figmaRawText || issue?.figma, issue?.webRawText || issue?.web))
}

function isTextQaIssue(issue) {
  return Boolean(issue?.textQa || issue?.source === 'text-qa' || issue?.mergeSource === 'text')
}

function wasExplicitlyRemovedAsMismatch(issue, removedIssues) {
  const issueTitle = normalizeComparableQaText(issue?.title || '')
  const issueText = normalizeComparableQaText(`${issue?.figma || ''} ${issue?.web || ''}`)
  return removedIssues.some((removed) => {
    const removedTitle = normalizeComparableQaText(removed?.title || '')
    const removedReason = String(removed?.reason || '')
    if (issueTitle && removedTitle && getQaTextSimilarity(issueTitle, removedTitle) < 0.8) return false
    if (!/오매칭|다른\s*섹션|서로\s*다른|mismatch|wrong\s*section|not\s*same/i.test(removedReason)) return false
    return !issueText || getQaTextSimilarity(issueText, normalizeComparableQaText(`${removed?.title || ''} ${removedReason}`)) >= 0.2
  })
}

function sortFinalMockupIssues(issues) {
  return issues.slice().sort((first, second) => {
    const rankDiff = getFinalIssueRank(first) - getFinalIssueRank(second)
    if (rankDiff !== 0) return rankDiff
    return sortMockupIssues([first, second])[0] === first ? -1 : 1
  })
}

function getFinalIssueRank(issue) {
  const text = getIssueSearchText(issue)
  if (isTextQaIssue(issue) && hasHighPrioritySignal(issue, text)) return 0
  if (issue.priorityLevel === 'low') return 9
  if (issue.type === 'CTA' && !isNavigationIssueText(text)) return 1
  if (issue.type === '금액' || /숫자|가격|금액|금리|이율|비율|기간|날짜|조건|모델|model|원|만원|%/i.test(text)) return 2
  if (issue.type === '섹션' || /섹션|누락|추가/i.test(text)) return 3
  if (issue.type === '레이아웃') return 6
  if (isNavigationIssueText(text)) return 8
  return 4
}

function appendMemoBasis(memo, basis) {
  const text = limitText(memo || '', 260)
  if (text.includes(basis)) return text
  return `${text ? `${text} ` : ''}${basis}`.trim()
}

function normalizeMockupSummary(issues = [], ignoredDifferences = [], removedIssues = []) {
  const fallback = issues.reduce((counts, issue) => {
    if (issue.status === '수정 필요') counts.fixNeeded += 1
    if (issue.status === '확인 필요') counts.checkNeeded += 1
    if (issue.status === '무시 가능') counts.ignored += 1
    return counts
  }, { fixNeeded: 0, checkNeeded: 0, ignored: ignoredDifferences.length + removedIssues.length })

  return {
    total: issues.length,
    fixNeeded: fallback.fixNeeded,
    checkNeeded: fallback.checkNeeded,
    ignored: fallback.ignored,
  }
}

function normalizeMockupIssueType(value) {
  if (MOCKUP_AI_TYPES.includes(value)) return value
  if (value === '문구 차이') return '문구'
  if (value === 'text') return '문구'
  if (value === 'image' || value === '비주얼 차이' || value === '이미지 확인') return '이미지'
  if (value === 'cta') return 'CTA'
  if (value === 'money' || value === 'price' || value === '금액') return '금액'
  if (value === 'layout' || value === '레이아웃 확인') return '레이아웃'
  if (value === 'section') return '섹션'
  if (value === 'form' || value === 'table' || value === 'other') return '레이아웃'
  return '레이아웃'
}

function normalizeMockupArea(value) {
  if (MOCKUP_AI_AREAS.includes(value)) return value
  if (value === 'upper') return 'top'
  if (value === 'lower') return 'bottom'
  return limitText(value || 'unknown', 60)
}

function normalizeYRatio(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.round(Math.max(0, Math.min(1, number)) * 1000) / 1000
}

function getAreaFromYRatio(value) {
  const ratio = normalizeYRatio(value)
  if (ratio === null) return 'unknown'
  if (ratio < 0.33) return 'top'
  if (ratio < 0.66) return 'middle'
  return 'bottom'
}

function getAreaDefaultYRatio(area) {
  if (area === 'top') return 0.16
  if (area === 'middle') return 0.5
  if (area === 'bottom') return 0.84
  return 0.5
}

function normalizePageType(value) {
  const text = String(value || '').toLowerCase().trim()
  if (PAGE_UNDERSTANDING_TYPES.includes(text)) return text
  if (/home|main|메인|홈/.test(text)) return 'home'
  if (/landing|campaign|promo|promotion|이벤트|프로모션/.test(text)) return 'promotion'
  if (/detail|product|상품|제품/.test(text)) return 'product-detail'
  if (/calc|calculator|계산|견적/.test(text)) return 'calculator'
  if (/form|apply|contact|문의|신청/.test(text)) return 'form'
  if (/list|listing|목록|검색/.test(text)) return 'listing'
  if (/article|content|news|story|콘텐츠|게시/.test(text)) return 'article'
  if (/policy|legal|terms|privacy|약관|정책|개인정보/.test(text)) return 'policy'
  return 'other'
}

function normalizeSectionRole(value) {
  const text = String(value || '').toLowerCase().trim()
  if (SECTION_ROLES.includes(text)) return text
  return inferSectionRoleFromText(text)
}

function inferSectionRoleFromText(value) {
  const text = String(value || '').toLowerCase()
  if (/header|nav|gnb|menu|navigation|검색|메뉴/.test(text)) return 'navigation'
  if (/hero|main\s*visual|kv|visual|대표|상단/.test(text)) return 'hero'
  if (/campaign|promo|promotion|event|혜택|이벤트|프로모션/.test(text)) return 'promotion'
  if (/product|goods|상품|제품|서비스|카드/.test(text)) return 'product'
  if (/form|field|input|apply|contact|문의|신청|동의|필수/.test(text)) return 'form'
  if (/calc|calculator|estimate|계산|견적|시뮬레이션/.test(text)) return 'calculator'
  if (/table|표|spec|사양|비교/.test(text)) return 'table'
  if (/legal|policy|terms|privacy|disclaimer|약관|정책|유의|고지|개인정보/.test(text)) return 'legal'
  if (/footer|copyright|푸터|풋터/.test(text)) return 'footer'
  if (/content|article|본문|내용|섹션/.test(text)) return 'content'
  return 'other'
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const result = []
  value.forEach((item) => {
    const text = limitText(item || '', 160)
    if (!text || seen.has(text)) return
    seen.add(text)
    result.push(text)
  })
  return result
}

function inferPageTypeFromHints(payload) {
  const text = `${payload.url || ''} ${payload.pageTitle || ''} ${payload.figmaTexts.join(' ')} ${payload.webTexts.join(' ')}`
  if (/약관|개인정보|privacy|terms|policy|legal/i.test(text)) return 'policy'
  if (/input|select|form|문의|신청|동의|필수|이름|전화|이메일/i.test(text)) return 'form'
  if (/계산|견적|할부|금리|시뮬레이션|calculator|estimate/i.test(text)) return 'calculator'
  if (/상품|제품|사양|옵션|가격|product|detail/i.test(text)) return 'product-detail'
  if (/목록|필터|정렬|페이지네이션|listing|search/i.test(text)) return 'listing'
  if (/뉴스|게시|article|story|content/i.test(text)) return 'article'
  if (/프로모션|이벤트|캠페인|혜택|promotion|campaign|event/i.test(text)) return 'promotion'
  if (getUrlPath(payload.url) === '/' || /home|main|메인|홈/i.test(payload.pageTitle || '')) return 'home'
  return 'other'
}

function inferComparisonFocus(pageType) {
  const focusByType = {
    home: ['대표 비주얼', '주요 서비스 진입점', '핵심 CTA', '주요 콘텐츠 섹션', '내비게이션과 전체 구성'],
    landing: ['캠페인 메시지', '혜택', '기간', '대상', 'CTA', '비주얼'],
    promotion: ['캠페인 메시지', '혜택', '기간', '대상', '가격 및 조건', 'CTA', '비주얼'],
    'product-detail': ['상품명', '제품 이미지', '사양', '가격', '옵션', '주요 설명', 'CTA', '표와 정보 구조'],
    calculator: ['입력 항목', '선택 옵션', '계산 결과', '단위', '금액', '단계', '실행 버튼'],
    form: ['필드', '라벨', '필수값', '동의 항목', '버튼', '안내 문구', '단계와 완료 조건'],
    listing: ['목록 개수', '카드 구조', '필터', '정렬', '썸네일', '링크', '페이지네이션'],
    article: ['제목', '본문', '이미지', '인용/표', 'CTA', '콘텐츠 순서'],
    policy: ['조항', '날짜', '금액/비율', '표', '항목 누락', '법적 고지', '버전 정보'],
    other: ['페이지 목적에 맞는 주요 텍스트', '주요 이미지', 'CTA 또는 사용자 행동', '섹션 구조'],
  }
  return focusByType[pageType] || focusByType.other
}

function hasNumberLikeText(value) {
  return /\d|%|원|만원|기간|날짜|년|월|일|회|개/.test(String(value || ''))
}

function getUrlPath(value) {
  try {
    return new URL(value).pathname || '/'
  } catch {
    return ''
  }
}

function normalizeMockupStatus(value, confidence) {
  const normalizedConfidence = normalizeConfidence(confidence)
  if (value === 'critical' || value === 'major') return '수정 필요'
  if (value === 'minor') return normalizedConfidence >= 0.75 ? '수정 필요' : '확인 필요'
  if (value === 'check') return '확인 필요'
  if (MOCKUP_AI_STATUSES.includes(value)) return value
  return normalizedConfidence >= 0.85 ? '수정 필요' : '확인 필요'
}

function normalizeVerificationStatus(value) {
  return ['kept', 'downgraded', 'removed'].includes(value) ? value : 'kept'
}

function normalizeTextMatchConfidence(value) {
  return ['high', 'medium', 'low'].includes(value) ? value : ''
}

function normalizeIssueEvidence(value) {
  const evidence = value && typeof value === 'object' ? value : {}
  const visual = Boolean(evidence.visual)
  const figmaJson = Boolean(evidence.figmaJson)
  const webDom = Boolean(evidence.webDom)
  const explicitAgreement = Number(evidence.sourceAgreement)
  const sourceAgreement = Number.isFinite(explicitAgreement)
    ? Math.max(0, Math.min(3, Math.round(explicitAgreement)))
    : [visual, figmaJson, webDom].filter(Boolean).length

  return { visual, figmaJson, webDom, sourceAgreement }
}

function normalizeConfidence(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0.5
  return Math.round(Math.max(0, Math.min(1, number)) * 100) / 100
}

function normalizeMockupPriority(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 99
}

function normalizeMockupTitle(issue) {
  return limitText(issue?.title || issue?.shortTitle || '확인 필요 항목입니다.', 100)
}

function normalizeMockupSideValue(issue, side) {
  const directValue = limitText(issue?.[side] || '', 240)
  if (directValue) return directValue

  const evidenceKey = side === 'figma' ? 'figmaEvidence' : 'webEvidence'
  const evidenceValue = limitText(issue?.[evidenceKey] || '', 240)
  if (evidenceValue) return evidenceValue

  const parsed = parseMockupDiffSide(issue?.diff, side)
  return limitText(parsed || '확인 필요', 240)
}

function normalizeMockupMemo(issue) {
  const memo = limitText(issue?.memo || issue?.detail || '', 320)
  if (memo) return memo

  const parts = [issue?.reason, issue?.recommendation, issue?.diff]
    .map((item) => limitText(item || '', 220))
    .filter(Boolean)
  return parts.join(' ')
}

function sortMockupIssues(issues) {
  const priority = { '수정 필요': 0, '확인 필요': 1, '무시 가능': 2 }
  return issues.slice().sort((first, second) => {
    const priorityLevelDiff = getPriorityLevelRank(first.priorityLevel) - getPriorityLevelRank(second.priorityLevel)
    if (priorityLevelDiff !== 0) return priorityLevelDiff
    const statusDiff = (priority[first.status] ?? 1) - (priority[second.status] ?? 1)
    if (statusDiff !== 0) return statusDiff
    return first.priority - second.priority
  })
}

function getPriorityLevelRank(value) {
  if (value === 'high') return 0
  if (value === 'low') return 2
  return 1
}

function parseMockupDiffSide(diff, side) {
  const text = String(diff || '')
  if (!text) return ''
  const figmaMatch = text.match(/(?:Figma|시안)\s*(?:은|:)?\s*['“"]?([^'”"/]+?)['”"]?\s*(?:인데|\/|,|현재|Web|웹)/i)
  const webMatch = text.match(/(?:Web|웹|현재)\s*(?:은|:)?\s*['“"]?([^'”"]+?)['”"]?\s*(?:로 보입니다|입니다|$)/i)
  if (side === 'figma') return figmaMatch?.[1]?.trim() || ''
  return webMatch?.[1]?.trim() || ''
}

function normalizeIgnoredDifferences(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => limitText(item, 180)).filter(Boolean).slice(0, 10)
}

function normalizeRemovedIssues(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const removedIssues = []

  value.forEach((item) => {
    const title = limitText(typeof item === 'string' ? item : item?.title || '제외된 항목', 140)
    const reason = limitText(typeof item === 'string' ? '' : item?.reason || item?.memo || '', 260)
    const key = `${title}:${reason}`
    if (!title || seen.has(key)) return
    seen.add(key)
    removedIssues.push({ title, reason: reason || '오탐 가능성이 높아 기본 목록에서 제외했습니다.' })
  })

  return removedIssues.slice(0, 20)
}

function postProcessMockupIssues(issues, payload = {}) {
  const keptIssues = []
  const removedIssues = []
  const figmaTextHints = Array.isArray(payload.figmaTexts) ? payload.figmaTexts : []
  const webTextHints = Array.isArray(payload.webTexts) ? payload.webTexts : []

  issues.forEach((issue) => {
    if (issue.verification === 'removed') {
      if (isProtectedTextIssue(issue)) {
        keptIssues.push(applyIssuePriorityRules({
          ...issue,
          status: issue.status === '무시 가능' ? '확인 필요' : issue.status,
          verification: 'kept',
          memo: appendMemoBasis(issue.memo, 'Text QA 후보는 명확한 오탐이 아니면 유지합니다.'),
        }))
        return
      }
      removedIssues.push({ title: issue.title, reason: '2차 AI 검증에서 오탐 후보로 제거했습니다.' })
      return
    }

    if (isTextQaIssue(issue)) {
      keptIssues.push(applyIssuePriorityRules(issue))
      return
    }

    const hasNumberDifference = hasMeaningfulNumberDifference(issue.figma, issue.web)

    if (!hasNumberDifference && isSuspiciousLongCurrentValue(issue)) {
      keptIssues.push(applyIssuePriorityRules({
        ...issue,
        status: '무시 가능',
        confidence: Math.min(Number(issue.confidence) || 0.5, 0.55),
        memo: appendMemoBasis(issue.memo, '현재 값이 DOM/OCR에서 길게 결합된 것으로 보여 기본 목록에서 제외했습니다.'),
        verification: issue.verification === 'kept' ? 'downgraded' : issue.verification,
      }))
      return
    }

    if (!isTextOrMoneyIssue(issue)) {
      keptIssues.push(applyIssuePriorityRules(issue))
      return
    }

    const normalizedFigma = normalizeComparableQaText(issue.figma)
    const normalizedWeb = normalizeComparableQaText(issue.web)

    if (!hasNumberDifference && normalizedFigma && normalizedFigma === normalizedWeb) {
      removedIssues.push({ title: issue.title, reason: '시안/현재 문구가 정규화 기준으로 동일해 OCR 오탐으로 판단했습니다.' })
      return
    }

    if (issue.type === '문구' && !hasNumberDifference) {
      const contextCheckedIssue = applyTextMismatchContextGuard(issue)
      if (contextCheckedIssue !== issue) {
        keptIssues.push(applyIssuePriorityRules(contextCheckedIssue))
        return
      }

      const sourceCheckedIssue = applyThreeSourceTextVerification(issue, figmaTextHints, webTextHints)
      if (sourceCheckedIssue !== issue) {
        keptIssues.push(applyIssuePriorityRules(sourceCheckedIssue))
        return
      }

      const figmaInWeb = findSimilarTextHint(issue.figma, webTextHints)
      const webInFigma = findSimilarTextHint(issue.web, figmaTextHints)
      const sharedHint = findSharedSimilarHint(figmaTextHints, webTextHints, issue)

      if (figmaInWeb && webInFigma) {
        removedIssues.push({ title: issue.title, reason: 'Figma/Web 텍스트 힌트에 동일하거나 거의 같은 문구가 있어 OCR 오탐으로 판단했습니다.' })
        return
      }

      if (sharedHint && issue.status === '확인 필요') {
        keptIssues.push(applyIssuePriorityRules({
          ...issue,
          status: '무시 가능',
          memo: `${issue.memo || ''} Figma/Web 텍스트 힌트에 동일 문구가 있어 기본 목록에서 숨겼습니다.`.trim(),
          verification: issue.verification === 'kept' ? 'downgraded' : issue.verification,
        }))
        return
      }

      if (issue.status === '확인 필요' && Number(issue.confidence) < 0.72 && (figmaInWeb || webInFigma)) {
        keptIssues.push(applyIssuePriorityRules({
          ...issue,
          status: '무시 가능',
          memo: `${issue.memo || ''} 텍스트 힌트상 동일 문구 가능성이 높아 기본 목록에서 숨겼습니다.`.trim(),
          verification: issue.verification === 'kept' ? 'downgraded' : issue.verification,
        }))
        return
      }
    }

    keptIssues.push(applyIssuePriorityRules(issue))
  })

  return { issues: keptIssues, removedIssues }
}

function applyTextMismatchContextGuard(issue) {
  if (!issue || issue.type !== '문구') return issue

  const figmaContext = getTextMismatchContext(issue.figma)
  const webContext = getTextMismatchContext(issue.web)
  if (figmaContext === 'disclaimer' && webContext === 'disclaimer') return issue
  if (figmaContext === 'campaign' && webContext === 'campaign') return issue

  const farApartByBox = areIssueBoxesFarApart(issue)
  const crossCampaignDisclaimer = (figmaContext === 'campaign' && webContext === 'disclaimer') || (figmaContext === 'disclaimer' && webContext === 'campaign')
  const imbalancedLongText = hasImbalancedTextLength(issue.figma, issue.web) && !hasMeaningfulTextOverlap(issue.figma, issue.web)

  if (crossCampaignDisclaimer || (farApartByBox && imbalancedLongText)) {
    return {
      ...issue,
      status: '무시 가능',
      confidence: Math.min(Number(issue.confidence) || 0.5, 0.55),
      memo: appendMemoBasis(issue.memo, '서로 다른 역할의 섹션 또는 약관성 장문 간 오매칭 가능성이 높아 기본 목록에서 제외했습니다.'),
      verification: issue.verification === 'kept' ? 'downgraded' : issue.verification,
    }
  }

  if ((farApartByBox || imbalancedLongText) && issue.status === '수정 필요') {
    return {
      ...issue,
      status: '확인 필요',
      confidence: Math.min(Number(issue.confidence) || 0.5, 0.68),
      memo: appendMemoBasis(issue.memo, '텍스트 위치/길이 차이가 커 오매칭 가능성 수동 확인 필요'),
      verification: issue.verification === 'kept' ? 'downgraded' : issue.verification,
    }
  }

  return issue
}

function getTextMismatchContext(value) {
  const text = String(value || '')
  const normalized = text.toLowerCase()
  const length = normalizeComparableQaText(text).length
  const hasLegalContext = /운용리스|중도해지|위약금|약관|유의사항|공시|금리|사업자|대표자|주소|고객센터|디스클레이머|disclaimer|legal|copyright|개인정보|준법|심의필/i.test(text)
  const hasCampaignContext = /hero|main\s*visual|campaign|promotion|혜택|이벤트|신청|예약|가격|금액|월\s*\d+|%/i.test(normalized)

  if (hasLegalContext && length >= 70) return 'disclaimer'
  if (hasCampaignContext && length <= 80) return 'campaign'
  return 'unknown'
}

function areIssueBoxesFarApart(issue) {
  const figmaY = getBoxCenterY(issue?.figmaBox)
  const webY = getBoxCenterY(issue?.webBox)
  if (!Number.isFinite(figmaY) || !Number.isFinite(webY)) return false
  return Math.abs(figmaY - webY) > 0.42
}

function getBoxCenterY(box) {
  if (!box || typeof box !== 'object') return Number.NaN
  const y = Number(box.y)
  const height = Number(box.height)
  if (!Number.isFinite(y)) return Number.NaN
  return y + (Number.isFinite(height) ? height / 2 : 0)
}

function hasImbalancedTextLength(firstText, secondText) {
  const firstLength = normalizeComparableQaText(firstText).length
  const secondLength = normalizeComparableQaText(secondText).length
  const shorter = Math.min(firstLength, secondLength)
  const longer = Math.max(firstLength, secondLength)
  return shorter > 0 && shorter <= 80 && longer >= 150 && longer / shorter >= 2.8
}

function applyThreeSourceTextVerification(issue, figmaTextHints, webTextHints) {
  const figmaSource = findBestTextSource(issue, figmaTextHints)
  const webSource = findBestTextSource(issue, webTextHints)
  const visionSource = issue.web || ''

  if (!figmaSource || !webSource || !visionSource) return issue

  const figmaWebSimilar = areQaTextsSimilar(figmaSource, webSource, 0.9)
  const figmaVisionSimilar = areQaTextsSimilar(figmaSource, visionSource, 0.9)
  const webVisionSimilar = areQaTextsSimilar(webSource, visionSource, 0.9)

  if (figmaWebSimilar && figmaVisionSimilar && webVisionSimilar) {
    return {
      ...issue,
      status: '무시 가능',
      confidence: Math.min(Number(issue.confidence) || 0.5, 0.55),
      memo: appendMemoBasis(issue.memo, '텍스트 소스 3개가 동일/유사해 OCR 오탐 가능성이 높습니다.'),
      verification: issue.verification === 'kept' ? 'downgraded' : issue.verification,
    }
  }

  if (figmaWebSimilar && !webVisionSimilar) {
    return {
      ...issue,
      status: '무시 가능',
      confidence: Math.min(Number(issue.confidence) || 0.5, 0.62),
      memo: appendMemoBasis(issue.memo, 'Figma JSON과 Web DOM 문구가 동일/유사해 OCR 오탐 가능성이 높습니다.'),
      verification: issue.verification === 'kept' ? 'downgraded' : issue.verification,
    }
  }

  if (figmaVisionSimilar && !webVisionSimilar) {
    return {
      ...issue,
      status: '무시 가능',
      confidence: Math.min(Number(issue.confidence) || 0.5, 0.62),
      memo: appendMemoBasis(issue.memo, 'Figma JSON과 Vision 판단이 동일/유사해 DOM/OCR 소스 차이로 판단했습니다.'),
      verification: issue.verification === 'kept' ? 'downgraded' : issue.verification,
    }
  }

  if (!figmaWebSimilar && !figmaVisionSimilar && !webVisionSimilar) {
    return {
      ...issue,
      status: '확인 필요',
      confidence: Math.min(Number(issue.confidence) || 0.5, 0.7),
      memo: appendMemoBasis(issue.memo, '텍스트 소스 간 인식 차이로 수동 확인 필요'),
      verification: issue.verification === 'kept' ? 'downgraded' : issue.verification,
    }
  }

  return issue
}

function findBestTextSource(issue, hints) {
  let bestHint = ''
  let bestScore = 0
  const issueValues = [issue.figma, issue.web, issue.title]
    .map((value) => normalizeComparableQaText(value))
    .filter((value) => value.length >= 6)
  if (issueValues.length === 0) return ''

  hints.forEach((hint) => {
    const normalizedHint = normalizeComparableQaText(hint)
    if (!normalizedHint || normalizedHint.length < 6) return

    const score = Math.max(...issueValues.map((value) => getQaTextSimilarity(value, normalizedHint)))
    if (score > bestScore) {
      bestScore = score
      bestHint = hint
    }
  })

  return bestScore >= 0.45 ? bestHint : ''
}

function areQaTextsSimilar(firstText, secondText, threshold = 0.9) {
  return getQaTextSimilarity(normalizeComparableQaText(firstText), normalizeComparableQaText(secondText)) >= threshold
}

function isSuspiciousLongCurrentValue(issue) {
  if (!issue || issue.type === '이미지') return false
  const webText = String(issue.web || '')
  if (webText.length < 170) return false
  const figmaText = String(issue.figma || '')
  if (figmaText && webText.length < figmaText.length * 2.4) return false
  return /\s/.test(webText) || /[|/·•]/.test(webText)
}

function applyIssuePriorityRules(issue) {
  const text = getIssueSearchText(issue)
  const isHighPriority = hasHighPrioritySignal(issue, text)
  const isLowPriority = hasLowPrioritySignal(text) && !isHighPriority

  if (isTextQaIssue(issue)) {
    return {
      ...issue,
      status: isHighPriority ? '수정 필요' : issue.status === '무시 가능' ? '확인 필요' : issue.status,
      priorityLevel: isHighPriority ? 'high' : 'normal',
    }
  }

  if (issue?.type === '레이아웃' && !isHighPriority) {
    return {
      ...issue,
      status: issue.status === '수정 필요' ? '확인 필요' : issue.status,
      priorityLevel: 'normal',
      memo: appendMemoBasis(issue.memo, '레이아웃 차이는 명확한 기능/콘텐츠 오류가 아니면 확인 필요로 분류했습니다.'),
    }
  }

  if (!isLowPriority) {
    return { ...issue, priorityLevel: isHighPriority ? 'high' : 'normal' }
  }

  const downgradedStatus = issue.status === '수정 필요' ? '확인 필요' : issue.status
  return {
    ...issue,
    status: Number(issue.confidence) < 0.65 ? '무시 가능' : downgradedStatus,
    priorityLevel: 'low',
    memo: appendMemoBasis(issue.memo, '반복 내비게이션 또는 오탐 가능성이 높은 단순 표현 차이로 판단되어 낮은 우선순위로 분류했습니다.'),
  }
}

function getIssueSearchText(issue) {
  return `${issue?.area || ''} ${issue?.type || ''} ${issue?.title || ''} ${issue?.figma || ''} ${issue?.web || ''} ${issue?.memo || ''}`.toLowerCase()
}

function hasHighPrioritySignal(issue, text) {
  if (isNavigationIssueText(text)) return false
  if (issue?.type === 'CTA') return !isNavigationIssueText(text)
  if (issue?.type === '금액') return true
  if (issue?.type === '섹션' && /누락|추가|순서|구조/i.test(text)) return true
  return /(cta|버튼|링크명|제목|모델|model|숫자|누락|개수|가격|금액|금리|이율|비율|퍼센트|기간|날짜|조건|필수|동의|입력|오류|섹션\s*누락|깨짐|원|만원|%)/i.test(text)
}

function hasLowPrioritySignal(text) {
  return isNavigationIssueText(text)
    || /(단순\s*표현|ocr\s*오탐|오탐\s*가능|오매칭\s*가능)/i.test(text)
}

function isNavigationIssueText(text) {
  return isNavigationCtaContext(text) || /(gnb|header|nav|navigation|global\s*navigation|menu|search|bar\s*items|상단\s*메뉴|전체\s*메뉴|검색)/i.test(String(text || ''))
}

function isTextOrMoneyIssue(issue) {
  return issue?.type === '문구' || issue?.type === '금액'
}

function normalizeComparableQaText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u3000\ufeff]+/g, '')
    .replace(/[.,，。ㆍ·:：;；!！?？"'“”‘’`´\-‐‑‒–—―_/\\()[\]{}<>《》]/g, '')
    .replace(/[^0-9a-z가-힣%]/g, '')
}

function hasMeaningfulNumberDifference(firstText, secondText) {
  const firstNumbers = extractComparableNumbers(firstText)
  const secondNumbers = extractComparableNumbers(secondText)
  if (firstNumbers.length === 0 && secondNumbers.length === 0) return false
  return firstNumbers.join('|') !== secondNumbers.join('|')
}

function extractComparableNumbers(value) {
  return (String(value || '').match(/\d+(?:[.,]\d+)?/g) || [])
    .map((number) => number.replace(/,/g, '.'))
}

function findSimilarTextHint(text, hints) {
  const normalizedText = normalizeComparableQaText(text)
  if (!normalizedText || normalizedText.length < 6) return null

  return hints.find((hint) => getQaTextSimilarity(normalizedText, normalizeComparableQaText(hint)) >= 0.92) || null
}

function findSharedSimilarHint(figmaHints, webHints, issue) {
  const issueText = normalizeComparableQaText(`${issue.figma} ${issue.web}`)
  if (!issueText) return null

  for (const figmaHint of figmaHints) {
    const normalizedFigma = normalizeComparableQaText(figmaHint)
    if (!normalizedFigma || normalizedFigma.length < 8 || !issueText.includes(normalizedFigma.slice(0, Math.min(10, normalizedFigma.length)))) continue

    for (const webHint of webHints) {
      if (getQaTextSimilarity(normalizedFigma, normalizeComparableQaText(webHint)) >= 0.94) {
        return figmaHint
      }
    }
  }

  return null
}

function getQaTextSimilarity(firstText, secondText) {
  if (!firstText || !secondText) return 0
  if (firstText === secondText) return 1
  if (firstText.includes(secondText) || secondText.includes(firstText)) {
    return Math.min(firstText.length, secondText.length) / Math.max(firstText.length, secondText.length)
  }

  const firstTokens = createQaTextTokenSet(firstText)
  const secondTokens = createQaTextTokenSet(secondText)
  if (firstTokens.size === 0 || secondTokens.size === 0) return 0

  let overlap = 0
  firstTokens.forEach((token) => {
    if (secondTokens.has(token)) overlap += 1
  })

  return overlap / Math.max(firstTokens.size, secondTokens.size)
}

function createQaTextTokenSet(value) {
  const text = String(value || '')
  const tokens = new Set()
  for (let index = 0; index < text.length - 1; index += 1) {
    tokens.add(text.slice(index, index + 2))
  }
  return tokens
}

function normalizeMockupBox(value) {
  if (!value || typeof value !== 'object') return null

  const x = Number(value.x)
  const y = Number(value.y)
  const width = Number(value.width)
  const height = Number(value.height)
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null

  const safeX = clampBoxRatio(x)
  const safeY = clampBoxRatio(y)
  const safeWidth = Math.min(clampBoxRatio(width), 1 - safeX)
  const safeHeight = Math.min(clampBoxRatio(height), 1 - safeY)
  if (safeWidth <= 0 || safeHeight <= 0) return null

  return {
    x: roundBoxRatio(safeX),
    y: roundBoxRatio(safeY),
    width: roundBoxRatio(safeWidth),
    height: roundBoxRatio(safeHeight),
  }
}

function clampBoxRatio(value) {
  return Math.max(0, Math.min(1, Number(value)))
}

function roundBoxRatio(value) {
  return Math.round(value * 10000) / 10000
}

function filterMinorMockupTextIssues(issues) {
  return issues.filter((issue) => {
    if (isTextQaIssue(issue)) return true
    if (issue.type !== '문구') return true
    if (!issue.figma || !issue.web) return true
    if (hasCriticalMockupTextDifference(issue.figma, issue.web)) return true
    return !isMinorMockupTextDifference(issue.figma, issue.web)
  })
}

function isMinorMockupTextDifference(figmaText, webText) {
  return normalizeMinorMockupText(figmaText) === normalizeMinorMockupText(webText)
}

function normalizeMinorMockupText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[.,:;。．，、：；]/g, '')
}

function hasCriticalMockupTextDifference(figmaText, webText) {
  const figma = normalizeCriticalMockupText(figmaText)
  const web = normalizeCriticalMockupText(webText)
  const criticalPairs = [
    ['금융상품', '금융프로그램'],
    ['상품', '프로그램'],
    ['운용리스', '리스'],
    ['할부', '리스'],
  ]

  return criticalPairs.some(([first, second]) => hasCriticalPairDifference(figma, web, first, second))
}

function normalizeCriticalMockupText(value) {
  return String(value || '').toLowerCase().replace(/[\s\u00a0]+/g, '')
}

function hasCriticalPairDifference(firstText, secondText, firstTerm, secondTerm) {
  const firstHasFirst = firstText.includes(firstTerm)
  const firstHasSecond = includesCriticalTerm(firstText, secondTerm, firstTerm)
  const secondHasFirst = secondText.includes(firstTerm)
  const secondHasSecond = includesCriticalTerm(secondText, secondTerm, firstTerm)

  return (firstHasFirst && secondHasSecond && !secondHasFirst)
    || (firstHasSecond && secondHasFirst && !firstHasFirst)
}

function includesCriticalTerm(text, term, longerTerm) {
  if (term !== '리스') return text.includes(term)
  return text.replaceAll(longerTerm, '').includes(term)
}

function parseAiQaJson(rawText) {
  if (!rawText) return null
  try {
    return JSON.parse(rawText)
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

function mapOpenAiError(error) {
  const status = Number(error?.status || error?.response?.status || 500)
  const message = String(error?.message || '')
  const code = String(error?.code || error?.error?.code || '')

  if (status === 401 || status === 403) return { status: 401, body: { message: 'OpenAI API Key가 유효하지 않습니다. .env의 OPENAI_API_KEY를 확인해주세요.', code: 'invalid_api_key' } }
  if (status === 402 || status === 429 || /quota|billing|credit/i.test(message + code)) return { status: 402, body: { message: 'API 크레딧이 부족하거나 결제 설정이 필요합니다.', code: 'insufficient_credits' } }
  if (status === 404 || /model/i.test(message + code)) return { status: 400, body: { message: `AI 모델명 확인이 필요합니다. 서버의 AI_QA_MODEL 값을 확인해주세요. 현재 모델: ${AI_QA_MODEL}`, code: 'model_error' } }
  if (/timeout|ETIMEDOUT/i.test(message + code)) return { status: 504, body: { message: 'AI QA 요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.', code: 'timeout' } }
  if (/network|fetch|connection|ECONN/i.test(message + code)) return { status: 502, body: { message: 'OpenAI API 네트워크 연결 중 오류가 발생했습니다.', code: 'network_error' } }
  return { status: 500, body: { message: 'AI QA 실행 중 오류가 발생했습니다.', code: 'ai_qa_error' } }
}

function limitText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function limitStrictText(value, maxLength) {
  const text = String(value || '').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

async function scanUrl(targetUrl) {
  const browser = await chromium.launch({ headless: true })
  const consoleMessages = []
  const failedImageRequests = new Map()
  const failedResourceRequests = []
  const badResourceResponses = []
  let mainResponse = null
  let mainError = ''
  let pageTitle
  let domSnapshot
  let mobileResult
  let webScreenshot

  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: DESKTOP_DESIGN_VIEWPORT,
      deviceScaleFactor: DESKTOP_SCREENSHOT_SCALE,
      permissions: [],
      serviceWorkers: 'block',
    })
    await blockPostRequests(context)

    const page = await context.newPage()
    attachCollectors(page, consoleMessages, failedImageRequests, failedResourceRequests, badResourceResponses)

    try {
      mainResponse = await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      })
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch((error) => {
        mainError = mainError || `networkidle 대기 제한: ${error.message}`
      })
    } catch (error) {
      mainError = error instanceof Error ? error.message : '페이지 접속 실패'
    }

    pageTitle = await safeTitle(page)
    domSnapshot = await safeDomSnapshot(page, targetUrl)
    webScreenshot = await safeWebScreenshot(page)
    mobileResult = await scanMobile(browser, targetUrl)
    await context.close()
  } finally {
    await browser.close()
  }

  const safePageTitle = pageTitle || ''
  const snapshot = domSnapshot || createEmptyDomSnapshot()
  const safeMobileResult = mobileResult || createMobileFallback()
  const linksToCheck = getLinksToCheck(snapshot.links)
  const linkStatuses = await checkLinkStatuses(linksToCheck)
  const images = mergeImageFailures(snapshot.images, failedImageRequests)
  const missingHrefLinks = snapshot.interactionTargets.filter((target) => !target.href)
  const checks = buildChecks({
    mainResponse,
    mainError,
    pageTitle: safePageTitle,
    consoleMessages,
    images,
    links: snapshot.links,
    missingHrefLinks,
    linkStatuses,
    counts: snapshot.counts,
    mobileResult: safeMobileResult,
    metaInfo: snapshot.metaInfo,
    missingAltImages: snapshot.missingAltImages,
    formInfo: snapshot.formInfo,
    externalBlankLinks: snapshot.externalBlankLinks,
    duplicateIds: snapshot.duplicateIds,
    headingInfo: snapshot.headingInfo,
    largeResources: snapshot.largeResources,
    networkIssues: failedResourceRequests.concat(badResourceResponses),
    unlabeledClickables: snapshot.unlabeledClickables,
  })

  return {
    targetUrl,
    scannedAt: new Date().toISOString(),
    pageTitle: safePageTitle,
    httpStatus: mainResponse?.status() ?? null,
    accessible: Boolean(mainResponse && mainResponse.ok()),
    navigationError: mainError,
    checks,
    links: linkStatuses,
    uncheckedLinkCount: 0,
    missingHrefLinks,
    images,
    designElements: snapshot.designElements,
    webCtaHints: snapshot.webCtaHints || [],
    webDomSummary: createWebDomSummary(snapshot, safePageTitle),
    webScreenshot: webScreenshot || createEmptyWebScreenshot(),
    consoleMessages,
    counts: snapshot.counts,
    mobile: safeMobileResult,
  }
}

async function safeWebScreenshot(page) {
  try {
    const viewport = page.viewportSize() || DESKTOP_DESIGN_VIEWPORT
    const pageSize = await page.evaluate(() => ({
      width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
      height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
    }))
    const buffer = await page.screenshot({ fullPage: true, type: 'png' })

    return {
      dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
      mediaType: 'image/png',
      width: viewport.width,
      height: pageSize.height,
      viewport,
      deviceScaleFactor: DESKTOP_SCREENSHOT_SCALE,
      fullPage: true,
      capped: false,
      capturedAt: new Date().toISOString(),
      error: '',
    }
  } catch (error) {
    return {
      dataUrl: '',
      mediaType: 'image/png',
      width: 0,
      height: 0,
      viewport: DESKTOP_DESIGN_VIEWPORT,
      deviceScaleFactor: DESKTOP_SCREENSHOT_SCALE,
      fullPage: true,
      capturedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : '스크린샷 수집 실패',
    }
  }
}

async function blockPostRequests(context) {
  await context.route('**/*', async (route) => {
    if (route.request().method().toUpperCase() === 'POST') {
      await route.abort('blockedbyclient')
      return
    }

    await route.continue()
  })
}

function attachCollectors(page, consoleMessages, failedImageRequests, failedResourceRequests = [], badResourceResponses = []) {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location()
      consoleMessages.push({
        level: 'error',
        source: location.url || 'inline-script',
        lineNumber: location.lineNumber ?? null,
        columnNumber: location.columnNumber ?? null,
        message: message.text(),
      })
    }
  })

  page.on('pageerror', (error) => {
    consoleMessages.push({
      level: 'error',
      source: 'pageerror',
      message: error.message,
    })
  })

  page.on('requestfailed', (request) => {
    const failureText = request.failure()?.errorText || 'request failed'
    if (request.resourceType() === 'image') {
      failedImageRequests.set(request.url(), failureText || 'image request failed')
    }

    if (request.method().toUpperCase() === 'POST' || /blockedbyclient/i.test(failureText)) return
    if (failedResourceRequests.length >= 30) return

    failedResourceRequests.push({
      url: request.url(),
      type: request.resourceType(),
      method: request.method(),
      message: failureText,
    })
  })

  page.on('response', (response) => {
    const statusCode = response.status()
    if (statusCode < 400 || badResourceResponses.length >= 30) return

    const request = response.request()
    if (request.resourceType() === 'document') return

    badResourceResponses.push({
      url: response.url(),
      type: request.resourceType(),
      method: request.method(),
      statusCode,
      message: getLinkNote(statusCode),
    })
  })
}

async function safeTitle(page) {
  try {
    return await page.title()
  } catch {
    return ''
  }
}

async function safeDomSnapshot(page, targetUrl) {
  try {
    return await page.evaluate(({ baseUrl, maxDesignElements }) => {
      const documentHeight = getDocumentHeight()
      const links = Array.from(document.querySelectorAll('a')).map((anchor, index) => {
        const href = anchor.getAttribute('href')?.trim() || ''
        const url = resolveInspectableUrl(href, baseUrl)

        return {
          index: index + 1,
          kind: 'a',
          label: getElementLabel(anchor, `Link ${index + 1}`),
          text: normalizeText(anchor.innerText || anchor.textContent || ''),
          ariaLabel: anchor.getAttribute('aria-label') || '',
          href,
          url: isInspectableUrl(url) ? url : '',
          selector: getCssSelector(anchor),
          domPath: getElementPath(anchor),
          section: estimateSection(anchor, documentHeight),
          y: getPageRect(anchor).y,
          boundingBox: getPageRect(anchor),
        }
      })

      const buttonTargets = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')).map((button, index) => {
        const href = getButtonTarget(button)
        const url = resolveInspectableUrl(href, baseUrl)

        return {
          index: index + 1,
          kind: button.tagName.toLowerCase(),
          label: getElementLabel(button, `Button ${index + 1}`),
          text: normalizeText(button.value || button.innerText || button.textContent || ''),
          ariaLabel: button.getAttribute('aria-label') || '',
          href,
          url: isInspectableUrl(url) ? url : '',
          selector: getCssSelector(button),
          domPath: getElementPath(button),
          section: estimateSection(button, documentHeight),
          y: getPageRect(button).y,
          boundingBox: getPageRect(button),
        }
      })

      const images = Array.from(document.images).map((image, index) => {
        const rect = getPageRect(image)
        return {
          index: index + 1,
          src: image.currentSrc || image.src || '',
          alt: image.alt || '',
          loaded: image.complete && image.naturalWidth > 0,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          selector: getCssSelector(image),
          domPath: getElementPath(image),
          section: estimateSection(image, documentHeight),
          y: rect.y,
          boundingBox: rect,
        }
      })

      const designElements = collectVisibleDesignElements().slice(0, maxDesignElements).map((entry, index) => ({
        index: index + 1,
        ...entry,
      }))
      const webCtaHints = collectWebCtaHints()
      const metaInfo = collectMetaInfo()
      const missingAltImages = images.filter((image) => !normalizeText(image.alt)).slice(0, 30)
      const formInfo = collectFormInfo()
      const externalBlankLinks = collectExternalBlankLinks(links, baseUrl)
      const duplicateIds = collectDuplicateIds()
      const headingInfo = collectHeadingInfo()
      const largeResources = collectLargeResources()
      const unlabeledClickables = collectUnlabeledClickables().slice(0, 30)

      return {
        links,
        buttonTargets,
        interactionTargets: links.concat(buttonTargets),
        images,
        designElements,
        webCtaHints,
        metaInfo,
        missingAltImages,
        formInfo,
        externalBlankLinks,
        duplicateIds,
        headingInfo,
        largeResources,
        unlabeledClickables,
        counts: {
          anchors: links.length,
          buttons: buttonTargets.length,
          missingHrefs: links.concat(buttonTargets).filter((target) => !target.href).length,
        },
      }

      function collectMetaInfo() {
        return {
          title: normalizeText(document.title),
          description: getMetaContent('meta[name="description"]'),
          canonical: document.querySelector('link[rel~="canonical"]')?.getAttribute('href')?.trim() || '',
          ogTitle: getMetaContent('meta[property="og:title"]'),
          ogDescription: getMetaContent('meta[property="og:description"]'),
          ogImage: getMetaContent('meta[property="og:image"]'),
        }
      }

      function getMetaContent(selector) {
        return normalizeText(document.querySelector(selector)?.getAttribute('content') || '')
      }

      function collectFormInfo() {
        const controls = Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea'))
        const missingLabels = controls
          .filter((control) => isVisibleElement(control) && !hasControlLabel(control))
          .map((control, index) => ({
            label: getElementLabel(control, `Form control ${index + 1}`),
            type: control.getAttribute('type') || control.tagName.toLowerCase(),
            name: control.getAttribute('name') || '',
            required: control.required === true,
            selector: getCssSelector(control),
            domPath: getElementPath(control),
            boundingBox: getPageRect(control),
          }))

        return {
          total: controls.length,
          requiredCount: controls.filter((control) => control.required === true).length,
          missingLabels: missingLabels.slice(0, 30),
        }
      }

      function hasControlLabel(control) {
        if (normalizeText(control.getAttribute('aria-label') || '')) return true
        if (normalizeText(control.getAttribute('aria-labelledby') || '')) return true
        const id = control.getAttribute('id') || ''
        if (id && document.querySelector(`label[for="${cssEscape(id)}"]`)) return true
        return Boolean(control.closest('label'))
      }

      function collectExternalBlankLinks(linkItems, baseUrlValue) {
        let baseOrigin = ''
        try {
          baseOrigin = new URL(baseUrlValue).origin
        } catch {
          baseOrigin = ''
        }

        return linkItems.filter((link) => {
          const anchor = safeQuerySelector(link.selector)
          if (!anchor || anchor.getAttribute('target') !== '_blank') return false
          if (!isExternalUrl(link.url, baseOrigin)) return false
          const rel = (anchor.getAttribute('rel') || '').toLowerCase()
          return !rel.includes('noopener') || !rel.includes('noreferrer')
        }).map((link) => {
          const anchor = safeQuerySelector(link.selector)
          return {
            ...link,
            target: '_blank',
            rel: anchor?.getAttribute('rel') || '',
          }
        }).slice(0, 30)
      }

      function isExternalUrl(url, baseOrigin) {
        if (!url || !baseOrigin) return false
        try {
          return new URL(url).origin !== baseOrigin
        } catch {
          return false
        }
      }

      function safeQuerySelector(selector) {
        if (!selector) return null
        try {
          return document.querySelector(selector)
        } catch {
          return null
        }
      }

      function collectDuplicateIds() {
        const idMap = new Map()
        Array.from(document.querySelectorAll('[id]')).forEach((element) => {
          const id = element.getAttribute('id') || ''
          if (!id) return
          const entries = idMap.get(id) || []
          entries.push({ selector: getCssSelector(element), domPath: getElementPath(element) })
          idMap.set(id, entries)
        })

        return Array.from(idMap.entries())
          .filter(([, entries]) => entries.length > 1)
          .map(([id, entries]) => ({ id, label: id, count: entries.length, selector: entries.map((entry) => entry.selector).join(' | '), domPath: entries.map((entry) => entry.domPath).join(' | ') }))
          .slice(0, 30)
      }

      function collectHeadingInfo() {
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((heading) => ({
          level: Number(heading.tagName.slice(1)),
          text: normalizeText(heading.innerText || heading.textContent || ''),
          selector: getCssSelector(heading),
          domPath: getElementPath(heading),
        }))
        const skipped = []
        let previousLevel = null
        headings.forEach((heading) => {
          if (previousLevel !== null && heading.level - previousLevel > 1) skipped.push(heading)
          previousLevel = heading.level
        })

        return {
          h1Count: headings.filter((heading) => heading.level === 1).length,
          headings: headings.slice(0, 40),
          skipped: skipped.slice(0, 20),
        }
      }

      function collectLargeResources() {
        const entries = typeof performance?.getEntriesByType === 'function' ? performance.getEntriesByType('resource') : []
        return entries.map((entry) => {
          const sizeBytes = Math.max(Number(entry.transferSize) || 0, Number(entry.encodedBodySize) || 0, Number(entry.decodedBodySize) || 0)
          return {
            url: entry.name || '',
            type: entry.initiatorType || 'resource',
            sizeBytes,
          }
        }).filter((entry) => entry.sizeBytes >= 1024 * 1024).slice(0, 30)
      }

      function collectUnlabeledClickables() {
        return Array.from(document.querySelectorAll('a, button, [role="button"], input[type="button"], input[type="submit"], [onclick]'))
          .filter((element) => isVisibleElement(element) && !getAccessibleLabel(element))
          .map((element, index) => ({
            label: `Clickable ${index + 1}`,
            type: element.tagName.toLowerCase(),
            selector: getCssSelector(element),
            domPath: getElementPath(element),
            boundingBox: getPageRect(element),
          }))
      }

      function getAccessibleLabel(element) {
        return normalizeText(element.innerText || element.textContent || element.value || '')
          || normalizeText(element.getAttribute('aria-label') || '')
          || normalizeText(element.getAttribute('aria-labelledby') || '')
          || normalizeText(element.getAttribute('title') || '')
          || normalizeText(element.querySelector('img')?.getAttribute('alt') || '')
      }

      function collectWebCtaHints() {
        const hints = []
        const seen = new Set()
        const documentHeight = getDocumentHeight()

        Array.from(document.querySelectorAll('*')).forEach((element) => {
          if (!isCtaCandidate(element) || !isVisibleElement(element)) return

          const text = normalizeText(element.value || element.innerText || element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || '')
          if (!isMeaningfulCtaText(text)) return

          const href = getButtonTarget(element) || element.getAttribute('href')?.trim() || ''
          const rect = getPageRect(element)
          const area = estimateSection(element, documentHeight)
          const key = `${normalizeComparableCtaText(text)}:${area}:${href}`
          if (seen.has(key)) return
          seen.add(key)

          hints.push({
            text,
            href,
            selector: getCssSelector(element),
            area,
            y: rect?.y ?? 0,
            visible: true,
          })
        })

        return hints.sort((first, second) => first.y - second.y).slice(0, 40)
      }

      function isCtaCandidate(element) {
        const tagName = element.tagName?.toLowerCase() || ''
        const role = element.getAttribute('role') || ''
        const type = element.getAttribute('type') || ''
        const className = typeof element.className === 'string' ? element.className : ''
        const href = element.getAttribute('href') || ''
        const searchable = `${className} ${href}`
        return tagName === 'a'
          || tagName === 'button'
          || role.toLowerCase() === 'button'
          || (tagName === 'input' && /^(button|submit)$/i.test(type))
          || element.hasAttribute('onclick')
          || /button|btn|cta|link/i.test(searchable)
      }

      function isMeaningfulCtaText(value) {
        const text = normalizeText(value)
        if (text.length < 2) return false
        if (/^[<>+\-_=|/\\•·.]+$/.test(text)) return false
        if (/^(닫기|close|x|×|prev|next|이전|다음)$/i.test(text)) return false
        return true
      }

      function normalizeComparableCtaText(value) {
        return normalizeText(value).toLowerCase().replace(/[\s\u00a0.,:;!?'"“”‘’()[\]{}<>_/\\-]/g, '')
      }

      function getDocumentHeight() {
        return Math.max(
          document.documentElement.scrollHeight,
          document.body?.scrollHeight || 0,
          window.innerHeight,
        ) || 1
      }

      function isInspectableUrl(value) {
        if (!value) return false
        return value.startsWith('http://') || value.startsWith('https://')
      }

      function resolveInspectableUrl(href, baseUrl) {
        try {
          return href ? new URL(href, baseUrl).href : ''
        } catch {
          return ''
        }
      }

      function collectVisibleDesignElements() {
        const elementsByKey = new Map()
        const documentHeight = getDocumentHeight()
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            if (!node.textContent || !normalizeText(node.textContent)) return NodeFilter.FILTER_REJECT

            const parent = node.parentElement
            if (!parent || !isVisibleElement(parent)) return NodeFilter.FILTER_REJECT
            if (isIgnoredTag(parent.tagName)) return NodeFilter.FILTER_REJECT
            return NodeFilter.FILTER_ACCEPT
          },
        })

        while (walker.nextNode()) {
          const node = walker.currentNode
          const anchor = getTextAnchor(node.parentElement)
          if (!anchor || !isVisibleElement(anchor)) continue

          const text = normalizeText(node.textContent)
          if (!text) continue

          const key = getElementKey(anchor)
          const entry = elementsByKey.get(key) || createElementEntry(anchor, documentHeight)
          if (!entry) continue
          entry.textParts.push(text)
          elementsByKey.set(key, entry)
        }

        document.querySelectorAll('a, button, [role="button"], input[type="button"], input[type="submit"]').forEach((element) => {
          if (!isVisibleElement(element)) return

          const key = getElementKey(element)
          const entry = elementsByKey.get(key) || createElementEntry(element, documentHeight)
          if (!entry) return

          if (entry.textParts.length === 0) {
            const fallbackText = normalizeText(element.value || element.innerText || element.textContent || '')
            if (fallbackText) entry.textParts.push(fallbackText)
          }

          elementsByKey.set(key, entry)
        })

        return Array.from(elementsByKey.values())
          .map((entry) => finalizeElementEntry(entry))
          .filter(Boolean)
          .sort((first, second) => {
            if (first.y !== second.y) return first.y - second.y
            return first.x - second.x
          })
      }

      function createElementEntry(element, documentHeight) {
        const rect = element.getBoundingClientRect()
        if (!hasVisibleRect(rect)) return null

        const styles = window.getComputedStyle(element)
        const x = rect.x + window.scrollX
        const y = rect.y + window.scrollY

        return {
          element,
          tag: element.tagName.toLowerCase(),
          layerPath: getElementPath(element),
          href: element.tagName.toLowerCase() === 'a' ? element.getAttribute('href')?.trim() || '' : '',
          fontFamily: styles.fontFamily,
          fontSize: styles.fontSize,
          fontWeight: styles.fontWeight,
          lineHeight: styles.lineHeight,
          color: styles.color,
          x: Math.round(x * 100) / 100,
          y: Math.round(y * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          positionRatio: Math.max(0, Math.min(1, y / documentHeight)),
          textParts: [],
        }
      }

      function finalizeElementEntry(entry) {
        const text = normalizeText(entry.textParts.join(' '))
        if (!text) return null

        return {
          tag: entry.tag,
          text,
          layerPath: entry.layerPath,
          href: entry.href,
          fontFamily: entry.fontFamily,
          fontSize: entry.fontSize,
          fontWeight: entry.fontWeight,
          lineHeight: entry.lineHeight,
          color: entry.color,
          x: entry.x,
          y: entry.y,
          width: entry.width,
          height: entry.height,
          positionRatio: entry.positionRatio,
        }
      }

      function getTextAnchor(element) {
        if (!element) return null

        const semanticAnchor = element.closest('a, button, [role="button"], input[type="button"], input[type="submit"], h1, h2, h3, h4, h5, h6, p, li, dt, dd, blockquote, figcaption, label, small')
        if (semanticAnchor && isVisibleElement(semanticAnchor)) return semanticAnchor

        return element
      }

      function isVisibleElement(element) {
        if (!element || element.closest('[hidden], [aria-hidden="true"]')) return false

        const styles = window.getComputedStyle(element)
        if (styles.display === 'none' || styles.visibility === 'hidden') return false
        if (Number.parseFloat(styles.opacity || '1') === 0) return false

        return hasVisibleRect(element.getBoundingClientRect())
      }

      function hasVisibleRect(rect) {
        return Boolean(rect && rect.width > 0 && rect.height > 0)
      }

      function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim()
      }

      function isIgnoredTag(tagName) {
        return ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(String(tagName || '').toUpperCase())
      }

      function getElementKey(element) {
        if (!element) return ''
        if (element.dataset.designQaKey) return element.dataset.designQaKey

        const key = `${element.tagName.toLowerCase()}-${Math.random().toString(36).slice(2, 10)}`
        element.dataset.designQaKey = key
        return key
      }

      function getElementPath(element) {
        if (!element) return ''

        const parts = []
        let current = element
        let depth = 0

        while (current && current !== document.body && depth < 4) {
          const tagName = current.tagName.toLowerCase()
          const idPart = current.id ? `#${current.id}` : ''
          const classPart = current.classList.length > 0 ? `.${Array.from(current.classList).slice(0, 2).join('.')}` : ''
          parts.unshift(`${tagName}${idPart}${classPart}`)
          current = current.parentElement
          depth += 1
        }

        return parts.join(' > ')
      }

      function getElementLabel(element, fallback) {
        return normalizeText(element.innerText || element.textContent || element.value || '')
          || element.getAttribute('aria-label')
          || element.getAttribute('title')
          || fallback
      }

      function getButtonTarget(element) {
        return element.getAttribute('href')?.trim()
          || element.getAttribute('data-href')?.trim()
          || element.getAttribute('data-url')?.trim()
          || element.getAttribute('formaction')?.trim()
          || ''
      }

      function getPageRect(element) {
        const rect = element?.getBoundingClientRect()
        if (!rect) return null

        return {
          x: Math.round((rect.x + window.scrollX) * 100) / 100,
          y: Math.round((rect.y + window.scrollY) * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
        }
      }

      function estimateSection(element, documentHeight) {
        const rect = getPageRect(element)
        if (!rect || documentHeight <= 0) return 'unknown'
        const ratio = rect.y / documentHeight
        if (ratio < 0.33) return 'top'
        if (ratio < 0.66) return 'middle'
        return 'bottom'
      }

      function getCssSelector(element) {
        if (!element || !element.tagName) return ''
        if (element.id) return `#${cssEscape(element.id)}`

        const parts = []
        let current = element
        let depth = 0
        while (current && current !== document.body && depth < 5) {
          const tagName = current.tagName.toLowerCase()
          const classNames = Array.from(current.classList || []).slice(0, 2).map((className) => `.${cssEscape(className)}`).join('')
          const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((sibling) => sibling.tagName === current.tagName) : []
          const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''
          parts.unshift(`${tagName}${classNames}${nth}`)
          current = current.parentElement
          depth += 1
        }
        return parts.join(' > ')
      }

      function cssEscape(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
        return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&')
      }
    }, { baseUrl: targetUrl, maxDesignElements: MAX_DESIGN_ELEMENTS })
  } catch {
    return createEmptyDomSnapshot()
  }
}

async function scanMobile(browser, targetUrl) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    permissions: [],
    serviceWorkers: 'block',
  })
  await blockPostRequests(context)

  try {
    const page = await context.newPage()
    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS,
    })
    const widthInfo = await page.evaluate(() => {
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 390
      const documentWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0, viewportWidth)
      return {
        viewportWidth,
        documentWidth,
        hasHorizontalOverflow: documentWidth > viewportWidth + 2,
      }
    }).catch(() => ({ viewportWidth: 390, documentWidth: 390, hasHorizontalOverflow: false }))

    return {
      accessible: Boolean(response && response.ok()),
      statusCode: response?.status() ?? null,
      viewport: { width: 390, height: 844 },
      ...widthInfo,
      note: response?.ok() ? '모바일 viewport 접속 가능' : '모바일 viewport 응답 확인 필요',
    }
  } catch (error) {
    return {
      accessible: false,
      statusCode: null,
      viewport: { width: 390, height: 844 },
      viewportWidth: 390,
      documentWidth: 390,
      hasHorizontalOverflow: false,
      note: error instanceof Error ? error.message : '모바일 viewport 접속 실패',
    }
  } finally {
    await context.close()
  }
}

async function checkLinkStatuses(links) {
  const api = await playwrightRequest.newContext({ ignoreHTTPSErrors: true })

  try {
    return await mapWithLimit(links, LINK_CHECK_CONCURRENCY, async (link) => {
      try {
        const response = await api.get(link.url, {
          timeout: LINK_TIMEOUT_MS,
          maxRedirects: 3,
        })
        const statusCode = response.status()
        await response.dispose()
        return {
          ...link,
          statusCode,
          status: getLinkStatus(statusCode),
          note: getLinkNote(statusCode),
        }
      } catch (error) {
        return {
          ...link,
          statusCode: null,
          status: 'warn',
          note: error instanceof Error ? error.message : '응답 상태 확인 실패',
        }
      }
    })
  } finally {
    await api.dispose()
  }
}

function getLinksToCheck(links = []) {
  const inspectableLinks = links.filter((link) => link.url)
  const sortedLinks = sortLinksForStatusCheck(inspectableLinks)
  if (!Number.isFinite(MAX_LINKS_TO_CHECK)) return sortedLinks
  return sortedLinks.slice(0, MAX_LINKS_TO_CHECK)
}

function sortLinksForStatusCheck(links) {
  return links.slice().sort((first, second) => {
    const rankDiff = getLinkCheckPriority(first) - getLinkCheckPriority(second)
    if (rankDiff !== 0) return rankDiff
    return Number(first.index || 0) - Number(second.index || 0)
  })
}

function getLinkCheckPriority(link) {
  const text = `${link.label || ''} ${link.text || ''} ${link.href || ''} ${link.url || ''} ${link.selector || ''} ${link.domPath || ''} ${link.section || ''}`.toLowerCase()
  if (/cta|button|btn|프로모션|상품|구매상담|구매\s*상담|온라인견적|온라인\s*견적|상담|신청|예약|바로가기|더\s*알아보기|자세히/.test(text)) return 0
  if (/promo|product|estimate|consult|buy|shop/.test(text)) return 1
  if (/gnb|header|nav|navigation|menu|search|상단\s*메뉴|전체\s*메뉴/.test(text) || link.section === 'top') return 2
  if (/footer|legal|copyright|약관|유의|고지|disclaimer|푸터/.test(text) || link.section === 'bottom') return 3
  return 2
}

async function mapWithLimit(items, limit, mapper) {
  const results = []
  let index = 0

  async function worker() {
    while (index < items.length) {
      const currentIndex = index
      index += 1
      results[currentIndex] = await mapper(items[currentIndex])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

function mergeImageFailures(images, failedImageRequests) {
  return images.map((image) => {
    const requestFailure = failedImageRequests.get(image.src)
    const failed = Boolean(requestFailure) || !image.loaded

    return {
      ...image,
      status: failed ? 'error' : 'ok',
      message: failed ? requestFailure || 'DOM 기준 이미지 로드 실패' : 'Loaded',
    }
  })
}

function buildChecks({
  mainResponse,
  mainError,
  pageTitle,
  consoleMessages,
  images,
  links,
  missingHrefLinks,
  linkStatuses,
  counts,
  mobileResult,
  metaInfo = {},
  missingAltImages = [],
  formInfo = { total: 0, requiredCount: 0, missingLabels: [] },
  externalBlankLinks = [],
  duplicateIds = [],
  headingInfo = { h1Count: 0, headings: [], skipped: [] },
  largeResources = [],
  networkIssues = [],
  unlabeledClickables = [],
}) {
  const httpStatus = mainResponse?.status() ?? null
  const brokenImages = images.filter((image) => image.status === 'error')
  const missingHrefCount = missingHrefLinks.length
  const badLinks = linkStatuses.filter((link) => link.status === 'error')
  const warningLinks = linkStatuses.filter((link) => link.status === 'warn')
  const missingMetaFields = getMissingMetaFields(metaInfo)
  const formMissingLabels = Array.isArray(formInfo.missingLabels) ? formInfo.missingLabels : []
  const headingItems = createHeadingIssueItems(headingInfo)

  return [
    {
      id: 'access',
      title: '페이지 접속 가능 여부',
      status: mainResponse?.ok() ? 'ok' : 'error',
      value: mainResponse?.ok() ? '접속 가능' : '접속 실패',
      detail: mainError || 'Playwright가 입력 URL에 정상 접속했습니다.',
    },
    {
      id: 'http-status',
      title: 'HTTP 응답 상태',
      status: getHttpStatus(httpStatus),
      value: httpStatus ? String(httpStatus) : '응답 없음',
      detail: httpStatus ? `메인 문서 응답 코드 ${httpStatus}` : mainError || '응답 객체를 수집하지 못했습니다.',
    },
    {
      id: 'title',
      title: '페이지 타이틀',
      status: pageTitle ? 'ok' : 'warn',
      value: pageTitle || '타이틀 없음',
      detail: pageTitle ? '브라우저 타이틀을 수집했습니다.' : '문서 title이 비어 있습니다.',
    },
    {
      id: 'console-errors',
      title: '콘솔 에러 수집',
      status: consoleMessages.length > 0 ? 'error' : 'ok',
      value: `${consoleMessages.length}건`,
      detail: consoleMessages.length > 0 ? 'console.error 또는 pageerror가 감지되었습니다.' : '콘솔 에러가 감지되지 않았습니다.',
      items: consoleMessages,
    },
    {
      id: 'images',
      title: '이미지 로드 실패 여부',
      status: brokenImages.length > 0 ? 'error' : 'ok',
      value: `${brokenImages.length}건 실패`,
      detail: `${images.length}개 이미지 중 로드 실패 항목을 확인했습니다.`,
      items: brokenImages,
    },
    {
      id: 'links',
      title: '링크 목록 수집',
      status: links.length > 0 ? 'ok' : 'warn',
      value: `${links.length}개`,
      detail: 'a 태그 기준 href 목록을 수집했습니다.',
    },
    {
      id: 'missing-href',
      title: '링크/버튼 URL 누락 여부',
      status: missingHrefCount > 0 ? 'warn' : 'ok',
      value: `${missingHrefCount}개`,
      detail: missingHrefCount > 0 ? 'href 또는 이동 URL이 없는 a/button 요소가 있습니다.' : 'URL 누락 링크/버튼이 없습니다.',
      items: missingHrefLinks,
    },
    {
      id: 'bad-links',
      title: '404/500 계열 링크 여부',
      status: badLinks.length > 0 ? 'error' : warningLinks.length > 0 ? 'warn' : 'ok',
      value: `${badLinks.length}개 오류`,
      detail: `전체 링크 ${linkStatuses.length}개 응답 상태를 확인했습니다.`,
      items: badLinks.concat(warningLinks),
    },
    {
      id: 'interaction-count',
      title: '버튼 또는 a 태그 개수',
      status: counts.buttons + counts.anchors > 0 ? 'ok' : 'warn',
      value: `button ${counts.buttons} / a ${counts.anchors}`,
      detail: '클릭하지 않고 DOM 요소 개수만 수집했습니다.',
    },
    {
      id: 'mobile',
      title: '모바일 viewport 접속 가능 여부',
      status: mobileResult.accessible ? 'ok' : 'error',
      value: mobileResult.statusCode ? String(mobileResult.statusCode) : '응답 없음',
      detail: mobileResult.note,
    },
    {
      id: 'meta',
      title: '메타 정보 검사',
      status: missingMetaFields.length > 0 ? 'warn' : 'ok',
      value: missingMetaFields.length > 0 ? `${missingMetaFields.length}개 확인 필요` : '기본 메타 설정됨',
      detail: missingMetaFields.length > 0 ? `누락 가능성이 있는 메타 정보: ${missingMetaFields.join(', ')}` : '검색/공유용 기본 메타 정보가 확인되었습니다.',
      items: missingMetaFields.map((field) => ({ label: field, message: '메타 정보 누락 가능성 확인 필요' })),
    },
    {
      id: 'image-alt',
      title: '이미지 alt 검사',
      status: missingAltImages.length > 0 ? 'warn' : 'ok',
      value: `${missingAltImages.length}개 확인 필요`,
      detail: missingAltImages.length > 0 ? 'alt가 비어 있는 이미지가 있습니다. 장식용 이미지일 수 있으나 확인이 필요합니다.' : 'alt가 비어 있는 이미지가 감지되지 않았습니다.',
      items: missingAltImages,
    },
    {
      id: 'forms',
      title: '폼 기본 검사',
      status: formMissingLabels.length > 0 ? 'warn' : 'ok',
      value: formInfo.total > 0 ? `폼 요소 ${formInfo.total}개 / required ${formInfo.requiredCount || 0}개` : '폼 요소 없음',
      detail: formInfo.total > 0
        ? formMissingLabels.length > 0 ? 'label 또는 aria-label이 없는 입력 요소가 있어 확인이 필요합니다.' : '폼 입력 요소의 기본 라벨 정보가 확인되었습니다.'
        : 'input/select/textarea 요소가 감지되지 않았습니다.',
      items: formMissingLabels,
    },
    {
      id: 'external-links',
      title: '외부 링크 보안 속성 검사',
      status: externalBlankLinks.length > 0 ? 'warn' : 'ok',
      value: `${externalBlankLinks.length}개 확인 필요`,
      detail: externalBlankLinks.length > 0 ? '새 창으로 열리는 외부 링크 중 rel 보안 속성 확인이 필요한 항목이 있습니다.' : '새 창 외부 링크의 기본 보안 속성이 확인되었습니다.',
      items: externalBlankLinks,
    },
    {
      id: 'duplicate-ids',
      title: '중복 ID 검사',
      status: duplicateIds.length > 0 ? 'warn' : 'ok',
      value: `${duplicateIds.length}개 확인 필요`,
      detail: duplicateIds.length > 0 ? '동일한 id가 여러 번 사용된 항목이 있어 확인이 필요합니다.' : '중복 id가 감지되지 않았습니다.',
      items: duplicateIds,
    },
    {
      id: 'headings',
      title: '헤딩 구조 검사',
      status: headingItems.length > 0 ? 'warn' : 'ok',
      value: `h1 ${headingInfo.h1Count || 0}개`,
      detail: headingItems.length > 0 ? 'h1 개수 또는 h2/h3 순서에서 확인이 필요한 구조가 있습니다.' : '기본 헤딩 구조가 확인되었습니다.',
      items: headingItems,
    },
    {
      id: 'resource-size',
      title: '리소스 용량 참고 검사',
      status: largeResources.length > 0 ? 'warn' : 'ok',
      value: `${largeResources.length}개 확인 필요`,
      detail: largeResources.length > 0 ? '1MB 이상으로 추정되는 큰 리소스가 있어 로딩 속도 확인이 필요합니다.' : '1MB 이상으로 수집된 리소스가 없습니다.',
      items: largeResources,
    },
    {
      id: 'network-failures',
      title: '네트워크 실패 요청',
      status: networkIssues.length > 0 ? 'warn' : 'ok',
      value: `${networkIssues.length}건 확인 필요`,
      detail: networkIssues.length > 0 ? '일부 페이지 구성 리소스 요청이 실패하거나 오류 응답을 반환했습니다.' : '수집된 네트워크 실패 요청이 없습니다.',
      items: networkIssues,
    },
    {
      id: 'mobile-overflow',
      title: '모바일 가로 스크롤 검사',
      status: mobileResult.hasHorizontalOverflow ? 'warn' : 'ok',
      value: mobileResult.hasHorizontalOverflow ? `${mobileResult.documentWidth}px / viewport ${mobileResult.viewportWidth}px` : '가로 넘침 없음',
      detail: mobileResult.hasHorizontalOverflow ? '모바일 화면 너비보다 문서가 넓어 가로 스크롤이 생길 수 있습니다.' : '모바일 viewport 기준 가로 넘침이 감지되지 않았습니다.',
    },
    {
      id: 'unlabeled-clickables',
      title: '클릭 가능 요소 텍스트 검사',
      status: unlabeledClickables.length > 0 ? 'warn' : 'ok',
      value: `${unlabeledClickables.length}개 확인 필요`,
      detail: unlabeledClickables.length > 0 ? '텍스트나 aria-label이 없는 클릭 가능 요소가 있어 목적 확인이 필요합니다.' : '클릭 가능 요소의 텍스트 또는 접근성 라벨이 확인되었습니다.',
      items: unlabeledClickables,
    },
  ]
}

function getMissingMetaFields(metaInfo = {}) {
  return [
    ['title', metaInfo.title],
    ['meta description', metaInfo.description],
    ['canonical URL', metaInfo.canonical],
    ['og:title', metaInfo.ogTitle],
    ['og:description', metaInfo.ogDescription],
    ['og:image', metaInfo.ogImage],
  ].filter(([, value]) => !value).map(([label]) => label)
}

function createHeadingIssueItems(headingInfo = {}) {
  const items = []
  const h1Count = Number(headingInfo.h1Count || 0)
  if (h1Count === 0) items.push({ label: 'h1 없음', message: '페이지 대표 제목인 h1이 감지되지 않았습니다.' })
  if (h1Count > 1) items.push({ label: 'h1 여러 개', message: `h1이 ${h1Count}개 감지되었습니다.` })
  if (Array.isArray(headingInfo.skipped)) {
    headingInfo.skipped.forEach((heading) => {
      items.push({ ...heading, label: heading.text || `h${heading.level}`, message: '헤딩 단계가 과하게 건너뛴 것으로 보입니다.' })
    })
  }
  return items.slice(0, 30)
}

function getHttpStatus(statusCode) {
  if (!statusCode) return 'error'
  if (statusCode >= 400) return 'error'
  if (statusCode >= 300) return 'warn'
  return 'ok'
}

function getLinkStatus(statusCode) {
  if (statusCode === 404 || statusCode >= 500) return 'error'
  if (statusCode >= 400) return 'warn'
  return 'ok'
}

function getLinkNote(statusCode) {
  if (statusCode === 404) return '404 Not Found'
  if (statusCode >= 500) return '5xx 서버 오류'
  if (statusCode >= 400) return '4xx 응답 확인 필요'
  if (statusCode >= 300) return '리다이렉트 후 응답 확인 완료'
  return '정상 응답'
}

function createEmptyDomSnapshot() {
  return {
    links: [],
    buttonTargets: [],
    interactionTargets: [],
    images: [],
    designElements: [],
    webCtaHints: [],
    metaInfo: {},
    missingAltImages: [],
    formInfo: { total: 0, requiredCount: 0, missingLabels: [] },
    externalBlankLinks: [],
    duplicateIds: [],
    headingInfo: { h1Count: 0, headings: [], skipped: [] },
    largeResources: [],
    unlabeledClickables: [],
    counts: { anchors: 0, buttons: 0, missingHrefs: 0 },
  }
}

function createEmptyWebScreenshot() {
  return {
    dataUrl: '',
    mediaType: 'image/png',
    width: 0,
    height: 0,
    viewport: DESKTOP_DESIGN_VIEWPORT,
    deviceScaleFactor: DESKTOP_SCREENSHOT_SCALE,
    fullPage: true,
    capturedAt: new Date().toISOString(),
    error: '스크린샷을 수집하지 못했습니다.',
  }
}

function createWebDomSummary(snapshot = {}, pageTitle = '') {
  const designElements = Array.isArray(snapshot.designElements) ? snapshot.designElements : []
  const webCtaHints = Array.isArray(snapshot.webCtaHints) ? snapshot.webCtaHints : []
  const images = Array.isArray(snapshot.images) ? snapshot.images : []
  const headings = designElements
    .filter((item) => /^h[1-6]$/i.test(item.tag || ''))
    .map((item, index) => createDomSummaryItem(item, `heading-${index + 1}`))
    .slice(0, 30)
  const visibleTextBlocks = designElements
    .map((item, index) => createDomSummaryItem(item, `text-${index + 1}`))
    .filter((item) => item.text)
    .slice(0, 80)
  const ctas = webCtaHints.map((item, index) => createDomSummaryItem(item, `cta-${index + 1}`, { isCta: true })).slice(0, 40)
  const priceOrNumberCandidates = visibleTextBlocks.filter((item) => hasNumberLikeText(item.text)).slice(0, 40)
  const imageItems = images.map((image, index) => createDomSummaryItem({
    text: image.alt || image.src,
    tag: 'img',
    selector: image.selector,
    layerPath: image.domPath,
    section: image.section,
    y: image.y,
    positionRatio: image.boundingBox?.yRatio,
  }, `image-${index + 1}`)).slice(0, 40)

  return {
    pageTitle,
    headings,
    visibleTextBlocks,
    ctas,
    formFields: [],
    priceOrNumberCandidates,
    images: imageItems,
    sections: inferSectionsFromElements(visibleTextBlocks.concat(ctas, imageItems), 'web'),
  }
}

function createDomSummaryItem(item, id, extra = {}) {
  const yRatio = normalizeYRatio(item.yRatio ?? item.positionRatio)
  return {
    id,
    text: limitStrictText(item.text || item.label || item.alt || '', 180),
    tag: limitText(item.tag || item.kind || '', 40),
    role: normalizeSectionRole(`${item.tag || ''} ${item.role || ''} ${item.layerPath || ''} ${item.selector || ''}`),
    selector: limitText(item.selector || '', 180),
    layerPath: limitText(item.layerPath || item.domPath || '', 220),
    href: limitText(item.href || '', 180),
    sectionTitle: limitText(item.sectionName || item.section || '', 120),
    area: normalizeMockupArea(item.area || item.section || getAreaFromYRatio(yRatio)),
    yRatio,
    ...extra,
  }
}

function createMobileFallback() {
  return {
    accessible: false,
    statusCode: null,
    viewport: { width: 390, height: 844 },
    viewportWidth: 390,
    documentWidth: 390,
    hasHorizontalOverflow: false,
    note: '모바일 검사를 실행하지 못했습니다.',
  }
}

export {
  createTextQaComparisonResult,
  createStrictTextMatches,
  createFallbackPageUnderstanding,
  createSectionMapping,
}
