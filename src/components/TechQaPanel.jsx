import { createTechQaViewModel, getVisibleLinkGroups, TECH_STATUS_LABELS } from '../utils/techQa'
import { formatScanTime } from '../utils/report'

function TechQaPanel({ result, copyStatus, onCopyReport }) {
  const view = createTechQaViewModel(result)
  const linkGroups = getVisibleLinkGroups(view.links)

  return (
    <section className="section-stack tech-qa-panel tech-qa-compact">
      <header className="audit-header tech-qa-header">
        <div className="audit-header-top">
          <div>
            <p className="eyebrow">Tech QA Report · {formatScanTime(result.scannedAt)}</p>
            <h2>{view.title}</h2>
            <p className="target-url">{view.targetUrl}</p>
          </div>
          <button className="secondary-button" type="button" onClick={onCopyReport}>결과 복사</button>
        </div>
        <div className="summary-box">{view.statusMessage}</div>
        {copyStatus ? <p className="copy-status">{copyStatus}</p> : null}
      </header>

      <section className="tech-kpi-grid" aria-label="Tech QA 핵심 요약">
        {view.summaryCards.map((card) => (
          <article className={`metric-card tech-kpi-card ${getStatusClass(card.status)}`} key={card.label}>
            <div className="tech-kpi-title">
              <span className="tech-kpi-icon" aria-hidden="true">{getKpiIcon(card.status)}</span>
              <p className="metric-label">{card.label}</p>
            </div>
            <p className="metric-value">{card.value}</p>
            {card.detail ? <p className="tech-kpi-detail">{card.detail}</p> : null}
          </article>
        ))}
      </section>

      <section className="detail-card tech-compact-card" aria-label="우선 확인 필요">
        <SectionHead
          title="우선 확인 필요"
          meta={`오류 ${view.issueCounts.errorUniqueElementCount}개 · 확인 필요 ${view.issueCounts.warningUniqueElementCount}개`}
          note="실제 조치가 필요한 항목만 우선 표시합니다."
        />
        {view.priorityItems.length > 0 ? <TechCompactTable items={view.priorityItems} mode="priority" /> : <p className="empty-row">오류 또는 확인 필요 항목이 없습니다.</p>}
      </section>

      <section className="detail-card tech-compact-card" aria-label="기본 진단 결과">
        <SectionHead
          title="기본 진단 결과"
          meta={`오류 검사 ${view.issueCounts.errorCheckCount} · 확인 필요 검사 ${view.issueCounts.warningCheckCount} · 정상 검사 ${view.issueCounts.normalCheckCount}`}
          note="핵심 Tech QA 진단 항목은 접지 않고 한 줄 결과로 표시합니다. raw 데이터는 상세 안에 둡니다."
        />
        <TechCompactTable items={view.basicCheckItems} mode="basic" />
      </section>

      <section className="detail-card tech-compact-card" aria-label="링크 및 버튼 검사">
        <SectionHead
          title="링크 및 버튼 검사"
          meta={`전체 ${view.linkSummary.total} · 오류 ${view.linkSummary.error} · 확인 필요 ${view.linkSummary.warn} · 정상 ${view.linkSummary.ok}`}
          note="페이지에서 발견한 링크와 이동 버튼을 실제 요청 결과 기준으로 표시합니다. 오류와 확인 필요 항목을 우선 표시합니다."
        />
        <LinkTable groups={linkGroups} />
      </section>

      <section className="detail-card tech-compact-card" aria-label="클릭 동작 검사">
        <SectionHead
          title="클릭 동작 검사"
          meta={`후보 ${view.clickActionGroups.total} · 안전 클릭 ${result.clickActionAudit?.safeClickAttemptCount || 0}`}
          note="버튼과 링크가 실제 사용자 클릭에 반응하는지 확인합니다. 안전상 클릭 생략, URL 불필요 UI 제어, 정상 검증 완료는 숫자만 표시하고 원본은 개발 상세 정보에서 확인합니다."
        />
        <ClickActionSummary groups={view.clickActionGroups} />
        <ClickActionIssueTable groups={view.clickActionGroups} />
      </section>

      <details className="detail-card tech-detail-accordion">
        <summary>
          <span>개발 상세 정보</span>
          <strong>raw selector, request, count</strong>
        </summary>
        <div className="tech-accordion-body">
          <DeveloperInfo view={view} result={result} />
          <RawDetails view={view} result={result} />
        </div>
      </details>
    </section>
  )
}

