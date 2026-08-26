import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReferenceReviewPanel from './ReferenceReviewPanel'
import { analyzeReferenceFile, normalizeReference } from '../utils/referenceQa'
import {
  createReferenceFileSelectionState,
  createReferenceNormalizeFailureState,
  createReferenceNormalizeSuccessState,
  resetReferenceReviewState,
  updateReferenceSheetDraftSelection,
} from '../utils/referenceReview'

function ReferenceQaModal({ isDisabled, onReferenceApply }) {
  const [isOpen, setIsOpen] = useState(false)
  const [referenceState, setReferenceState] = useState(() => resetReferenceReviewState())
  const [selectedSheetNames, setSelectedSheetNames] = useState([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isNormalizing, setIsNormalizing] = useState(false)
  const triggerRef = useRef(null)
  const dialogRef = useRef(null)
  const shouldRestoreFocusRef = useRef(false)
  const titleId = 'reference-qa-dialog-title'
  const descriptionId = 'reference-qa-dialog-description'
  const confirmedCount = referenceState.confirmedReferenceMap?.items?.length || 0
  const triggerLabel = confirmedCount > 0 ? `Reference QA 적용 중 · ${confirmedCount}개` : 'Reference QA 선택 사항'
  const sheetSummaries = referenceState.analyzedReference?.sheetSummaries || []

  useEffect(() => {
    if (!isOpen && shouldRestoreFocusRef.current) {
      shouldRestoreFocusRef.current = false
      window.setTimeout(() => triggerRef.current?.focus(), 0)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.setTimeout(() => focusFirstDialogControl(dialogRef.current), 0)
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return undefined
    const handleWindowKeyDown = (event) => {
      if (event.key !== 'Escape' && event.code !== 'Escape') return
      event.preventDefault()
      closeModal()
    }
    window.addEventListener('keydown', handleWindowKeyDown, true)
    return () => window.removeEventListener('keydown', handleWindowKeyDown, true)
  }, [isOpen])

  const openModal = () => {
    if (isDisabled) return
    setIsOpen(true)
  }

  const closeModal = () => {
    shouldRestoreFocusRef.current = true
    setIsOpen(false)
  }

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] || null
    setSelectedSheetNames([])
    setReferenceState(createReferenceFileSelectionState(file))
    if (typeof onReferenceApply === 'function') onReferenceApply(null)
  }

  const handleAnalyze = async () => {
    if (!referenceState.selectedFile || isAnalyzing || isNormalizing) return

    setIsAnalyzing(true)
    setSelectedSheetNames([])
    setReferenceState((current) => ({ ...current, analyzedReference: null, referenceMap: null, reviewItems: [], confirmedReferenceMap: null, referenceMeta: null, normalizedSheetNames: [], referenceError: '' }))
    if (typeof onReferenceApply === 'function') onReferenceApply(null)

    try {
      const analyzedReference = await analyzeReferenceFile(referenceState.selectedFile)
      setReferenceState((current) => ({ ...current, analyzedReference, referenceError: '' }))
    } catch (error) {
      setReferenceState((current) => ({ ...current, analyzedReference: null, referenceMap: null, reviewItems: [], confirmedReferenceMap: null, referenceMeta: null, normalizedSheetNames: [], referenceError: error instanceof Error ? error.message : 'Reference 분석에 실패했습니다.' }))
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleNormalize = async () => {
    if (!referenceState.analyzedReference || selectedSheetNames.length === 0 || isAnalyzing || isNormalizing) return

    const normalizedSelection = [...selectedSheetNames]
    setIsNormalizing(true)
    setReferenceState((current) => ({ ...current, referenceError: '' }))

    try {
      const normalized = await normalizeReference(referenceState.analyzedReference, { selectedSheetNames: normalizedSelection })
      setReferenceState((current) => createReferenceNormalizeSuccessState(current, normalized, normalizedSelection))
      if (typeof onReferenceApply === 'function') onReferenceApply(null)
    } catch (error) {
      setReferenceState((current) => createReferenceNormalizeFailureState(current, error instanceof Error ? error.message : 'Reference 정규화에 실패했습니다.'))
    } finally {
      setIsNormalizing(false)
    }
  }

  const handleSheetToggle = (sheetName, checked) => {
    setSelectedSheetNames((current) => updateReferenceSheetDraftSelection(current, sheetName, checked))
  }

  const handleItemsChange = (reviewItems) => {
    setReferenceState((current) => ({ ...current, reviewItems, confirmedReferenceMap: null }))
    if (typeof onReferenceApply === 'function') onReferenceApply(null)
  }

  const handleApply = (confirmedReferenceMap) => {
    setReferenceState((current) => ({ ...current, confirmedReferenceMap }))
    if (typeof onReferenceApply === 'function') onReferenceApply(confirmedReferenceMap)
  }

  const handleDialogKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeModal()
      return
    }
    if (event.key !== 'Tab') return
    keepFocusInsideDialog(event, dialogRef.current)
  }

  const handleBackdropMouseDown = (event) => {
    if (event.target !== event.currentTarget) return
    closeModal()
  }

  return (
    <div className="reference-qa-modal" aria-label="Reference QA">
      <span className="tech-scan-options-secondary-row reference-qa-trigger-row">
        <span className="tech-scan-options-status-check" aria-hidden="true">✓</span>
        <button
          ref={triggerRef}
          className="tech-scan-options-trigger reference-qa-trigger"
          type="button"
          disabled={isDisabled}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-controls="reference-qa-dialog"
          onClick={openModal}
        >
          <span className="tech-scan-options-link">
            <span>{triggerLabel}</span>
            <span className="tech-scan-options-chevron" aria-hidden="true" />
          </span>
        </button>
      </span>

      {isOpen ? createPortal((
        <div className="tech-scan-options-backdrop reference-qa-backdrop" onMouseDown={handleBackdropMouseDown}>
          <section
            ref={dialogRef}
            id="reference-qa-dialog"
            className="tech-scan-options-dialog reference-qa-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
          >
            <span className="tech-scan-options-sheet-handle" aria-hidden="true" />
            <header className="tech-scan-options-dialog-header">
              <div>
                <h2 id={titleId}>Reference QA</h2>
                <p id={descriptionId}>파일 분석, sheet 선택, 정규화 Preview를 순서대로 검토하세요.</p>
              </div>
              <button className="tech-scan-options-close-button" type="button" onClick={closeModal} aria-label="닫기" title="닫기">
                <span aria-hidden="true">×</span>
              </button>
            </header>

            <div className="tech-scan-options-body reference-qa-body">
              <section className="reference-upload-card" aria-label="Reference File 선택">
                <div className="reference-upload-copy">
                  <h3>파일 선택</h3>
                  <p>IA / 기능정의서 / Sitemap Excel (.xlsx)을 업로드하면 Expected Navigation Map을 미리 검토할 수 있습니다.</p>
                </div>
                <div className="reference-upload-controls reference-file-action-row">
                  <label className="reference-file-picker" htmlFor="reference-file-input">
                    <span>{referenceState.selectedFile ? '다른 Reference 선택' : 'Reference Excel 선택'}</span>
                    <input
                      id="reference-file-input"
                      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      type="file"
                      disabled={isDisabled || isAnalyzing || isNormalizing}
                      onChange={handleFileChange}
                    />
                  </label>
                  <button className="reference-analyze-button" type="button" disabled={!referenceState.selectedFile || isDisabled || isAnalyzing || isNormalizing} onClick={handleAnalyze}>
                    {isAnalyzing ? '분석 중...' : '분석'}
                  </button>
                </div>
                {referenceState.selectedFile ? <p className="reference-selected-file">선택됨: {referenceState.selectedFile.name}</p> : null}
                {referenceState.referenceError ? <p className="start-error reference-error">{referenceState.referenceError}</p> : null}
              </section>

              {referenceState.analyzedReference ? (
                <SheetSelection
                  sheetSummaries={sheetSummaries}
                  selectedSheetNames={selectedSheetNames}
                  isDisabled={isDisabled || isAnalyzing || isNormalizing}
                  onSheetToggle={handleSheetToggle}
                  onNormalize={handleNormalize}
                  isNormalizing={isNormalizing}
                />
              ) : null}

              {referenceState.referenceMap ? (
                <ReferenceReviewPanel
                  referenceMap={referenceState.referenceMap}
                  items={referenceState.reviewItems}
                  meta={referenceState.referenceMeta}
                  confirmedReferenceMap={referenceState.confirmedReferenceMap}
                  isDisabled={isDisabled || isAnalyzing || isNormalizing}
                  onItemsChange={handleItemsChange}
                  onApply={handleApply}
                />
              ) : null}
            </div>
          </section>
        </div>
      ), document.body) : null}
    </div>
  )
}

