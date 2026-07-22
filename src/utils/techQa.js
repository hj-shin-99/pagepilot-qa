export const TECH_STATUS_LABELS = {
  ok: '정상',
  warn: '확인 필요',
  error: '오류',
  info: '참고',
}

const CLICK_ACTION_GROUPS = [
  { id: 'actualErrors', label: '실제 오류' },
  { id: 'warnings', label: '확인 필요' },
  { id: 'safeSkipped', label: '안전상 클릭 생략' },
  { id: 'uiControls', label: 'URL이 필요 없는 UI control' },
  { id: 'verified', label: '정상 검증 완료' },
]

const BASIC_CHECK_ORDER = [
  'access',
  'http-status',
  'title',
  'console-errors',
  'images',
  'links',
  'missing-href',
  'mobile',
  'headings',
  'duplicate-ids',
  'network-failures',
  'forms',
]

const CHECK_DEFINITIONS = {
  access: { section: 'planning', owner: '개발팀', label: '페이지 접속', description: '검사 대상 페이지가 브라우저에서 열리는지 확인합니다.' },
  'http-status': { section: 'backend', owner: '개발팀', label: 'HTTP 상태', description: '서버가 페이지 요청에 반환한 HTTP 상태 코드를 확인합니다.' },
  title: { section: 'seo', owner: 'UID팀', label: 'Title', description: '문서의 title 요소가 수집되는지 확인합니다.' },
  'console-errors': { section: 'frontend', owner: 'UID팀', label: 'Console', description: '페이지 실행 중 발생한 first-party와 third-party 콘솔 오류를 분류합니다.' },
  images: { section: 'frontend', owner: 'UID팀', label: '이미지 로딩', description: '페이지 안의 이미지 요청과 로딩 실패 수를 확인합니다.' },
  links: { section: 'link', owner: 'UID팀', label: '링크 수집', description: '페이지에서 수집한 링크와 실제 요청 오류 수를 확인합니다.' },
  'missing-href': { section: 'link', owner: 'UID팀', label: '버튼 URL', description: '이동 목적 요소에 href, URL, action 근거가 있는지 확인합니다.' },
  'bad-links': { section: 'link', owner: 'UID팀', label: '페이지 링크 검사', description: '수집된 링크를 실제 요청해 4xx, 5xx, timeout, 요청 실패 여부를 확인합니다.' },
  'interaction-count': { section: 'planning', owner: 'UID팀', label: '클릭 요소 수', description: '페이지에서 수집된 링크와 버튼 개수를 확인합니다.' },
  mobile: { section: 'planning', owner: 'UID팀', label: '모바일 viewport', description: '모바일 viewport에서 페이지 접속 상태를 확인합니다.' },
  meta: { section: 'seo', owner: 'UID팀', label: 'Meta description / OG', description: '검색과 공유에 사용하는 기본 meta markup이 있는지 확인합니다.' },
  'image-alt': { section: 'planning', owner: 'UID팀', label: '이미지 alt', description: '의미 있는 이미지에 alt 값이 있는지 확인합니다.' },
  forms: { section: 'frontend', owner: 'UID팀', label: 'Form 기본 검사', description: '입력 요소에 label 또는 접근성 이름이 연결되어 있는지 확인합니다.' },
  'external-links': { section: 'planning', owner: 'UID팀', label: '새 창 외부 링크', description: '새 창 외부 링크의 rel 보안 속성을 확인합니다.' },
  'duplicate-ids': { section: 'frontend', owner: 'UID팀', label: '중복 ID', description: '한 페이지 안에서 같은 id 값이 여러 번 사용되는지 확인합니다.' },
  headings: { section: 'seo', owner: 'UID팀', label: 'Heading', description: 'H1과 heading 구조가 수집되는지 확인합니다.' },
  'resource-size': { section: 'frontend', owner: 'UID팀', label: '큰 리소스', description: '용량이 큰 CSS, JS, 이미지 리소스를 참고 정보로 확인합니다.' },
  'network-failures': { section: 'backend', owner: '개발팀', label: '네트워크 요청', description: '페이지 구성 중 실패한 document, API, JS, CSS, 폰트 요청을 확인합니다.' },
  'mobile-overflow': { section: 'frontend', owner: 'UID팀', label: '모바일 가로 스크롤', description: '모바일 화면 너비보다 문서가 넓어지는지 확인합니다.' },
  'click-actions': { section: 'frontend', owner: 'UID팀', label: '클릭 동작', description: '버튼과 링크가 실제 사용자 클릭에 반응하는지 확인합니다.' },
  'unlabeled-clickables': { section: 'planning', owner: 'UID팀', label: '클릭 가능한 요소 이름', description: '버튼과 링크에 사용자용 이름이 있는지 확인합니다.' },
}

