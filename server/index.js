import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { chromium, request as playwrightRequest } from 'playwright'

const PORT = Number(process.env.PORT || 3001)
const AI_QA_MODEL = 'gpt-5.4-mini'
const AI_QA_TIMEOUT_MS = 60000
const MAX_AI_ITEMS = 40
const MAX_AI_TEXT_ITEMS = 60
const MAX_AI_ISSUES = 20
const MAX_AI_IMAGE_DATA_URL_LENGTH = 9_000_000
const MAX_LINKS_TO_CHECK = 30
const MAX_DESIGN_ELEMENTS = 120
const DESKTOP_DESIGN_VIEWPORT = { width: 1920, height: 1080 }
const DESKTOP_SCREENSHOT_SCALE = 2
const NAVIGATION_TIMEOUT_MS = 15000
const LINK_TIMEOUT_MS = 7000

const app = express()

loadLocalEnv()

app.use(express.json({ limit: '24mb' }))

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

app.post('/api/ai-qa', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    res.status(400).json({ message: 'OpenAI API Key가 설정되지 않았습니다. .env의 OPENAI_API_KEY를 확인해주세요.', code: 'missing_api_key' })
    return
  }

  const payload = createSafeAiQaPayload(req.body)
  if (!payload.url) {
    res.status(400).json({ message: 'AI QA를 실행할 URL 정보가 없습니다.', code: 'invalid_payload' })
    return
  }

  try {
    const client = new OpenAI({ apiKey, timeout: AI_QA_TIMEOUT_MS })
    const rawText = await requestAiQa(client, payload)
    const parsed = parseAiQaJson(rawText)

    if (!parsed) {
      res.json({
        ok: false,
        parseError: true,
        message: 'AI 응답을 해석하지 못했습니다. 원문 응답을 확인해주세요.',
        rawText,
      })
      return
    }

    res.json({ ok: true, model: AI_QA_MODEL, result: normalizeAiQaResult(parsed) })
  } catch (error) {
    const mappedError = mapOpenAiError(error)
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

function createSafeAiQaPayload(body = {}) {
  return {
    pageTitle: limitText(body.pageTitle, 140),
    url: isHttpUrl(body.url) ? body.url : '',
    figma: {
      texts: normalizeAiItems(body.figma?.texts, MAX_AI_TEXT_ITEMS),
      buttons: normalizeAiItems(body.figma?.buttons, 30),
      image: normalizeAiImage(body.figma?.image),
    },
    web: {
      texts: normalizeAiItems(body.web?.texts, MAX_AI_TEXT_ITEMS),
      buttons: normalizeAiItems(body.web?.buttons, 30),
      links: normalizeAiLinks(body.web?.links),
      screenshot: normalizeAiImage(body.web?.screenshot),
    },
    localIssues: normalizeAiIssues(body.localIssues),
  }
}

function normalizeAiItems(items, limit) {
  if (!Array.isArray(items)) return []
  return items.slice(0, limit).map((item) => ({
    text: limitText(item?.text || item?.label || '', 220),
    compareText: limitText(item?.compareText || '', 220),
    sectionLabel: limitText(item?.sectionLabel || item?.sectionName || '', 80),
    qaGroupId: limitText(item?.qaGroupId || '', 80),
    href: limitText(item?.href || '', 220),
    positionRatio: normalizeRatio(item?.positionRatio),
  })).filter((item) => item.text || item.compareText)
}

function normalizeAiLinks(links) {
  if (!Array.isArray(links)) return []
  return links.slice(0, 40).map((link) => ({
    label: limitText(link?.label || '', 160),
    href: limitText(link?.href || '', 220),
    url: limitText(link?.url || '', 220),
    status: limitText(link?.status || '', 80),
  })).filter((link) => link.label || link.href || link.url)
}

function normalizeAiIssues(issues) {
  if (!Array.isArray(issues)) return []
  return issues.slice(0, MAX_AI_ISSUES).map((issue) => ({
    type: limitText(issue?.type || issue?.label || '', 80),
    area: limitText(issue?.area || issue?.sectionName || issue?.region || '', 80),
    title: limitText(issue?.title || issue?.itemTitle || issue?.text || '', 160),
    figma: limitText(issue?.figma || issue?.figmaText || '', 260),
    web: limitText(issue?.web || issue?.webText || '', 260),
    qaGroupId: limitText(issue?.qaGroupId || '', 80),
  })).filter((issue) => issue.type || issue.title)
}

function normalizeAiImage(image) {
  const dataUrl = typeof image?.dataUrl === 'string' && image.dataUrl.length <= MAX_AI_IMAGE_DATA_URL_LENGTH ? image.dataUrl : ''
  return {
    name: limitText(image?.name || '', 120),
    width: Number.isFinite(Number(image?.width)) ? Number(image.width) : null,
    height: Number.isFinite(Number(image?.height)) ? Number(image.height) : null,
    dataUrl,
    omittedReason: dataUrl ? '' : image?.dataUrl ? '이미지 데이터가 커서 AI 요청에서 제외됨' : '',
  }
}

function normalizeRatio(value) {
  if (value && typeof value === 'object') return Number.isFinite(Number(value.yRatio)) ? Number(value.yRatio) : null
  return Number.isFinite(Number(value)) ? Number(value) : null
}

async function requestAiQa(client, payload) {
  const userContent = [
    { type: 'text', text: createAiQaPrompt(payload) },
  ]

  if (payload.web.screenshot.dataUrl) {
    userContent.push({ type: 'image_url', image_url: { url: payload.web.screenshot.dataUrl, detail: 'low' } })
  }
  if (payload.figma.image.dataUrl) {
    userContent.push({ type: 'image_url', image_url: { url: payload.figma.image.dataUrl, detail: 'low' } })
  }

  const completion = await client.chat.completions.create({
    model: AI_QA_MODEL,
    messages: [
      { role: 'system', content: getAiQaSystemPrompt() },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: 2200,
  })

  return completion.choices?.[0]?.message?.content || ''
}

function getAiQaSystemPrompt() {
  return [
    '너는 웹 기획자/QA 담당자다.',
    '웹 캡처, Figma 시안, Figma JSON 요약, Playwright 추출 결과를 함께 보고 실제 운영 QA 관점에서 확인해야 할 차이만 정리한다.',
    'Figma JSON은 참고 자료이지 절대 기준이 아니다. 레이어 구조, 그룹핑, 텍스트 분리 방식, 좌표 정보가 틀릴 수 있다.',
    '판단 우선순위: 1) Web 캡처와 Figma 시안 이미지를 실제 화면 기준으로 비교 2) Playwright가 추출한 Web DOM 텍스트/버튼/링크 확인 3) Figma JSON은 시안 텍스트/버튼/영역 보조 확인 4) 로컬 규칙 기반 후보 이슈는 참고하되 그대로 믿지 말 것.',
    'JSON에 없다고 시안에 없는 것으로 단정하지 말고, JSON 좌표가 다르다고 위치 오류로 단정하지 말고, JSON 텍스트가 쪼개져 있어도 시안 이미지 기준으로 같은 문구면 동일하게 판단한다.',
    'JSON과 시안 이미지가 충돌하면 “시안 이미지 기준 확인 필요”로 표시하고, Playwright DOM과 웹 캡처가 충돌하면 “웹 렌더링 기준 확인 필요”로 표시한다.',
    '찾을 것: 문구 차이, 시안에는 있는데 웹에 없는 콘텐츠, 웹에는 있는데 시안에 없는 콘텐츠, 버튼/CTA 문구 차이, 버튼/CTA 누락, 링크 확인 필요, 주요 이미지/비주얼 차이, 눈에 띄는 레이아웃 차이, 기획자가 확인해야 할 검토 사항.',
    '무시할 것: 줄바꿈 차이, 단순 공백 차이, 마침표/쉼표 차이, 브라우저 렌더링 미세 위치 차이, 실제 차이가 작아 보이는 폰트명 차이, GNB/푸터/디스클레이머의 사소한 차이, 동일 문구 반복, 개발자용 layerPath, Vector, icon, logo, blende.',
    '로컬 규칙 기반 후보 이슈는 참고만 하고 그대로 믿지 말고 이미지와 텍스트를 함께 보고 최종 판단한다.',
    '반드시 JSON 객체만 응답한다.',
  ].join('\n')
}

function createAiQaPrompt(payload) {
  const compactPayload = {
    pageTitle: payload.pageTitle,
    url: payload.url,
    figma: {
      texts: payload.figma.texts,
      buttons: payload.figma.buttons,
      imageMeta: omitImageData(payload.figma.image),
    },
    web: {
      texts: payload.web.texts,
      buttons: payload.web.buttons,
      links: payload.web.links,
      screenshotMeta: omitImageData(payload.web.screenshot),
    },
    localRuleBasedCandidateIssues: payload.localIssues,
  }

  return [
    '아래 QA 데이터를 검토해서 실제 확인이 필요한 항목만 JSON으로 정리해줘.',
    '응답 형식:',
    '{"summary":"전체 요약","confidence":"high | medium | low","items":[{"type":"문구 차이 | 시안에만 있음 | 웹에만 있음 | 버튼/링크 확인 | 이미지 확인 | 레이아웃 확인 | 참고","area":"상단 영역 | 주요 콘텐츠 영역 | 하단 안내 영역 | 푸터/디스클레이머 | 위치 확인 필요","title":"짧은 제목","figma":"Figma 기준 내용","web":"Web 기준 내용","reason":"왜 확인이 필요한지","evidence":"근거: Web 캡처 + Figma 시안 이미지 | Web DOM 텍스트 + Figma JSON | 로컬 후보 이슈 + 이미지 확인 필요","priority":"high | medium | low"}]}',
    '이미지는 첨부 순서대로 Web 1920 캡처, Figma 시안 이미지다. 첨부가 없으면 메타 정보만 참고해라.',
    JSON.stringify(compactPayload, null, 2),
  ].join('\n\n')
}

function omitImageData(image) {
  return {
    name: image.name,
    width: image.width,
    height: image.height,
    hasImageData: Boolean(image.dataUrl),
    omittedReason: image.omittedReason,
  }
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

function normalizeAiQaResult(result) {
  const items = Array.isArray(result.items) ? result.items.slice(0, MAX_AI_ITEMS).map((item) => ({
    type: normalizeAiItemType(item?.type),
    area: normalizeAiArea(item?.area),
    title: limitText(item?.title || '확인 필요', 120),
    figma: limitText(item?.figma || '', 300),
    web: limitText(item?.web || '', 300),
    reason: limitText(item?.reason || '', 360),
    evidence: limitText(item?.evidence || item?.basis || '', 180),
    priority: normalizePriority(item?.priority),
  })) : []

  return {
    summary: limitText(result.summary || 'AI 검수 결과가 생성되었습니다.', 400),
    confidence: normalizeConfidence(result.confidence),
    items,
  }
}

function normalizeAiItemType(value) {
  const allowed = ['문구 차이', '시안에만 있음', '웹에만 있음', '버튼/링크 확인', '이미지 확인', '레이아웃 확인', '참고']
  return allowed.includes(value) ? value : '참고'
}

function normalizeAiArea(value) {
  const allowed = ['상단 영역', '주요 콘텐츠 영역', '하단 안내 영역', '푸터/디스클레이머', '위치 확인 필요']
  return allowed.includes(value) ? value : '위치 확인 필요'
}

function normalizePriority(value) {
  return ['high', 'medium', 'low'].includes(value) ? value : 'medium'
}

function normalizeConfidence(value) {
  return ['high', 'medium', 'low'].includes(value) ? value : 'medium'
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
