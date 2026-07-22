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
        <SectionHead title="우선 확인 필요" meta={`오류 ${view.issueCounts.errorElementCount}개 요소 · 확인 필요 ${view.issueCounts.warningElementCount}개 요소`} note="실제 조치가 필요한 항목만 우선 표시합니다." />
        {view.priorityItems.length > 0 ? <TechCompactTable items={view.priorityItems} mode="priority" /> : <p className="empty-row">오류 또는 확인 필요 항목이 없습니다.</p>}
      </section>

      <section className="detail-card tech-compact-card" aria-label="기본 진단 결과">
        <SectionHead
          title="기본 진단 결과"
          meta={`오류 검사 ${view.issueCounts.errorCheckCount} · 확인 필요 검사 ${view.issueCounts.warningCheckCount} · 정상 검사 ${view.issueCounts.normalCheckCount}`}
          note="핵심 Tech QA 진단 항목은 접지 않고 항상 한 줄 결과로 표시합니다. 긴 설명과 raw 데이터는 상세 안에 둡니다."
        />
        <TechCompactTable items={view.basicCheckItems} mode="basic" />
      </section>

      <section className="detail-card tech-compact-card" aria-label="링크 및 버튼 검사">
        <SectionHead
          title="링크 및 버튼 검사"
          meta={`전체 ${view.linkSummary.total} · 오류 ${view.linkSummary.error} · 확인 필요 ${view.linkSummary.warn} · 정상 ${view.linkSummary.ok}`}
          note="페이지에서 발견한 링크와 이동 버튼을 실제로 검사한 결과입니다. 오류와 확인 필요 항목을 우선 표시합니다."
        />
        <LinkTable groups={linkGroups} />
      </section>

      <section className="detail-card tech-compact-card" aria-label="클릭 동작 검사">
        <SectionHead
          title="클릭 동작 검사"
          meta={`후보 ${view.clickActionGroups.total} · 안전 클릭 ${result.clickActionAudit?.safeClickAttemptCount || 0}`}
          note="상단 오류/확인 필요 count에는 실제 오류와 조치 가능한 확인 필요만 포함합니다. 안전상 클릭 생략, URL 불필요 UI 제어, 정상 검증 완료는 개발 상세 통계로만 봅니다."
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
        <span>기술 상태</span>
        <span>href/action</span>
        <span>selector/위치</span>
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
      <strong>{item.label || item.text || item.selector || '-'}</strong>
      <span>{item.technicalTerm || item.category || item.hrefState || item.actionClassification || '-'}</span>
      <span className="tech-url-cell">{item.href || item.formAction || item.actionEvidence || item.actionType || '-'}</span>
      <span className="tech-url-cell">{item.selector || item.section || item.domPath || '-'}</span>
      <OwnerBadge owner={getUidOwner()} />
      <details className="tech-row-details">
        <summary>상세</summary>
        <dl className="tech-issue-meta">
          <Meta label="검사 목적" value="사용자가 눌러야 하는 버튼과 링크가 실제로 동작하는지 확인합니다." />
          <Meta label="현재 결과" value={`${TECH_STATUS_LABELS[status]} · ${item.label || item.text || '클릭 요소'}`} />
          <Meta label="왜 확인이 필요한가" value={item.reason || item.note || '자동 검사에서 클릭 동작을 확정하지 못했습니다.'} />
          <Meta label="담당 팀에서 확인할 내용" value={`${getUidOwner()}에서 실제 화면에서 해당 요소를 눌렀을 때 의도한 동작이 발생하는지 확인해 주세요.`} />
          <Meta label="기술 근거" value={formatTechnicalEvidence(item)} />
        </dl>
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
  return (
    <details className="tech-row-details">
      <summary>상세</summary>
      <dl className="tech-issue-meta">
        <Meta label="검사 목적" value={item.description} />
        <Meta label="현재 결과" value={formatCurrentResult(item)} />
        <Meta label="왜 확인이 필요한가" value={formatCheckReason(item)} />
        <Meta label="담당 팀에서 확인할 내용" value={formatTeamAction(item)} />
        <Meta label="기술 근거" value={formatTechnicalEvidence(item.raw)} />
        <Meta label="우선 확인 팀" value={item.status === 'ok' ? '-' : item.owner} />
      </dl>
      <ProblemElementList items={item.problemItems || item.raw?.items} owner={item.owner} />
    </details>
  )
}

function formatCurrentResult(item = {}) {
  return `${TECH_STATUS_LABELS[item.status] || item.status || '확인'}${item.value ? ` · ${item.value}` : ''}`
}

