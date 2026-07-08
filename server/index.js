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
const MAX_MOCKUP_AI_ISSUES = 10
const MAX_CTA_HINTS = 40
const MOCKUP_AI_STATUSES = ['수정 필요', '확인 필요', '무시 가능']
const MOCKUP_AI_TYPES = ['문구', '이미지', 'CTA', '레이아웃', '섹션', '금액']
const MOCKUP_AI_AREAS = ['top', 'middle', 'bottom', 'unknown']
const MAX_TEXT_MISMATCH_HINTS = 20
const MAX_LINKS_TO_CHECK = 30
const MAX_DESIGN_ELEMENTS = 120
const DESKTOP_DESIGN_VIEWPORT = { width: 1920, height: 1080 }
const DESKTOP_SCREENSHOT_SCALE = 2
const NAVIGATION_TIMEOUT_MS = 15000
const LINK_TIMEOUT_MS = 7000

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
    console.log('[Mockup AI QA] calling OpenAI')
    const rawText = await requestMockupAiQa(client, payload)
    console.log('[Mockup AI QA] response received')

    const parsed = parseAiQaJson(rawText)
    if (!parsed) {
      console.log('[Mockup AI QA] sending response')
      res.status(502).json({ message: 'OpenAI 응답 JSON을 해석하지 못했습니다.', code: 'parse_error' })
      return
    }

    console.log('[Mockup AI QA] raw issues:', parsed.issues)
    const firstPassResult = normalizeMockupAiQaResult(parsed, payload)
    const { result: visionResult, verification } = await createVerifiedMockupAiQaResult(client, payload, firstPassResult)
    const ctaResult = createCtaComparisonResult(payload)
    const imageResult = await createImageOnlyMockupQaResult(client, payload)
    const result = createFinalMockupQaResult({ visionResult, ctaResult, imageResult, payload })
    result.verification = verification
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

