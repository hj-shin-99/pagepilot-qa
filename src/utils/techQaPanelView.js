import { formatDeviceList } from '../../shared/deviceProfiles.js'
import { getTechQaStatusLabel, normalizeTechQaDisplayText } from './techQa.js'
import { createTechQaExplanation } from './techQaExplanationCatalog.js'

const MARKUP_ACCESSIBILITY_PRIMARY_IDS = ['meta', 'image-alt', 'external-links']
const MARKUP_ACCESSIBILITY_DETAIL_IDS = ['meta', 'image-alt', 'external-links', 'headings', 'duplicate-ids', 'forms', 'unlabeled-clickables']

export function createTechPanelDisplayModel(result = {}, view = {}) {
  const detailRows = createTechDetailRows(view)
  const completion = createTechCompletion(result, view)

  return {
    completion,
    detailRows,
  }
}

export function createTechDetailRows(view = {}) {
  const basicRows = arrayOfObjects(view.basicCheckItems).map((item) => createDetailRowItem(item, getBasicCheckDetailId(item)))
  const linkRows = arrayOfObjects(view.links).map((item, index) => createDetailRowItem(item, getTechDetailRowId('tech-link', item, index)))
  const clickRows = createClickDetailRows(view.clickActionGroups)
  const landingRows = createLandingDetailRows(view.landingPageGroups)
  const formRows = createInteractionDetailRows(view.formInteractionGroups, 'tech-form')
  const hoverRows = createInteractionDetailRows(view.hoverInteractionGroups, 'tech-hover')
  const modalRows = createInteractionDetailRows(view.modalInteractionGroups, 'tech-modal')
  const scrollRows = createInteractionDetailRows(view.scrollInteractionGroups, 'tech-scroll')
  const responsiveRows = createInteractionDetailRows(view.responsiveLayoutGroups, 'tech-responsive')
  const downloadRows = createInteractionDetailRows(view.downloadResourceGroups, 'tech-download')
  const cookieRows = createInteractionDetailRows(view.cookieGroups, 'tech-cookie')
  const imageRows = createInteractionDetailRows(view.imageGroups, 'tech-image')
  const performanceRows = createInteractionDetailRows(view.performanceGroups, 'tech-performance')
  const seoRows = createInteractionDetailRows(view.seoGroups, 'tech-seo')
  const markupRows = createMarkupDetailRows(view.checkItems)

  return {
    basicRows,
    linkRows,
    clickRows,
    landingRows,
    formRows,
    hoverRows,
    modalRows,
    scrollRows,
    responsiveRows,
    downloadRows,
    cookieRows,
    imageRows,
    performanceRows,
    seoRows,
    markupRows,
  }
}

function createClickDetailRows(groups = {}) {
  const items = arrayOfObjects(groups.actualErrors)
    .concat(arrayOfObjects(groups.warnings), arrayOfObjects(groups.safeSkipped), arrayOfObjects(groups.uiControls), arrayOfObjects(groups.verified))

  return items.map((item, index) => {
    const rowId = getTechDetailRowId('tech-click', item, index)
    const status = getClickDetailStatus(item)
    return attachTechQaDetailViewModel({
      ...item,
      id: item.id || rowId,
      rowId,
      rowKey: rowId,
      detailTargetId: rowId,
      status,
      statusLabel: getTechQaStatusLabel({ ...item, status }),
      title: getClickDetailTitle(item),
      value: normalizeTechQaDisplayText(getClickDetailValue(item)),
      owner: 'UID팀',
      categoryLabel: 'UI',
    })
  })
}

function createLandingDetailRows(groups = {}) {
  const items = arrayOfObjects(groups.errors).concat(arrayOfObjects(groups.warnings), arrayOfObjects(groups.normals))
  return items.map((item, index) => {
    const rowId = getTechDetailRowId('tech-landing', item, index)
    return attachTechQaDetailViewModel({
      ...item,
      id: item.id || rowId,
      rowId,
      rowKey: rowId,
      detailTargetId: rowId,
      title: item.label || '랜딩 페이지',
      value: normalizeTechQaDisplayText(formatLandingResult(item)),
      statusLabel: getTechQaStatusLabel(item),
      owner: getLandingOwner(item),
      categoryLabel: 'UI',
    })
  })
}

function createInteractionDetailRows(groups = {}, prefix = 'tech-interaction') {
  const items = arrayOfObjects(groups.errors)
    .concat(arrayOfObjects(groups.warnings), arrayOfObjects(groups.normals), arrayOfObjects(groups.infos))

  return items.map((item, index) => {
    const rowId = getTechDetailRowId(prefix, item, index)
    const status = getInteractionDetailStatus(item)
    return attachTechQaDetailViewModel({
      ...item,
      id: item.id || rowId,
      rowId,
      rowKey: rowId,
      detailTargetId: rowId,
      status,
      statusLabel: getTechQaStatusLabel({ ...item, status }),
      title: getInteractionDetailTitle(item),
      value: normalizeTechQaDisplayText(getInteractionDetailValue(item)),
      owner: item.owner || 'UID팀',
      categoryLabel: 'UI',
    })
  })
}

