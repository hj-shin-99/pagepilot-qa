import { useState } from 'react'
import { createTechQaViewModel, getSectionVisibility, getVisibleLinkGroups, TECH_STATUS_LABELS } from '../utils/techQa'
import { createTechPanelDisplayModel, getBasicCheckDetailId, getMarkupDetailId } from '../utils/techQaPanelView'
import { formatScanTime } from '../utils/report'
import { createTechQaTitle } from '../utils/techTitle'

const MARKUP_ACCESSIBILITY_PRIMARY_IDS = ['meta', 'image-alt', 'external-links']
const MARKUP_ACCESSIBILITY_DETAIL_IDS = ['meta', 'image-alt', 'external-links', 'headings', 'duplicate-ids', 'forms', 'unlabeled-clickables']

function TechQaPanel({ result }) {
  const view = createTechQaViewModel(result)
  const display = createTechPanelDisplayModel(result, view)
  const linkGroups = getVisibleLinkGroups(display.detailRows.linkRows)
  const markupItems = createMarkupAccessibilityItems(display.detailRows.markupRows)
  const techTitle = createTechQaTitle(view.title)
  const scanOptions = view.scanOptions

  return (
    <section className="section-stack tech-qa-panel tech-qa-compact">
      <header className="audit-header tech-qa-header">
        <div className="audit-header-top">
          <div>
            <p className="eyebrow">Tech QA Report · {formatScanTime(result.scannedAt)}</p>
            <h2>{techTitle}</h2>
            <p className="target-url">{view.targetUrl}</p>
          </div>
        </div>
        <div className="summary-box">{formatTechStatusMessage(display)}</div>
      </header>

      <TechCompletionCard completion={display.completion} />

      <section className="detail-card tech-compact-card" id="tech-basic-section" aria-label="주요 검사 결과">
        <SectionHead
          title="주요 검사 결과"
          meta={`오류 검사 ${view.issueCounts.errorCheckCount} · 확인 필요 검사 ${view.issueCounts.warningCheckCount} · 정상 검사 ${view.issueCounts.normalCheckCount}`}
          note="페이지의 주요 Tech QA 검사 결과를 한눈에 확인할 수 있습니다."
        />
        <TechCompactTable items={display.detailRows.basicRows} mode="basic" />
      </section>

      {scanOptions.url ? (
        <section className="detail-card tech-compact-card" id="tech-links-section" aria-label="URL 검사">
          <SectionHead
            title="URL 검사"
            meta={`전체 ${view.linkSummary.total} · 오류 ${view.linkSummary.error} · 확인 필요 ${view.linkSummary.warn} · 정상 ${view.linkSummary.ok}`}
            note="페이지에서 수집한 링크와 이동 URL의 상태를 확인합니다. 실제 클릭이 아닌 href 기준으로 정상 연결, 리다이렉트 및 특수 링크 여부를 검사합니다."
          />
          <LinkTable groups={linkGroups} />
        </section>
      ) : null}

      {scanOptions.click ? (
        <section className="detail-card tech-compact-card" id="tech-click-section" aria-label="클릭 동작 검사">
          <SectionHead
            title="클릭 동작 검사"
            meta={`오류 ${view.clickActionGroups.actualErrors.length} · 확인 필요 ${view.clickActionGroups.warnings.length} · 정상 ${getNormalClickCount(view.clickActionGroups)}`}
            note="버튼과 링크 등 클릭 가능한 요소의 실제 동작을 확인합니다. URL 이동뿐 아니라 새 창, 탭, 아코디언, 모달 등 클릭 전후의 상태 변화를 검사합니다."
          />
          <ClickActionIssueTable rows={display.detailRows.clickRows} />
        </section>
      ) : null}

      {scanOptions.landing ? <LandingPageSection groups={view.landingPageGroups} rows={display.detailRows.landingRows} /> : null}

      {scanOptions.form ? (
        <InteractionAuditSection
          id="tech-form-section"
          title="Form QA"
          ariaLabel="Form QA"
          note="입력 요소의 레이블, 필수값 및 기본 검증 동작을 확인합니다. 실제 데이터 전송 없이 사용자 입력 과정에서 발생하는 검증 반응을 검사합니다."
          emptyMessage="검사할 입력 폼이 없습니다."
          groups={view.formInteractionGroups}
          rows={display.detailRows.formRows}
        />
      ) : null}

      {scanOptions.hover ? (
        <InteractionAuditSection
          id="tech-hover-section"
          title="Hover / Dropdown QA"
          ariaLabel="Hover / Dropdown QA"
          note="Hover, Dropdown 및 Tooltip 요소의 표시와 복원 동작을 확인합니다. Hover 전후의 visibility, ARIA 상태 및 화면 이탈 여부를 검사합니다."
          emptyMessage="검사할 Hover 또는 드롭다운 요소가 없습니다."
          groups={view.hoverInteractionGroups}
          rows={display.detailRows.hoverRows}
        />
      ) : null}

      {scanOptions.modal ? (
        <InteractionAuditSection
          id="tech-modal-section"
          title="Modal QA"
          ariaLabel="Modal QA"
          note="Modal의 열기, 닫기, 포커스 및 스크롤 동작을 확인합니다. ESC, 닫기 버튼, 포커스 이동과 스크롤 잠금 여부를 함께 검사합니다."
          emptyMessage="검사할 모달 트리거가 없습니다."
          groups={view.modalInteractionGroups}
          rows={display.detailRows.modalRows}
        />
      ) : null}

      {scanOptions.scroll ? (
        <InteractionAuditSection
          id="tech-scroll-section"
          title="Scroll QA"
          ariaLabel="Scroll QA"
          note="페이지 스크롤, 하단 도달, 지연 로딩 및 고정 요소의 동작을 확인합니다."
          emptyMessage="검사할 스크롤 결과가 없습니다."
          groups={view.scrollInteractionGroups}
          rows={display.detailRows.scrollRows}
        />
      ) : null}

      {scanOptions.responsive ? (
        <InteractionAuditSection
          id="tech-responsive-section"
          title="Responsive QA"
          ariaLabel="Responsive QA"
          note="Desktop, Tablet, Mobile 화면에서 레이아웃과 가로 넘침 여부를 확인합니다."
          emptyMessage="검사할 반응형 viewport 결과가 없습니다."
          groups={view.responsiveLayoutGroups}
          rows={display.detailRows.responsiveRows}
        />
      ) : null}

      {scanOptions.download ? (
        <InteractionAuditSection
          id="tech-download-section"
          title="Download QA"
          ariaLabel="Download QA"
          note="다운로드 링크의 응답 상태, 파일 형식 및 주요 헤더를 확인합니다."
          emptyMessage="검사 대상 다운로드 링크가 없습니다."
          groups={view.downloadResourceGroups}
          rows={display.detailRows.downloadRows}
        />
      ) : null}

      {scanOptions.cookie ? (
        <InteractionAuditSection
          id="tech-cookie-section"
          title="Cookie QA"
          ariaLabel="Cookie QA"
          note="페이지에서 생성된 쿠키의 출처와 기본 보안 속성을 확인합니다."
          emptyMessage="검사 대상 쿠키가 없습니다."
          groups={view.cookieGroups}
          rows={display.detailRows.cookieRows}
        />
      ) : null}

      {scanOptions.image ? (
        <InteractionAuditSection
          id="tech-image-section"
          title="Image QA"
          ariaLabel="Image QA"
          note="이미지 리소스의 로딩 상태와 실제 해상도 및 렌더링 상태를 확인합니다."
          emptyMessage="검사 대상 이미지가 없습니다."
          groups={view.imageGroups}
          rows={display.detailRows.imageRows}
        />
      ) : null}

      {scanOptions.markup ? <MarkupAccessibilitySection items={markupItems} /> : null}

      <details className="detail-card tech-detail-accordion">
        <summary>
          <span>개발 상세 정보</span>
          <strong>raw selector, request, count</strong>
        </summary>
        <div className="tech-accordion-body">
          <DeveloperInfo view={view} result={result} scanOptions={scanOptions} />
          <RawDetails view={view} result={result} scanOptions={scanOptions} />
        </div>
      </details>
    </section>
  )
}