const SECTION_TITLES = {
  planning: '기본 QA',
  link: '링크 및 버튼 QA',
  seo: 'Markup QA',
  frontend: 'UI QA',
  backend: 'API·네트워크 QA',
}

export function createTechQaViewModel(result = {}) {
  const checks = arrayOfObjects(result.checks)
  const clickActionGroups = createClickActionGroups(result)
  const links = createLinkItems(result.links)
  const linkSummary = createLinkSummary(links, result.linkAudit)
  const checkItems = checks.map((check) => createCheckItem(check, clickActionGroups, { result, linkSummary }))
  const allItems = checkItems.concat(links)
  const priorityItems = allItems.filter(isPriorityItem).sort(comparePriorityItems)
  const normalCheckItems = checkItems.filter((item) => item.status === 'ok').sort(comparePriorityItems)
  const counts = countStatuses(allItems)
  const issueCounts = createTechQaCounts(checkItems, priorityItems)
  const priorityCounts = { error: issueCounts.errorUniqueElementCount, warn: issueCounts.warningUniqueElementCount, ok: 0 }
  const statusMessage = issueCounts.errorUniqueElementCount > 0
    ? `오류 ${issueCounts.errorUniqueElementCount}개 · ${issueCounts.errorCheckCount}개 검사에서 발견되었습니다.`
    : issueCounts.warningUniqueElementCount > 0
      ? `확인 필요 ${issueCounts.warningUniqueElementCount}개 · ${issueCounts.warningCheckCount}개 검사에서 발견되었습니다.`
      : '오류 0개 · 확인 필요 0개입니다.'

  return {
    title: result.pageTitle || '페이지 타이틀 없음',
    targetUrl: result.targetUrl || '',
    scannedAt: result.scannedAt || '',
    statusMessage,
    counts,
    issueCounts,
    priorityCounts,
    summaryCards: createSummaryCards(result, issueCounts, linkSummary),
    checkItems,
    basicCheckItems: createBasicCheckItems(checkItems),
    normalCheckItems,
    priorityItems,
    sections: createSections(checkItems, links),
    linkSummary,
    clickActionGroups,
    links,
    allItems: allItems.sort(comparePriorityItems),
    developer: createDeveloperInfo(result, linkSummary),
  }
}

export function createLinkItems(links = []) {
  return arrayOfObjects(links).map((link, index) => {
    const status = normalizeStatus(link.status)
    const owner = getLinkOwner(link)
    return {
      id: `link-${index}-${link.url || link.href || link.selector || link.label || ''}`,
      type: 'link',
      section: 'link',
      title: link.label || link.text || link.url || `링크 ${index + 1}`,
      status,
      statusLabel: TECH_STATUS_LABELS[status],
      value: link.statusCode ? String(link.statusCode) : link.category || link.note || '확인 필요',
      description: getLinkDescription(link),
      shortDescription: getShortDescription(getLinkDescription(link)),
      technicalTerm: getLinkTechnicalTerm(link),
      easyExplanation: getLinkEasyExplanation(link),
      example: link.finalUrl && link.finalUrl !== link.url ? `${link.url} -> ${link.finalUrl}` : link.url || link.href || link.selector || '',
      owner,
      categoryLabel: '링크',
      priority: getLinkPriority(link),
      raw: link,
    }
  }).sort(comparePriorityItems)
}

export function getVisibleLinkGroups(links = [], normalLimit = 5, warnLimit = 5) {
  const errors = links.filter((link) => link.status === 'error')
  const warnings = links.filter((link) => link.status === 'warn')
  const normals = links.filter((link) => link.status === 'ok')
  return {
    errors,
    warnings: warnings.slice(0, warnLimit),
    hiddenWarnings: warnings.slice(warnLimit),
    normals: normals.slice(0, normalLimit),
    hiddenNormals: normals.slice(normalLimit),
  }
}

export function countStatuses(items = []) {
  return items.reduce((counts, item) => ({ ...counts, [item.status]: (counts[item.status] || 0) + 1 }), { ok: 0, warn: 0, error: 0 })
}