function createMarkupDetailRows(checkItems = []) {
  return arrayOfObjects(checkItems)
    .filter((item) => {
      if (MARKUP_ACCESSIBILITY_PRIMARY_IDS.includes(item.id)) return true
      return MARKUP_ACCESSIBILITY_DETAIL_IDS.includes(item.id) && item.status !== 'ok'
    })
    .map((item) => createDetailRowItem(item, getMarkupDetailId(item)))
}

function createDetailRowItem(item = {}, rowId = '') {
  return attachTechQaDetailViewModel({
    ...item,
    rowId,
    rowKey: rowId,
    detailTargetId: rowId,
  })
}

function attachTechQaDetailViewModel(item = {}) {
  return {
    ...item,
    ...createTechQaDetailViewModel(item),
  }
}

export function createTechQaDetailViewModel(item = {}) {
  const displayStatus = item.statusLabel || getTechQaStatusLabel(item)
  const summary = normalizeTechQaDisplayText(item.value || displayStatus)
  const explanation = createTechQaExplanation(item, { displayStatus, summary })
  return {
    displayStatus,
    summary,
    ...explanation,
    finding: explanation.meaning,
    reason: explanation.classificationReason,
    impact: explanation.decisionGuide[0] || '',
    recommendation: explanation.decisionGuide[explanation.decisionGuide.length - 1] || '',
    technicalEvidence: createTechnicalEvidence(item),
  }
}

export function getDisplayPriorityOwner(item = {}, fallbackOwner = '') {
  const displayStatus = item.displayStatus || item.statusLabel || getTechQaStatusLabel(item)
  if (displayStatus === '정상' || displayStatus === '해당 없음') return '-'
  return item.owner || fallbackOwner || '-'
}

function createTechnicalEvidence(item = {}) {
  const raw = item.raw || item
  return [
    createEvidence('selector', raw.selector || item.selector || raw.representativeSelector),
    createEvidence('URL', raw.url || raw.href || item.url || item.href),
    createEvidence('final URL', raw.finalUrl || item.finalUrl),
    createEvidence('requested URL', raw.requestedUrl || raw.requestUrl || item.requestedUrl || item.requestUrl),
    createEvidence('HTTP status', raw.statusCode ?? item.statusCode),
    createEvidence('status', raw.status || item.status),
    createEvidence('category', raw.category || item.category),
    createEvidence('message', raw.message || item.message),
    createEvidence('reason', raw.reason || item.reason),
    createEvidence('note', raw.note || item.note),
    createEvidence('raw value', raw.value || item.value),
    createEvidence('text', raw.text || raw.label || raw.ariaLabel || item.text || item.label),
    createEvidence('role', raw.role || item.role),
    createEvidence('tag', raw.tagName || raw.kind || item.tagName || item.kind),
    createEvidence('href', raw.href || item.href),
    createEvidence('overlay selector', raw.overlaySelector || item.overlaySelector),
    createEvidence('hit target', raw.hitTargetSelector || item.hitTargetSelector),
    createEvidence('pointer-events', raw.pointerEvents || item.pointerEvents),
    createEvidence('click executed', raw.clickExecuted ?? item.clickExecuted),
    createEvidence('observed change', raw.observableChange ?? item.observableChange),
    createEvidence('interaction outcome', raw.interactionOutcome || item.interactionOutcome),
    createEvidence('resource URL', raw.resourceUrl || raw.requestUrl || raw.currentSrc || raw.src || item.resourceUrl || item.requestUrl || item.currentSrc || item.src),
    createEvidence('content type', raw.contentType || item.contentType),
    createEvidence('content length', raw.contentLength || item.contentLength),
    createEvidence('size bytes', raw.sizeBytes || raw.transferSize || raw.encodedBodySize || item.sizeBytes || item.transferSize || item.encodedBodySize),
    createEvidence('source', raw.source || item.source),
    createEvidence('viewport', raw.viewportState || item.viewportState || raw.type || item.type),
    createEvidence('duration ms', raw.durationMs || raw.requestDurationMs || item.durationMs || item.requestDurationMs),
  ].filter(Boolean)
}

function createEvidence(label, value) {
  if (value === undefined || value === null || value === '') return null
  return { label, value: String(value) }
}