function TechCompletionCard({ completion }) {
  return (
    <article className="detail-card tech-completion-card" aria-label="Tech QA 검사 완료">
      <div className="tech-completion-main">
        <div>
          <h3>{completion.title}</h3>
          <p className="panel-note relaxed-note">{completion.description}</p>
        </div>
        <ol className="tech-completion-steps" aria-label="Tech QA 검사 완료 단계">
          {completion.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </div>
      {completion.meta.length > 0 ? (
        <dl className="tech-completion-meta">
          {completion.meta.map((item) => <Meta label={item.label} value={item.value} key={item.label} />)}
        </dl>
      ) : null}
    </article>
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
      {items.map((item) => <TechTableRow item={item} key={item.rowKey || item.id} />)}
    </div>
  )
}

function TechTableRow({ item }) {
  return (
    <DetailRow
      id={item.rowId || getBasicCheckDetailId(item)}
      className={`tech-table-row tech-row-details tech-row-with-details ${getStatusClass(item.status)}`}
      detail={<IssueDetails item={item} />}
    >
        <div className="tech-table-title">
          <span className="tech-category-chip">{item.categoryLabel || 'Tech'}</span>
          <strong>{item.title}</strong>
        </div>
        <span className={`status-badge ${getStatusClass(item.status)}`}>{TECH_STATUS_LABELS[item.status]}</span>
        <span className="tech-table-value">{item.value || '-'}</span>
        <OwnerBadge owner={item.status === 'ok' ? '-' : item.owner} />
    </DetailRow>
  )
}

function MarkupAccessibilitySection({ items }) {
  const problemItems = items.filter((item) => item.status !== 'ok')
  const normalItems = items.filter((item) => item.status === 'ok')
  const errorCount = problemItems.filter((item) => item.status === 'error').length
  const warningCount = problemItems.filter((item) => item.status === 'warn').length

  return (
    <section className="detail-card tech-compact-card" id="tech-markup-accessibility-section" aria-label="마크업 및 접근성 검사">
        <SectionHead
          title="마크업 및 접근성 검사"
          meta={`오류 검사 ${errorCount} · 확인 필요 검사 ${warningCount} · 정상 검사 ${normalItems.length}`}
          note="Meta, 이미지 alt, 입력 레이블 등 기본 마크업과 접근성을 확인합니다."
        />
      {problemItems.length > 0 ? (
        <div className="tech-markup-check-list">
          <div className="tech-markup-head">
            <span>검사 항목</span>
            <span>상태</span>
            <span>결과</span>
            <span>우선 확인</span>
            <span>상세</span>
          </div>
          {problemItems.map((item) => <MarkupCheckRow item={item} key={item.rowKey || item.id} />)}
        </div>
      ) : <p className="empty-row">마크업 및 접근성 확인 필요 항목이 없습니다.</p>}
      {normalItems.length > 0 ? <NormalMarkupSummary items={normalItems} /> : null}
    </section>
  )
}

function MarkupCheckRow({ item }) {
  return (
    <DetailRow
      id={item.rowId || getMarkupDetailId(item)}
      className={`tech-table-row tech-row-details tech-row-with-details tech-markup-row tech-markup-check-row ${getStatusClass(item.status)}`}
      detail={<MarkupCheckDetails item={item} />}
    >
      <div className="tech-table-title">
        <span className="tech-category-chip">{item.categoryLabel || 'Markup'}</span>
        <strong>{item.title}</strong>
      </div>
      <span className={`status-badge ${getStatusClass(item.status)}`}>{TECH_STATUS_LABELS[item.status]}</span>
      <span className="tech-table-value">{item.value || '-'}</span>
      <OwnerBadge owner={item.status === 'ok' ? '-' : item.owner} />
    </DetailRow>
  )
}

function MarkupCheckDetails({ item }) {
  const problemItems = Array.isArray(item.problemItems) && item.problemItems.length > 0 ? item.problemItems : item.raw?.items || []
  return (
    <div className="tech-markup-detail">
      <dl className="tech-issue-meta">
        <Meta label="검사 결과" value={formatMarkupCheckResult(item, problemItems)} />
      </dl>
      {problemItems.length > 0 ? <ProblemElementList items={problemItems} owner={item.owner} /> : <p className="tech-normal-note">확인 필요 요소가 없습니다.</p>}
    </div>
  )
}

function NormalMarkupSummary({ items }) {
  return (
    <details className="tech-detail-list tech-normal-markup-list">
      <summary>정상 마크업 및 접근성 검사 {items.length}개</summary>
      <ul className="tech-raw-list">
        {items.map((item) => <li key={item.id}>{item.title} · {item.value || '정상'}</li>)}
      </ul>
    </details>
  )
}

function LinkTable({ groups }) {
  return (
    <>
      <div className="tech-link-table">
        <LinkTableHead />
        {groups.visibleItems.length > 0 ? groups.visibleItems.map((item, index) => <LinkTableRow item={item} key={item.rowKey || getTechRowKey(item, 'link-visible', index)} />) : <p className="empty-row">검사된 링크가 없습니다.</p>}
      </div>
      {groups.hiddenCount > 0 ? <CollapsedRows label={getCollapsedResultsLabel(groups.hiddenCount)} items={groups.hiddenItems} renderHead={() => <LinkTableHead />} renderRow={(item, index) => <LinkTableRow item={item} key={item.rowKey || getTechRowKey(item, 'link-hidden', index)} />} /> : null}
    </>
  )
}

function LinkTableHead() {
  return (
    <div className="tech-link-head">
      <span>상태</span>
      <span>버튼/링크명</span>
      <span>URL</span>
      <span>HTTP</span>
      <span>우선 확인</span>
      <span>상세</span>
    </div>
  )
}

function LinkTableRow({ item }) {
  const raw = item.raw || {}
  return (
    <DetailRow
      id={item.rowId}
      className={`tech-link-row tech-row-details tech-row-with-details ${getStatusClass(item.status)}`}
      summaryClassName="tech-link-row-summary"
      detail={<IssueDetails item={item} />}
    >
        <span className={`status-badge ${getStatusClass(item.status)}`}>{TECH_STATUS_LABELS[item.status]}</span>
        <strong>{item.title}</strong>
        <span className="tech-url-cell">{raw.url || raw.href || '-'}</span>
        <span>{raw.statusCode || '-'}</span>
        <OwnerBadge owner={item.status === 'ok' ? '-' : item.owner} />
    </DetailRow>
  )
}

function ClickActionIssueTable({ rows }) {
  const visibility = getSectionVisibility(rows, { maxVisible: 5, statusOrder: ['error', 'warn', 'info', 'ok'] })
  if (!rows.length) return <p className="empty-row">클릭 후보가 없습니다.</p>
  return (
    <>
      {visibility.visibleItems.length > 0 ? <ClickActionTable id="tech-click-section-table" items={visibility.visibleItems} ariaLabel="클릭 동작 검사 결과" /> : <p className="empty-row">클릭 결과가 없습니다.</p>}
      {visibility.hiddenItems.length > 0 ? <CollapsedClickRows label={getCollapsedResultsLabel(visibility.hiddenItems.length)} items={visibility.hiddenItems} /> : null}
    </>
  )
}

function ClickActionTable({ id, items, ariaLabel, className = '' }) {
  return (
    <div className={`tech-click-issue-table${className ? ` ${className}` : ''}`} id={id} aria-label={ariaLabel}>
      <ClickActionTableHead />
      <div className="tech-click-table-body">
        {items.map((item, index) => <ClickActionRow item={item} key={item.rowKey || getTechRowKey(item, 'click', index)} />)}
      </div>
    </div>
  )
}

function ClickActionTableHead() {
  return (
    <div className="tech-click-issue-head">
      <span>상태</span>
      <span>화면 문구</span>
      <span>위치</span>
      <span>결과</span>
      <span>우선 확인</span>
      <span>상세</span>
    </div>
  )
}

function CollapsedClickRows({ label, items }) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <details className="tech-more-details tech-click-more-details tech-click-more" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className="tech-more-summary">{isOpen ? '접기' : label}</summary>
      <ClickActionTable items={items} ariaLabel={label} className="tech-click-more-table" />
    </details>
  )
}