function SheetSelection({ sheetSummaries, selectedSheetNames, isDisabled, isNormalizing, onSheetToggle, onNormalize }) {
  return (
    <section className="reference-upload-card reference-sheet-selection" aria-label="Reference sheet 선택">
      <div className="reference-upload-copy">
        <h3>sheet 선택</h3>
        <p>모든 sheet는 자동 병합하지 않습니다. 실제 normalization에 사용할 sheet를 직접 선택하세요.</p>
      </div>
      <div className="reference-sheet-list">
        {sheetSummaries.map((sheet, index) => {
          const isEmptyNavigation = Number(sheet.navigationCandidateRowCount) === 0 && Number(sheet.urlLikeTargetCount) === 0
          const checked = selectedSheetNames.includes(sheet.sheetName)
          const sheetInputId = `reference-sheet-${index}`
          return (
            <label className={`reference-sheet-row ${checked ? 'is-selected' : ''} ${isEmptyNavigation ? 'is-low-priority' : ''}`} htmlFor={sheetInputId} key={sheet.sheetName}>
              <input
                id={sheetInputId}
                type="checkbox"
                checked={checked}
                disabled={isDisabled || isEmptyNavigation}
                onChange={(event) => onSheetToggle(sheet.sheetName, event.target.checked)}
              />
              <span className="reference-sheet-main">
                <strong>{sheet.sheetName}</strong>
                <span>{formatSheetSummary(sheet)}</span>
                <span>{formatHeaderSummary(sheet.headerCandidatesSummary)}</span>
              </span>
              {sheet.recommendationRank === 1 && !isEmptyNavigation ? <span className="reference-sheet-badge">추천 후보</span> : null}
              {isEmptyNavigation ? <span className="reference-sheet-badge is-muted">navigation 후보 없음</span> : null}
            </label>
          )
        })}
      </div>
      <div className="reference-apply-row">
        <button className="reference-analyze-button" type="button" disabled={selectedSheetNames.length === 0 || isDisabled || isNormalizing} onClick={onNormalize}>
          {isNormalizing ? 'normalization 중...' : '선택 sheet normalization'}
        </button>
        <p>{isNormalizing ? 'Reference 분석 중 · 여러 후보를 chunk 단위로 처리합니다.' : '선택되지 않은 sheet row는 normalization 요청에 포함되지 않습니다.'}</p>
      </div>
    </section>
  )
}