function ClickActionSummary({ groups }) {
  if (!groups || !groups.total) return <p className="empty-row">클릭 후보가 없습니다.</p>
  return (
    <div className="tech-click-summary" aria-label="클릭 동작 검사 통계">
      <MetricPill label="실제 오류" value={groups.actualErrors.length} tone="error" />
      <MetricPill label="확인 필요" value={groups.warnings.length} tone="warn" />
      <MetricPill label="안전상 클릭 생략" value={groups.safeSkipped.length} tone="info" />
      <MetricPill label="URL 불필요 UI 제어" value={groups.uiControls.length} tone="ok" />
      <MetricPill label="정상 검증 완료" value={groups.verified.length} tone="ok" />
    </div>
  )
}

function MetricPill({ label, value, tone }) {
  return <div className={`tech-metric-pill status-${tone}`}><span>{label}</span><strong>{value}개</strong></div>
}

function getKpiIcon(status) {
  if (status === 'error') return 'x'
  if (status === 'warn') return '!'
  if (status === 'info') return 'i'
  return '✓'
}

function SectionHead({ title, meta, note }) {
  return (
    <div className="section-title-row tech-section-head">
      <div>
        <h3>{title}</h3>
        {note ? <p className="panel-note relaxed-note">{note}</p> : null}
      </div>
      <span>{meta}</span>
    </div>
  )
}

function TechCompactTable({ items, mode }) {
  if (!items.length) return <p className="empty-row">표시할 항목이 없습니다.</p>
  return (
    <div className={`tech-compact-table is-${mode}`}>
      <div className="tech-table-head">
        <span>검사 항목</span>
        <span>상태</span>
        <span>결과</span>
        <span>우선 확인</span>
        <span>상세</span>
      </div>
      {items.map((item) => <TechTableRow item={item} key={item.id} />)}
    </div>
  )
}

function TechTableRow({ item }) {
  return (
    <div className={`tech-table-row ${getStatusClass(item.status)}`}>
      <div className="tech-table-title">
        <span className="tech-category-chip">{item.categoryLabel || 'Tech'}</span>
        <strong>{item.title}</strong>
      </div>
      <span className={`status-badge ${getStatusClass(item.status)}`}>{TECH_STATUS_LABELS[item.status]}</span>
      <span className="tech-table-value">{item.value || '-'}</span>
      <OwnerBadge owner={item.status === 'ok' ? '-' : item.owner} />
      <IssueDetails item={item} />
    </div>
  )
}

function LinkTable({ groups }) {
  const visible = groups.errors.concat(groups.warnings, groups.normals)
  return (
    <>
      <div className="tech-link-table">
        <div className="tech-link-head">
          <span>상태</span>
          <span>버튼/링크명</span>
          <span>URL</span>
          <span>HTTP</span>
          <span>우선 확인</span>
          <span>상세</span>
        </div>
        {visible.length > 0 ? visible.map((item) => <LinkTableRow item={item} key={item.id} />) : <p className="empty-row">검사된 링크가 없습니다.</p>}
      </div>
      {groups.hiddenWarnings.length > 0 ? <CollapsedRows label={`확인 필요 링크 ${groups.hiddenWarnings.length}개 더보기`} items={groups.hiddenWarnings} /> : null}
      {groups.hiddenNormals.length > 0 ? <CollapsedRows label={`정상 링크 ${groups.hiddenNormals.length}개 더보기`} items={groups.hiddenNormals} /> : null}
    </>
  )
}

function LinkTableRow({ item }) {
  const raw = item.raw || {}
  return (
    <div className={`tech-link-row ${getStatusClass(item.status)}`}>
      <span className={`status-badge ${getStatusClass(item.status)}`}>{TECH_STATUS_LABELS[item.status]}</span>
      <strong>{item.title}</strong>
      <span className="tech-url-cell">{raw.url || raw.href || '-'}</span>
      <span>{raw.statusCode || '-'}</span>
      <OwnerBadge owner={item.status === 'ok' ? '-' : item.owner} />
      <IssueDetails item={item} />
    </div>
  )
}

