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
    const result = normalizeMockupAiQaResult(parsed)
    console.log('[Mockup AI QA] filtered issues:', result.issues)
    console.log('[Mockup AI QA] issues with boxes:', result.issues.map((issue) => ({ title: issue.title, figmaBox: issue.figmaBox, webBox: issue.webBox })))
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
    textMismatchHints: createTextMismatchHints(figmaTexts, webTexts),
  }
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
          { type: 'image_url', image_url: { url: payload.webScreenshotDataUrl, detail: 'auto' } },
          { type: 'image_url', image_url: { url: payload.figmaImageDataUrl, detail: 'auto' } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: 2200,
  })

  return completion.choices?.[0]?.message?.content || ''
}

function getMockupAiQaSystemPrompt() {
  return [
    '너는 웹 QA 담당자다.',
    '웹 캡처와 Figma 시안 이미지를 나란히 보고 실제 차이를 찾아라.',
    'JSON/DOM 텍스트는 참고용이다.',
    '가장 중요한 것은 실제 문구 의미 차이다.',
    '줄바꿈, 공백, 마침표, 쉼표, 띄어쓰기만 다른 경우는 무시한다.',
    '온라인견적 vs 온라인 견적, 소비자 정보포털 vs 소비자 정보 포털, 구비 서류 vs 구비서류는 무시한다.',
    'My FinCar 앱 더 알아보기 vs MY FinCar 앱 더 알아보기처럼 대소문자만 다른 경우는 무시한다.',
    '상품 vs 프로그램, 금융 상품 vs 금융 프로그램, 운용리스 vs 리스, 구매상담 바로가기 vs 프로모션 바로가기는 반드시 문구 차이로 유지한다.',
    '0~8.99%처럼 금리 또는 숫자 패턴이 다른 경우는 반드시 문구 차이로 유지한다.',
    '핵심 명사, 상품명, CTA 문구가 달라진 경우는 반드시 문구 차이로 유지한다.',
    '문구 차이는 figma와 web에 비교 가능한 원문을 넣고, 사소한 표기 차이를 제외하고 실제 확인 필요한 차이만 반환한다.',
    '문구 차이는 이미지에서 작게 보이거나 잘 보이지 않더라도 Figma/Web 텍스트 힌트에서 명확하면 반드시 반환한다.',
    '작은 본문/디스클레이머 문구는 이미지보다 텍스트 힌트를 더 신뢰한다.',
    'issues 배열은 최대 10개까지만 반환한다.',
    '각 이슈의 region은 이미지 세로 위치 기준으로 top, upper, middle, lower, bottom, unknown 중 하나를 추정한다.',
    '각 이슈마다 가능하면 figmaBox와 webBox를 0~1 비율 좌표로 반환하고, 정확한 위치를 모르면 null로 반환한다.',
    '반드시 JSON으로만 응답한다.',
  ].join('\n')
}

function createMockupAiQaPrompt(payload) {
  const hints = {
    url: payload.url,
    pageTitle: payload.pageTitle,
    figmaTexts: payload.figmaTexts,
    webTexts: payload.webTexts,
    textMismatchHints: payload.textMismatchHints,
  }

  return [
    '첨부 이미지는 순서대로 웹 fullPage screenshot, Figma 시안 이미지다.',
    'Figma JSON 텍스트와 Web DOM visible text는 아래 참고 힌트로만 사용해라.',
    'textMismatchHints는 서버가 만든 keyword mismatch 후보이며 최종 결과가 아니라 참고용이다. 이미지 또는 텍스트 힌트와 교차 확인해 실제 이슈만 반환해라.',
    '문구 차이는 이미지에서 보이지 않더라도 Figma/Web 텍스트 힌트에서 명확하면 반드시 반환해라.',
    '작은 본문/디스클레이머 문구는 이미지보다 텍스트 힌트를 더 신뢰해라.',
    '전체 페이지를 한 번 훑고 끝내지 말고 상품 vs 프로그램, 금융 상품 vs 금융 프로그램, 운용리스 vs 리스, 0~8.99% vs 다른 금리, 구매상담 바로가기 vs 프로모션 바로가기를 반드시 교차 확인해라.',
    'issues 배열은 실제 확인 필요한 차이만 10개 이하로 반환해라.',
    '각 이슈에는 대략 위치를 region으로 넣어라. 허용값은 top, upper, middle, lower, bottom, unknown 중 하나다.',
    '각 이슈마다 가능하면 figmaBox/webBox를 반환해라. box는 해당 문구가 보이는 대략적인 영역을 이미지 기준 0~1 비율 x, y, width, height로 표현한다.',
    '정확한 위치를 모르면 figmaBox 또는 webBox는 null로 반환해라.',
    '반드시 아래 JSON 형식으로만 응답해라.',
    '{"summary":{"total":0,"textDifference":0,"figmaOnly":0,"webOnly":0,"visualDifference":0},"issues":[{"type":"문구 차이 | Figma에만 있음 | Web에만 있음 | 비주얼 차이","area":"대략적인 위치","region":"top | upper | middle | lower | bottom | unknown","figma":"시안 내용","web":"웹 내용","title":"짧은 제목","figmaBox":{"x":0.0,"y":0.0,"width":0.3,"height":0.05},"webBox":{"x":0.0,"y":0.0,"width":0.3,"height":0.05}}]}',
    JSON.stringify(hints, null, 2),
  ].join('\n\n')
}

