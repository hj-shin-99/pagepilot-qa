import fs from 'node:fs'
import { classifyImageAlt } from './imageAltClassifier.js'

const IMAGE_AUDIT_TIMEOUT_MS = 6000
const IMAGE_AUDIT_NETWORK_IDLE_TIMEOUT_MS = 2500
const MAX_IMAGE_CANDIDATES = 120
const LARGE_IMAGE_TRANSFER_BYTES = 512 * 1024
const UPSCALE_TOLERANCE_RATIO = 0.75
const OVERSIZE_TOLERANCE_RATIO = 4
const DISTORTION_TOLERANCE_RATIO = 0.12

export async function auditImages(browser, targetUrl, instrumentation = null) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    serviceWorkers: 'block',
  })

  try {
    await blockMutatingRequests(context)
    const page = await context.newPage()
    incrementAuditCount(instrumentation, 'imageAuditPageCount')
    const responses = new Map()

    page.on('response', (response) => {
      const request = typeof response.request === 'function' ? response.request() : null
      const resourceType = typeof request?.resourceType === 'function' ? request.resourceType() : ''
      if (resourceType && resourceType !== 'image') return
      const headers = typeof response.headers === 'function' ? response.headers() : {}
      const url = typeof response.url === 'function' ? response.url() : ''
      if (!url) return
      responses.set(normalizeImageUrl(url), {
        statusCode: typeof response.status === 'function' ? response.status() : 0,
        contentType: headers['content-type'] || headers['Content-Type'] || '',
        contentLength: Number(headers['content-length'] || headers['Content-Length'] || 0) || null,
      })
    })

    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: IMAGE_AUDIT_TIMEOUT_MS })
      await page.waitForLoadState('networkidle', { timeout: IMAGE_AUDIT_NETWORK_IDLE_TIMEOUT_MS }).catch(() => {})
      const candidateSnapshot = await collectImageCandidates(page)
      const meaningfulCandidateCount = candidateSnapshot.items.filter((candidate) => !shouldExcludeImageCandidate(candidate)).length
      const groupedItems = normalizeImageResults(candidateSnapshot.items, responses)
      return {
        items: groupedItems,
        meta: createImageAuditMeta(groupedItems, {
          candidateCount: meaningfulCandidateCount,
        }),
      }
    } finally {
      await page.close().catch(() => {})
    }
  } finally {
    await context.close().catch(() => {})
  }
}