function ClickActionRow({ item }) {
  return (
    <DetailRow
      id={item.rowId}
      className={`tech-click-issue-row tech-click-row tech-row-details tech-row-with-details ${getStatusClass(item.status)}`}
      summaryClassName="tech-click-row-summary"
      detail={(
        <div className="tech-problem-elements is-single">
          <ol>
            <ProblemElementCard entry={item} owner={item.owner || getUidOwner()} />
          </ol>
        </div>
      )}
    >
        <span className={`status-badge ${getStatusClass(item.status)}`}>{TECH_STATUS_LABELS[item.status]}</span>
        <strong>{item.title || getElementName(item)}</strong>
        <span>{getUserLocation(item)}</span>
        <span>{item.value || formatElementResult(item)}</span>
        <OwnerBadge owner={item.owner || getUidOwner()} />
    </DetailRow>
  )
}

function LandingPageSection({ groups, rows }) {
  const visibleGroups = getVisibleLinkGroups(rows)
  const meta = groups?.hasTargets
    ? `전체 ${groups.total} · 오류 ${groups.errors.length} · 확인 필요 ${groups.warnings.length} · 정상 ${groups.normals.length}`
    : '검사 대상 없음'

  return (
    <section className="detail-card tech-compact-card" id="tech-landing-section" aria-label="랜딩 페이지 검사">
      <SectionHead
        title="랜딩 페이지 검사"
        meta={meta}
        note="수집된 이동 대상 페이지의 응답 상태와 기본 콘텐츠를 확인합니다. 최종 URL, 페이지 콘텐츠 및 주요 오류 여부를 함께 검사합니다."
      />
      {groups?.hasTargets ? (
        <>
          <LandingPageTable items={visibleGroups.visibleItems} />
          {visibleGroups.hiddenCount > 0 ? <CollapsedRows label={getCollapsedResultsLabel(visibleGroups.hiddenCount)} items={visibleGroups.hiddenItems} renderHead={() => <LandingPageTableHead />} renderRow={(item, index) => <LandingPageRow item={item} key={item.rowKey || getTechRowKey(item, 'landing-hidden', index)} />} /> : null}
        </>
      ) : <p className="empty-row">검사할 URL 이동 또는 새 창 결과가 없습니다.</p>}
    </section>
  )
}

function InteractionAuditSection({ id, title, ariaLabel, note, emptyMessage, groups, rows }) {
  const visibility = getSectionVisibility(rows, { maxVisible: 5, statusOrder: ['error', 'warn', 'ok', 'info'] })
  return (
    <section className="detail-card tech-compact-card" id={id} aria-label={ariaLabel}>
      <SectionHead
        title={title}
        meta={formatInteractionSectionMeta(groups)}
        note={note}
      />
      {groups?.hasTargets ? (
        <>
          <InteractionAuditTable items={visibility.visibleItems} label={ariaLabel} />
          {visibility.hiddenItems.length > 0 ? <CollapsedInteractionRows label={getCollapsedResultsLabel(visibility.hiddenItems.length)} items={visibility.hiddenItems} /> : null}
        </>
      ) : <p className="empty-row">{emptyMessage}</p>}
    </section>
  )
}

function InteractionAuditTable({ items, label, className = '' }) {
  if (!items.length) return <p className="empty-row">검사 결과가 없습니다.</p>
  return (
    <div className={`tech-click-issue-table tech-interaction-table${className ? ` ${className}` : ''}`} aria-label={label}>
      <InteractionAuditTableHead />
      <div className="tech-click-table-body">
        {items.map((item, index) => <InteractionAuditRow item={item} key={item.rowKey || getTechRowKey(item, 'interaction', index)} />)}
      </div>
    </div>
  )
}

function InteractionAuditTableHead() {
  return (
    <div className="tech-click-issue-head">
      <span>상태</span>
      <span>검사 대상</span>
      <span>유형</span>
      <span>결과</span>
      <span>우선 확인</span>
      <span>상세</span>
    </div>
  )
}

