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
            <p className="metric-label">{card.label}</p>
            <p className="metric-value">{card.value}</p>
          </article>
        ))}
      </section>

      <section className="detail-card tech-compact-card" aria-label="우선 확인 필요">
        <SectionHead title="우선 확인 필요" meta={`오류 ${view.counts.error} · 확인 필요 ${view.counts.warn}`} note="문제 항목만 우선 표시합니다." />
        {view.priorityItems.length > 0 ? <TechCompactTable items={view.priorityItems} mode="priority" /> : <p className="empty-row">오류 또는 확인 필요 항목이 없습니다.</p>}
      </section>

      <section className="detail-card tech-compact-card" aria-label="전체 검사 결과">
        <SectionHead title="전체 검사 항목" meta={`${view.checkItems.length}개 항목`} note="상태 우선으로 정렬한 기술 점검표입니다." />
        <TechCompactTable items={view.checkItems} mode="checks" />
      </section>

      <section className="detail-card tech-compact-card" aria-label="링크 및 버튼 검사">
        <SectionHead
          title="링크 및 버튼 검사"
          meta={`전체 ${view.linkSummary.total} · 오류 ${view.linkSummary.error} · 확인 필요 ${view.linkSummary.warn} · 정상 ${view.linkSummary.ok}`}
          note="페이지에서 발견한 링크와 이동 버튼을 실제로 검사한 결과입니다. 오류와 확인 필요 항목을 우선 표시합니다."
        />
        <LinkTable groups={linkGroups} />
      </section>

      <details className="detail-card tech-detail-accordion">
        <summary>
          <span>개발 상세 정보</span>
          <strong>raw selector, request, count</strong>
        </summary>
        <div className="tech-accordion-body">
          <DeveloperInfo view={view} result={result} />
          <RawDetails result={result} />
        </div>
      </details>
    </section>
  )
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
        <Meta label="기술 항목" value={item.technicalTerm || item.raw?.technicalTerm || item.raw?.category} />
        <Meta label="의미" value={item.description} />
        <Meta label="쉬운 설명" value={item.easyExplanation || item.raw?.easyExplanation} />
        <Meta label="발견 결과" value={item.value} />
        <Meta label="영향" value={item.example} />
        <Meta label="우선 확인 팀" value={item.status === 'ok' ? '-' : item.owner} />
        <Meta label="화면 문구" value={item.raw?.label || item.raw?.text} />
        <Meta label="element tag" value={item.raw?.tagName || item.raw?.kind} />
        <Meta label="role" value={item.raw?.role} />
        <Meta label="action type" value={item.raw?.actionType} />
        <Meta label="URL" value={item.raw?.url} />
        <Meta label="resolved URL" value={item.raw?.url} />
        <Meta label="Final URL" value={item.raw?.finalUrl} />
        <Meta label="href" value={item.raw?.href} />
        <Meta label="aria-label" value={item.raw?.ariaLabel} />
        <Meta label="class" value={item.raw?.className} />
        <Meta label="위치" value={item.raw?.section || item.raw?.domPath} />
        <Meta label="selector" value={item.raw?.selector} />
        <Meta label="source" value={item.raw?.source || item.raw?.category} />
        <Meta label="status" value={item.raw?.statusCode ?? item.raw?.status} />
        <Meta label="문제 판정 이유" value={item.raw?.reason || item.raw?.note || item.raw?.detail} />
        <Meta label="error message" value={item.raw?.message || item.raw?.note || item.raw?.detail} />
        <Meta label="request type" value={item.raw?.type} />
        <Meta label="source count" value={item.raw?.sourceCount} />
        <Meta label="확인할 내용" value={item.status === 'ok' ? '' : `${item.owner}에서 ${item.technicalTerm || item.title} 근거를 확인해 주세요.`} />
      </dl>
      <ProblemElementList items={item.raw?.items} owner={item.owner} />
    </details>
  )
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
            <span>기술 항목: {entry.technicalTerm || entry.category || entry.hrefState || '-'}</span>
            <span>요소: {entry.tagName || entry.kind || '-'}{entry.role ? ` / role=${entry.role}` : ''}</span>
            <span>href/action: {entry.href || entry.actionType || entry.actionEvidence || '-'}</span>
            <span>selector: {entry.selector || '-'}</span>
            <span>위치: {entry.section || entry.domPath || '-'}</span>
            <span>확인 이유: {entry.reason || entry.note || entry.message || '-'}</span>
            <span>우선 확인: {entry.owner || owner || '-'}</span>
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

function RawDetails({ result }) {
  const consoleItems = Array.isArray(result.consoleMessages) ? result.consoleMessages : []
  const networkCheck = Array.isArray(result.checks) ? result.checks.find((check) => check.id === 'network-failures') : null
  const clickCheck = Array.isArray(result.checks) ? result.checks.find((check) => check.id === 'click-actions') : null
  const networkItems = Array.isArray(networkCheck?.items) ? networkCheck.items : []
  const clickItems = Array.isArray(result.clickActions) ? result.clickActions : Array.isArray(clickCheck?.items) ? clickCheck.items : []
  return (
    <div className="tech-raw-grid">
      <RawList title="Console raw" items={consoleItems} />
      <RawList title="Network raw" items={networkItems} />
      <RawList title="Click raw" items={clickItems} />
    </div>
  )
}

function RawList({ title, items }) {
  return (
    <details className="tech-detail-list">
      <summary>{title} {items.length}개</summary>
      <ul className="tech-raw-list">
        {items.slice(0, 30).map((item, index) => <li key={`${title}-${index}`}>{formatRawItem(item)}</li>)}
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
  return 'status-ok'
}

export default TechQaPanel
