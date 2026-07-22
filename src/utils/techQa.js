export const TECH_STATUS_LABELS = {
  ok: '정상',
  warn: '확인 필요',
  error: '오류',
  info: '완료',
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
  access: { section: 'planning', owner: '개발팀', label: '페이지 접속 여부', description: '검사 대상 페이지가 브라우저에서 정상으로 열리는지 확인합니다. 접속에 실패하면 사용자가 페이지를 볼 수 없으므로 가장 먼저 확인해야 합니다.' },
  'http-status': { section: 'backend', owner: '개발팀', label: 'HTTP 상태 코드', description: '서버가 페이지 요청에 어떤 응답 코드를 반환했는지 확인합니다. 4xx/5xx는 사용자 접속 실패나 서버 오류로 이어질 수 있습니다.' },
  title: { section: 'seo', owner: 'UID팀', label: 'Title', description: '브라우저 탭과 검색 결과에 표시되는 페이지 제목입니다. 비어 있으면 검색 노출과 사용자 이해에 문제가 생길 수 있습니다.' },
  'console-errors': { section: 'frontend', owner: 'UID팀', label: 'Console error', description: '페이지 실행 중 JavaScript 오류가 발생했는지 확인합니다. 오류가 있으면 버튼, 폼, 화면 동작이 정상 작동하지 않을 수 있습니다.' },
  images: { section: 'frontend', owner: 'UID팀', label: '이미지 로딩', description: '페이지 안의 이미지가 정상으로 불러와졌는지 확인합니다. 실패하면 깨진 이미지가 노출될 수 있습니다.' },
  links: { section: 'link', owner: 'UID팀', label: '링크 수집', description: '페이지 안에서 검사 가능한 링크와 클릭 요소를 수집합니다. 수집 수가 비정상적으로 적으면 DOM 구조나 렌더링을 확인해야 합니다.' },
  'missing-href': { section: 'link', owner: 'UID팀', label: '버튼 URL 검사', description: '이동 목적의 버튼이나 링크에 이동 주소 또는 action 근거가 있는지 확인합니다. 없으면 사용자가 눌러도 정상 페이지로 이동하지 않을 수 있습니다.' },
  'bad-links': { section: 'link', owner: 'UID팀', label: '페이지 링크 검사', description: '수집된 링크를 실제 요청해 4xx/5xx, timeout, 요청 실패를 확인합니다. 문제 링크는 정상 링크보다 먼저 확인해야 합니다.' },
  'interaction-count': { section: 'planning', owner: 'UID팀', label: '클릭 요소 수', description: '페이지의 링크와 버튼 개수를 확인합니다. 예상보다 적거나 많으면 메뉴, CTA, 카드 링크 누락 여부를 점검할 수 있습니다.' },
  mobile: { section: 'planning', owner: 'UID팀', label: '모바일 viewport 검사', description: '모바일 크기에서 페이지가 접속되는지 확인합니다. 모바일 사용자에게 빈 화면이나 오류가 보이는지 판단하는 기본 검사입니다.' },
  meta: { section: 'seo', owner: 'UID팀', label: 'Meta description / OG', description: '검색과 공유에 필요한 기본 메타 정보가 있는지 확인합니다. 누락되면 검색 결과나 SNS 공유 문구가 의도와 다를 수 있습니다.' },
  'image-alt': { section: 'planning', owner: 'UID팀', label: '이미지 alt', description: '의미 있는 이미지에 대체 텍스트가 있는지 확인합니다. 누락되면 접근성과 콘텐츠 검수 품질이 떨어질 수 있습니다.' },
  forms: { section: 'frontend', owner: 'UID팀', label: '폼 라벨', description: '입력 요소에 label 또는 접근성 이름이 연결되어 있는지 확인합니다. 누락되면 사용자가 입력 목적을 이해하기 어렵습니다.' },
  'external-links': { section: 'planning', owner: 'UID팀', label: '새 창 외부 링크', description: '새 창으로 열리는 외부 링크의 보안 속성을 확인합니다. rel 속성이 부족하면 보안과 사용자 보호에 문제가 생길 수 있습니다.' },
  'duplicate-ids': { section: 'frontend', owner: 'UID팀', label: '중복 ID 검사', description: '한 페이지 안에서 같은 ID가 여러 번 사용되는지 확인합니다. 중복 ID는 버튼 동작, 스타일 적용, 접근성 기능에 오류를 만들 수 있습니다.' },
  headings: { section: 'seo', owner: 'UID팀', label: 'Heading hierarchy', description: 'H1과 H2/H3 구조가 자연스러운지 확인합니다. 검색엔진과 보조기기가 페이지 구조를 이해하는 데 영향을 줍니다.' },
  'resource-size': { section: 'frontend', owner: 'UID팀', label: '큰 리소스', description: '용량이 큰 CSS, JS, 이미지 리소스를 확인합니다. 큰 파일은 로딩 지연과 사용자 이탈로 이어질 수 있습니다.' },
  'network-failures': { section: 'backend', owner: '개발팀', label: '네트워크 요청', description: '페이지 구성 중 실패한 API, JS, CSS, 폰트 요청을 확인합니다. API 오류는 데이터 누락이나 기능 실패로 이어질 수 있습니다.' },
  'mobile-overflow': { section: 'frontend', owner: 'UID팀', label: '모바일 가로 스크롤', description: '모바일 화면 너비보다 문서가 넓어지는지 확인합니다. 가로 스크롤은 레이아웃 깨짐으로 보일 수 있습니다.' },
  'click-actions': { section: 'frontend', owner: 'UID팀', label: '클릭 동작 검사', description: '버튼이나 링크처럼 보이는 요소가 실제로 클릭 가능한지 확인합니다. 동작 근거가 없거나 클릭할 수 없으면 사용자가 기능을 사용할 수 없습니다.' },
  'unlabeled-clickables': { section: 'planning', owner: 'UID팀', label: '클릭 가능한 요소 이름', description: '버튼이나 링크에 사용자가 이해할 수 있는 이름이 있는지 확인합니다. 이름이 없으면 화면 낭독기 사용자와 검수자가 기능을 이해하기 어렵습니다.' },
}

