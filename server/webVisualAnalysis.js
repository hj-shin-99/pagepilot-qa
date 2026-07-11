import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { inferWebTextRole } from './webText.js'

const MAX_CTA_CANDIDATES = 20
const MAX_IMAGE_CANDIDATES = 20
const MAX_VIDEO_CANDIDATES = 10
const MAX_SECTION_CANDIDATES = 20

export function createWebVisualAnalysis(scanResult, options = {}) {
  const safeScanResult = scanResult && typeof scanResult === 'object' ? scanResult : {}
  const visualPayloadData = safeScanResult.visualPayloadData && typeof safeScanResult.visualPayloadData === 'object'
    ? safeScanResult.visualPayloadData
    : {}
  const saveScreenshot = options.saveScreenshot || saveWebScreenshotFromScanResult
  const screenshot = saveScreenshot(safeScanResult.webScreenshot, {
    targetUrl: safeScanResult.targetUrl,
    cacheDir: options.screenshotCacheDir,
  })
  const textNodes = normalizeWebTextNodes(visualPayloadData.textNodes)
  const ctaCandidates = createWebCtaCandidates(safeScanResult.webCtaHints)
  const imageCandidates = createWebImageCandidates(safeScanResult.images)
  const videoCandidates = createWebVideoCandidates(visualPayloadData.videoCandidates)
  const sectionCandidates = createSectionCandidates({
    textNodes,
    ctaCandidates,
    imageCandidates,
    videoCandidates,
  })
  const viewport = safeScanResult.webScreenshot?.viewport || {}
  const pageMetrics = normalizePageMetrics(visualPayloadData.page, viewport)

  return {
    url: normalizeString(safeScanResult.targetUrl),
    title: normalizeString(safeScanResult.pageTitle),
    screenshot,
    page: pageMetrics,
    textNodes,
    designElements: Array.isArray(safeScanResult.designElements) ? safeScanResult.designElements : [],
    ctaCandidates,
    imageCandidates,
    videoCandidates,
    sectionCandidates,
    scanResult: safeScanResult,
    meta: {
      playwrightRunCount: normalizeCount(visualPayloadData.playwrightRunCount, 1),
      screenshotCreated: screenshot.created === true,
      screenshotPath: screenshot.path,
    },
  }
}

export function saveWebScreenshotFromScanResult(webScreenshot, options = {}) {
  const dataUrl = typeof webScreenshot?.dataUrl === 'string' ? webScreenshot.dataUrl.trim() : ''
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    return createEmptyScreenshotResult(webScreenshot, '스크린샷 데이터가 없습니다.')
  }

  try {
    const buffer = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
    if (buffer.length === 0) {
      return createEmptyScreenshotResult(webScreenshot, '스크린샷 데이터가 비어 있습니다.')
    }

    const cacheDir = options.cacheDir || getVisualScreenshotCacheDir()
    ensureDirectory(cacheDir)

    const fileId = createHash('sha1').update(buffer).digest('hex').slice(0, 24)
    const fileName = `${fileId}.png`
    const filePath = path.join(cacheDir, fileName)
    const created = !fs.existsSync(filePath)
    if (created) {
      fs.writeFileSync(filePath, buffer)
    }

    return {
      path: path.posix.join('.cache', 'visual', 'screenshots', fileName),
      width: normalizeCount(webScreenshot?.width, 0),
      height: normalizeCount(webScreenshot?.height, 0),
      mimeType: 'image/png',
      created,
      sizeBytes: buffer.length,
      capturedAt: normalizeString(webScreenshot?.capturedAt),
      error: '',
    }
  } catch (error) {
    return createEmptyScreenshotResult(webScreenshot, error instanceof Error ? error.message : '스크린샷 저장 실패')
  }
}