function ClickActionIssueTable({ groups }) {
  const items = (groups?.actualErrors || []).concat(groups?.warnings || [])
  if (!items.length) return <p className="empty-row">실제 동작 오류는 확인되지 않았습니다.</p>
  return (
    <div className="tech-click-issue-table" aria-label="클릭 동작 오류 및 확인 필요">
      <div className="tech-click-issue-head">
        <span>상태</span>
        <span>화면 문구</span>
        <span>위치</span>
        <span>결과</span>
        <span>우선 확인</span>
        <span>상세</span>
      </div>
      {items.map((item, index) => <ClickActionIssueRow item={item} key={`${index}-${item.auditId || item.selector || item.label || ''}`} />)}
    </div>
  )
}

function ClickActionIssueRow({ item }) {
  const status = item.actionClassification === 'actual-error' || item.status === 'error' ? 'error' : 'warn'
  return (
    <div className={`tech-click-issue-row ${getStatusClass(status)}`}>
      <span className={`status-badge ${getStatusClass(status)}`}>{TECH_STATUS_LABELS[status]}</span>
      <strong>{getElementName(item)}</strong>
      <span>{getUserLocation(item)}</span>
      <span>{formatElementResult(item)}</span>
      <OwnerBadge owner={getUidOwner()} />
      <details className="tech-row-details">
        <summary>상세</summary>
        <div className="tech-problem-elements is-single">
          <ol>
            <ProblemElementCard entry={item} owner={getUidOwner()} />
          </ol>
        </div>
      </details>
    </div>
  )
}

function getUidOwner() {
  return ['UID', '팀'].join('')
}

function formatHitTest(item = {}) {
  if (item.hitTestStatus === 'hitTestPassed' || item.hitTargetSame === true) return '통과'
  if (item.unrelatedOverlay === true && item.overlaySelector) return `unrelated overlay: ${item.overlaySelector}`
  if (item.hitTestStatus === 'hitTestFailed') return 'unrelated overlay 확인 필요'
  if (item.hitTestStatus === 'hitTestNotRun') return '미실행'
  if (item.hitTestStatus === 'hitTestUnavailable') return '확인 불가'
  return ''
}

function getElementName(item = {}, index = null) {
  return item.label || item.text || item.ariaLabel || item.title || item.url || (index === null ? '클릭 요소' : `요소 ${index + 1}`)
}

function formatElementResult(item = {}) {
  if (item.actionClassification === 'actual-error') return item.reason || item.category || '실제 클릭 오류가 확인되었습니다.'
  if (item.actionClassification === 'actionable-warning') return item.reason || item.category || '자동 검사에서 동작 여부를 확정하지 못했습니다.'
  if (item.status === 'error') return item.reason || item.message || item.category || '오류가 확인되었습니다.'
  if (item.status === 'warn') return item.reason || item.message || item.category || '확인이 필요한 항목입니다.'
  return item.reason || item.note || '정상으로 확인되었습니다.'
}

function formatElementIssue(item = {}) {
  return sanitizeUserFacingText(formatElementResult(item))
}

function getEntryStatus(item = {}) {
  if (item.actionClassification === 'actual-error') return 'error'
  if (item.actionClassification === 'actionable-warning') return 'warn'
  if (item.status === 'error' || item.status === 'warn' || item.status === 'ok' || item.status === 'info') return item.status
  return 'warn'
}

function getUserLocation(item = {}) {
  const value = String(item.userLocation || item.area || item.readableArea || item.section || item.sectionPath || '').toLowerCase()
  if (/header|gnb|top/.test(value)) return 'Header'
  if (/nav|menu/.test(value)) return 'Navigation'
  if (/hero|main[\s_-]*visual|kv|visual/.test(value)) return 'Main Visual'
  if (/footer|bottom/.test(value)) return 'Footer'
  if (/modal|dialog|popup/.test(value)) return 'Modal'
  if (/sidebar|side\s*bar|drawer/.test(value)) return 'Sidebar'
  if (/body|content|main/.test(value)) return 'Body'
  return 'Unknown'
}

function sanitizeUserFacingText(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/selector|dom path|stack|https?:\/\/|#[\w-]+|\.[\w-]+|>/.test(text)) return '자동 검사에서는 실제 영향 여부를 확정하지 못했습니다.'
  return text
}

function CollapsedRows({ label, items }) {
  return (
    <details className="tech-detail-list tech-link-more">
      <summary>{label}</summary>
      <div className="tech-link-table is-collapsed">
        {items.map((item) => <LinkTableRow item={item} key={item.id} />)}
      </div>
    </details>
  )
}

function OwnerBadge({ owner }) {
  return <span className="tech-owner-badge">{owner || '-'}</span>
}