const SECTION_TITLES = {
  planning: '기획 QA',
  link: '링크 및 버튼 QA',
  seo: 'SEO QA',
  frontend: 'UI QA',
  backend: 'API·네트워크 QA',
}

export function createTechQaViewModel(result = {}) {
  const checks = arrayOfObjects(result.checks)
  const clickActionGroups = createClickActionGroups(result)
  const links = createLinkItems(result.links)
  const checkItems = checks.map((check) => createCheckItem(check, clickActionGroups))
  const allItems = checkItems.concat(links)
  const priorityItems = allItems.filter(isPriorityItem).sort(comparePriorityItems)
  const normalCheckItems = checkItems.filter((item) => item.status === 'ok').sort(comparePriorityItems)
  const counts = countStatuses(allItems)
  const issueCounts = createTechQaCounts(checkItems, priorityItems)
  const priorityCounts = { error: issueCounts.errorElementCount, warn: issueCounts.warningElementCount, ok: 0 }
  const linkSummary = createLinkSummary(links, result.linkAudit)
  const statusMessage = issueCounts.errorElementCount > 0
    ? `${issueCounts.errorCheckCount}개 검사에서 ${issueCounts.errorElementCount}개 오류 요소가 발견되었습니다.`
    : issueCounts.warningElementCount > 0
      ? `${issueCounts.warningCheckCount}개 검사에서 ${issueCounts.warningElementCount}개 확인 필요 요소가 발견되었습니다.`
      : '배포 차단 오류는 확인되지 않았습니다.'

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
  const actionableChecks = checkItems.filter(isPriorityItem)
  const elementItems = priorityItems.length > 0 ? priorityItems : actionableChecks
  return {
    errorCheckCount: actionableChecks.filter((item) => item.status === 'error').length,
    errorElementCount: countUniqueProblemElements(elementItems, 'error'),
    warningCheckCount: actionableChecks.filter((item) => item.status === 'warn').length,
    warningElementCount: countUniqueProblemElements(elementItems, 'warn'),
    normalCheckCount: checkItems.filter((item) => item.status === 'ok').length,
  }
}