function createWebCtaCandidates(webCtaHints) {
  const hints = Array.isArray(webCtaHints) ? webCtaHints : []
  return hints
    .map((hint) => {
      const reasons = []
      if (hint?.selector && /(button|btn|cta|role=button|\ba\b)/i.test(String(hint.selector))) reasons.push('interactive selector')
      if (normalizeString(hint?.href)) reasons.push('has href')
      if (normalizeString(hint?.area) === 'top') reasons.push('top section')
      if (hint?.visible !== false) reasons.push('visible')

      return {
        type: 'cta',
        source: 'web',
        sourceId: truncateText(hint?.selector || hint?.href || hint?.text, 180),
        text: truncateText(hint?.text, 120),
        href: normalizeString(hint?.href),
        selector: truncateText(hint?.selector, 180),
        context: truncateText(hint?.selector, 180),
        parentContext: '',
        section: normalizeString(hint?.area) || 'unknown',
        confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
        reasons,
        y: normalizeNumber(hint?.y),
        yRatio: normalizeAreaToRatio(hint?.area),
        visible: hint?.visible !== false,
      }
    })
    .filter((item) => item.text)
    .slice(0, MAX_CTA_CANDIDATES)
}

function createWebImageCandidates(images) {
  const safeImages = Array.isArray(images) ? images : []
  return safeImages
    .map((image) => {
      const reasons = ['img element']
      if (image?.loaded) reasons.push('loaded successfully')
      if (normalizeString(image?.alt)) reasons.push('has alt text')
      if (normalizeString(image?.section) === 'top') reasons.push('top section')

      return {
        type: 'image',
        source: 'web',
        sourceId: truncateText(image?.selector || image?.src || image?.alt, 180),
        text: truncateText(image?.alt, 120),
        selector: truncateText(image?.selector, 180),
        context: truncateText(image?.domPath || image?.selector, 180),
        parentContext: '',
        section: normalizeString(image?.section) || 'unknown',
        confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
        reasons,
        width: normalizeNumber(image?.naturalWidth),
        height: normalizeNumber(image?.naturalHeight),
        yRatio: normalizeBoundingBoxYRatio(image?.boundingBox),
        visible: image?.loaded === true,
      }
    })
    .slice(0, MAX_IMAGE_CANDIDATES)
}

function createWebVideoCandidates(videoCandidates) {
  const safeCandidates = Array.isArray(videoCandidates) ? videoCandidates : []
  return safeCandidates
    .map((candidate) => {
      const reasons = []
      if (normalizeString(candidate?.tagName)) reasons.push(`${candidate.tagName} element`)
      if (candidate?.autoplay === true) reasons.push('autoplay enabled')
      if (candidate?.controls === true) reasons.push('controls enabled')
      if (normalizeString(candidate?.section) === 'top') reasons.push('top section')

      return {
        type: 'video',
        source: 'web',
        sourceId: truncateText(candidate?.selector || candidate?.title || candidate?.ariaLabel, 180),
        text: truncateText(candidate?.title || candidate?.ariaLabel || '', 120),
        selector: truncateText(candidate?.selector, 180),
        context: truncateText(candidate?.selector, 180),
        parentContext: '',
        section: normalizeString(candidate?.section) || 'unknown',
        confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
        reasons,
        yRatio: normalizeNumber(candidate?.yRatio),
        width: normalizeNumber(candidate?.width),
        height: normalizeNumber(candidate?.height),
        visible: true,
      }
    })
    .slice(0, MAX_VIDEO_CANDIDATES)
}