export function createTechQaCounts(checkItems = [], priorityItems = []) {
  const countItems = priorityItems.length > 0 ? priorityItems : checkItems.filter(isPriorityItem)
  const evidenceRecords = countItems.flatMap((item) => createEvidenceRecords(item))
  const errorEvidenceRecords = evidenceRecords.filter((record) => record.severity === 'error')
  const warningEvidenceRecords = evidenceRecords.filter((record) => record.severity === 'warn')
  const errorUniqueElementCount = countUniqueEvidenceRecords(errorEvidenceRecords)
  const warningUniqueElementCount = countUniqueEvidenceRecords(warningEvidenceRecords)
  const checkBreakdown = countItems
    .map((item) => createCountBreakdown(item))
    .filter((entry) => entry.errorEvidenceCount > 0 || entry.warningEvidenceCount > 0)

  return {
    errorCheckCount: checkBreakdown.filter((item) => item.errorEvidenceCount > 0).length,
    errorEvidenceCount: errorEvidenceRecords.length,
    errorUniqueElementCount,
    errorElementCount: errorUniqueElementCount,
    warningCheckCount: checkBreakdown.filter((item) => item.warningEvidenceCount > 0).length,
    warningEvidenceCount: warningEvidenceRecords.length,
    warningUniqueElementCount,
    warningElementCount: warningUniqueElementCount,
    duplicateEvidenceMergedCount: Math.max(0, errorEvidenceRecords.length - errorUniqueElementCount) + Math.max(0, warningEvidenceRecords.length - warningUniqueElementCount),
    normalCheckCount: checkItems.filter((item) => item.status === 'ok').length,
    checkBreakdown,
  }
}

function createCheckItem(check = {}, clickActionGroups = createEmptyClickActionGroups(), context = {}) {
  const definition = CHECK_DEFINITIONS[check.id] || { section: 'frontend', owner: 'UID팀', label: check.title || check.id || '검사 항목', description: check.detail || '자동 수집한 기술 검사 항목입니다.' }
  const display = check.id === 'click-actions' ? createClickActionDisplay(clickActionGroups, check) : null
  const status = display?.status || normalizeStatus(check.status)
  const problemItems = getProblemItems(check, display)
  return {
    id: check.id || definition.label,
    type: 'check',
    section: definition.section,
    title: definition.label || check.title,
    status,
    statusLabel: TECH_STATUS_LABELS[status],
    value: display?.value || getObjectiveCheckValue(check, context, problemItems) || check.value || '',
    description: definition.description,
    shortDescription: getShortDescription(definition.description),
    technicalTerm: check.title || definition.label,
    easyExplanation: definition.description,
    example: getCheckExample(check),
    owner: getOwnerForCheck(check, definition),
    categoryLabel: getSectionLabel(definition.section),
    priority: getCheckPriority(check),
    problemItems,
    raw: check,
  }
}

function createBasicCheckItems(checkItems = []) {
  return BASIC_CHECK_ORDER
    .map((id) => checkItems.find((item) => item.id === id))
    .filter(Boolean)
}

function createSections(checkItems, links) {
  const sections = ['planning', 'link', 'seo', 'frontend', 'backend'].map((sectionId) => {
    const baseItems = sectionId === 'link' ? checkItems.filter((item) => item.section === sectionId).concat(links) : checkItems.filter((item) => item.section === sectionId)
    const items = baseItems.sort(comparePriorityItems)
    return {
      id: sectionId,
      title: SECTION_TITLES[sectionId],
      counts: countStatuses(items),
      items,
      visible: createVisibleItems(items),
    }
  })
  return sections
}

function createVisibleItems(items = []) {
  const errors = items.filter((item) => item.status === 'error')
  const warnings = items.filter((item) => item.status === 'warn')
  const normals = items.filter((item) => item.status === 'ok')
  return {
    errors,
    warnings: warnings.slice(0, 5),
    hiddenWarnings: warnings.slice(5),
    normals: normals.slice(0, 5),
    hiddenNormals: normals.slice(5),
  }
}

function createSummaryCards(result, counts, linkSummary) {
  const imageTotal = Array.isArray(result.images) ? result.images.length : 0
  const accessStatus = result.accessible ? '정상' : '오류'
  const errorDetail = counts.errorCheckCount > 0 ? `${counts.errorCheckCount}개 검사에서 발견` : '0개 검사에서 발견'
  const warningDetail = counts.warningCheckCount > 0 ? `${counts.warningCheckCount}개 검사에서 발견` : '0개 검사에서 발견'
  return [
    { label: '페이지 접속', value: `${accessStatus} · HTTP ${result.httpStatus || '응답 없음'}`, status: result.accessible ? 'ok' : 'error' },
    { label: '오류', value: `${counts.errorUniqueElementCount}개`, detail: errorDetail, status: counts.errorUniqueElementCount > 0 ? 'error' : 'ok' },
    { label: '확인 필요', value: `${counts.warningUniqueElementCount}개`, detail: warningDetail, status: counts.warningUniqueElementCount > 0 ? 'warn' : 'ok' },
    { label: '검사 완료', value: `링크 ${linkSummary.total}개 · 이미지 ${imageTotal}개`, detail: `정상 검사 ${counts.normalCheckCount}개 항목`, status: 'info' },
  ]
}