function CollapsedInteractionRows({ label, items }) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <details className="tech-more-details tech-click-more-details tech-click-more" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className="tech-more-summary">{isOpen ? '접기' : label}</summary>
      <InteractionAuditTable items={items} label={label} className="tech-click-more-table" />
    </details>
  )
}

function InteractionAuditRow({ item }) {
  return (
    <DetailRow
      id={item.rowId}
      className={`tech-click-issue-row tech-click-row tech-row-details tech-row-with-details ${getStatusClass(item.status)}`}
      summaryClassName="tech-click-row-summary"
      detail={<InteractionAuditDetails item={item} />}
    >
      <span className={`status-badge ${getStatusClass(item.status)}`}>{TECH_STATUS_LABELS[item.status] || item.status}</span>
      <strong>{item.title || getElementName(item)}</strong>
      <span>{formatInteractionCategory(item)}</span>
      <span>{item.value || item.note || item.reason || '확인 결과가 기록되었습니다.'}</span>
      <OwnerBadge owner={item.owner || getUidOwner()} />
    </DetailRow>
  )
}

function LandingPageTable({ items }) {
  if (!items.length) return <p className="empty-row">검사된 랜딩 페이지가 없습니다.</p>
  return (
    <div className="tech-link-table" aria-label="랜딩 페이지 검사 결과">
      <LandingPageTableHead />
      <div className="tech-link-table-body">
        {items.map((item, index) => <LandingPageRow item={item} key={item.rowKey || getTechRowKey(item, 'landing-visible', index)} />)}
      </div>
    </div>
  )
}

function LandingPageTableHead() {
  return (
    <div className="tech-link-head">
      <span>상태</span>
      <span>원본 클릭</span>
      <span>랜딩 URL</span>
      <span>HTTP</span>
      <span>우선 확인</span>
      <span>상세</span>
    </div>
  )
}

function LandingPageRow({ item }) {
  return (
    <DetailRow
      id={item.rowId}
      className={`tech-link-row tech-row-details tech-row-with-details ${getStatusClass(item.status)}`}
      summaryClassName="tech-link-row-summary"
      detail={<LandingPageDetails item={item} />}
    >
      <span className={`status-badge ${getStatusClass(item.status)}`}>{TECH_STATUS_LABELS[item.status]}</span>
      <strong>{item.title || item.label || '랜딩 페이지'}</strong>
      <span className="tech-url-cell">{item.finalUrl || item.requestedUrl || '-'}</span>
      <span>{item.statusCode || '-'}</span>
      <OwnerBadge owner={item.owner || getLandingOwner(item)} />
    </DetailRow>
  )
}

function LandingPageDetails({ item }) {
  return (
    <>
      <dl className="tech-issue-meta">
        <Meta label="검사 목적" value="클릭 후 최종 랜딩 페이지가 정상적으로 열리는지 확인합니다." />
        <Meta label="검사 결과" value={formatLandingResult(item)} />
        <Meta label="요청 URL" value={item.requestedUrl} />
        <Meta label="최종 URL" value={item.finalUrl} />
        <Meta label="페이지 title" value={item.pageTitle || 'title 없음'} />
        <Meta label="리다이렉트" value={item.redirected ? '있음' : '없음'} />
        <Meta label="새 창 여부" value={item.openedInNewWindow ? '새 창/새 탭' : '현재 창'} />
        <Meta label="콘텐츠 신호" value={`visible ${item.visibleElementCount || 0} · body child ${item.bodyChildCount || 0} · text ${item.bodyTextLength || 0}`} />
        <Meta label="오류 신호" value={formatLandingErrorSignals(item)} />
      </dl>
      <div className="tech-problem-elements is-single">
        <strong>연결된 원본 클릭 {Array.isArray(item.sources) ? item.sources.length : 0}개</strong>
        <ol>
          {(item.sources || []).map((source, index) => (
            <li key={`${item.auditId || item.requestedUrl}-${index}`}>
              <strong>{source.label || `클릭 요소 ${index + 1}`} · {getUserLocation(source)}</strong>
              <span>클릭 결과: {formatLandingSourceOutcome(source)}</span>
              <span>대상 URL: {source.requestedUrl || '-'}</span>
              <details className="tech-row-details">
                <summary>기술 정보 보기</summary>
                <dl className="tech-issue-meta">
                  <Meta label="selector" value={source.selector} />
                  <Meta label="section" value={source.section} />
                  <Meta label="interaction outcome" value={source.interactionOutcome} />
                </dl>
              </details>
            </li>
          ))}
        </ol>
      </div>
    </>
  )
}

