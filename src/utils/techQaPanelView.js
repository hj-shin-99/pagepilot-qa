import { formatDeviceList } from '../../shared/deviceProfiles.js'
import { getTechQaStatusLabel, normalizeTechQaDisplayText } from './techQa.js'

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
  return {
    displayStatus,
    summary,
    finding: createFinding(item, displayStatus, summary),
    reason: createReason(item, displayStatus),
    impact: createImpact(item, displayStatus),
    verifySteps: createVerifySteps(item, displayStatus),
    recommendation: createRecommendation(item, displayStatus),
    technicalEvidence: createTechnicalEvidence(item),
  }
}

function createFinding(item = {}, displayStatus = '', summary = '') {
  const raw = item.raw || item
  const statusCode = getStatusCode(item)
  if (displayStatus === '정상') return '현재 검사 조건에서 정상 응답 또는 기대 신호를 확인했습니다.'
  if (displayStatus === '해당 없음') return createNotApplicableFinding(item)
  if (displayStatus === '검사 불가') return `${createUnavailableCause(item)} 신호로 인해 해당 항목을 완료하지 못했습니다.`
  if (statusCode >= 400) return `요청한 URL이 HTTP ${statusCode} 상태를 반환했습니다.`
  if (isHashHref(raw)) return '링크 대상이 임시 값인 #으로 설정되어 있습니다.'
  if (raw.category === 'missing-navigation-url' || item.id === 'missing-href') return '클릭 가능한 요소에서 이동 URL 또는 action 근거가 충분히 확인되지 않았습니다.'
  if (item.id === 'resource-size') return summary ? `자동 검사에서 ${summary} 항목을 확인했습니다.` : '자동 검사에서 기준 초과 리소스를 확인했습니다.'
  if (raw.message) return `자동 검사에서 ${limitSentence(raw.message)} 신호를 확인했습니다.`
  if (raw.reason || raw.note) return limitSentence(raw.reason || raw.note)
  if (summary) return `자동 검사에서 ${summary} 결과를 확인했습니다.`
  return '자동 검사에서 확인이 필요한 신호를 수집했습니다.'
}

function createReason(item = {}, displayStatus = '') {
  const raw = item.raw || item
  const statusCode = getStatusCode(item)
  if (displayStatus === '정상') return '현재 검사 조건에서는 실패 신호가 수집되지 않았습니다.'
  if (displayStatus === '해당 없음') return createNotApplicableReason(item)
  if (displayStatus === '검사 불가') return `${createUnavailableCause(item)} 관련 기존 신호가 수집되었습니다.`
  if (statusCode) return `자동 요청 결과 status ${statusCode}가 확인되었습니다.`
  if (isHashHref(raw)) return 'HTML href 값이 #으로 확인되어 의도된 UI 제어인지 자동 검사만으로 확정할 수 없어 직접 확인이 필요합니다.'
  if (raw.selector) return `수집된 selector 기준으로 ${displayStatus} 신호가 확인되었습니다.`
  if (raw.category) return `자동 검사 분류값 ${raw.category}를 기준으로 판단했습니다.`
  if (displayStatus === '검토 필요') return '자동 검사만으로 의도한 동작 여부를 확정할 수 없어 직접 확인이 필요합니다.'
  return '자동 검사에서 객관적인 실패 신호가 확인되었습니다.'
}

function createImpact(item = {}, displayStatus = '') {
  const raw = item.raw || item
  const statusCode = getStatusCode(item)
  if (displayStatus === '정상') return '현재 검사 조건에서는 직접적인 사용자 영향이 확인되지 않았습니다.'
  if (displayStatus === '해당 없음') return '현재 페이지 또는 선택한 검사 범위에서는 직접적인 영향이 확인되지 않았습니다.'
  if (displayStatus === '검사 불가') return '검사가 완료되지 않아 실제 사용자 영향 여부를 판단할 수 없습니다.'
  if (statusCode === 404) return '사용자가 해당 링크를 열면 페이지를 찾을 수 없을 수 있습니다.'
  if (statusCode >= 500) return '사용자가 해당 링크를 열 때 서버 오류 화면을 볼 수 있습니다.'
  if (isHashHref(raw)) return '의도된 UI 제어일 수도 있어 자동 검사만으로 오류를 확정할 수 없습니다.'
  if (item.id === 'image-alt') return '대체 텍스트가 필요한 이미지라면 접근성 또는 검색 이해도에 영향이 있을 수 있습니다.'
  if (item.id === 'meta' || item.id === 'seo-readiness') return '검색 노출 또는 공유 미리보기 품질에 영향이 있을 수 있습니다.'
  if (item.id === 'forms' || item.id === 'form-interaction') return '사용자가 입력 또는 제출 과정에서 혼란을 겪을 수 있습니다.'
  if (item.id === 'console-errors' || item.id === 'network-failures') return '페이지 기능 동작 또는 일부 콘텐츠 로딩에 영향이 있을 수 있습니다.'
  return '직접적인 영향은 자동 검사에서 확인되지 않았습니다.'
}