function normalizeMockupAiQaResult(result) {
  const rawIssues = Array.isArray(result.issues) ? result.issues.map((issue) => ({
    type: normalizeMockupIssueType(issue?.type),
    area: limitText(issue?.area || '위치 확인 필요', 80),
    region: normalizeMockupRegion(issue?.region),
    figma: limitText(issue?.figma || '', 300),
    web: limitText(issue?.web || '', 300),
    title: limitText(issue?.title || '확인 필요', 120),
    figmaBox: normalizeMockupBox(issue?.figmaBox),
    webBox: normalizeMockupBox(issue?.webBox),
  })) : []
  const issues = filterMinorMockupTextIssues(rawIssues).slice(0, MAX_MOCKUP_AI_ISSUES)

  const summary = normalizeMockupSummary({}, issues)
  return { summary, issues }
}

function normalizeMockupSummary(summary = {}, issues = []) {
  const fallback = issues.reduce((counts, issue) => {
    if (issue.type === '문구 차이') counts.textDifference += 1
    if (issue.type === 'Figma에만 있음') counts.figmaOnly += 1
    if (issue.type === 'Web에만 있음') counts.webOnly += 1
    if (issue.type === '비주얼 차이') counts.visualDifference += 1
    return counts
  }, { textDifference: 0, figmaOnly: 0, webOnly: 0, visualDifference: 0 })

  return {
    total: normalizeCount(summary.total, issues.length),
    textDifference: normalizeCount(summary.textDifference, fallback.textDifference),
    figmaOnly: normalizeCount(summary.figmaOnly, fallback.figmaOnly),
    webOnly: normalizeCount(summary.webOnly, fallback.webOnly),
    visualDifference: normalizeCount(summary.visualDifference, fallback.visualDifference),
  }
}

function normalizeMockupIssueType(value) {
  if (value === 'Figma에만 있음' || value === '시안에만 있음') return 'Figma에만 있음'
  if (value === 'Web에만 있음' || value === '웹에만 있음') return 'Web에만 있음'
  if (value === '비주얼 차이' || value === '이미지 확인' || value === '레이아웃 확인') return '비주얼 차이'
  if (value === '문구 차이') return '문구 차이'
  return '비주얼 차이'
}

function normalizeMockupRegion(value) {
  return ['top', 'upper', 'middle', 'lower', 'bottom', 'unknown'].includes(value) ? value : 'unknown'
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
    if (issue.type !== '문구 차이') return true
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

function normalizeCount(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.min(Math.round(number), MAX_MOCKUP_AI_ISSUES) : fallback
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
  const checks = buildChecks({
    mainResponse,
    mainError,
    pageTitle: safePageTitle,
    consoleMessages,
    images,
    links: snapshot.links,
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
    missingHrefLinks: snapshot.links.filter((link) => !link.href),
    images,
    designElements: snapshot.designElements,
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
      consoleMessages.push({
        level: 'error',
        source: message.location().url || 'inline-script',
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
      const links = Array.from(document.querySelectorAll('a')).map((anchor, index) => {
        const href = anchor.getAttribute('href')?.trim() || ''
        const url = resolveInspectableUrl(href, baseUrl)

        return {
          index: index + 1,
          label: anchor.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || anchor.getAttribute('aria-label') || `Link ${index + 1}`,
          href,
          url: isInspectableUrl(url) ? url : '',
        }
      })

      const images = Array.from(document.images).map((image, index) => ({
        index: index + 1,
        src: image.currentSrc || image.src || '',
        alt: image.alt || '',
        loaded: image.complete && image.naturalWidth > 0,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      }))

      const designElements = collectVisibleDesignElements().slice(0, maxDesignElements).map((entry, index) => ({
        index: index + 1,
        ...entry,
      }))

      return {
        links,
        images,
        designElements,
        counts: {
          anchors: links.length,
          buttons: document.querySelectorAll('button').length,
          missingHrefs: links.filter((link) => !link.href).length,
        },
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
        const documentHeight = Math.max(
          document.documentElement.scrollHeight,
          document.body?.scrollHeight || 0,
          window.innerHeight,
        ) || 1
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
  linkStatuses,
  counts,
  mobileResult,
}) {
  const httpStatus = mainResponse?.status() ?? null
  const brokenImages = images.filter((image) => image.status === 'error')
  const missingHrefCount = counts.missingHrefs
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
    },
    {
      id: 'images',
      title: '이미지 로드 실패 여부',
      status: brokenImages.length > 0 ? 'error' : 'ok',
      value: `${brokenImages.length}건 실패`,
      detail: `${images.length}개 이미지 중 로드 실패 항목을 확인했습니다.`,
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
      title: '링크 href 누락 여부',
      status: missingHrefCount > 0 ? 'warn' : 'ok',
      value: `${missingHrefCount}개`,
      detail: missingHrefCount > 0 ? 'href가 없는 a 태그가 있습니다.' : 'href 누락 링크가 없습니다.',
    },
    {
      id: 'bad-links',
      title: '404/500 계열 링크 여부',
      status: badLinks.length > 0 ? 'error' : warningLinks.length > 0 ? 'warn' : 'ok',
      value: `${badLinks.length}개 오류`,
      detail: `${linkStatuses.length}개 링크 응답 상태를 확인했습니다.`,
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
    images: [],
    designElements: [],
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