function createClickActionDisplay(groups, check = {}) {
  const problemItems = groups.actualErrors.concat(groups.warnings)
  const status = groups.actualErrors.length > 0 ? 'error' : groups.warnings.length > 0 ? 'warn' : 'ok'
  const value = problemItems.length > 0 ? `실제 오류 ${groups.actualErrors.length}개 · 확인 필요 ${groups.warnings.length}개` : check.value && normalizeStatus(check.status) === 'ok' ? check.value : `실제 오류 0개 · 확인 필요 0개`
  return { status, value, problemItems }
}

function createClickActionGroups(result = {}) {
  const clickCheck = arrayOfObjects(result.checks).find((check) => check.id === 'click-actions')
  const items = arrayOfObjects(result.clickActions).length > 0 ? arrayOfObjects(result.clickActions) : arrayOfObjects(clickCheck?.items)
  const groups = createEmptyClickActionGroups()
  items.forEach((item) => {
    groups[getClickActionGroupId(item)].push(item)
  })
  groups.definitions = CLICK_ACTION_GROUPS
  groups.total = items.length
  return groups
}

function createEmptyClickActionGroups() {
  return {
    actualErrors: [],
    warnings: [],
    safeSkipped: [],
    uiControls: [],
    verified: [],
    definitions: CLICK_ACTION_GROUPS,
    total: 0,
  }
}

function getClickActionGroupId(item = {}) {
  if (item.actionClassification === 'actual-error') return 'actualErrors'
  if (item.actionClassification === 'actionable-warning') return 'warnings'
  if (item.actionClassification === 'safe-click-skipped') return 'safeSkipped'
  if (item.actionClassification === 'ui-control-no-url-required') return 'uiControls'
  if (item.actionClassification === 'verified-working') return 'verified'
  const category = String(item.category || item.hrefState || '')
  const reason = String(item.reason || '')
  if (category === 'skipped-safe-click' || item.safeClickSkippedReason) return 'safeSkipped'
  if (category === 'UI-control-no-url-required') return 'uiControls'
  if (item.status === 'ok' || category === 'valid-url' || category === 'observable-action') return 'verified'
  if (category === 'covered-or-not-interactable' || category === 'no-observable-action' || category === 'disabled-action') return 'actualErrors'
  if (/pointer-events|hit-test|가리고|관찰 가능한 변화가 없습니다/i.test(reason)) return 'actualErrors'
  return 'warnings'
}

function isPriorityItem(item = {}) {
  if (item.status === 'ok') return false
  if (item.id === 'bad-links') return false
  if (item.id === 'missing-href') return false
  if (item.id !== 'click-actions') return true
  return arrayOfObjects(item.problemItems).length > 0
}

function getProblemItems(check = {}, display = null) {
  if (display) return display.problemItems
  const items = arrayOfObjects(check.items)
  if (normalizeStatus(check.status) === 'ok') return []
  if (check.id === 'network-failures') return items.filter((item) => item.confidence !== 'low' && !/^reference/.test(String(item.category || '')))
  if (check.id === 'console-errors') return items.filter((item) => normalizeStatus(item.status) !== 'ok')
  return items
}