function createCheckItem(check = {}, clickActionGroups = createEmptyClickActionGroups()) {
  const definition = CHECK_DEFINITIONS[check.id] || { section: 'frontend', owner: 'UID팀', label: check.title || check.id || '검사 항목', description: check.detail || '자동 수집한 기술 검사 항목입니다.' }
  const display = check.id === 'click-actions' ? createClickActionDisplay(clickActionGroups, check) : null
  const status = display?.status || normalizeStatus(check.status)
  return {
    id: check.id || definition.label,
    type: 'check',
    section: definition.section,
    title: definition.label || check.title,
    status,
    statusLabel: TECH_STATUS_LABELS[status],
    value: display?.value || check.value || '',
    description: definition.description,
    shortDescription: getShortDescription(definition.description),
    technicalTerm: check.title || definition.label,
    easyExplanation: definition.description,
    example: getCheckExample(check),
    owner: getOwnerForCheck(check, definition),
    categoryLabel: getSectionLabel(definition.section),
    priority: getCheckPriority(check),
    problemItems: getProblemItems(check, display),
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
  const errorDetail = counts.errorCheckCount > 0 ? `${counts.errorCheckCount}개 검사에서 발견` : '오류 검사 없음'
  const warningDetail = counts.warningCheckCount > 0 ? `${counts.warningCheckCount}개 검사에서 확인` : '확인 필요 검사 없음'
  return [
    { label: '페이지 접속', value: `${accessStatus} · HTTP ${result.httpStatus || '응답 없음'}`, status: result.accessible ? 'ok' : 'error' },
    { label: '오류', value: `${counts.errorElementCount}개 요소`, detail: errorDetail, status: counts.errorElementCount > 0 ? 'error' : 'ok' },
    { label: '확인 필요', value: `${counts.warningElementCount}개 요소`, detail: warningDetail, status: counts.warningElementCount > 0 ? 'warn' : 'ok' },
    { label: '정상 검사', value: `${counts.normalCheckCount}개 항목`, detail: `링크 ${linkSummary.total}개 · 이미지 ${imageTotal}개 수집`, status: 'info' },
  ]
}

function createClickActionDisplay(groups, check = {}) {
  const problemItems = groups.actualErrors.concat(groups.warnings)
  const status = groups.actualErrors.length > 0 ? 'error' : groups.warnings.length > 0 ? 'warn' : 'ok'
  const value = problemItems.length > 0 ? `실제 오류 ${groups.actualErrors.length} · 확인 필요 ${groups.warnings.length}` : check.value && normalizeStatus(check.status) === 'ok' ? check.value : '정상'
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
  if (category === 'covered-or-not-interactable' || category === 'no-observable-action' || category === 'missing-navigation-action') return 'actualErrors'
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

function countUniqueProblemElements(items = [], targetStatus = '') {
  const uniqueKeys = new Set()
  let anonymousCount = 0

  items.forEach((item) => {
    const entries = getProblemEntries(item, targetStatus)
    entries.forEach((entry) => {
      const key = getProblemIdentityKey(entry, item)
      if (key) uniqueKeys.add(key)
      else anonymousCount += 1
    })
  })

  return uniqueKeys.size + anonymousCount
}

function getProblemEntries(item = {}, targetStatus = '') {
  const problemItems = arrayOfObjects(item.problemItems)
  if (problemItems.length > 0) return problemItems.filter((entry) => getEntryStatus(entry, item) === targetStatus)
  const rawItems = arrayOfObjects(item.raw?.items)
  if (rawItems.length > 0) return rawItems.filter((entry) => getEntryStatus(entry, item) === targetStatus)
  return item.status === targetStatus ? [item.raw || item] : []
}

function getEntryStatus(entry = {}, parent = {}) {
  if (entry.actionClassification === 'actual-error') return 'error'
  if (entry.actionClassification === 'actionable-warning') return 'warn'
  const status = normalizeStatus(entry.status)
  if (entry.status !== undefined && status !== 'ok') return status
  return normalizeStatus(parent.status)
}

function getProblemIdentityKey(entry = {}, parent = {}) {
  const raw = entry.raw || entry
  const selectors = [raw.selector, raw.domPath, raw.sourceId, raw.auditId]
    .map(normalizeIdentityPart)
    .filter(Boolean)
  if (selectors.length > 0) return `dom:${selectors[0]}`

  const actionEvidence = normalizeIdentityPart(raw.actionEvidence || raw.actionType || raw.formAction || raw.dataHref || raw.dataUrl)
  const href = normalizeIdentityPart(raw.href || raw.url || raw.finalUrl)
  const label = normalizeIdentityPart(raw.label || raw.text || raw.ariaLabel || parent.title)
  if (href && label) return `action:${href}|${label}|${actionEvidence}`
  if (href) return `url:${href}`

  const sourceUrl = normalizeIdentityPart(raw.sourceUrl || raw.source)
  const message = normalizeConsoleMessage(raw.message)
  if (message) return `message:${sourceUrl}|${message}`
  return ''
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

function getSectionLabel(section) {
  if (section === 'seo') return 'SEO'
  if (section === 'frontend') return 'UI'
  if (section === 'backend') return 'API'
  if (section === 'link') return '링크'
  return '기획'
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