export async function collectImageCandidates(page) {
  const items = await page.evaluate(({ maxCandidates }) => {
    return Array.from(document.querySelectorAll('img, picture img, svg image')).slice(0, maxCandidates).map((element, index) => {
      const isSvgImage = element.tagName.toLowerCase() === 'image'
      const rect = getRect(element)
      const style = window.getComputedStyle(element)
      const img = isSvgImage ? null : element
      const rawSrc = isSvgImage
        ? resolveUrl(String(element.getAttribute('href') || element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '').trim())
        : String(img.getAttribute('src') || '').trim()
      const currentSrc = isSvgImage ? rawSrc : String(img.currentSrc || img.src || '').trim()
      const label = getAccessibleLabel(element) || (currentSrc || rawSrc ? getFileLabel(currentSrc || rawSrc) : `이미지 ${index + 1}`)
      const naturalWidth = isSvgImage ? Number(element.width?.baseVal?.value || rect.width || 0) : Number(img.naturalWidth || 0)
      const naturalHeight = isSvgImage ? Number(element.height?.baseVal?.value || rect.height || 0) : Number(img.naturalHeight || 0)
      const alt = isSvgImage ? '' : String(img.getAttribute('alt') || '')

      return {
        label,
        sourceType: isSvgImage ? 'svg-image' : 'img',
        src: rawSrc,
        currentSrc,
        srcset: isSvgImage ? '' : String(img.getAttribute('srcset') || ''),
        loading: isSvgImage ? '' : String(img.loading || img.getAttribute('loading') || ''),
        complete: isSvgImage ? true : img.complete === true,
        naturalWidth,
        naturalHeight,
        clientWidth: Number(element.clientWidth || rect.width || 0),
        clientHeight: Number(element.clientHeight || rect.height || 0),
        renderedWidth: Number(rect.width || 0),
        renderedHeight: Number(rect.height || 0),
        boundingBox: rect,
        objectFit: style.objectFit || '',
        visibility: style.visibility || '',
        display: style.display || '',
        opacity: style.opacity || '',
        visible: isVisible(element),
        offscreen: rect.right < -20 || rect.bottom < -20 || rect.left > (window.innerWidth || document.documentElement.clientWidth || 0) + 20,
        ariaHidden: element.getAttribute('aria-hidden') === 'true',
        hasAriaHiddenAncestor: Boolean(element.closest('[aria-hidden="true"]')),
        hidden: element.hasAttribute('hidden'),
        role: element.getAttribute('role') || '',
        className: typeof element.className === 'string' ? element.className : '',
        ancestorClassText: getAncestorClassText(element),
        interactiveAncestorLabel: getAccessibleLabel(element.closest('a, button, [role="button"]')),
        figureCaption: normalizeText(element.closest('figure')?.querySelector('figcaption')?.innerText || ''),
        selector: getCssSelector(element),
        section: estimateSection(rect),
        insideClosedDialog: isInsideClosedDialog(element),
        devicePixelRatio: Number(window.devicePixelRatio || 1),
        viewportWidth: window.innerWidth || document.documentElement.clientWidth || 0,
        viewportHeight: window.innerHeight || document.documentElement.clientHeight || 0,
        alt,
      }
    })

    function getRect(element) {
      const rect = element.getBoundingClientRect()
      return {
        x: Number(rect.x || 0),
        y: Number(rect.y || 0),
        width: Number(rect.width || 0),
        height: Number(rect.height || 0),
        right: Number(rect.right || 0),
        bottom: Number(rect.bottom || 0),
      }
    }

    function isVisible(element) {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0
    }

    function getAccessibleLabel(element) {
      if (!element) return ''
      return normalizeText(element.getAttribute?.('aria-label') || '')
        || normalizeText(element.getAttribute?.('title') || '')
        || normalizeText(element.innerText || element.textContent || '')
        || normalizeText(element.querySelector?.('img')?.getAttribute?.('alt') || '')
    }

    function getAncestorClassText(element) {
      const parts = []
      let current = element
      let depth = 0
      while (current && current !== document.body && depth < 6) {
        const className = typeof current.className === 'string' ? current.className : ''
        parts.push(className)
        current = current.parentElement
        depth += 1
      }
      return normalizeText(parts.join(' '))
    }

    function getCssSelector(element) {
      if (!element || !element.tagName) return ''
      if (element.id) return `#${cssEscape(element.id)}`
      const parts = []
      let current = element
      let depth = 0
      while (current && current !== document.body && depth < 4) {
        const tagName = current.tagName.toLowerCase()
        const classNames = Array.from(current.classList || []).slice(0, 2).map((className) => `.${cssEscape(className)}`).join('')
        parts.unshift(`${tagName}${classNames}`)
        current = current.parentElement
        depth += 1
      }
      return parts.join(' > ')
    }

    function isInsideClosedDialog(element) {
      const dialog = element.closest('dialog, [role="dialog"], [aria-modal="true"], .modal, .dialog')
      if (!dialog) return false
      const style = window.getComputedStyle(dialog)
      if (dialog.hasAttribute('hidden')) return true
      if (dialog.getAttribute('aria-hidden') === 'true') return true
      if (style.display === 'none' || style.visibility === 'hidden') return true
      if (dialog.tagName.toLowerCase() === 'dialog' && dialog.open !== true) return true
      return false
    }

    function estimateSection(rect) {
      const documentHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0, window.innerHeight) || 1
      const ratio = Number(rect.y || 0) / documentHeight
      if (ratio < 0.33) return 'top'
      if (ratio < 0.66) return 'middle'
      return 'bottom'
    }

    function getFileLabel(value) {
      const text = String(value || '').split('?')[0].split('#')[0]
      const parts = text.split('/')
      return parts[parts.length - 1] || text || ''
    }

    function normalizeText(value) {
      return String(value || '').replace(/\s+/g, ' ').trim()
    }

    function resolveUrl(value) {
      const text = String(value || '').trim()
      if (!text) return ''
      try {
        return new URL(text, document.baseURI).toString()
      } catch {
        return text
      }
    }

    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
      return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&')
    }
  }, { maxCandidates: MAX_IMAGE_CANDIDATES }).catch(() => [])

  const safeItems = arrayOfObjects(items).map((item) => {
    const altClassification = item.sourceType === 'svg-image'
      ? { category: 'meaningful-image', reason: 'svg-image' }
      : classifyImageAlt({
          src: item.currentSrc || item.src,
          alt: item.alt,
          role: item.role,
          ariaHidden: item.ariaHidden,
          hasAriaHiddenAncestor: item.hasAriaHiddenAncestor,
          className: item.className,
          ancestorClassText: item.ancestorClassText,
          interactiveAncestorLabel: item.interactiveAncestorLabel,
          figureCaption: item.figureCaption,
          visible: item.visible,
          naturalWidth: item.naturalWidth,
          naturalHeight: item.naturalHeight,
          boundingBox: item.boundingBox,
          viewport: { width: item.viewportWidth, height: item.viewportHeight },
        })
    return {
      ...item,
      altCategory: altClassification.category,
      altReason: altClassification.reason,
    }
  })
  return { items: safeItems, candidateCount: safeItems.length }
}

