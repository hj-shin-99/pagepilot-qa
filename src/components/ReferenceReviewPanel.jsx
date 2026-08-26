import { useState } from 'react'
import {
  confirmReferenceItem,
  createConfirmedReferenceMap,
  createExpectedUrlDisplayRows,
  createReferenceReviewSummary,
  editReferenceItem,
  excludeReferenceItem,
} from '../utils/referenceReview'

function ReferenceReviewPanel({ referenceMap, items, meta, confirmedReferenceMap, isDisabled, onItemsChange, onApply }) {
  const [editingId, setEditingId] = useState('')
  const [draft, setDraft] = useState(createEmptyDraft())
  const summary = createReferenceReviewSummary(items)
  const coverage = meta?.coverage || {}
  const rowCoverage = coverage.rowCoverage || coverage
  const urlEvidenceCoverage = coverage.urlEvidenceCoverage || {}
  const chunking = meta?.chunking || {}

  const startEdit = (item) => {
    setEditingId(item.referenceId)
    setDraft({
      label: item.element?.label || '',
      aliases: (item.element?.aliases || []).join(', '),
      urls: (item.expected?.urls || []).map((url) => url.raw || '').join('\n'),
    })
  }

  const cancelEdit = () => {
    setEditingId('')
    setDraft(createEmptyDraft())
  }

  const saveEdit = (referenceId) => {
    const urls = draft.urls.split(/\r?\n/).map((url) => url.trim()).filter(Boolean)
    onItemsChange(editReferenceItem(items, referenceId, { label: draft.label, aliases: draft.aliases, urls }))
    cancelEdit()
  }

  const applyReference = () => {
    onApply(createConfirmedReferenceMap(referenceMap, items))
  }

  return (
    <section className="reference-review-panel" aria-label="Reference Map Preview">
      <div className="reference-review-header">
        <div>
          <h3>Reference Map Preview</h3>
          <p>미검토 항목은 적용 대상에서 제외됩니다. Confirm 또는 Edit 저장 후 적용하세요.</p>
          <p>Row Coverage와 URL Evidence는 별도 지표입니다.</p>
        </div>
        <div className="reference-review-summary" aria-label="Reference review summary">
          <span>선택 sheet {formatSelectedSheets(meta?.selectedSheetNames)}</span>
          <span>Row Coverage {rowCoverage.mappedCandidateRows ?? meta?.outputItemCount ?? 0}/{rowCoverage.totalCandidateRows ?? 0}</span>
          <span>URL Evidence {urlEvidenceCoverage.classifiedGroundedUrls ?? 0}개 분류 완료 / 검토 필요 {urlEvidenceCoverage.reviewNeededUrls ?? 0}개</span>
          <span>Expected URL {urlEvidenceCoverage.expectedGroundedUrls ?? 0}</span>
          <span>chunk {chunking.successfulChunkCount ?? 0}/{chunking.chunkCount ?? 0}</span>
          <span>적용 {summary.confirmed}</span>
          <span>수정 {summary.edited}</span>
          <span>제외 {summary.excluded}</span>
          <span>미검토 {summary.pending}</span>
        </div>
      </div>

      {meta?.warnings?.length ? (
        <p className="reference-review-warning">정규화 경고: {meta.warnings.join(', ')}</p>
      ) : null}
      {chunking.failedChunkCount > 0 ? (
        <p className="reference-review-warning">일부 후보는 AI 해석에 실패하여 검토 필요 상태로 남았습니다.</p>
      ) : null}

      <div className="reference-review-list">
        {items.map((item) => {
          const urls = item.expected?.urls || []
          const urlRows = createExpectedUrlDisplayRows(item)
          const evidenceSummary = summarizeUrlEvidence(item.urlEvidence)
          const status = item.userDecision?.status || 'pending'
          const isLowConfidence = Number(item.confidence) < 0.75
          const isUnmapped = item.isUnmappedCandidate === true
          const isEditing = editingId === item.referenceId

          return (
            <article className={`reference-review-item is-${status} ${isLowConfidence ? 'is-low-confidence' : ''} ${isUnmapped ? 'is-unmapped' : ''}`} key={item.referenceId}>
              <div className="reference-review-item-main">
                <div>
                  <span className="reference-status-badge">{isUnmapped && status === 'pending' ? 'AI 미매핑 / 검토 필요' : formatStatus(status, item.userDecision?.edited)}</span>
                  {isLowConfidence ? <span className="reference-confidence-badge">검토 필요</span> : null}
                  {item.duplicateCandidate ? <span className="reference-confidence-badge">중복 후보</span> : null}
                </div>
                <h4>{item.element?.label || '이름 없는 항목'}</h4>
                <dl className="reference-review-facts">
                  <div>
                    <dt>Expected URL</dt>
                    <dd>{renderExpectedUrls(item.referenceId, urlRows)}</dd>
                  </div>
                  <div>
                    <dt>URL Evidence</dt>
                    <dd>Expected {urls.length} · 설명 {evidenceSummary.descriptiveOnly} · template {evidenceSummary.parameterTemplate} · 검토 {evidenceSummary.reviewNeeded}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{item.source?.sheetName || 'Unknown'} · Row {item.source?.rowNumber || '-'}</dd>
                  </div>
                  <div>
                    <dt>Evidence</dt>
                    <dd>{item.source?.evidenceText || '근거 없음'}</dd>
                  </div>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{formatConfidence(item.confidence)}</dd>
                  </div>
                </dl>
              </div>

              {isEditing ? (
                <div className="reference-edit-form" aria-label="Reference 항목 수정">
                  <label>
                    <span>Element label</span>
                    <input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
                  </label>
                  <label>
                    <span>Aliases</span>
                    <input value={draft.aliases} placeholder="쉼표로 구분" onChange={(event) => setDraft({ ...draft, aliases: event.target.value })} />
                  </label>
                  <label>
                    <span>Expected URL</span>
                    <textarea value={draft.urls} rows={Math.max(2, urls.length)} onChange={(event) => setDraft({ ...draft, urls: event.target.value })} />
                  </label>
                  <div className="reference-review-actions">
                    <button type="button" disabled={isDisabled} onClick={() => saveEdit(item.referenceId)}>Edit 저장</button>
                    <button type="button" disabled={isDisabled} onClick={cancelEdit}>취소</button>
                  </div>
                </div>
              ) : (
                <div className="reference-review-actions">
                  <button type="button" disabled={isDisabled} onClick={() => onItemsChange(confirmReferenceItem(items, item.referenceId))}>Confirm</button>
                  <button type="button" disabled={isDisabled} onClick={() => startEdit(item)}>Edit</button>
                  <button type="button" disabled={isDisabled} onClick={() => onItemsChange(excludeReferenceItem(items, item.referenceId))}>Exclude</button>
                </div>
              )}
            </article>
          )
        })}
      </div>

      <div className="reference-apply-row">
        <button className="primary-button reference-apply-button" type="button" disabled={isDisabled || items.length === 0} onClick={applyReference}>Reference 적용</button>
        {confirmedReferenceMap ? (
          <p>Reference 적용 완료: 적용 {confirmedReferenceMap.reviewSummary.confirmed}개, 제외 {confirmedReferenceMap.reviewSummary.excluded}개, 미검토 {confirmedReferenceMap.reviewSummary.pending}개</p>
        ) : (
          <p>Pending 또는 Excluded 항목은 confirmedReferenceMap에 포함되지 않습니다.</p>
        )}
      </div>
    </section>
  )
}