function formatSheetSummary(sheet) {
  return `non-empty ${sheet.nonEmptyRowCount || 0}행 · navigation 후보 ${sheet.navigationCandidateRowCount || 0}행 · URL-like ${sheet.urlLikeTargetCount || 0}개`
}

function formatHeaderSummary(headerCandidatesSummary = []) {
  const labels = headerCandidatesSummary.flatMap((row) => row.labels || []).slice(0, 6)
  return labels.length ? `headerCandidates: ${labels.join(', ')}` : 'headerCandidates: 없음'
}

function getFocusableElements(dialog) {
  if (!dialog) return []
  return Array.from(dialog.querySelectorAll('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter((element) => !element.disabled && element.getAttribute('aria-hidden') !== 'true')
}

function focusFirstDialogControl(dialog) {
  const [firstElement] = getFocusableElements(dialog)
  if (firstElement) {
    firstElement.focus()
    return
  }
  dialog?.focus()
}

function keepFocusInsideDialog(event, dialog) {
  const focusableElements = getFocusableElements(dialog)
  if (focusableElements.length === 0) {
    event.preventDefault()
    dialog?.focus()
    return
  }
  const firstElement = focusableElements[0]
  const lastElement = focusableElements[focusableElements.length - 1]
  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault()
    lastElement.focus()
    return
  }
  if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault()
    firstElement.focus()
  }
}

export default ReferenceQaModal