function getObjectiveCheckValue(check = {}, context = {}, problemItems = []) {
  const result = context.result || {}
  const linkSummary = context.linkSummary || {}
  const items = arrayOfObjects(check.items)
  const problemCount = problemItems.length

  if (check.id === 'access') return `${result.accessible === false ? '접속 실패' : '접속 가능'} · HTTP ${result.httpStatus || check.statusCode || '응답 없음'}`
  if (check.id === 'http-status') return `HTTP ${result.httpStatus || check.value || '응답 없음'}`
  if (check.id === 'title') return check.value ? `수집됨 · ${check.value}` : result.pageTitle ? `수집됨 · ${result.pageTitle}` : '비어 있음'
  if (check.id === 'console-errors') return formatConsoleCheckValue(check, items)
  if (check.id === 'images') return `총 ${getImageTotal(check, result, items)}개 · 실패 ${getProblemCount(check, problemItems)}개`
  if (check.id === 'links') return `총 ${getLinkTotal(check, linkSummary)}개 · 요청 오류 ${Number(linkSummary.error || 0)}개`
  if (check.id === 'missing-href') return `총 ${getButtonTotal(result, check)}개 · URL 확인 필요 ${problemCount}개`
  if (check.id === 'mobile') return formatMobileCheckValue(check, result)
  if (check.id === 'headings') return check.value ? `${check.value} · 확인 필요 ${problemCount}개` : `확인 필요 ${problemCount}개`
  if (check.id === 'duplicate-ids') return `중복 ID ${problemCount}개`
  if (check.id === 'network-failures') return `실패 요청 ${problemCount}개`
  if (check.id === 'forms') return check.value ? `${check.value} · 확인 필요 ${problemCount}개` : `확인 필요 ${problemCount}개`
  if (check.id === 'meta') return `총 ${getGenericTotal(check, problemCount)}개 항목 확인 필요`
  if (check.id === 'image-alt') return `총 ${getImageTotal(check, result, items)}개 · alt 확인 필요 ${problemCount}개`
  if (check.id === 'external-links') return `총 ${getGenericTotal(check, problemCount)}개 · rel 확인 필요 ${problemCount}개`
  return ''
}

function formatConsoleCheckValue(check = {}, items = []) {
  const meta = check.meta || {}
  const firstParty = Number(meta.firstPartyRuntimeErrorCount || 0) + Number(meta.firstPartyConsoleErrorCount || 0)
  const thirdParty = Number(meta.thirdPartyScriptErrorCount || 0)
  if (firstParty || thirdParty || meta.representativeCount !== undefined) return `first-party ${firstParty}개 · third-party ${thirdParty}개`

  const firstPartyItems = items.filter((item) => item.party === 'first-party' || item.classification === 'first-party-runtime-error' || item.classification === 'first-party-console-error').length
  const thirdPartyItems = items.filter((item) => item.party === 'third-party' || item.classification === 'third-party-script-error').length
  if (firstPartyItems || thirdPartyItems) return `first-party ${firstPartyItems}개 · third-party ${thirdPartyItems}개`
  return 'first-party 0개 · third-party 0개'
}

function getImageTotal(check = {}, result = {}, items = []) {
  if (Array.isArray(result.images) && result.images.length > 0) return result.images.length
  if (Number(check.totalCount) > 0) return Number(check.totalCount)
  if (Number(check.total) > 0) return Number(check.total)
  const parsed = String(check.value || '').match(/(\d+)\s*개\s*(?:중|총)/)
  if (parsed) return Number(parsed[1])
  return items.length
}

function getButtonTotal(result = {}, check = {}) {
  if (Number(result.counts?.buttons) > 0) return Number(result.counts.buttons)
  if (Number(check.totalCount) > 0) return Number(check.totalCount)
  if (Number(check.total) > 0) return Number(check.total)
  return arrayOfObjects(check.items).length
}

function getLinkTotal(check = {}, linkSummary = {}) {
  if (Number(linkSummary.total) > 0) return Number(linkSummary.total)
  const parsed = String(check.value || '').match(/(\d+)\s*개/)
  if (parsed) return Number(parsed[1])
  return 0
}

function getGenericTotal(check = {}, fallback = 0) {
  if (Number(check.totalCount) > 0) return Number(check.totalCount)
  if (Number(check.total) > 0) return Number(check.total)
  const parsed = String(check.value || '').match(/(?:총\s*)?(\d+)\s*개/)
  if (parsed) return Math.max(Number(parsed[1]), Number(fallback || 0))
  return Number(fallback || 0)
}

function getProblemCount(check = {}, problemItems = []) {
  if (Array.isArray(problemItems)) return problemItems.length
  return arrayOfObjects(check.items).length
}

function formatMobileCheckValue(check = {}, result = {}) {
  const viewport = result.mobile?.viewport
  const viewportText = viewport?.width && viewport?.height ? `viewport ${viewport.width}x${viewport.height}` : 'viewport 확인'
  const statusCode = result.mobile?.statusCode || check.statusCode || result.httpStatus || ''
  return statusCode ? `${viewportText} · HTTP ${statusCode}` : viewportText
}