function createSectionCandidates({ textNodes, ctaCandidates, imageCandidates, videoCandidates }) {
  const sections = new Map()

  textNodes.forEach((node) => {
    const key = normalizeSectionKey(node.sectionHint)
    const entry = getOrCreateSection(sections, key)
    entry.textCount += 1
    if (node.role === 'heading') entry.headingCount += 1
    if (node.role === 'navigation') entry.navigationCount += 1
    if (node.role === 'price') entry.priceCount += 1
  })

  ctaCandidates.forEach((candidate) => {
    const entry = getOrCreateSection(sections, normalizeSectionKey(candidate.section))
    entry.ctaCount += 1
  })

  imageCandidates.forEach((candidate) => {
    const entry = getOrCreateSection(sections, normalizeSectionKey(candidate.section))
    entry.imageCount += 1
  })

  videoCandidates.forEach((candidate) => {
    const entry = getOrCreateSection(sections, normalizeSectionKey(candidate.section))
    entry.videoCount += 1
  })

  return Array.from(sections.values())
    .map((entry) => {
      const reasons = []
      if (entry.name === 'navigation' || entry.navigationCount >= 2) reasons.push('navigation-like text cluster')
      if ((entry.name === 'hero' || entry.name === 'top') && entry.headingCount > 0) reasons.push('top heading cluster')
      if (entry.ctaCount > 0) reasons.push('contains CTA candidates')
      if (entry.imageCount > 0) reasons.push('contains image candidates')
      if (entry.videoCount > 0) reasons.push('contains video candidates')

      return {
        type: 'section',
        source: 'web',
        name: entry.name,
        confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
        reasons,
        counts: {
          text: entry.textCount,
          heading: entry.headingCount,
          navigation: entry.navigationCount,
          price: entry.priceCount,
          cta: entry.ctaCount,
          image: entry.imageCount,
          video: entry.videoCount,
        },
      }
    })
    .sort((first, second) => scoreSectionCandidate(second) - scoreSectionCandidate(first))
    .slice(0, MAX_SECTION_CANDIDATES)
}

function normalizeWebTextNodes(textNodes) {
  return (Array.isArray(textNodes) ? textNodes : []).map((node) => ({
    ...node,
    role: node?.role || inferWebTextRole(node),
  }))
}

function normalizePageMetrics(page, viewport) {
  return {
    viewportWidth: normalizeCount(page?.viewportWidth, normalizeCount(viewport?.width, 0)),
    viewportHeight: normalizeCount(page?.viewportHeight, normalizeCount(viewport?.height, 0)),
    scrollWidth: normalizeCount(page?.scrollWidth, 0),
    scrollHeight: normalizeCount(page?.scrollHeight, 0),
  }
}

function getOrCreateSection(map, key) {
  const sectionKey = key || 'unknown'
  if (map.has(sectionKey)) return map.get(sectionKey)

  const entry = {
    name: sectionKey,
    textCount: 0,
    headingCount: 0,
    navigationCount: 0,
    priceCount: 0,
    ctaCount: 0,
    imageCount: 0,
    videoCount: 0,
  }
  map.set(sectionKey, entry)
  return entry
}

function scoreSectionCandidate(candidate) {
  return candidate.counts.heading * 6
    + candidate.counts.navigation * 5
    + candidate.counts.cta * 4
    + candidate.counts.image * 3
    + candidate.counts.video * 3
    + candidate.counts.text
}

function normalizeSectionKey(value) {
  const text = normalizeString(value).toLowerCase()
  if (!text) return 'unknown'
  if (text.includes('nav')) return 'navigation'
  return text
}

function createEmptyScreenshotResult(webScreenshot, error) {
  return {
    path: '',
    width: normalizeCount(webScreenshot?.width, 0),
    height: normalizeCount(webScreenshot?.height, 0),
    mimeType: 'image/png',
    created: false,
    sizeBytes: 0,
    capturedAt: normalizeString(webScreenshot?.capturedAt),
    error,
  }
}

function getVisualScreenshotCacheDir() {
  return path.resolve('.cache', 'visual', 'screenshots')
}

function ensureDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true })
  }
}

function classifyConfidence(value) {
  return ['high', 'medium', 'low'].includes(value) ? value : 'low'
}

function truncateText(value, maxLength) {
  const text = normalizeString(value).replace(/\s+/g, ' ')
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeCount(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : fallback
}

function normalizeNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeAreaToRatio(value) {
  if (value === 'top') return 0.15
  if (value === 'middle') return 0.5
  if (value === 'bottom') return 0.85
  if (value === 'navigation') return 0.05
  if (value === 'hero') return 0.12
  return null
}

function normalizeBoundingBoxYRatio(box) {
  const y = Number(box?.y)
  if (!Number.isFinite(y)) return null
  if (y < 600) return 0.12
  if (y < 1800) return 0.5
  return 0.85
}