function createEmptyDraft() {
  return { label: '', aliases: '', urls: '' }
}

function renderExpectedUrls(referenceId, urlRows) {
  if (urlRows.length === 0) return <span>URL 없음</span>
  if (urlRows.length === 1) return <code>{urlRows[0]}</code>
  return <span className="reference-url-list">{urlRows.map((raw) => <code key={`${referenceId}-${raw}`}>{raw}</code>)}</span>
}

function formatStatus(status, edited) {
  if (status === 'confirmed' && edited) return 'Edited'
  if (status === 'confirmed') return 'Confirmed'
  if (status === 'excluded') return 'Excluded'
  return 'Pending'
}

function formatConfidence(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  return `${Math.round(number * 100)}%`
}

function formatSelectedSheets(sheetNames = []) {
  if (!Array.isArray(sheetNames) || sheetNames.length === 0) return '-'
  if (sheetNames.length <= 2) return sheetNames.join(', ')
  return `${sheetNames.slice(0, 2).join(', ')} 외 ${sheetNames.length - 2}`
}

function summarizeUrlEvidence(urlEvidence = []) {
  const urls = Array.isArray(urlEvidence) ? urlEvidence : []
  return {
    descriptiveOnly: urls.filter((url) => url.classification === 'descriptive-only').length,
    parameterTemplate: urls.filter((url) => url.classification === 'parameter-template').length,
    reviewNeeded: urls.filter((url) => url.classification === 'review-needed').length,
  }
}

export default ReferenceReviewPanel