function createCountBreakdown(item = {}) {
  const records = createEvidenceRecords(item)
  const errorRecords = records.filter((record) => record.severity === 'error')
  const warningRecords = records.filter((record) => record.severity === 'warn')
  const errorUniqueIdentityCount = countUniqueEvidenceRecords(errorRecords)
  const warningUniqueIdentityCount = countUniqueEvidenceRecords(warningRecords)
  return {
    id: item.id || item.title || item.type || 'unknown',
    title: item.title || item.id || item.type || 'unknown',
    type: item.type || 'check',
    status: item.status || '',
    errorEvidenceCount: errorRecords.length,
    warningEvidenceCount: warningRecords.length,
    uniqueIdentityCount: countUniqueEvidenceRecords(records),
    errorUniqueIdentityCount,
    warningUniqueIdentityCount,
    duplicateMergedCount: Math.max(0, errorRecords.length - errorUniqueIdentityCount) + Math.max(0, warningRecords.length - warningUniqueIdentityCount),
  }
}

function createEvidenceRecords(item = {}) {
  return getEvidenceEntries(item)
    .map((entry, index) => {
      const severity = getEntryStatus(entry, item)
      return {
        item,
        entry,
        index,
        severity,
        identityKeys: getEvidenceIdentityKeys(entry, item),
      }
    })
    .filter((record) => record.severity === 'error' || record.severity === 'warn')
}

function getEvidenceEntries(item = {}) {
  const problemItems = arrayOfObjects(item.problemItems)
  if (problemItems.length > 0) return problemItems
  const rawItems = arrayOfObjects(item.raw?.items)
  if (rawItems.length > 0) return rawItems
  const status = normalizeStatus(item.status)
  return status === 'error' || status === 'warn' ? [item.raw || item] : []
}

function countUniqueEvidenceRecords(records = []) {
  if (records.length === 0) return 0
  const parents = records.map((_, index) => index)
  const keyOwners = new Map()

  records.forEach((record, index) => {
    record.identityKeys.forEach((key) => {
      if (keyOwners.has(key)) unionParents(parents, index, keyOwners.get(key))
      else keyOwners.set(key, index)
    })
  })

  return new Set(records.map((_, index) => findParent(parents, index))).size
}

function unionParents(parents, first, second) {
  const firstRoot = findParent(parents, first)
  const secondRoot = findParent(parents, second)
  if (firstRoot !== secondRoot) parents[secondRoot] = firstRoot
}

function findParent(parents, index) {
  if (parents[index] !== index) parents[index] = findParent(parents, parents[index])
  return parents[index]
}

function getEntryStatus(entry = {}, parent = {}) {
  if (entry.actionClassification === 'actual-error') return 'error'
  if (entry.actionClassification === 'actionable-warning') return 'warn'
  const status = normalizeStatus(entry.status)
  if (entry.status !== undefined) return status
  return normalizeStatus(parent.status)
}

function getEvidenceIdentityKeys(entry = {}, parent = {}) {
  const raw = entry.raw || entry
  const stableKeys = [raw.auditId, raw.sourceId, raw.stableId, raw.requestId, raw.elementId, raw.id]
    .map((value) => normalizeIdentityPart(value))
    .filter(Boolean)
    .map((value) => `stable:${value}`)
  const selector = normalizeIdentityPart(raw.selector)
  if (selector) return [`dom:${selector}`]
  if (stableKeys.length > 0) return [...new Set(stableKeys)]
  const domPath = normalizeIdentityPart(raw.domPath)
  if (domPath) return [`dom:${domPath}`]

  const requestUrl = normalizeUrlIdentity(raw.requestUrl || raw.url || raw.finalUrl || raw.href)
  const requestType = normalizeIdentityPart(raw.requestType || raw.resourceType || raw.type || raw.method || raw.category || parent.id)
  if (requestUrl) return [`request:${requestType}|${requestUrl}`]

  const sourceUrl = normalizeUrlIdentity(raw.sourceUrl || raw.source)
  const message = normalizeConsoleMessage(raw.message)
  if (message) return [`console:${sourceUrl}|${message}`]

  const imageSrc = normalizeUrlIdentity(raw.src || raw.currentSrc)
  if (imageSrc) return [`image:${imageSrc}`]

  const label = normalizeIdentityPart(raw.label || raw.text || raw.ariaLabel || parent.title)
  const controlIdentity = [raw.formAction, raw.name, raw.controlId, raw.actionEvidence, raw.actionType, raw.role, raw.tagName, label].map(normalizeIdentityPart).filter(Boolean).join('|')
  if (controlIdentity) return [`control:${controlIdentity}`]

  const location = normalizeIdentityPart(raw.userLocation || raw.area || raw.readableArea || raw.section || raw.sectionPath || parent.section)
  const fallback = [raw.category || parent.id, label, location].map(normalizeIdentityPart).filter(Boolean).join('|')
  if (fallback) return [`fallback:${fallback}`]

  return []
}