function IssueDetails({ item }) {
  if (item.status === 'ok') return <NormalIssueDetails item={item} />
  if (item.type === 'link') return <SingleProblemDetails item={item} />
  const problemItems = item.problemItems || item.raw?.items
  const hasProblemItems = Array.isArray(problemItems) && problemItems.length > 0
  return (
    <details className="tech-row-details">
      <summary>상세</summary>
      <dl className="tech-issue-meta">
        <Meta label="검사 목적" value={item.description} />
        <Meta label="검사 결과" value={formatCurrentResult(item)} />
        {hasProblemItems ? null : <Meta label="확인할 내용" value={formatTeamAction(item)} />}
      </dl>
      {hasProblemItems ? <ProblemElementList items={problemItems} owner={item.owner} /> : <TechnicalInfo raw={item.raw} />}
    </details>
  )
}

function SingleProblemDetails({ item }) {
  return (
    <details className="tech-row-details">
      <summary>상세</summary>
      <div className="tech-problem-elements is-single">
        <ol>
          <ProblemElementCard entry={{ ...item.raw, title: item.title, owner: item.owner }} owner={item.owner} />
        </ol>
      </div>
    </details>
  )
}

function NormalIssueDetails({ item }) {
  return (
    <details className="tech-row-details tech-normal-details">
      <summary>상세</summary>
      <p>{formatNormalDetail(item)}</p>
    </details>
  )
}

function formatCurrentResult(item = {}) {
  return `${TECH_STATUS_LABELS[item.status] || item.status || '확인'}${item.value ? ` · ${item.value}` : ''}`
}

function formatTeamAction(item = {}) {
  if (item.status === 'ok') return '-'
  return `${item.owner || '담당 팀'}에서 해당 항목을 확인해 주세요.`
}

function formatNormalDetail(item = {}) {
  if (item.id === 'access') return `페이지 접속에 성공했습니다.${item.value ? ` ${item.value.replace(/^접속 가능\s*·\s*/, '')}` : ''}`
  if (item.id === 'images') return `${item.value || '이미지 로딩이 정상입니다.'}`
  return `${item.title || '검사 항목'}: ${item.value || '정상'}`
}

function TechnicalInfo({ raw }) {
  const evidence = formatTechnicalEvidence(raw)
  if (!evidence) return null
  return (
    <details className="tech-row-details">
      <summary>기술 정보 보기</summary>
      <dl className="tech-issue-meta">
        <Meta label="기술 정보" value={evidence} />
      </dl>
    </details>
  )
}

function formatTechnicalEvidence(raw = {}) {
  return [
    raw?.technicalTerm || raw?.category ? `technical: ${raw.technicalTerm || raw.category}` : '',
    raw?.tagName || raw?.kind ? `element: ${raw.tagName || raw.kind}` : '',
    raw?.role ? `role: ${raw.role}` : '',
    raw?.text || raw?.ariaLabel || raw?.label ? `text/aria-label: ${raw.text || raw.ariaLabel || raw.label}` : '',
    raw?.selector ? `selector: ${raw.selector}` : '',
    raw?.section ? `section: ${raw.section}` : '',
    raw?.domPath ? `DOM path: ${raw.domPath}` : '',
    raw?.href || raw?.url ? `href/url: ${raw.href || raw.url}` : '',
    raw?.requestUrl ? `request URL: ${raw.requestUrl}` : '',
    raw?.actionType || raw?.actionEvidence ? `action: ${raw.actionType || raw.actionEvidence}` : '',
    raw?.source ? `source: ${raw.source}` : '',
    raw?.viewportState ? `viewport: ${raw.viewportState}` : '',
    raw?.visible !== undefined ? `visible: ${raw.visible}` : '',
    raw?.enabled !== undefined ? `enabled: ${raw.enabled}` : '',
    raw?.pointerEvents ? `pointer-events: ${raw.pointerEvents}` : '',
    raw?.hitTestStatus ? `hit-test: ${raw.hitTestStatus}` : '',
    raw?.hitTargetSelector ? `hit target: ${raw.hitTargetSelector}` : '',
    raw?.overlaySelector ? `overlay: ${raw.overlaySelector}` : '',
    raw?.clickExecuted !== undefined ? `click executed: ${raw.clickExecuted}` : '',
    raw?.observableChange !== undefined ? `observed change: ${raw.observableChange}` : '',
    raw?.safeClickResult?.error || raw?.message ? `raw failure: ${raw.safeClickResult?.error || raw.message}` : '',
    raw?.statusCode ?? raw?.status ? `status: ${raw.statusCode ?? raw.status}` : '',
    raw?.repeatCount ? `repeatCount: ${raw.repeatCount}` : '',
  ].filter(Boolean).join(' · ')
}

