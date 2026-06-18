import express from 'express'
import { chromium, request as playwrightRequest } from 'playwright'

const PORT = Number(process.env.PORT || 3001)
const MAX_LINKS_TO_CHECK = 30
const MAX_DESIGN_ELEMENTS = 120
const DESKTOP_DESIGN_VIEWPORT = { width: 1920, height: 1080 }
const DESKTOP_SCREENSHOT_SCALE = 2
const NAVIGATION_TIMEOUT_MS = 15000
const LINK_TIMEOUT_MS = 7000

const app = express()

app.use(express.json({ limit: '32kb' }))

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

      const designElements = Array.from(document.querySelectorAll('h1,h2,h3,p,a,button,img')).slice(0, maxDesignElements).map((element, index) => {
        const rect = element.getBoundingClientRect()
        const styles = window.getComputedStyle(element)
        const text = element.tagName.toLowerCase() === 'img'
          ? element.getAttribute('alt') || element.getAttribute('aria-label') || ''
          : element.textContent?.trim().replace(/\s+/g, ' ') || element.getAttribute('aria-label') || ''

        return {
          index: index + 1,
          tag: element.tagName.toLowerCase(),
          text,
          fontFamily: styles.fontFamily,
          fontSize: styles.fontSize,
          fontWeight: styles.fontWeight,
          lineHeight: styles.lineHeight,
          color: styles.color,
          x: Math.round((rect.x + window.scrollX) * 100) / 100,
          y: Math.round((rect.y + window.scrollY) * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          href: element.tagName.toLowerCase() === 'a' ? element.href : '',
        }
      })

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