export function normalizeImageResults(candidates = [], responses = new Map()) {
  const groups = groupImageCandidates(candidates)
  return groups.map((group) => classifyImageGroup(group, responses)).filter(Boolean).sort((first, second) => getStatusRank(first.status) - getStatusRank(second.status) || String(first.label || '').localeCompare(String(second.label || '')))
}

export function createImageAuditMeta(items = [], context = {}) {
  const sourceItems = arrayOfObjects(items)
  const candidateCount = Number(context.candidateCount || sourceItems.length || 0)
  return {
    candidateCount,
    inspectedCount: sourceItems.length,
    okCount: sourceItems.filter((item) => item.status === 'ok').length,
    warningCount: sourceItems.filter((item) => item.status === 'warn').length,
    errorCount: sourceItems.filter((item) => item.status === 'error').length,
    skippedCount: sourceItems.filter((item) => item.status === 'info').length,
    noTarget: context.noTarget === true || (candidateCount === 0 && sourceItems.length === 0),
  }
}

function groupImageCandidates(candidates = []) {
  const groups = new Map()
  arrayOfObjects(candidates).forEach((candidate) => {
    if (shouldExcludeImageCandidate(candidate)) return
    const key = normalizeImageUrl(candidate.currentSrc || candidate.src) || `selector:${String(candidate.selector || '').trim()}`
    if (!key) return
    const existing = groups.get(key)
    if (existing) {
      existing.sources.push(candidate)
      existing.visibleCount += candidate.visible === true ? 1 : 0
      existing.renderedSizes.push(`${Math.round(Number(candidate.renderedWidth || 0))}x${Math.round(Number(candidate.renderedHeight || 0))}`)
      if (candidate.selector) existing.selectors.push(candidate.selector)
      return
    }
    groups.set(key, {
      key,
      label: candidate.label,
      sourceType: candidate.sourceType,
      currentSrc: candidate.currentSrc,
      src: candidate.src,
      selectors: candidate.selector ? [candidate.selector] : [],
      renderedSizes: [`${Math.round(Number(candidate.renderedWidth || 0))}x${Math.round(Number(candidate.renderedHeight || 0))}`],
      visibleCount: candidate.visible === true ? 1 : 0,
      sources: [candidate],
    })
  })
  return Array.from(groups.values())
}