function ProblemElementList({ items, owner }) {
  if (!Array.isArray(items) || items.length === 0) return null
  return (
    <div className="tech-problem-elements">
      <strong>확인할 요소 {items.length}개</strong>
      <ol>
        {items.map((entry, index) => <ProblemElementCard entry={entry} owner={owner} index={index} key={`${index}-${entry.selector || entry.url || entry.label || entry.message || ''}`} />)}
      </ol>
    </div>
  )
}

function ProblemElementCard({ entry, owner, index = null }) {
  const team = entry.owner || owner || '담당 팀'
  return (
    <li>
      <strong>{getElementName(entry, index)} · {getUserLocation(entry)}</strong>
      <span>상태: {TECH_STATUS_LABELS[getEntryStatus(entry)] || TECH_STATUS_LABELS[entry.status] || entry.status || '확인 필요'}</span>
      <span>판정 결과: {formatDecisionResult(entry)}</span>
      <span>확인 이유: {formatElementIssue(entry)}</span>
      <span>{team} 확인: {formatTeamCheck(entry)}</span>
      <details className="tech-row-details">
        <summary>기술 정보 보기</summary>
        <dl className="tech-issue-meta">
          <Meta label="tag" value={entry.tagName || entry.kind} />
          <Meta label="role" value={entry.role} />
          <Meta label="text / aria-label" value={entry.text || entry.ariaLabel || entry.label} />
          <Meta label="href/action" value={entry.href || entry.formAction || entry.actionType || entry.actionEvidence} />
          <Meta label="selector" value={entry.selector} />
          <Meta label="section" value={entry.section || entry.sectionPath} />
          <Meta label="DOM path" value={entry.domPath} />
          <Meta label="source URL" value={entry.sourceUrl || entry.source} />
          <Meta label="request URL" value={entry.requestUrl || entry.url || entry.href} />
          <Meta label="source" value={entry.source || entry.category} />
          <Meta label="viewport state" value={entry.viewportState} />
          <Meta label="visible" value={entry.visible} />
          <Meta label="enabled" value={entry.enabled} />
          <Meta label="pointer-events" value={entry.pointerEvents} />
          <Meta label="hit-test state" value={entry.hitTestStatus || formatHitTest(entry)} />
          <Meta label="hit target" value={entry.hitTargetSelector} />
          <Meta label="same element" value={entry.sameElement} />
          <Meta label="descendant match" value={entry.descendantMatch} />
          <Meta label="ancestor match" value={entry.ancestorMatch} />
          <Meta label="unrelated overlay" value={entry.unrelatedOverlay} />
          <Meta label="overlay selector" value={entry.overlaySelector} />
          <Meta label="click executed" value={entry.clickExecuted} />
          <Meta label="observed change" value={entry.observableChange} />
          <Meta label="raw failure" value={entry.safeClickResult?.error || entry.message || entry.stack} />
        </dl>
      </details>
    </li>
  )
}

function formatDecisionResult(entry = {}) {
  const status = TECH_STATUS_LABELS[getEntryStatus(entry)] || '확인 필요'
  return entry.technicalTerm || entry.category || entry.actionClassification ? `${status} · ${entry.technicalTerm || entry.category || entry.actionClassification}` : status
}

function formatTeamCheck(entry = {}) {
  if (entry.actionClassification) return '실제 화면에서 해당 요소를 눌러 의도한 동작이 발생하는지 확인해 주세요.'
  return '해당 항목의 수집 결과와 실제 화면 상태를 확인해 주세요.'
}