function createVerifySteps(item = {}, displayStatus = '') {
  const raw = item.raw || item
  if (displayStatus === '정상') return ['필요 시 동일 조건에서 페이지를 열어 현재 결과가 유지되는지 확인합니다.']
  if (displayStatus === '해당 없음') return ['현재 페이지에 해당 검사 대상이 필요한지 확인합니다.']
  if (displayStatus === '검사 불가') return ['페이지 접근 조건을 확인합니다.', '로그인, 권한 또는 네트워크 상태를 확인한 뒤 다시 검사합니다.']
  if (hasUrl(item)) return ['표시된 URL을 새 탭에서 엽니다.', '정상 페이지가 표시되는지 확인합니다.']
  if (isClickableItem(item)) return ['해당 요소를 브라우저에서 클릭합니다.', '모달, 아코디언, 이동 또는 화면 변화가 의도대로 발생하는지 확인합니다.']
  if (raw.selector) return ['대상 페이지를 브라우저에서 엽니다.', '표시된 요소 또는 같은 위치의 UI를 확인합니다.', '자동 검사 결과와 실제 화면 상태가 일치하는지 확인합니다.']
  return ['대상 페이지를 브라우저에서 엽니다.', '검사 항목과 관련된 화면 상태를 직접 확인합니다.']
}

function createRecommendation(item = {}, displayStatus = '') {
  const raw = item.raw || item
  const statusCode = getStatusCode(item)
  if (displayStatus === '정상') return '추가 조치는 필요하지 않습니다. 단, 배포 후 동일 조건에서 재확인할 수 있습니다.'
  if (displayStatus === '해당 없음') return '현재 페이지에서 해당 기능이나 요소가 필요 없다면 조치하지 않아도 됩니다.'
  if (displayStatus === '검사 불가') return '접근 조건 또는 네트워크 상태를 해소한 뒤 다시 검사하세요.'
  if (statusCode >= 400) return '링크 주소 또는 대상 페이지의 배포 상태를 확인하세요.'
  if (isHashHref(raw)) return '정상 UI 제어라면 수정이 필요하지 않습니다. 화면 변화가 없다면 링크 또는 클릭 이벤트를 확인하세요.'
  if (displayStatus === '검토 필요') return `${item.owner || '담당 팀'}에서 의도된 동작인지 확인해 주세요.`
  return `${item.owner || '담당 팀'}에서 확인된 신호와 실제 화면 상태를 확인해 주세요.`
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
    createEvidence('source', raw.source || item.source),
    createEvidence('viewport', raw.viewportState || item.viewportState || raw.type || item.type),
    createEvidence('duration ms', raw.durationMs || raw.requestDurationMs || item.durationMs || item.requestDurationMs),
  ].filter(Boolean)
}

function createEvidence(label, value) {
  if (value === undefined || value === null || value === '') return null
  return { label, value: String(value) }
}

function createNotApplicableFinding(item = {}) {
  if (item.raw?.meta?.noTarget || item.meta?.noTarget) return '현재 페이지에서 이 검사 대상 요소가 확인되지 않았습니다.'
  if (item.status === 'info' || item.status === 'skipped') return '현재 항목은 자동 검사 대상에서 제외되었거나 별도 조치 대상이 아닙니다.'
  return '현재 페이지 또는 선택한 검사 범위에 해당하는 대상이 없습니다.'
}

function createNotApplicableReason(item = {}) {
  if (item.raw?.meta?.noTarget || item.meta?.noTarget) return '검사 메타 정보에서 noTarget 신호가 확인되었습니다.'
  if (item.status === 'info' || item.status === 'skipped') return '자동 검사에서 정보성 또는 생략 항목으로 분류되었습니다.'
  return '대상 요소가 없거나 현재 검사 옵션에서 사용되지 않는 항목입니다.'
}

function createUnavailableCause(item = {}) {
  const text = [item.category, item.reason, item.note, item.message, item.navigationError, item.loadWarning, item.raw?.category, item.raw?.reason, item.raw?.note, item.raw?.message].filter(Boolean).join(' ').toLowerCase()
  const statusCode = getStatusCode(item)
  if (/login|auth|unauthorized|401/.test(text) || statusCode === 401) return 'login required'
  if (/access|denied|forbidden|restricted|403/.test(text) || statusCode === 403) return 'access denied'
  if (/timeout|timed\s*out|408/.test(text) || statusCode === 408) return 'timeout'
  if (/network|net::|dns|tls|ssl|connection|request[-\s]?failed/.test(text)) return 'network'
  if (/unsupported/.test(text)) return 'unsupported'
  if (/missing|not found target|target/.test(text)) return 'target missing'
  return '검사 불가'
}

function getStatusCode(item = {}) {
  const raw = item.raw || item
  const value = raw.statusCode ?? item.statusCode
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function isHashHref(item = {}) {
  return item.href === '#' || item.url === '#' || item.category === 'same-page-anchor'
}

function hasUrl(item = {}) {
  const raw = item.raw || item
  return Boolean(raw.url || raw.href || raw.finalUrl || raw.requestedUrl || raw.requestUrl || item.url || item.href || item.finalUrl || item.requestedUrl || item.requestUrl)
}

function isClickableItem(item = {}) {
  const raw = item.raw || item
  return Boolean(raw.actionClassification || raw.interactionOutcome || raw.href || item.type === 'link' || item.categoryLabel === 'UI')
}

function limitSentence(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180)
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
  const environment = getEnvironmentLabel(result)
  const linkCount = getLinkInspectionCount(result, view)
  const imageCount = Array.isArray(result.images) ? result.images.length : null
  const durationText = formatTechQaDuration(result.durationMs)

  if (engine) meta.push({ label: '검사 엔진', value: engine })
  if (environment) meta.push({ label: '검사 환경', value: environment })
  if (linkCount !== null) meta.push({ label: '링크 검사', value: `${linkCount}개` })
  if (imageCount !== null) meta.push({ label: '이미지 검사', value: `${imageCount}개` })
  if (durationText) meta.push({ label: '처리시간', value: durationText })

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