function createTechCompletion(result = {}, view = {}) {
  const meta = createCompletionMeta(result, view)
  const steps = createCompletionSteps(result, view)
  const engine = meta.find((item) => item.label === '검사 엔진')?.value
  const environment = meta.find((item) => item.label === '검사 환경')?.value
  const method = engine ? `${engine}를 통해` : '수집된 Tech QA 결과를 기반으로'
  const environmentText = environment ? `${environment} 환경에서 ` : ''
  const scopeText = createCompletionScopeText(view.scanOptions)

  return {
    title: 'Tech QA 검사 완료',
    description: `${method} ${environmentText}${scopeText}를 완료했습니다.`,
    steps,
    meta,
  }
}

function createCompletionScopeText(scanOptions = {}) {
  return hasSelectedTechChecks(scanOptions)
    ? '페이지 기본 검사와 선택한 Tech QA 검사'
    : '페이지 기본 검사'
}

function createCompletionSteps(result = {}, view = {}) {
  const steps = []

  if (result.accessible !== undefined || Array.isArray(view.checkItems) && view.checkItems.length > 0) steps.push('페이지 기본 검사 완료')
  if (getEnvironmentLabel(result)) steps.push(`${getEnvironmentLabel(result)} 검사 완료`)
  if (hasSelectedTechChecks(view.scanOptions)) steps.push('선택한 Tech QA 검사 완료')

  return steps.length > 0 ? steps : ['Tech QA 결과 수집 완료']
}

function hasSelectedTechChecks(scanOptions = {}) {
  return Boolean(
    scanOptions.url
    || scanOptions.click
    || scanOptions.landing
    || scanOptions.form
    || scanOptions.hover
    || scanOptions.modal
    || scanOptions.markup
    || scanOptions.scroll
    || scanOptions.responsive
    || scanOptions.download
    || scanOptions.cookie
    || scanOptions.image
    || scanOptions.performance
    || scanOptions.seo
  )
}

function createCompletionMeta(result = {}, view = {}) {
  const meta = []
  const engine = resolveTechQaEngine(result, view)
  const linkCount = getLinkInspectionCount(result, view)
  const imageCount = Array.isArray(result.images) ? result.images.length : null
  const durationText = formatTechQaDuration(result.durationMs)
  const totalDurationText = formatTechQaDuration(result.totalDurationMs)

  if (engine) meta.push({ label: '검사 엔진', value: engine })
  if (linkCount !== null) meta.push({ label: '링크 검사', value: `${linkCount}개` })
  if (imageCount !== null) meta.push({ label: '이미지 검사', value: `${imageCount}개` })
  if (durationText) meta.push({ label: '처리시간', value: durationText })
  if (totalDurationText) meta.push({ label: '총 검사 시간', value: totalDurationText })

  return meta
}

function formatTechQaDuration(value) {
  const durationMs = Number(value)
  if (!Number.isFinite(durationMs) || durationMs < 0) return ''
  return `${(durationMs / 1000).toFixed(1)}초`
}

export function resolveTechQaEngine(result = {}, view = {}) {
  const explicit = [
    result.meta?.scanner,
    result.meta?.engine,
    result.scanner,
    result.engine,
  ].map((value) => String(value || '').toLowerCase())
  if (explicit.some((value) => value.includes('playwright'))) return 'Playwright'

  const runCount = getPositiveNumber(
    view.developer?.playwrightRunCount ||
    result.meta?.playwrightRuns ||
    result.meta?.playwrightRunCount ||
    result.meta?.browserLaunchCount ||
    result.meta?.webScanInvocationCount ||
    result.meta?.desktopPageCount ||
    result.meta?.mobilePageCount ||
    result.linkAudit?.playwrightRunCount ||
    result.visualPayloadData?.playwrightRunCount,
  )
  if (runCount !== null) return 'Playwright'

  if (hasTechQaScanEvidence(result, view)) return 'Playwright'
  return ''
}

function hasTechQaScanEvidence(result = {}, view = {}) {
  if (Array.isArray(result.checks) && result.checks.length > 0) return true
  if (Array.isArray(result.links) && result.links.length > 0) return true
  if (Array.isArray(result.images) && result.images.length > 0) return true
  if (Array.isArray(result.clickActions) && result.clickActions.length > 0) return true
  if (Array.isArray(result.cookieItems) && result.cookieItems.length > 0) return true
  if (Array.isArray(result.imageItems) && result.imageItems.length > 0) return true
  if (Array.isArray(result.performanceItems) && result.performanceItems.length > 0) return true
  if (Array.isArray(result.seoItems) && result.seoItems.length > 0) return true
  if (Array.isArray(result.consoleMessages) && result.consoleMessages.length > 0) return true
  if (result.mobile && typeof result.mobile === 'object') return true
  if (hasObjectKeys(result.linkAudit)) return true
  if (hasObjectKeys(result.clickActionAudit)) return true
  if (hasObjectKeys(result.consoleAudit)) return true
  if (hasObjectKeys(result.cookieAudit)) return true
  if (hasObjectKeys(result.imageAudit)) return true
  if (hasObjectKeys(result.performanceAudit)) return true
  if (hasObjectKeys(result.seoAudit)) return true
  if (Array.isArray(view.checkItems) && view.checkItems.length > 0) return true
  if (Array.isArray(view.links) && view.links.length > 0) return true
  return false
}