function InteractionAuditDetails({ item }) {
  return (
    <>
      <dl className="tech-issue-meta">
        <Meta label="검사 목적" value={item.description} />
        <Meta label="검사 결과" value={item.value || item.note || item.reason} />
        <Meta label="유형" value={formatInteractionCategory(item)} />
        <Meta label="field type" value={item.inputType || item.type || item.tagName} />
        <Meta label="name" value={item.name} />
        <Meta label="required" value={formatBoolean(item.required)} />
        <Meta label="disabled" value={formatBoolean(item.disabled)} />
        <Meta label="readonly" value={formatBoolean(item.readOnly)} />
        <Meta label="autocomplete" value={item.autocomplete} />
        <Meta label="validation state" value={formatValidationState(item.validationState)} />
        <Meta label="validation message" value={item.validationMessage} />
        <Meta label="aria-invalid" value={item.ariaInvalid} />
        <Meta label="submit attempted" value={formatBoolean(item.submitAttempted)} />
        <Meta label="submit blocked" value={formatBoolean(item.submitBlocked)} />
        <Meta label="request methods" value={formatRequestMethods(item.requestMethods)} />
        <Meta label="viewport" value={item.type} />
        <Meta label="overflow amount" value={item.overflowAmount} />
        <Meta label="status code" value={item.statusCode} />
        <Meta label="final URL" value={item.finalUrl} />
        <Meta label="content-type" value={item.contentType} />
        <Meta label="content-length" value={item.contentLength} />
        <Meta label="content-disposition" value={item.contentDisposition} />
        <Meta label="filename" value={item.filename} />
        <Meta label="source count" value={item.sourceCount} />
        <Meta label="cookie domain" value={item.domain} />
        <Meta label="cookie path" value={item.path} />
        <Meta label="sameSite" value={item.sameSite} />
        <Meta label="secure" value={formatBoolean(item.secure)} />
        <Meta label="httpOnly" value={formatBoolean(item.httpOnly)} />
        <Meta label="session cookie" value={formatBoolean(item.session)} />
        <Meta label="first/third party" value={item.party} />
        <Meta label="hostOnly" value={formatBoolean(item.hostOnly)} />
        <Meta label="expires" value={item.expiresAt} />
        <Meta label="source origin" value={item.sourceOrigin} />
        <Meta label="value length" value={item.valueLength} />
        <Meta label="banner hints" value={Array.isArray(item.bannerHints) ? item.bannerHints.join(' · ') : ''} />
        <Meta label="src" value={item.src} />
        <Meta label="currentSrc" value={item.currentSrc} />
        <Meta label="natural size" value={formatImageSize(item.naturalWidth, item.naturalHeight)} />
        <Meta label="rendered size" value={formatImageSize(item.renderedWidth, item.renderedHeight)} />
        <Meta label="client size" value={formatImageSize(item.clientWidth, item.clientHeight)} />
        <Meta label="object-fit" value={item.objectFit} />
        <Meta label="visible count" value={item.visibleCount} />
        <Meta label="selectors" value={Array.isArray(item.selectors) ? item.selectors.join(' | ') : ''} />
        <Meta label="rendered sizes" value={Array.isArray(item.renderedSizeList) ? item.renderedSizeList.join(' | ') : ''} />
        <Meta label="near bottom" value={formatBoolean(item.nearBottom)} />
        <Meta label="overflow hidden" value={formatBoolean(item.overflowHidden)} />
        <Meta label="lazy images" value={item.lazyImageCount} />
        <Meta label="unresolved lazy images" value={item.unresolvedLazyImageCount} />
        <Meta label="broken lazy images" value={item.brokenLazyImageCount} />
        <Meta label="fixed elements" value={item.fixedElementCount} />
        <Meta label="blocking fixed elements" value={item.blockingFixedElementCount} />
        <Meta label="panel selector" value={item.panelSelector || item.dialogSelector} />
        <Meta label="aria-haspopup" value={item.ariaHaspopup} />
        <Meta label="aria-expanded" value={item.ariaExpanded} />
        <Meta label="accessible name" value={item.accessibleName} />
        <Meta label="close button" value={formatBoolean(item.hasCloseButton)} />
        <Meta label="ESC close" value={formatBoolean(item.escClosed)} />
        <Meta label="backdrop close" value={formatBoolean(item.backdropClosed)} />
        <Meta label="focus moved" value={formatBoolean(item.focusMovedInside)} />
        <Meta label="focus return" value={formatBoolean(item.focusReturned)} />
        <Meta label="scroll lock" value={formatBoolean(item.scrollLocked)} />
        <Meta label="selector" value={item.selector || item.representativeSelector} />
        <Meta label="section" value={item.section} />
      </dl>
      {Array.isArray(item.issues) && item.issues.length > 0 ? (
        <div className="tech-problem-elements is-single">
          <strong>확인 필요 사유 {item.issues.length}개</strong>
          <ol>
            {item.issues.map((entry, index) => <li key={`${item.rowId || item.auditId || item.selector}-${index}`}><span>{entry}</span></li>)}
          </ol>
        </div>
      ) : null}
      <TechnicalInfo raw={item} />
    </>
  )
}

function DetailRow({ id, className, summaryClassName = '', children, detail }) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <details id={id} className={className} open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className={`tech-row-summary${summaryClassName ? ` ${summaryClassName}` : ''}`} aria-label={isOpen ? '상세 닫기' : '상세 열기'} aria-expanded={isOpen}>
        {children}
        <DetailChevron />
      </summary>
      <div className="tech-row-detail-body">
        {detail}
      </div>
    </details>
  )
}

function DetailChevron() {
  return (
    <span className="tech-detail-toggle" aria-hidden="true">
      <span className="tech-detail-chevron">▸</span>
    </span>
  )
}

function createMarkupAccessibilityItems(checkItems = []) {
  return checkItems.filter((item) => {
    if (MARKUP_ACCESSIBILITY_PRIMARY_IDS.includes(item.id)) return true
    return MARKUP_ACCESSIBILITY_DETAIL_IDS.includes(item.id) && item.status !== 'ok'
  })
}

function formatTechStatusMessage() {
  return 'Tech QA 검사가 완료되었습니다. 아래 항목에서 오류 및 확인 필요 결과를 확인해 주세요.'
}

function formatMarkupCheckResult(item = {}, problemItems = []) {
  if (item.id === 'image-alt') return `${item.value || `alt 확인 필요 ${problemItems.length}개`}`
  if (item.id === 'external-links') return `${item.value || `rel 확인 필요 ${problemItems.length}개`}`
  if (item.id === 'meta') return `${item.value || `Meta/OG ${problemItems.length}개 항목 확인 필요`}`
  return `${item.value || `확인 필요 ${problemItems.length}개`}`
}

function getNormalClickCount(groups = {}) {
  return (groups.uiControls || []).length + (groups.verified || []).length
}

function getLandingDisplayStatus(item = {}) {
  if (item.status === 'error' || item.category === 'http-5xx' || item.category === 'http-4xx' || item.category === 'blank-screen') return 'error'
  if (item.status === 'warn') return 'warn'
  return 'ok'
}

function getUidOwner() {
  return ['UID', '팀'].join('')
}

