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
  const markupRows = createMarkupDetailRows(view.checkItems)

  return {
    basicRows,
    linkRows,
    clickRows,
    landingRows,
    markupRows,
  }
}

function createClickDetailRows(groups = {}) {
  const items = arrayOfObjects(groups.actualErrors)
    .concat(arrayOfObjects(groups.warnings), arrayOfObjects(groups.safeSkipped), arrayOfObjects(groups.uiControls), arrayOfObjects(groups.verified))

  return items.map((item, index) => {
    const rowId = getTechDetailRowId('tech-click', item, index)
    const status = getClickDetailStatus(item)
    return {
      ...item,
      id: item.id || rowId,
      rowId,
      rowKey: rowId,
      detailTargetId: rowId,
      status,
      title: getClickDetailTitle(item),
      value: getClickDetailValue(item),
      owner: 'UID팀',
      categoryLabel: 'UI',
    }
  })
}

function createLandingDetailRows(groups = {}) {
  const items = arrayOfObjects(groups.errors).concat(arrayOfObjects(groups.warnings), arrayOfObjects(groups.normals))
  return items.map((item, index) => {
    const rowId = getTechDetailRowId('tech-landing', item, index)
    return {
      ...item,
      id: item.id || rowId,
      rowId,
      rowKey: rowId,
      detailTargetId: rowId,
      title: item.label || '랜딩 페이지',
      value: formatLandingResult(item),
      owner: getLandingOwner(item),
      categoryLabel: 'UI',
    }
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
  return {
    ...item,
    rowId,
    rowKey: rowId,
    detailTargetId: rowId,
  }
}

function createTechCompletion(result = {}, view = {}) {
  const meta = createCompletionMeta(result, view)
  const steps = createCompletionSteps(result, view)
  const engine = meta.find((item) => item.label === '검사 엔진')?.value
  const environment = meta.find((item) => item.label === '검사 환경')?.value
  const method = engine ? `${engine}를 통해` : '수집된 Tech QA 결과를 기반으로'
  const environmentText = environment ? `${environment} 환경, ` : ''

  return {
    title: 'Tech QA 검사 완료',
    description: `${method} 페이지 접속, ${environmentText}링크·이미지·마크업 및 클릭 동작 검사를 완료했습니다.`,
    steps,
    meta,
  }
}

function createCompletionSteps(result = {}, view = {}) {
  const steps = []
  const checks = Array.isArray(view.checkItems) ? view.checkItems : []
  const hasCheck = (id) => checks.some((item) => item.id === id)

  if (result.accessible !== undefined || hasCheck('access') || checks.length > 0) steps.push('페이지 및 DOM 수집 완료')
  if (getEnvironmentLabel(result)) steps.push(`${getEnvironmentLabel(result)} 검사 완료`)
  if (hasLinks(result, view) || hasImages(result)) steps.push('링크 및 리소스 검사 완료')
  if (hasCheck('click-actions') || hasMarkupChecks(checks)) steps.push('클릭 및 마크업 검사 완료')

  return steps.length > 0 ? steps : ['Tech QA 결과 수집 완료']
}

function createCompletionMeta(result = {}, view = {}) {
  const meta = []
  const engine = resolveTechQaEngine(result, view)
  const environment = getEnvironmentLabel(result)
  const linkCount = getLinkInspectionCount(result, view)
  const imageCount = Array.isArray(result.images) ? result.images.length : null

  if (engine) meta.push({ label: '검사 엔진', value: engine })
  if (environment) meta.push({ label: '검사 환경', value: environment })
  if (linkCount !== null) meta.push({ label: '링크 검사', value: `${linkCount}개` })
  if (imageCount !== null) meta.push({ label: '이미지 검사', value: `${imageCount}개` })

  return meta
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
  if (Array.isArray(result.consoleMessages) && result.consoleMessages.length > 0) return true
  if (result.mobile && typeof result.mobile === 'object') return true
  if (hasObjectKeys(result.linkAudit)) return true
  if (hasObjectKeys(result.clickActionAudit)) return true
  if (hasObjectKeys(result.consoleAudit)) return true
  if (Array.isArray(view.checkItems) && view.checkItems.length > 0) return true
  if (Array.isArray(view.links) && view.links.length > 0) return true
  return false
}

function hasObjectKeys(value) {
  return Boolean(value && typeof value === 'object' && Object.keys(value).length > 0)
}

function getEnvironmentLabel(result = {}) {
  const hasDesktop = Number(result.meta?.desktopPageCount || 0) > 0 || result.accessible !== undefined || result.httpStatus !== undefined
  const hasMobile = Number(result.meta?.mobilePageCount || 0) > 0 || Boolean(result.mobile)
  if (hasDesktop && hasMobile) return 'Desktop + Mobile'
  if (hasDesktop) return 'Desktop'
  if (hasMobile) return 'Mobile'
  return ''
}

function getLinkInspectionCount(result = {}, view = {}) {
  const uniqueCount = getPositiveNumber(view.linkSummary?.uniqueRequestUrlCount || result.linkAudit?.uniqueRequestUrlCount)
  if (uniqueCount !== null) return uniqueCount
  if (Array.isArray(view.links)) return view.links.length
  if (Array.isArray(result.links)) return result.links.length
  return null
}

function hasLinks(result = {}, view = {}) {
  return Array.isArray(result.links) || Array.isArray(view.links) || Boolean(result.linkAudit)
}

function hasImages(result = {}) {
  return Array.isArray(result.images)
}

function hasMarkupChecks(checks = []) {
  return checks.some((item) => ['meta', 'image-alt', 'external-links', 'headings', 'duplicate-ids', 'forms', 'unlabeled-clickables'].includes(item.id))
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
  if (item.actionClassification === 'actual-error') return item.reason || item.category || '실제 클릭 오류가 확인되었습니다.'
  if (item.actionClassification === 'actionable-warning') return item.reason || item.category || '자동 검사에서 동작 여부를 확정하지 못했습니다.'
  if (item.status === 'error') return item.reason || item.message || item.category || '오류가 확인되었습니다.'
  if (item.status === 'warn') return item.reason || item.message || item.category || '확인이 필요한 항목입니다.'
  return item.reason || item.note || '정상으로 확인되었습니다.'
}

function formatLandingResult(item = {}) {
  const status = item.status === 'error' || item.category === 'http-5xx' || item.category === 'http-4xx' || item.category === 'blank-screen'
    ? '오류'
    : item.status === 'warn' ? '확인 필요' : '정상'
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