app.listen(PORT, () => {
  console.log(`PagePilot QA API listening on http://127.0.0.1:${PORT}`)
})

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
    textMismatchHints: createTextMismatchHints(figmaTexts, webTexts),
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

    hints.push({
      text,
      href,
      selector: source === 'web' ? limitText(item?.selector || '', 180) : '',
      area,
      y: Number.isFinite(Number(item?.y)) ? Math.round(Number(item.y)) : null,
      visible: item?.visible !== false,
      layerPath: source === 'figma' ? limitText(item?.layerPath || '', 220) : '',
      yRatio: Number.isFinite(Number(item?.yRatio)) ? Math.max(0, Math.min(1, Number(item.yRatio))) : null,
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

async function requestMockupAiQa(client, payload) {
  const completion = await client.chat.completions.create({
    model: AI_QA_MODEL,
    messages: [
      { role: 'system', content: getMockupAiQaSystemPrompt() },
      {
        role: 'user',
        content: [
          { type: 'text', text: createMockupAiQaPrompt(payload) },
          { type: 'image_url', image_url: { url: payload.figmaImageDataUrl, detail: 'auto' } },
          { type: 'image_url', image_url: { url: payload.webScreenshotDataUrl, detail: 'auto' } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: 2200,
  })

  return completion.choices?.[0]?.message?.content || ''
}

async function createVerifiedMockupAiQaResult(client, payload, firstPassResult) {
  try {
    console.log('[Mockup AI QA] calling OpenAI verification')
    const rawText = await requestMockupAiQaVerification(client, payload, firstPassResult)
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

async function requestMockupAiQaVerification(client, payload, firstPassResult) {
  const completion = await client.chat.completions.create({
    model: AI_QA_MODEL,
    messages: [
      { role: 'system', content: getMockupAiQaVerificationSystemPrompt() },
      {
        role: 'user',
        content: [
          { type: 'text', text: createMockupAiQaVerificationPrompt(payload, firstPassResult) },
          { type: 'image_url', image_url: { url: payload.figmaImageDataUrl, detail: 'auto' } },
          { type: 'image_url', image_url: { url: payload.webScreenshotDataUrl, detail: 'auto' } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: 1800,
  })

  return completion.choices?.[0]?.message?.content || ''
}

async function createImageOnlyMockupQaResult(client, payload) {
  try {
    console.log('[Mockup AI QA] calling image-only comparison')
    const rawText = await requestMockupImageOnlyQa(client, payload)
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

async function requestMockupImageOnlyQa(client, payload) {
  const completion = await client.chat.completions.create({
    model: AI_QA_MODEL,
    messages: [
      { role: 'system', content: getMockupImageOnlySystemPrompt() },
      {
        role: 'user',
        content: [
          { type: 'text', text: createMockupImageOnlyPrompt(payload) },
          { type: 'image_url', image_url: { url: payload.figmaImageDataUrl, detail: 'auto' } },
          { type: 'image_url', image_url: { url: payload.webScreenshotDataUrl, detail: 'auto' } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: 1200,
  })

  return completion.choices?.[0]?.message?.content || ''
}

function getMockupAiQaSystemPrompt() {
  return [
    '너는 웹 QA 담당자다.',
    '첫 번째 이미지는 Figma 시안이고 두 번째 이미지는 실제 웹 캡처다.',
    '사용자가 원하는 것은 분석 보고서가 아니라 수정 요청용 QA 체크리스트다.',
    'Figma 시안 이미지와 실제 웹 캡처를 비교해 실제 운영자가 수정하거나 확인해야 할 핵심 차이만 최대 5건 작성한다.',
    '단순 줄바꿈, 미세한 자간, 폰트 렌더링 차이, 브라우저 안티앨리어싱, 공백, 마침표, 쉼표, 미세한 위치 차이, 이미지 크롭 차이는 무시한다.',
    '중요하지 않은 차이는 버린다.',
    'Figma JSON과 Web DOM 텍스트는 참고용 힌트일 뿐이며 절대 기준이 아니다.',
    'JSON에만 존재하고 Figma 시안 이미지에 보이지 않는 항목은 이슈로 만들지 않는다.',
    '각 이슈는 시안: A / 현재: B 형태로 짧게 작성한다.',
    '확실하지 않은 것은 status를 확인 필요로 표시하고 장황하게 설명하지 않는다.',
    'issues 배열은 최대 5개까지만 반환한다.',
    'status는 수정 필요, 확인 필요, 무시 가능 중 하나만 사용한다.',
    'type은 문구, 이미지, CTA, 레이아웃, 섹션, 금액 중 하나만 사용한다.',
    'area는 top, middle, bottom, unknown 중 하나만 사용한다.',
    '정확한 normalized boundingBox를 모르면 figmaBox/webBox를 절대 만들지 않는다.',
    '반드시 JSON으로만 응답한다.',
  ].join('\n')
}

function createMockupAiQaPrompt(payload) {
  const hints = {
    url: payload.url,
    pageTitle: payload.pageTitle,
    figmaTexts: payload.figmaTexts,
    webTexts: payload.webTexts,
    figmaCtaHints: payload.figmaCtaHints,
    webCtaHints: payload.webCtaHints,
    textMismatchHints: payload.textMismatchHints,
  }

  return [
    '왼쪽/첫 번째 이미지는 Figma 시안, 오른쪽/두 번째 이미지는 실제 웹 캡처입니다.',
    '당신은 웹 QA 담당자입니다. 사용자가 원하는 것은 분석 보고서가 아니라 수정 요청용 QA 체크리스트입니다.',
    'Figma 시안 이미지와 실제 웹 캡처를 비교해, 실제 운영자가 수정하거나 확인해야 할 핵심 차이만 최대 5건 작성하세요.',
    '사소한 차이는 제외하세요. 단순 줄바꿈, 자간, 폰트 렌더링, 미세한 위치 차이, 이미지 크롭 차이는 제외하세요.',
    '중요하지 않은 것은 버리세요.',
    'Figma JSON은 참고용 힌트일 뿐이며, JSON에만 존재하고 시안 이미지에 보이지 않는 항목은 이슈로 만들지 마세요.',
    'Web DOM visible text와 textMismatchHints도 참고 힌트이며, 이미지 비교 판단보다 우선하지 않습니다.',
    'CTA 버튼 차이는 figmaCtaHints와 webCtaHints의 같은 area 구성 차이를 중요하게 참고하세요.',
    '메인 Hero 이미지가 다른 장면이면 텍스트 차이와 별개로 이미지 이슈를 만드세요.',
    '각 이슈는 “시안: A / 현재: B” 형태로 짧게 작성하세요.',
    '수정 필요성이 애매하거나 확실하지 않은 것은 “확인 필요”로 표시하세요.',
    '정확한 normalized boundingBox를 모르면 figmaBox/webBox를 반환하지 마세요.',
    'issues 배열은 실제 수정/확인 필요한 핵심 차이만 5개 이하로 반환하세요.',
    '반드시 아래 JSON 형식으로만 응답해라.',
    '{"summary":{"fixNeeded":0,"checkNeeded":0,"ignored":0},"issues":[{"status":"수정 필요 | 확인 필요 | 무시 가능","priority":1,"area":"top | middle | bottom | unknown","type":"문구 | 이미지 | CTA | 레이아웃 | 섹션 | 금액","title":"메인 KV 문구가 다릅니다.","figma":"시안 값","web":"현재 값","memo":"짧은 QA 메모","confidence":0.9}],"ignoredDifferences":["줄바꿈 차이","미세한 이미지 크롭 차이"]}',
    JSON.stringify(hints, null, 2),
  ].join('\n\n')
}

function getMockupAiQaVerificationSystemPrompt() {
  return [
    '너는 웹 QA 오탐 제거 담당자다.',
    '아래 이슈 목록은 1차 AI가 찾은 QA 후보이며 사용자에게 보여주기 전에 반드시 오탐을 제거한다.',
    '문구 이슈는 figmaTextHints와 webTextHints에 동일하거나 거의 같은 문구가 있으면 제거한다.',
    '작은 글씨 또는 OCR 추정으로 만든 이슈는 제거하거나 확인 필요로 낮춘다.',
    '숫자/금액 차이는 유지한다.',
    '최종적으로 실제 수정이 필요한 핵심 이슈만 최대 5개 남긴다.',
    '반드시 JSON으로만 응답한다.',
  ].join('\n')
}

function getMockupImageOnlySystemPrompt() {
  return [
    '너는 웹 QA 이미지/비주얼 차이 전담 검토자다.',
    '첫 번째 이미지는 Figma 시안이고 두 번째 이미지는 실제 웹 캡처다.',
    '텍스트 차이는 무시하고 이미지, 배경, 영상 캡처 장면, 차량, 인물, 색감, 구도 차이만 찾는다.',
    '메인 Hero/main visual 영역은 동일한 장면이어야 한다. 차량 주행 이미지와 다른 영상 캡처/인물/다른 차량 장면은 반드시 이미지 차이로 판단한다.',
    '텍스트가 비슷하거나 같아도 배경 이미지가 명확히 다르면 이슈를 생성한다.',
    '미세한 크롭, 압축, 렌더링 차이는 무시한다.',
    '최대 3개 이슈만 JSON으로 반환한다.',
  ].join('\n')
}

function createMockupImageOnlyPrompt(payload) {
  const hints = {
    url: payload.url,
    pageTitle: payload.pageTitle,
    figmaCtaHints: payload.figmaCtaHints,
    webCtaHints: payload.webCtaHints,
  }

  return [
    '텍스트는 무시하고 이미지/비주얼 차이만 비교하세요.',
    '특히 top 영역의 메인 Hero 비주얼을 가장 먼저 확인하세요.',
    '차량, 인물, 배경, 색감, 구도, 영상 캡처 장면이 명확히 다르면 이미지 차이로 판단하세요.',
    '텍스트가 비슷하거나 같아도 배경 이미지가 다르면 이슈를 생성하세요.',
    '이미지 차이가 확실하지 않으면 이슈를 만들지 마세요.',
    '결과는 아래 JSON 형식만 사용하세요.',
    '{"issues":[{"status":"수정 필요 | 확인 필요","priority":1,"area":"top | middle | bottom | unknown","type":"이미지","title":"메인 Hero 이미지가 다릅니다.","figma":"차량 주행 이미지","web":"다른 영상 캡처/인물 또는 다른 차량 장면","memo":"메인 Hero 배경 비주얼이 시안과 현재 웹에서 서로 다릅니다.","confidence":0.9}],"ignoredDifferences":["미세한 크롭 차이"]}',
    JSON.stringify(hints, null, 2),
  ].join('\n\n')
}

function createMockupAiQaVerificationPrompt(payload, firstPassResult) {
  const verificationInput = {
    firstPassIssues: firstPassResult.issues,
    firstPassRemovedIssues: firstPassResult.removedIssues || [],
    figmaTextHints: payload.figmaTexts,
    webTextHints: payload.webTexts,
    textMismatchHints: payload.textMismatchHints,
  }

  return [
    '아래 이슈 목록은 1차 AI가 찾은 QA 후보입니다. 실제 사용자에게 보여주기 전에 오탐을 제거하세요.',
    '특히 문구 이슈는 figmaTextHints와 webTextHints에 동일하거나 거의 같은 문구가 있으면 제거하세요.',
    '작은 글씨/OCR 추정으로 만든 이슈는 제거하거나 확인 필요로 낮추세요.',
    '숫자/금액 차이는 유지하세요. 예: 47만원 vs 50만원은 유지합니다.',
    '최종적으로 실제 수정이 필요한 핵심 이슈만 최대 5개 남기세요.',
    '반드시 아래 JSON 형식으로만 응답하세요.',
    '{"issues":[{"status":"수정 필요 | 확인 필요 | 무시 가능","priority":1,"area":"top | middle | bottom | unknown","type":"문구 | 이미지 | CTA | 레이아웃 | 섹션 | 금액","title":"...","figma":"...","web":"...","memo":"...","confidence":0.9,"verification":"kept | downgraded | removed"}],"removedIssues":[{"title":"...","reason":"figma/web text hints are identical, likely OCR false positive"}]}',
    JSON.stringify(verificationInput, null, 2),
  ].join('\n\n')
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
    memo: normalizeMockupMemo(issue),
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

function createCtaComparisonResult(payload = {}) {
  try {
    const figmaHints = Array.isArray(payload.figmaCtaHints) ? payload.figmaCtaHints : []
    const webHints = Array.isArray(payload.webCtaHints) ? payload.webCtaHints : []
    if (figmaHints.length === 0 || webHints.length === 0) return { issues: [], removedIssues: [], ignoredDifferences: [], error: '' }

    const issues = MOCKUP_AI_AREAS.flatMap((area) => createCtaAreaIssues(area, figmaHints, webHints))
      .map((issue) => applyIssuePriorityRules(issue))
      .slice(0, 5)
    const summary = normalizeMockupSummary(issues, [], [])
    return { summary, counts: summary, issues, removedIssues: [], ignoredDifferences: [], error: '' }
  } catch (error) {
    console.log('[Mockup AI QA] CTA comparison failed:', error instanceof Error ? error.message : error)
    return { issues: [], removedIssues: [], ignoredDifferences: [], error: 'cta_compare_failed' }
  }
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
    status: area === 'top' ? '수정 필요' : '확인 필요',
    priority: area === 'top' ? 2 : 12,
    title: area === 'top' ? '메인 CTA 버튼 구성이 다릅니다.' : 'CTA 버튼 구성이 다릅니다.',
    figma: figmaTexts.join(' / ') || 'CTA 없음',
    web: webTexts.join(' / ') || 'CTA 없음',
    memo: createCtaIssueMemo(missingTexts, addedTexts),
    confidence: area === 'top' ? 0.95 : 0.88,
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

function createFinalMockupQaResult({ visionResult, ctaResult, imageResult, payload }) {
  const visionIssues = Array.isArray(visionResult?.issues) ? visionResult.issues : []
  const ctaIssues = Array.isArray(ctaResult?.issues) ? ctaResult.issues : []
  const imageIssues = Array.isArray(imageResult?.issues) ? imageResult.issues : []
  const mergedIssues = mergeMockupIssues({ visionIssues, ctaIssues, imageIssues })
  const ignoredDifferences = normalizeIgnoredDifferences([
    ...(visionResult?.ignoredDifferences || []),
    ...(ctaResult?.ignoredDifferences || []),
    ...(imageResult?.ignoredDifferences || []),
  ])
  const removedIssues = normalizeRemovedIssues([
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
      visionIssues: visionIssues.length,
      ctaIssues: ctaIssues.length,
      imageIssues: imageIssues.length,
      finalIssues: mergedIssues.length,
      ctaError: ctaResult?.error || '',
      imageError: imageResult?.error || '',
    },
  }
}

function mergeMockupIssues({ visionIssues, ctaIssues, imageIssues }) {
  const selected = []
  const allIssues = [
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
    if (first.type === '이미지' && /hero|히어로|메인|kv/i.test(getIssueSearchText(first) + getIssueSearchText(second))) return true
  }

  const firstText = normalizeComparableQaText(`${first.title} ${first.figma} ${first.web}`)
  const secondText = normalizeComparableQaText(`${second.title} ${second.figma} ${second.web}`)
  if (!firstText || !secondText) return false
  return getQaTextSimilarity(firstText, secondText) >= 0.82
}

function choosePreferredMockupIssue(first, second) {
  if (first.type === 'CTA' || second.type === 'CTA') return first.mergeSource === 'cta' ? first : second
  if (first.type === '이미지' || second.type === '이미지') return first.mergeSource === 'image' ? first : second
  if (getFinalIssueRank(second) < getFinalIssueRank(first)) return second
  return Number(second.confidence || 0) > Number(first.confidence || 0) ? second : first
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
  if (issue.area === 'top' && (issue.type === '문구' || issue.type === '이미지' || /hero|히어로|메인|kv/i.test(text))) return 0
  if (issue.type === 'CTA') return 1
  if (issue.type === '금액' || /가격|금액|월\s*납입|월납입|만원|프로모션|조건/i.test(text)) return 2
  if (issue.type === '섹션' || /섹션|누락|추가/i.test(text)) return 3
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
  return '레이아웃'
}

function normalizeMockupArea(value) {
  if (MOCKUP_AI_AREAS.includes(value)) return value
  if (value === 'upper') return 'top'
  if (value === 'lower') return 'bottom'
  return limitText(value || 'unknown', 60)
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
      removedIssues.push({ title: issue.title, reason: '2차 AI 검증에서 오탐 후보로 제거했습니다.' })
      return
    }

    if (!isTextOrMoneyIssue(issue)) {
      keptIssues.push(applyIssuePriorityRules(issue))
      return
    }

    const hasNumberDifference = hasMeaningfulNumberDifference(issue.figma, issue.web)
    const normalizedFigma = normalizeComparableQaText(issue.figma)
    const normalizedWeb = normalizeComparableQaText(issue.web)

    if (!hasNumberDifference && normalizedFigma && normalizedFigma === normalizedWeb) {
      removedIssues.push({ title: issue.title, reason: '시안/현재 문구가 정규화 기준으로 동일해 OCR 오탐으로 판단했습니다.' })
      return
    }

    if (issue.type === '문구' && !hasNumberDifference) {
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

function applyIssuePriorityRules(issue) {
  const text = getIssueSearchText(issue)
  const isHighPriority = hasHighPrioritySignal(issue, text)
  const isLowPriority = hasLowPrioritySignal(text) && !isHighPriority

  if (!isLowPriority) {
    return { ...issue, priorityLevel: isHighPriority ? 'high' : 'normal' }
  }

  const downgradedStatus = issue.status === '수정 필요' ? '확인 필요' : issue.status
  return {
    ...issue,
    status: Number(issue.confidence) < 0.65 ? '무시 가능' : downgradedStatus,
    priorityLevel: 'low',
    memo: `${issue.memo || ''} Footer/legal/안내성 정보로 판단되어 낮은 우선순위로 분류했습니다.`.trim(),
  }
}

function getIssueSearchText(issue) {
  return `${issue?.area || ''} ${issue?.type || ''} ${issue?.title || ''} ${issue?.figma || ''} ${issue?.web || ''} ${issue?.memo || ''}`.toLowerCase()
}

function hasHighPrioritySignal(issue, text) {
  if (issue?.area === 'top' && /(메인|kv|hero|히어로|배너|프로모션|혜택|가격|금액|월\s*납입|월납입|만원|cta|버튼|신청|예약|구매|상담)/i.test(text)) return true
  if (issue?.type === 'CTA' || issue?.type === '금액') return true
  return /(메인\s*kv|kv|hero|히어로|cta|버튼|누락|개수|가격|금액|할인율|월\s*납입|월납입|만원|프로모션|혜택|구매\s*혜택|주요\s*섹션|섹션\s*누락)/i.test(text)
}

function hasLowPrioritySignal(text) {
  return /(사업자등록번호|상호명|대표자|고객센터|기준금리|공시|약관|주소|전화|팩스|copyright|footer|법률|유의사항|디스클레이머|disclaimer|legal)/i.test(text)
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
    ['구매상담', '프로모션'],
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

async function scanUrl(targetUrl) {
  const browser = await chromium.launch({ headless: true })
  const consoleMessages = []
  const failedImageRequests = new Map()
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
    attachCollectors(page, consoleMessages, failedImageRequests)

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
  const linksToCheck = snapshot.links.filter((link) => link.url).slice(0, MAX_LINKS_TO_CHECK)
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
    uncheckedLinkCount: Math.max(snapshot.links.filter((link) => link.url).length - MAX_LINKS_TO_CHECK, 0),
    missingHrefLinks,
    images,
    designElements: snapshot.designElements,
    webCtaHints: snapshot.webCtaHints || [],
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

function attachCollectors(page, consoleMessages, failedImageRequests) {
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
    if (request.resourceType() === 'image') {
      failedImageRequests.set(request.url(), request.failure()?.errorText || 'image request failed')
    }
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

      return {
        links,
        buttonTargets,
        interactionTargets: links.concat(buttonTargets),
        images,
        designElements,
        webCtaHints,
        counts: {
          anchors: links.length,
          buttons: buttonTargets.length,
          missingHrefs: links.concat(buttonTargets).filter((target) => !target.href).length,
        },
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
    return {
      accessible: Boolean(response && response.ok()),
      statusCode: response?.status() ?? null,
      viewport: { width: 390, height: 844 },
      note: response?.ok() ? '모바일 viewport 접속 가능' : '모바일 viewport 응답 확인 필요',
    }
  } catch (error) {
    return {
      accessible: false,
      statusCode: null,
      viewport: { width: 390, height: 844 },
      note: error instanceof Error ? error.message : '모바일 viewport 접속 실패',
    }
  } finally {
    await context.close()
  }
}

async function checkLinkStatuses(links) {
  const api = await playwrightRequest.newContext({ ignoreHTTPSErrors: true })

  try {
    return await mapWithLimit(links, 5, async (link) => {
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
}) {
  const httpStatus = mainResponse?.status() ?? null
  const brokenImages = images.filter((image) => image.status === 'error')
  const missingHrefCount = missingHrefLinks.length
  const badLinks = linkStatuses.filter((link) => link.status === 'error')
  const warningLinks = linkStatuses.filter((link) => link.status === 'warn')

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
      detail: `${linkStatuses.length}개 링크 응답 상태를 확인했습니다.`,
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
  ]
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

function createMobileFallback() {
  return {
    accessible: false,
    statusCode: null,
    viewport: { width: 390, height: 844 },
    note: '모바일 검사를 실행하지 못했습니다.',
  }
}