function getDevOwner() {
  return ['개발', '팀'].join('')
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

function formatLandingResult(item = {}) {
  const parts = []
  parts.push(`${TECH_STATUS_LABELS[getLandingDisplayStatus(item)] || '확인'}${item.statusCode ? ` · HTTP ${item.statusCode}` : ''}`)
  if (item.note) parts.push(item.note)
  return parts.join(' · ')
}

function formatLandingErrorSignals(item = {}) {
  const signals = []
  if (item.browserErrorPage) signals.push('브라우저 오류 화면')
  if (item.loadWarning) signals.push(item.loadWarning)
  if (item.navigationError) signals.push(item.navigationError)
  if (Number(item.criticalConsoleErrorCount || 0) > 0) signals.push(`치명적 script error ${item.criticalConsoleErrorCount}건`)
  if (Number(item.advisoryConsoleErrorCount || 0) > 0) signals.push(`참고 console error ${item.advisoryConsoleErrorCount}건`)
  if (Number(item.thirdPartyConsoleErrorCount || 0) > 0) signals.push(`third-party ${item.thirdPartyConsoleErrorCount}건`)
  if (item.unexpectedRedirect) signals.push('예기치 않은 최종 도메인/프로토콜 이동')
  return signals.length > 0 ? signals.join(' · ') : '명확한 오류 신호 없음'
}

function formatLandingSourceOutcome(source = {}) {
  const outcome = String(source.interactionOutcome || '').trim()
  if (outcome === 'new-window') return '새 창 열림'
  if (outcome === 'navigation') return '현재 창 URL 이동'
  if (outcome === 'modal') return '모달 노출'
  if (outcome === 'tab') return '탭/패널 전환'
  if (outcome === 'accordion') return '아코디언 변화'
  if (outcome === 'dropdown') return '메뉴/목록 노출'
  if (outcome === 'scroll') return '스크롤 이동'
  if (outcome === 'ui-change') return '기타 UI 변화'
  if (outcome === 'skipped') return '안전 정책으로 생략'
  if (outcome === 'blocked') return '클릭 불가'
  if (outcome === 'error') return '클릭 오류'
  return outcome || '확인 필요'
}

function formatElementIssue(item = {}) {
  return sanitizeUserFacingText(formatElementResult(item))
}

function getEntryStatus(item = {}) {
  if (item.actionClassification === 'actual-error') return 'error'
  if (item.actionClassification === 'actionable-warning') return 'warn'
  if (item.actionClassification === 'safe-click-skipped') return 'info'
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

function getLandingOwner(item = {}) {
  if (item.category === 'http-5xx' || item.category === 'navigation-failed') return getDevOwner()
  if (item.category === 'timeout' || item.category === 'restricted') return getUidOwner()
  if (item.status === 'error' && Number(item.statusCode || 0) >= 500) return getDevOwner()
  return getUidOwner()
}

function sanitizeUserFacingText(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/selector|dom path|stack|https?:\/\/|#[\w-]+|\.[\w-]+|>/.test(text)) return '자동 검사에서는 실제 영향 여부를 확정하지 못했습니다.'
  return text
}

function CollapsedRows({ label, items, renderHead, renderRow }) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <details className="tech-more-details tech-normal-links-more tech-link-more" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className="tech-more-summary">{isOpen ? '접기' : label}</summary>
      <div className="tech-link-table tech-link-more-table">
        {renderHead()}
        <div className="tech-link-table-body">
          {items.map((item, index) => renderRow(item, index))}
        </div>
      </div>
    </details>
  )
}

function getTechRowKey(item = {}, prefix = 'row', index = 0) {
  return [
    prefix,
    item.id,
    item.auditId,
    item.selector,
    item.finalUrl,
    item.requestedUrl,
    item.url,
    item.href,
    item.label,
    item.title,
    index,
  ].filter(Boolean).join(':')
}

function getCollapsedResultsLabel(count = 0) {
  return `결과 ${count}개 더보기`
}

function formatInteractionSectionMeta(groups = {}) {
  const infoPart = Number(groups.infos?.length || 0) > 0 ? ` · 참고 ${groups.infos.length}` : ''
  return groups?.hasTargets
    ? `전체 ${groups.total} · 오류 ${groups.errors.length} · 확인 필요 ${groups.warnings.length} · 정상 ${groups.normals.length}${infoPart}`
    : '검사 대상 없음'
}

function formatInteractionCategory(item = {}) {
  return item.category || item.inputType || item.type || item.kindHint || item.tagName || '-'
}

function formatValidationState(validationState = {}) {
  if (!validationState || typeof validationState !== 'object') return ''
  const parts = []
  if (validationState.valid === true) parts.push('valid')
  if (validationState.valueMissing === true) parts.push('valueMissing')
  if (validationState.typeMismatch === true) parts.push('typeMismatch')
  if (validationState.patternMismatch === true) parts.push('patternMismatch')
  return parts.join(' · ')
}

function formatBoolean(value) {
  if (value === true) return '예'
  if (value === false) return '아니오'
  return ''
}

function formatRequestMethods(value) {
  return Array.isArray(value) && value.length > 0 ? value.join(', ') : ''
}

function formatImageSize(width, height) {
  const numericWidth = Number(width || 0)
  const numericHeight = Number(height || 0)
  if (numericWidth <= 0 || numericHeight <= 0) return ''
  return `${Math.round(numericWidth)}x${Math.round(numericHeight)}`
}

function getLargeResourceThreshold(item = {}) {
  const detail = String(item.raw?.detail || '').trim()
  return detail.includes('1MB') ? '1MB 이상' : ''
}

function formatResourceSize(value) {
  const size = Number(value)
  if (!Number.isFinite(size) || size <= 0) return '-'
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB (${size} B)`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB (${size} B)`
  return `${size} B`
}

function OwnerBadge({ owner }) {
  return <span className="tech-owner-badge">{owner || '-'}</span>
}

function IssueDetails({ item }) {
  if (item.id === 'resource-size') return <ResourceSizeDetails item={item} />
  if (item.status === 'ok') return <NormalIssueDetails item={item} />
  if (item.type === 'link') return <SingleProblemDetails item={item} />
  const problemItems = item.problemItems || item.raw?.items
  const hasProblemItems = Array.isArray(problemItems) && problemItems.length > 0
  return (
    <>
      <dl className="tech-issue-meta">
        <Meta label="검사 목적" value={item.description} />
        <Meta label="검사 결과" value={formatCurrentResult(item)} />
        {hasProblemItems ? null : <Meta label="확인할 내용" value={formatTeamAction(item)} />}
      </dl>
      {hasProblemItems ? <ProblemElementList items={problemItems} owner={item.owner} /> : <TechnicalInfo raw={item.raw} />}
    </>
  )
}

function ResourceSizeDetails({ item }) {
  const problemItems = Array.isArray(item.problemItems) && item.problemItems.length > 0 ? item.problemItems : Array.isArray(item.raw?.items) ? item.raw.items : []
  const hasProblemItems = problemItems.length > 0
  const threshold = getLargeResourceThreshold(item)
  const resultText = item.status === 'ok'
    ? '정상 · 큰 리소스 없음'
    : hasProblemItems ? `확인 필요 · 기준 초과 ${problemItems.length}개` : item.value || TECH_STATUS_LABELS[item.status] || '확인 필요'
  return (
    <>
      <dl className="tech-issue-meta">
        <Meta label="검사 목적" value={item.description} />
        <Meta label="검사 결과" value={resultText} />
        <Meta label="판정 기준" value={threshold} />
      </dl>
      {hasProblemItems ? <LargeResourceList items={problemItems} threshold={threshold} /> : <p className="tech-normal-note">{item.status === 'ok' ? '1MB 이상으로 수집된 리소스가 없습니다.' : item.raw?.detail || item.value || '세부 리소스 데이터가 없습니다.'}</p>}
    </>
  )
}