function DeveloperInfo({ view, result }) {
  return (
    <div className="developer-info-grid">
      <Meta label="Target URL" value={view.developer.targetUrl} />
      <Meta label="Final URL" value={result.finalUrl || result.targetUrl} />
      <Meta label="Playwright run count" value={view.developer.playwrightRunCount || '-'} />
      <Meta label="발견 링크 수" value={view.linkSummary.discovered} />
      <Meta label="unique URL 수" value={view.linkSummary.uniqueRequestUrlCount} />
      <Meta label="실제 HTTP 요청 수" value={view.linkSummary.actualHttpRequestCount} />
      <Meta label="dedupe 수" value={view.linkSummary.dedupedLinkCount} />
      <Meta label="redirect 수" value={view.linkSummary.redirectCount} />
      <Meta label="4xx" value={view.linkSummary.status4xxCount} />
      <Meta label="5xx" value={view.linkSummary.status5xxCount} />
      <Meta label="timeout" value={view.linkSummary.timeoutCount} />
      <Meta label="console raw" value={view.developer.rawConsoleCount} />
      <Meta label="network raw" value={getCheckItemCount(result, 'network-failures')} />
      <Meta label="click candidates" value={result.clickActionAudit?.candidateCount} />
      <Meta label="safe click count" value={result.clickActionAudit?.safeClickAttemptCount} />
      <Meta label="errorCheckCount" value={view.issueCounts.errorCheckCount} />
      <Meta label="errorEvidenceCount" value={view.issueCounts.errorEvidenceCount} />
      <Meta label="errorUniqueElementCount" value={view.issueCounts.errorUniqueElementCount} />
      <Meta label="warningCheckCount" value={view.issueCounts.warningCheckCount} />
      <Meta label="warningEvidenceCount" value={view.issueCounts.warningEvidenceCount} />
      <Meta label="warningUniqueElementCount" value={view.issueCounts.warningUniqueElementCount} />
      <Meta label="duplicateEvidenceMergedCount" value={view.issueCounts.duplicateEvidenceMergedCount} />
    </div>
  )
}

function RawDetails({ view, result }) {
  const consoleItems = Array.isArray(result.consoleMessages) ? result.consoleMessages : []
  const networkCheck = Array.isArray(result.checks) ? result.checks.find((check) => check.id === 'network-failures') : null
  const clickCheck = Array.isArray(result.checks) ? result.checks.find((check) => check.id === 'click-actions') : null
  const networkItems = Array.isArray(networkCheck?.items) ? networkCheck.items : []
  const clickItems = Array.isArray(result.clickActions) ? result.clickActions : Array.isArray(clickCheck?.items) ? clickCheck.items : []
  return (
    <div className="tech-raw-grid">
      <CountBreakdown items={view.issueCounts.checkBreakdown || []} />
      <RawList title="안전상 클릭 생략 전체" items={view.clickActionGroups.safeSkipped} />
      <RawList title="URL 불필요 UI 제어 전체" items={view.clickActionGroups.uiControls} />
      <RawList title="정상 클릭 검증 전체" items={view.clickActionGroups.verified} />
      <RawList title="Raw click candidates" items={clickItems} />
      <RawList title="Raw console" items={consoleItems} />
      <RawList title="Raw network" items={networkItems} />
    </div>
  )
}

function CountBreakdown({ items }) {
  return (
    <details className="tech-detail-list">
      <summary>Count breakdown {items.length}개 검사</summary>
      <ul className="tech-raw-list">
        {items.map((item) => (
          <li key={`${item.type}-${item.id}`}>
            {item.id} · error evidence {item.errorEvidenceCount} · warning evidence {item.warningEvidenceCount} · unique identities {item.uniqueIdentityCount} · duplicate merged {item.duplicateMergedCount}
          </li>
        ))}
      </ul>
    </details>
  )
}

function RawList({ title, items }) {
  return (
    <details className="tech-detail-list">
      <summary>{title} {items.length}개</summary>
      <ul className="tech-raw-list">
        {items.map((item, index) => <li key={`${title}-${index}`}>{formatRawItem(item)}</li>)}
      </ul>
    </details>
  )
}

function formatRawItem(item = {}) {
  return [item.type || item.tagName || item.kind, item.statusCode, item.url || item.href || item.source, item.selector, item.category, item.reason || item.message].filter(Boolean).join(' · ') || JSON.stringify(item)
}

function getCheckItemCount(result, checkId) {
  const check = Array.isArray(result.checks) ? result.checks.find((item) => item.id === checkId) : null
  return Array.isArray(check?.items) ? check.items.length : 0
}

function Meta({ label, value }) {
  if (value === undefined || value === null || value === '') return null
  return <div><dt>{label}</dt><dd>{String(value)}</dd></div>
}

function getStatusClass(status) {
  if (status === 'error') return 'status-error'
  if (status === 'warn') return 'status-warn'
  if (status === 'info') return 'status-info'
  return 'status-ok'
}

export default TechQaPanel