function hasObjectKeys(value) {
  return Boolean(value && typeof value === 'object' && Object.keys(value).length > 0)
}

function getEnvironmentLabel(result = {}) {
  if (Array.isArray(result.devices) && result.devices.length > 0) return formatDeviceList(result.devices)
  const hasDesktop = Number(result.meta?.desktopPageCount || 0) > 0 || result.accessible !== undefined || result.httpStatus !== undefined
  const hasMobile = Number(result.meta?.mobilePageCount || 0) > 0 || Boolean(result.mobile)
  if (hasDesktop && hasMobile) return 'Desktop + Mobile'
  if (hasDesktop) return 'Desktop'
  if (hasMobile) return 'Mobile'
  return ''
}

function getLinkInspectionCount(result = {}, view = {}) {
  if (view.scanOptions?.url !== true) return null
  const uniqueCount = getPositiveNumber(view.linkSummary?.uniqueRequestUrlCount || result.linkAudit?.uniqueRequestUrlCount)
  if (uniqueCount !== null) return uniqueCount
  if (Array.isArray(view.links)) return view.links.length
  if (Array.isArray(result.links)) return result.links.length
  return null
}

function getPositiveNumber(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? number : null
}

export function getBasicCheckDetailId(item = {}) {
  return `tech-basic-${normalizeRowId(item.id || item.title || 'check')}`
}

export function getMarkupDetailId(item = {}) {
  return `tech-markup-${normalizeRowId(item.id || item.title || 'check')}`
}

function getTechDetailRowId(prefix, item = {}, index = 0) {
  const identity = [
    item.id,
    item.auditId,
    item.selector,
    item.finalUrl,
    item.requestedUrl,
    item.url,
    item.href,
    item.label,
    item.title,
    item.text,
    item.category,
    index,
  ].filter((value) => value !== undefined && value !== null && value !== '').join('-')
  return `${prefix}-${normalizeRowId(identity || `row-${index}`)}`
}

function normalizeRowId(value) {
  return String(value || 'row')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function arrayOfObjects(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

function getClickDetailStatus(item = {}) {
  if (item.actionClassification === 'actual-error' || item.status === 'error') return 'error'
  if (item.actionClassification === 'actionable-warning' || item.status === 'warn') return 'warn'
  if (item.actionClassification === 'safe-click-skipped') return 'info'
  return 'ok'
}

function getClickDetailTitle(item = {}) {
  return item.label || item.text || item.ariaLabel || item.title || item.url || '클릭 요소'
}

function getClickDetailValue(item = {}) {
  if (item.actionClassification === 'actual-error') return item.reason || item.category || '실제 클릭 문제가 확인되었습니다.'
  if (item.actionClassification === 'actionable-warning') return item.reason || item.category || '자동 검사에서 동작 여부를 확정하지 못했습니다.'
  if (item.status === 'error') return item.reason || item.message || item.category || '문제가 확인되었습니다.'
  if (item.status === 'warn') return item.reason || item.message || item.category || '검토가 필요한 항목입니다.'
  return item.reason || item.note || '정상으로 확인되었습니다.'
}

function formatLandingResult(item = {}) {
  const status = getTechQaStatusLabel({
    ...item,
    status: item.status === 'error' || item.category === 'http-5xx' || item.category === 'http-4xx' || item.category === 'blank-screen'
      ? 'error'
      : item.status === 'warn' ? 'warn' : 'ok',
  })
  const parts = []
  parts.push(`${status}${item.statusCode ? ` · HTTP ${item.statusCode}` : ''}`)
  if (item.note) parts.push(item.note)
  return parts.join(' · ')
}

function getLandingOwner(item = {}) {
  if (item.category === 'http-5xx' || item.category === 'navigation-failed') return '개발팀'
  if (item.category === 'timeout' || item.category === 'restricted') return 'UID팀'
  if (item.status === 'error' && Number(item.statusCode || 0) >= 500) return '개발팀'
  return 'UID팀'
}

function getInteractionDetailStatus(item = {}) {
  if (item.status === 'info' || item.status === 'skipped') return 'info'
  if (item.status === 'error' || item.status === 'warn' || item.status === 'ok') return item.status
  return 'warn'
}

function getInteractionDetailTitle(item = {}) {
  return item.title || item.label || item.name || item.selector || item.type || '검사 항목'
}

function getInteractionDetailValue(item = {}) {
  return item.value || item.note || item.reason || item.validationMessage || item.category || '확인 결과가 기록되었습니다.'
}