function classifyImageGroup(group = {}, responses = new Map()) {
  const representative = group.sources?.find((candidate) => candidate.visible === true) || group.sources?.[0]
  if (!representative) return null
  const normalizedUrl = normalizeImageUrl(representative.currentSrc || representative.src)
  const response = normalizedUrl ? responses.get(normalizedUrl) || {} : {}
  const issues = []
  let status = 'ok'
  let owner = 'UID팀'
  const isSvg = representative.sourceType === 'svg-image' || /\.svg(?:$|[?#])|image\/svg\+xml/i.test(`${representative.currentSrc || ''} ${response.contentType || ''}`)
  const isData = String(representative.currentSrc || representative.src || '').startsWith('data:')
  const isBlob = String(representative.currentSrc || representative.src || '').startsWith('blob:')

  if (isData) {
    status = isMeaningfullyBrokenImage(representative) ? 'error' : 'info'
    issues.push(isMeaningfullyBrokenImage(representative)
      ? '표시 중인 data URL 이미지가 정상 해상도로 렌더링되지 않았습니다.'
      : 'data URL 이미지는 HTTP 헤더 확인 없이 렌더링 상태만 참고했습니다.')
  }

  if (isBlob) {
    status = 'info'
    issues.push('blob URL 이미지는 브라우저 런타임 리소스라 정적 헤더 확인을 생략했습니다.')
  }

  const statusCode = Number(response.statusCode || 0)
  if (statusCode >= 500 || statusCode === 404 || statusCode === 410) {
    status = 'error'
    owner = statusCode >= 500 ? '개발팀' : 'UID팀'
    issues.push(statusCode >= 500 ? '이미지 서버가 5xx 오류를 반환했습니다.' : '표시 중인 이미지가 404/410 응답을 반환했습니다.')
  } else if (statusCode === 401 || statusCode === 403) {
    status = status === 'error' ? 'error' : 'warn'
    issues.push('이미지 응답이 인증 또는 권한 제한으로 완전히 확인되지 않았습니다.')
  }

  if (response.contentType && !/^image\/|image\/svg\+xml/i.test(String(response.contentType || '')) && !/application\/octet-stream/i.test(String(response.contentType || ''))) {
    status = 'error'
    owner = '개발팀'
    issues.push('이미지 요청이 image MIME이 아닌 응답을 반환했습니다.')
  }

  if (isMeaningfullyBrokenImage(representative) && !isLazyOffscreenCandidate(representative)) {
    status = 'error'
    issues.push('표시 대상 이미지가 complete/natural size 기준으로 정상 로드되지 않았습니다.')
  }

  if (!isSvg && shouldWarnForAspectDistortion(representative)) {
    status = status === 'error' ? 'error' : 'warn'
    issues.push('원본 비율과 실제 렌더링 비율 차이가 커 왜곡 가능성이 있습니다.')
  }

  if (!isSvg && shouldWarnForUpscale(representative)) {
    status = status === 'error' ? 'error' : 'warn'
    issues.push('원본 해상도에 비해 크게 렌더링되어 흐릿하게 보일 수 있습니다.')
  }

  if (!isSvg && shouldWarnForOversizedSource(representative, response.contentLength)) {
    status = status === 'error' ? 'error' : 'warn'
    issues.push('표시 크기에 비해 원본 이미지가 커 전송 효율을 확인해 주세요.')
  }

  if (!response.contentType && !isData && !isBlob && status === 'ok') {
    status = 'info'
    issues.push('Content-Type을 명확히 확인하지 못했습니다.')
  }

  if (status === 'ok' && normalizedUrl && group.sources.length > 1) issues.push('동일 이미지 URL이 여러 위치에서 재사용되었습니다.')

  return {
    label: representative.label,
    title: representative.label,
    category: representative.sourceType,
    type: 'image',
    status,
    severity: status,
    note: issues[0] || '이미지 로딩 상태와 렌더링 크기를 확인했습니다.',
    issues,
    owner,
    src: representative.src,
    currentSrc: representative.currentSrc,
    loading: representative.loading,
    complete: representative.complete === true,
    naturalWidth: representative.naturalWidth,
    naturalHeight: representative.naturalHeight,
    clientWidth: representative.clientWidth,
    clientHeight: representative.clientHeight,
    renderedWidth: representative.renderedWidth,
    renderedHeight: representative.renderedHeight,
    objectFit: representative.objectFit,
    visibility: representative.visibility,
    contentType: response.contentType || '',
    contentLength: response.contentLength || null,
    statusCode: statusCode || null,
    sourceCount: group.sources.length,
    visibleCount: group.visibleCount,
    representativeSelector: group.selectors[0] || '',
    selectors: Array.from(new Set(group.selectors)).slice(0, 5),
    renderedSizeList: Array.from(new Set(group.renderedSizes)).slice(0, 5),
    section: representative.section,
    technicalTerm: 'image-rendering',
  }
}

function shouldExcludeImageCandidate(candidate = {}) {
  const classText = `${candidate.className || ''} ${candidate.ancestorClassText || ''}`
  const role = String(candidate.role || '').toLowerCase()
  if (candidate.hidden === true || candidate.ariaHidden === true || candidate.insideClosedDialog === true) return true
  if (String(candidate.display || '').toLowerCase() === 'none' || String(candidate.visibility || '').toLowerCase() === 'hidden') return true
  if (role === 'presentation' || role === 'none') return true
  if (Number(candidate.renderedWidth || 0) <= 1 && Number(candidate.renderedHeight || 0) <= 1) return true
  if (candidate.offscreen === true && isLazyOffscreenCandidate(candidate)) return true
  if (candidate.altCategory === 'excluded-image') return true
  if (candidate.altCategory === 'decorative-image' && Number(candidate.renderedWidth || 0) <= 48 && Number(candidate.renderedHeight || 0) <= 48) return true
  if (candidate.sourceType === 'svg-image' && Number(candidate.renderedWidth || 0) <= 24 && Number(candidate.renderedHeight || 0) <= 24 && /icon|sprite|logo|arrow|chevron|close|menu/i.test(classText)) return true
  if (/swiper-slide-duplicate|slick-cloned|\bclone\b/i.test(classText)) return true
  return false
}

function isMeaningfullyBrokenImage(candidate = {}) {
  if (candidate.visible !== true) return false
  if (candidate.sourceType === 'svg-image') return false
  return candidate.complete !== true || Number(candidate.naturalWidth || 0) <= 0 || Number(candidate.naturalHeight || 0) <= 0 || !(candidate.currentSrc || candidate.src)
}

function isLazyOffscreenCandidate(candidate = {}) {
  return String(candidate.loading || '').toLowerCase() === 'lazy' && candidate.offscreen === true && candidate.visible !== true
}

function shouldWarnForAspectDistortion(candidate = {}) {
  const objectFit = String(candidate.objectFit || '').toLowerCase()
  if (objectFit === 'cover' || objectFit === 'contain') return false
  const naturalWidth = Number(candidate.naturalWidth || 0)
  const naturalHeight = Number(candidate.naturalHeight || 0)
  const renderedWidth = Number(candidate.renderedWidth || 0)
  const renderedHeight = Number(candidate.renderedHeight || 0)
  if (naturalWidth <= 24 || naturalHeight <= 24 || renderedWidth <= 24 || renderedHeight <= 24) return false
  const naturalRatio = naturalWidth / naturalHeight
  const renderedRatio = renderedWidth / renderedHeight
  return Math.abs(renderedRatio - naturalRatio) / naturalRatio > DISTORTION_TOLERANCE_RATIO
}

function shouldWarnForUpscale(candidate = {}) {
  const renderedWidth = Number(candidate.renderedWidth || 0)
  const renderedHeight = Number(candidate.renderedHeight || 0)
  const naturalWidth = Number(candidate.naturalWidth || 0)
  const naturalHeight = Number(candidate.naturalHeight || 0)
  if (renderedWidth < 64 || renderedHeight < 64 || naturalWidth <= 0 || naturalHeight <= 0) return false
  const dpr = Math.max(1, Math.min(2, Number(candidate.devicePixelRatio || 1)))
  return naturalWidth < renderedWidth * dpr * UPSCALE_TOLERANCE_RATIO || naturalHeight < renderedHeight * dpr * UPSCALE_TOLERANCE_RATIO
}

function shouldWarnForOversizedSource(candidate = {}, contentLength = null) {
  const renderedWidth = Number(candidate.renderedWidth || 0)
  const renderedHeight = Number(candidate.renderedHeight || 0)
  const naturalWidth = Number(candidate.naturalWidth || 0)
  const naturalHeight = Number(candidate.naturalHeight || 0)
  if (renderedWidth < 64 || renderedHeight < 64 || naturalWidth <= 0 || naturalHeight <= 0) return false
  const dpr = Math.max(1, Math.min(2, Number(candidate.devicePixelRatio || 1)))
  const isOversized = naturalWidth > renderedWidth * dpr * OVERSIZE_TOLERANCE_RATIO && naturalHeight > renderedHeight * dpr * OVERSIZE_TOLERANCE_RATIO
  if (!isOversized) return false
  return Number(contentLength || 0) >= LARGE_IMAGE_TRANSFER_BYTES
}

function normalizeImageUrl(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.startsWith('data:') || text.startsWith('blob:')) return text
  try {
    const url = new URL(text)
    return `${url.origin.toLowerCase()}${url.pathname}${url.search}`
  } catch {
    return text
  }
}

async function blockMutatingRequests(context) {
  await context.route('**/*', async (route) => {
    const method = String(route.request().method() || '').toUpperCase()
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
}

function incrementAuditCount(instrumentation, key) {
  if (!instrumentation || typeof instrumentation !== 'object') return
  instrumentation[key] = Number(instrumentation[key] || 0) + 1
}

function getStatusRank(status) {
  if (status === 'error') return 0
  if (status === 'warn') return 1
  if (status === 'ok') return 2
  return 3
}

function arrayOfObjects(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

export const IMAGE_AUDIT_TEST_ONLY = {
  classifyImageGroup,
  createImageAuditMeta,
  normalizeImageResults,
  shouldExcludeImageCandidate,
  shouldWarnForAspectDistortion,
  shouldWarnForOversizedSource,
  shouldWarnForUpscale,
}

export function assertImageAuditSourceSafety() {
  const source = fs.readFileSync(new URL('./techImageAudit.js', import.meta.url), 'utf8')
  const implementationSource = source.split('export function assertImageAuditSourceSafety')[0]
  return !/from ['"].*visual|saveAs\(|writeFile|createWriteStream|download\.path\(/i.test(implementationSource)
}