function LargeResourceList({ items, threshold }) {
  return (
    <div className="tech-problem-elements">
      <strong>확인할 리소스 {items.length}개</strong>
      <ol>
        {items.map((entry, index) => (
          <li key={`${entry.url || entry.selector || 'resource'}-${index}`}>
            <strong>{entry.url || `리소스 ${index + 1}`}</strong>
            <span>리소스 유형: {entry.type || 'resource'}</span>
            <span>리소스 용량: {formatResourceSize(entry.sizeBytes)}</span>
            {threshold ? <span>큰 리소스 기준: {threshold}</span> : null}
            <span>확인 이유: 1MB 이상으로 수집된 리소스라 로딩 영향 확인이 필요합니다.</span>
            <details className="tech-row-details">
              <summary>기술 정보 보기</summary>
              <dl className="tech-issue-meta">
                <Meta label="resource URL" value={entry.url} />
                <Meta label="resource type" value={entry.type} />
                <Meta label="size bytes" value={entry.sizeBytes} />
                <Meta label="status" value={entry.statusCode || entry.status} />
              </dl>
            </details>
          </li>
        ))}
      </ol>
    </div>
  )
}

function SingleProblemDetails({ item }) {
  return (
    <div className="tech-problem-elements is-single">
      <ol>
        <ProblemElementCard entry={{ ...item.raw, title: item.title, owner: item.owner }} owner={item.owner} />
      </ol>
    </div>
  )
}

