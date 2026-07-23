export function createTechPanelDisplayModel(result = {}, view = {}) {
  const priorityRows = createTechPriorityRows(view)
  const priorityCounts = countPriorityRows(priorityRows)
  const completion = createTechCompletion(result, view)

  return {
    completion,
    priorityRows,
    priorityCounts,
  }
}

export function createTechPriorityRows(view = {}) {
  const clickRows = createClickPriorityRows(view)
  const sourceRows = Array.isArray(view.allItems) && view.allItems.length > 0 ? view.allItems : Array.isArray(view.priorityItems) ? view.priorityItems : []
  const nonClickRows = sourceRows.filter(isDisplayPriorityRow)
  return clickRows.concat(nonClickRows)
}

function isDisplayPriorityRow(item = {}) {
  if (item.status === 'ok') return false
  if (item.id === 'click-actions') return false
  if (item.id === 'bad-links') return false
  if (item.id === 'missing-href') return false
  return true
}

function createClickPriorityRows(view = {}) {
  const groups = view.clickActionGroups || {}
  const clickCheck = Array.isArray(view.checkItems) ? view.checkItems.find((item) => item.id === 'click-actions') : null
  const base = clickCheck || {
    id: 'click-actions',
    type: 'check',
    section: 'frontend',
    owner: 'UID팀',
    categoryLabel: 'UI QA',
    priority: 4,
  }
  const rows = []
  const actualErrors = Array.isArray(groups.actualErrors) ? groups.actualErrors : []
  const warnings = Array.isArray(groups.warnings) ? groups.warnings : []

  if (actualErrors.length > 0) {
    rows.push({
      ...base,
      id: 'click-actions-actual-errors',
      title: '클릭 동작 오류',
      status: 'error',
      value: `실제 오류 ${actualErrors.length}개`,
      problemItems: actualErrors,
      detailTargetId: 'tech-click-actual-errors',
      priority: Number(base.priority || 4),
    })
  }

  if (warnings.length > 0) {
    rows.push({
      ...base,
      id: 'click-actions-warnings',
      title: '클릭 동작 확인 필요',
      status: 'warn',
      value: `확인 필요 ${warnings.length}개`,
      problemItems: warnings,
      detailTargetId: 'tech-click-warnings',
      priority: Number(base.priority || 4) + 0.1,
    })
  }

  return rows
}

function countPriorityRows(rows = []) {
  return rows.reduce((counts, row) => {
    if (row.status === 'error') return { ...counts, error: counts.error + 1 }
    if (row.status === 'warn') return { ...counts, warn: counts.warn + 1 }
    return counts
  }, { error: 0, warn: 0 })
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