function normalizeIdentityPart(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeConsoleMessage(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeUrlIdentity(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  try {
    const url = new URL(text, 'https://pagepilot.local')
    const path = url.pathname.replace(/\/$/, '') || '/'
    return `${url.origin.toLowerCase()}${path}${url.search}`.replace(/^https:\/\/pagepilot\.local/i, '')
  } catch {
    return normalizeIdentityPart(text)
  }
}

function getSectionLabel(section) {
  if (section === 'seo') return 'Markup'
  if (section === 'frontend') return 'UI'
  if (section === 'backend') return 'API'
  if (section === 'link') return '링크'
  return '기본'
}

function getShortDescription(value) {
  const text = String(value || '').trim()
  const [firstSentence] = text.split(/(?<=[.!?。])\s+|(?<=다\.)\s*/u).filter(Boolean)
  return (firstSentence || text).replace(/\s+/g, ' ').slice(0, 90)
}

function createLinkSummary(links, meta = {}) {
  const counts = countStatuses(links)
  return {
    total: links.length,
    error: counts.error,
    warn: counts.warn,
    ok: counts.ok,
    discovered: Number(meta?.discoveredLinkCount || links.length),
    uniqueRequestUrlCount: Number(meta?.uniqueRequestUrlCount || 0),
    actualHttpRequestCount: Number(meta?.actualHttpRequestCount || 0),
    dedupedLinkCount: Number(meta?.dedupedLinkCount || 0),
    redirectCount: Number(meta?.redirectCount || 0),
    status4xxCount: Number(meta?.status4xxCount || 0),
    status5xxCount: Number(meta?.status5xxCount || 0),
    timeoutCount: Number(meta?.timeoutCount || 0),
    missingNavigationHrefCount: Number(meta?.missingNavigationHrefCount || 0),
    uiControlWithoutUrlCount: Number(meta?.uiControlWithoutUrlCount || 0),
  }
}

function createDeveloperInfo(result, linkSummary) {
  return {
    playwrightRunCount: Number(result.visualPayloadData?.playwrightRunCount || result.linkAudit?.playwrightRunCount || 0),
    targetUrl: result.targetUrl || '',
    navigationError: result.navigationError || '',
    linkSummary,
    rawCheckCount: Array.isArray(result.checks) ? result.checks.length : 0,
    rawLinkCount: Array.isArray(result.links) ? result.links.length : 0,
    rawImageCount: Array.isArray(result.images) ? result.images.length : 0,
    rawConsoleCount: Array.isArray(result.consoleMessages) ? result.consoleMessages.length : 0,
  }
}

function getOwnerForCheck(check, definition) {
  if (check.id === 'network-failures') {
    const text = JSON.stringify(check.items || [])
    if (/xhr|fetch|api|json|document|dns|tls|timeout|mixed|cdn/i.test(text)) return '개발팀'
  }
  if (check.id === 'click-actions') return 'UID팀'
  if (check.id === 'images' && check.status !== 'ok') return 'UID팀'
  if (check.id === 'http-status' && Number(check.value) >= 400) return '개발팀'
  return definition.owner
}

function getLinkOwner(link = {}) {
  const category = String(link.category || '')
  const type = String(link.type || '')
  if (category === 'missing-navigation-url' || category === 'javascript-pseudo-url' || category === 'same-page-anchor') return 'UID팀'
  if (Number(link.statusCode) >= 500) return '개발팀'
  if (Number(link.statusCode) >= 400) return type === 'xhr' || type === 'fetch' ? '개발팀' : 'UID팀'
  if (category === 'request-failed' || category === 'timeout') return '개발팀'
  return 'UID팀'
}

function getCheckPriority(check = {}) {
  if (check.id === 'access') return 0
  if (check.id === 'http-status' && Number(check.value) >= 500) return 1
  if (check.id === 'http-status' && Number(check.value) >= 400) return 2
  if (check.id === 'missing-href') return 3
  if (check.id === 'click-actions') return 4
  if (check.id === 'console-errors') return 5
  if (check.id === 'network-failures') return 6
  if (check.id === 'images') return 7
  if (check.id === 'meta' || check.id === 'title') return 9
  return 12
}

function getLinkPriority(link = {}) {
  if (link.category === 'request-failed') return 0
  if (link.category === 'timeout') return 1
  if (Number(link.statusCode) >= 500) return 2
  if (Number(link.statusCode) >= 400) return 3
  if (link.category === 'missing-navigation-url') return 4
  if (link.category === 'javascript-pseudo-url' || link.category === 'same-page-anchor') return 5
  if (link.category === 'redirect') return 10
  return link.status === 'ok' ? 20 : 12
}

function getLinkDescription(link = {}) {
  if (link.category === 'missing-navigation-url') return '클릭 가능한 CTA에 이동 주소나 action 근거가 없습니다. 사용자가 버튼을 눌러도 원하는 페이지로 이동하지 않을 수 있습니다.'
  if (link.category === 'same-page-anchor') return '링크가 같은 페이지 내부 anchor로 연결됩니다. CTA 이동 목적과 맞는지 확인해야 합니다.'
  if (link.category === 'javascript-pseudo-url') return '링크가 javascript pseudo URL로 되어 있습니다. 실제 이동이나 이벤트 연결이 의도대로 동작하는지 확인해야 합니다.'
  if (link.category === 'timeout') return '링크 응답 시간이 초과되었습니다. 사용자가 이동 시 긴 대기나 실패를 경험할 수 있습니다.'
  if (Number(link.statusCode) >= 500) return '목적지 서버가 오류를 반환했습니다. 사용자 이동이 실패할 가능성이 높습니다.'
  if (Number(link.statusCode) >= 400) return '목적지가 없거나 접근할 수 없는 응답입니다. 링크 주소 또는 페이지 공개 상태를 확인해야 합니다.'
  if (link.category === 'redirect') return '링크가 다른 최종 URL로 이동합니다. 의도한 목적지인지 확인하세요.'
  if (link.requestSkipped) return link.note || 'HTTP 검사에서 제외된 링크입니다. 오류로 단정하지 않고 별도 분류했습니다.'
  return '목적지 URL이 정상 응답하는지 확인한 링크입니다.'
}

function getLinkTechnicalTerm(link = {}) {
  if (link.technicalTerm) return link.technicalTerm
  if (link.category === 'missing-navigation-url') return 'href 누락'
  if (link.category === 'same-page-anchor') return '페이지 내부 앵커'
  if (link.category === 'javascript-pseudo-url') return 'javascript:void(0)'
  if (link.category === 'http-4xx') return `HTTP ${link.statusCode || '4xx'}`
  if (link.category === 'http-5xx') return `HTTP ${link.statusCode || '5xx'}`
  if (link.category === 'timeout') return 'timeout'
  if (link.category === 'redirect') return 'redirect'
  return 'valid-url'
}

function getLinkEasyExplanation(link = {}) {
  if (link.easyExplanation) return link.easyExplanation
  if (link.category === 'missing-navigation-url') return 'href는 링크가 이동할 주소를 지정하는 HTML 속성입니다. href가 없으면 사용자가 눌러도 다른 페이지로 이동하지 않을 수 있습니다.'
  if (link.category === 'same-page-anchor') return '같은 페이지 내부 위치로 이동하는 앵커입니다. 이동 CTA라면 실제 목적지 URL이 필요한지 확인해야 합니다.'
  if (link.category === 'javascript-pseudo-url') return '링크 주소 대신 JavaScript 동작만 지정된 상태입니다. 실제 이동 버튼이라면 목적지 URL이 누락됐을 수 있습니다.'
  if (Number(link.statusCode) === 404) return 'HTTP 404는 요청한 페이지나 파일을 서버에서 찾지 못한 상태입니다.'
  if (Number(link.statusCode) >= 500) return 'HTTP 5xx는 서버가 요청을 정상 처리하지 못한 상태입니다.'
  if (link.category === 'timeout') return 'timeout은 제한 시간 안에 서버 응답을 받지 못한 상태입니다.'
  return getLinkDescription(link)
}

function getCheckExample(check = {}) {
  const items = arrayOfObjects(check.items)
  if (items.length > 0) return formatExample(items[0])
  return check.detail || check.value || ''
}

function formatExample(item = {}) {
  return item.url || item.src || item.selector || item.message || item.label || item.id || ''
}

function comparePriorityItems(first, second) {
  const statusDiff = getStatusRank(first.status) - getStatusRank(second.status)
  if (statusDiff !== 0) return statusDiff
  return Number(first.priority || 99) - Number(second.priority || 99)
}

function getStatusRank(status) {
  if (status === 'error') return 0
  if (status === 'warn') return 1
  return 2
}

function normalizeStatus(status) {
  if (status === 'error' || status === '오류') return 'error'
  if (status === 'warn' || status === 'warning' || status === 'check' || status === '확인 필요') return 'warn'
  return 'ok'
}

function arrayOfObjects(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}