function NormalIssueDetails({ item }) {
  return (
    <div className="tech-normal-details">
      <p>{formatNormalDetail(item)}</p>
    </div>
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
  if (item.id === 'resource-size') return '1MB 이상으로 수집된 리소스가 없습니다.'
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
    raw?.linkType ? `link type: ${raw.linkType}` : '',
    raw?.tagName || raw?.kind ? `element: ${raw.tagName || raw.kind}` : '',
    raw?.role ? `role: ${raw.role}` : '',
    raw?.text || raw?.ariaLabel || raw?.label ? `text/aria-label: ${raw.text || raw.ariaLabel || raw.label}` : '',
    raw?.selector ? `selector: ${raw.selector}` : '',
    raw?.section ? `section: ${raw.section}` : '',
    raw?.domPath ? `DOM path: ${raw.domPath}` : '',
    raw?.href || raw?.url ? `href/url: ${raw.href || raw.url}` : '',
    raw?.currentSrc || raw?.src ? `image src: ${raw.currentSrc || raw.src}` : '',
    raw?.finalUrl ? `final URL: ${raw.finalUrl}` : '',
    raw?.domain ? `domain: ${raw.domain}` : '',
    raw?.path ? `path: ${raw.path}` : '',
    raw?.sameSite ? `sameSite: ${raw.sameSite}` : '',
    raw?.contentType ? `content-type: ${raw.contentType}` : '',
    raw?.objectFit ? `object-fit: ${raw.objectFit}` : '',
    raw?.redirected !== undefined ? `redirected: ${raw.redirected}` : '',
    raw?.requestUrl ? `request URL: ${raw.requestUrl}` : '',
    raw?.actionType || raw?.actionEvidence ? `action: ${raw.actionType || raw.actionEvidence}` : '',
    raw?.interactionOutcome ? `interaction outcome: ${raw.interactionOutcome}` : '',
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
    raw?.pageTitle ? `page title: ${raw.pageTitle}` : '',
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
          <Meta label="alt" value={entry.alt} />
          <Meta label="rel" value={entry.rel} />
          <Meta label="meta property/name" value={entry.property || entry.name || (entry.label && /^og:|meta|canonical/i.test(entry.label) ? entry.label : '')} />
          <Meta label="href/action" value={entry.href || entry.formAction || entry.actionType || entry.actionEvidence} />
          <Meta label="link type" value={entry.linkType} />
          <Meta label="requested URL" value={entry.requestUrl || entry.url || entry.href} />
          <Meta label="final URL" value={entry.finalUrl} />
          <Meta label="redirected" value={entry.redirected} />
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
          <Meta label="interaction outcome" value={entry.interactionOutcome} />
          <Meta label="interaction evidence" value={Array.isArray(entry.interactionEvidence) ? entry.interactionEvidence.join(' · ') : ''} />
          <Meta label="landing URL" value={entry.landingUrl} />
          <Meta label="raw evidence" value={entry.category || entry.altReason || entry.altCategory || entry.status} />
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

function DeveloperInfo({ view, result, scanOptions }) {
  const metaItems = [
    { label: 'Target URL', value: view.developer.targetUrl },
    { label: 'Final URL', value: result.finalUrl || result.targetUrl },
    { label: 'Playwright run count', value: view.developer.playwrightRunCount || '-' },
    { label: 'console raw', value: view.developer.rawConsoleCount },
    { label: 'network raw', value: getCheckItemCount(result, 'network-failures') },
    { label: 'errorCheckCount', value: view.issueCounts.errorCheckCount },
    { label: 'errorEvidenceCount', value: view.issueCounts.errorEvidenceCount },
    { label: 'errorUniqueElementCount', value: view.issueCounts.errorUniqueElementCount },
    { label: 'warningCheckCount', value: view.issueCounts.warningCheckCount },
    { label: 'warningEvidenceCount', value: view.issueCounts.warningEvidenceCount },
    { label: 'warningUniqueElementCount', value: view.issueCounts.warningUniqueElementCount },
    { label: 'duplicateEvidenceMergedCount', value: view.issueCounts.duplicateEvidenceMergedCount },
  ]

  if (scanOptions.url) {
    metaItems.splice(3, 0,
      { label: '발견 링크 수', value: view.linkSummary.discovered },
      { label: 'unique URL 수', value: view.linkSummary.uniqueRequestUrlCount },
      { label: '실제 HTTP 요청 수', value: view.linkSummary.actualHttpRequestCount },
      { label: 'dedupe 수', value: view.linkSummary.dedupedLinkCount },
      { label: 'redirect 수', value: view.linkSummary.redirectCount },
      { label: '4xx', value: view.linkSummary.status4xxCount },
      { label: '5xx', value: view.linkSummary.status5xxCount },
      { label: 'timeout', value: view.linkSummary.timeoutCount },
    )
  }

  if (scanOptions.click) {
    metaItems.splice(5, 0,
      { label: 'click candidates', value: result.clickActionAudit?.candidateCount },
      { label: 'safe click count', value: result.clickActionAudit?.safeClickAttemptCount },
    )
  }

  if (scanOptions.landing) {
    metaItems.push(
      { label: 'landing targets', value: view.landingPageGroups?.meta?.candidateCount },
      { label: 'landing audited', value: view.landingPageGroups?.meta?.inspectedCount },
      { label: 'landing redirects', value: view.landingPageGroups?.meta?.redirectCount },
    )
  }

  if (scanOptions.form) {
    metaItems.push(
      { label: 'form candidates', value: view.formInteractionGroups?.meta?.candidateCount },
      { label: 'form audited', value: view.formInteractionGroups?.meta?.inspectedCount },
    )
  }

  if (scanOptions.hover) {
    metaItems.push(
      { label: 'hover candidates', value: view.hoverInteractionGroups?.meta?.candidateCount },
      { label: 'hover audited', value: view.hoverInteractionGroups?.meta?.inspectedCount },
    )
  }

  if (scanOptions.modal) {
    metaItems.push(
      { label: 'modal candidates', value: view.modalInteractionGroups?.meta?.candidateCount },
      { label: 'modal audited', value: view.modalInteractionGroups?.meta?.inspectedCount },
    )
  }

  if (scanOptions.scroll) {
    metaItems.push(
      { label: 'scroll candidates', value: view.scrollInteractionGroups?.meta?.candidateCount },
      { label: 'scroll audited', value: view.scrollInteractionGroups?.meta?.inspectedCount },
    )
  }

  if (scanOptions.responsive) {
    metaItems.push(
      { label: 'responsive candidates', value: view.responsiveLayoutGroups?.meta?.candidateCount },
      { label: 'responsive audited', value: view.responsiveLayoutGroups?.meta?.inspectedCount },
    )
  }

  if (scanOptions.download) {
    metaItems.push(
      { label: 'download candidates', value: view.downloadResourceGroups?.meta?.candidateCount },
      { label: 'download audited', value: view.downloadResourceGroups?.meta?.inspectedCount },
    )
  }

  if (scanOptions.cookie) {
    metaItems.push(
      { label: 'cookie candidates', value: view.cookieGroups?.meta?.candidateCount },
      { label: 'cookie audited', value: view.cookieGroups?.meta?.inspectedCount },
    )
  }

  if (scanOptions.image) {
    metaItems.push(
      { label: 'image candidates', value: view.imageGroups?.meta?.candidateCount },
      { label: 'image audited', value: view.imageGroups?.meta?.inspectedCount },
    )
  }

  return (
    <div className="developer-info-grid">
      {metaItems.map((item) => <Meta label={item.label} value={item.value} key={item.label} />)}
    </div>
  )
}

function RawDetails({ view, result, scanOptions }) {
  const consoleItems = Array.isArray(result.consoleMessages) ? result.consoleMessages : []
  const networkCheck = Array.isArray(result.checks) ? result.checks.find((check) => check.id === 'network-failures') : null
  const clickCheck = Array.isArray(result.checks) ? result.checks.find((check) => check.id === 'click-actions') : null
  const networkItems = Array.isArray(networkCheck?.items) ? networkCheck.items : []
  const clickItems = Array.isArray(result.clickActions) ? result.clickActions : Array.isArray(clickCheck?.items) ? clickCheck.items : []
  const landingCheck = Array.isArray(result.checks) ? result.checks.find((check) => check.id === 'landing-pages') : null
  const landingItems = Array.isArray(result.landingPages) ? result.landingPages : Array.isArray(landingCheck?.items) ? landingCheck.items : []
  const formCheck = Array.isArray(result.checks) ? result.checks.find((check) => check.id === 'form-interaction') : null
  const formItems = Array.isArray(result.formInteractions) ? result.formInteractions : Array.isArray(formCheck?.items) ? formCheck.items : []
  const hoverCheck = Array.isArray(result.checks) ? result.checks.find((check) => check.id === 'hover-interaction') : null
  const hoverItems = Array.isArray(result.hoverInteractions) ? result.hoverInteractions : Array.isArray(hoverCheck?.items) ? hoverCheck.items : []
  const modalCheck = Array.isArray(result.checks) ? result.checks.find((check) => check.id === 'modal-interaction') : null
  const modalItems = Array.isArray(result.modalInteractions) ? result.modalInteractions : Array.isArray(modalCheck?.items) ? modalCheck.items : []
  const scrollCheck = Array.isArray(result.checks) ? result.checks.find((check) => check.id === 'scroll-interaction') : null
  const scrollItems = Array.isArray(result.scrollInteractions) ? result.scrollInteractions : Array.isArray(scrollCheck?.items) ? scrollCheck.items : []
  const responsiveCheck = Array.isArray(result.checks) ? result.checks.find((check) => check.id === 'responsive-layout') : null
  const responsiveItems = Array.isArray(result.responsiveLayouts) ? result.responsiveLayouts : Array.isArray(responsiveCheck?.items) ? responsiveCheck.items : []
  const downloadCheck = Array.isArray(result.checks) ? result.checks.find((check) => check.id === 'download-resource') : null
  const downloadItems = Array.isArray(result.downloadResources) ? result.downloadResources : Array.isArray(downloadCheck?.items) ? downloadCheck.items : []
  const cookieCheck = Array.isArray(result.checks) ? result.checks.find((check) => check.id === 'cookie-security') : null
  const cookieItems = Array.isArray(result.cookieItems) ? result.cookieItems : Array.isArray(cookieCheck?.items) ? cookieCheck.items : []
  const imageCheck = Array.isArray(result.checks) ? result.checks.find((check) => check.id === 'image-rendering') : null
  const imageItems = Array.isArray(result.imageItems) ? result.imageItems : Array.isArray(imageCheck?.items) ? imageCheck.items : []
  return (
    <div className="tech-raw-grid">
      <CountBreakdown items={view.issueCounts.checkBreakdown || []} />
      {scanOptions.click ? <RawList title="안전상 클릭 생략 전체" items={view.clickActionGroups.safeSkipped} /> : null}
      {scanOptions.click ? <RawList title="URL 불필요 UI 제어 전체" items={view.clickActionGroups.uiControls} /> : null}
      {scanOptions.click ? <RawList title="정상 클릭 검증 전체" items={view.clickActionGroups.verified} /> : null}
      {scanOptions.form ? <RawList title="Raw form audits" items={formItems} /> : null}
      {scanOptions.hover ? <RawList title="Raw hover audits" items={hoverItems} /> : null}
      {scanOptions.modal ? <RawList title="Raw modal audits" items={modalItems} /> : null}
      {scanOptions.scroll ? <RawList title="Raw scroll audits" items={scrollItems} /> : null}
      {scanOptions.responsive ? <RawList title="Raw responsive audits" items={responsiveItems} /> : null}
      {scanOptions.download ? <RawList title="Raw download audits" items={downloadItems} /> : null}
      {scanOptions.cookie ? <RawList title="Raw cookie audits" items={cookieItems} /> : null}
      {scanOptions.image ? <RawList title="Raw image audits" items={imageItems} /> : null}
      {scanOptions.landing ? <RawList title="Raw landing audits" items={landingItems} /> : null}
      {scanOptions.click ? <RawList title="Raw click candidates" items={clickItems} /> : null}
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
  return [item.label || item.name, item.type || item.tagName || item.kind, item.statusCode, item.finalUrl || item.requestedUrl || item.url || item.href || item.source || item.currentSrc || item.src, item.selector || item.representativeSelector, item.category, item.reason || item.note || item.message].filter(Boolean).join(' · ') || JSON.stringify(item)
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