function formatCheckReason(item = {}) {
  if (item.status === 'ok') return '자동 검사에서 정상 근거가 확인되었습니다.'
  return item.raw?.reason || item.raw?.note || item.raw?.detail || item.shortDescription || '자동 검사에서 사용자가 실제로 겪을 수 있는 문제인지 확인이 필요합니다.'
}

function formatTeamAction(item = {}) {
  if (item.status === 'ok') return '-'
  return `${item.owner || '담당 팀'}에서 실제 화면 동작과 수집 근거를 확인해 주세요.`
}

function formatTechnicalEvidence(raw = {}) {
  return [
    raw?.technicalTerm || raw?.category ? `technical: ${raw.technicalTerm || raw.category}` : '',
    raw?.tagName || raw?.kind ? `element: ${raw.tagName || raw.kind}` : '',
    raw?.role ? `role: ${raw.role}` : '',
    raw?.selector ? `selector: ${raw.selector}` : '',
    raw?.href || raw?.url ? `href/url: ${raw.href || raw.url}` : '',
    raw?.actionType || raw?.actionEvidence ? `action: ${raw.actionType || raw.actionEvidence}` : '',
    raw?.source ? `source: ${raw.source}` : '',
    raw?.viewportState ? `viewport: ${raw.viewportState}` : '',
    raw?.hitTestStatus ? `hit-test: ${raw.hitTestStatus}` : '',
    raw?.hitTargetSelector ? `hit target: ${raw.hitTargetSelector}` : '',
    raw?.overlaySelector ? `overlay: ${raw.overlaySelector}` : '',
    raw?.clickExecuted !== undefined ? `click executed: ${raw.clickExecuted}` : '',
    raw?.observableChange !== undefined ? `observed change: ${raw.observableChange}` : '',
    raw?.statusCode ?? raw?.status ? `status: ${raw.statusCode ?? raw.status}` : '',
    raw?.repeatCount ? `repeatCount: ${raw.repeatCount}` : '',
  ].filter(Boolean).join(' · ')
}

function ProblemElementList({ items, owner }) {
  if (!Array.isArray(items) || items.length === 0) return null
  return (
    <div className="tech-problem-elements">
      <strong>문제 요소 {items.length}개</strong>
      <ol>
        {items.map((entry, index) => (
          <li key={`${index}-${entry.selector || entry.url || entry.label || entry.message || ''}`}>
            <strong>{entry.label || entry.text || entry.url || entry.selector || `요소 ${index + 1}`}</strong>
            <span>상태: {TECH_STATUS_LABELS[entry.status] || entry.status || '확인 필요'}</span>
            <span>확인 이유: {entry.reason || entry.note || '자동 검사에서 동작을 확정하지 못했습니다.'}</span>
            <span>확인할 내용: {entry.owner || owner || '담당 팀'}에서 실제 화면 동작을 확인해 주세요.</span>
            <details className="tech-row-details">
              <summary>기술 상세</summary>
              <dl className="tech-issue-meta">
                <Meta label="tag" value={entry.tagName || entry.kind} />
                <Meta label="role" value={entry.role} />
                <Meta label="selector" value={entry.selector} />
                <Meta label="href/action" value={entry.href || entry.actionType || entry.actionEvidence} />
                <Meta label="source" value={entry.source || entry.category} />
                <Meta label="viewport state" value={entry.viewportState} />
                <Meta label="hit-test state" value={entry.hitTestStatus || formatHitTest(entry)} />
                <Meta label="hit target" value={entry.hitTargetSelector} />
                <Meta label="same element" value={entry.sameElement} />
                <Meta label="descendant match" value={entry.descendantMatch} />
                <Meta label="ancestor match" value={entry.ancestorMatch} />
                <Meta label="unrelated overlay" value={entry.unrelatedOverlay} />
                <Meta label="overlay selector" value={entry.overlaySelector} />
                <Meta label="click executed" value={entry.clickExecuted} />
                <Meta label="observed change" value={entry.observableChange} />
                <Meta label="raw error" value={entry.safeClickResult?.error || entry.message} />
              </dl>
            </details>
          </li>
        ))}
      </ol>
    </div>
  )
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
      <RawList title="안전상 클릭 생략 전체" items={view.clickActionGroups.safeSkipped} />
      <RawList title="URL 불필요 UI 제어 전체" items={view.clickActionGroups.uiControls} />
      <RawList title="정상 클릭 검증 전체" items={view.clickActionGroups.verified} />
      <RawList title="Raw click candidates" items={clickItems} />
      <RawList title="Raw console" items={consoleItems} />
      <RawList title="Raw network" items={networkItems} />
    </div>
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
