import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReferenceReviewPanel from './ReferenceReviewPanel'
import { analyzeReferenceFile, normalizeReference } from '../utils/referenceQa'
import {
  createReferencePreset,
  createReferencePresetFilename,
  createReferenceFileSelectionState,
  createReferenceNormalizeFailureState,
  createReferenceNormalizeSuccessState,
  importReferencePresetFromText,
  MAX_REFERENCE_PRESET_BYTES,
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
  const fileInputRef = useRef(null)
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

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0] || null
    event.target.value = ''
    if (!file) return

    if (isSupportedReferenceExcel(file)) {
      setSelectedSheetNames([])
      setReferenceState(createReferenceFileSelectionState(file))
      if (typeof onReferenceApply === 'function') onReferenceApply(null)
      return
    }

    if (isSupportedPresetFile(file)) {
      await importPresetFile(file)
      return
    }

    setReferenceState((current) => ({ ...current, referenceError: '지원하는 .xlsx 또는 Reference 설정 JSON 파일을 선택해 주세요.' }))
  }

  const importPresetFile = async (file) => {
    if (file.size > MAX_REFERENCE_PRESET_BYTES) {
      setReferenceState((current) => ({ ...current, referenceError: 'Reference 설정 파일이 너무 큽니다.' }))
      return
    }
    try {
      const next = importReferencePresetFromText(await file.text())
      setSelectedSheetNames(next.normalizedSheetNames)
      setReferenceState({ ...next, presetFileName: file.name })
      if (typeof onReferenceApply === 'function') onReferenceApply(null)
    } catch (error) {
      setReferenceState((current) => ({ ...current, referenceError: error instanceof Error ? error.message : 'Reference 설정 가져오기에 실패했습니다.' }))
    }
  }

  const handleBrowseClick = () => {
    if (isDisabled || isAnalyzing || isNormalizing) return
    fileInputRef.current?.click()
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

  const handleApply = async (confirmedReferenceMap) => {
    try {
      if (typeof onReferenceApply === 'function') await onReferenceApply(confirmedReferenceMap)
      setReferenceState((current) => ({ ...current, confirmedReferenceMap, referenceError: '' }))
      closeModal()
    } catch (error) {
      setReferenceState((current) => ({ ...current, referenceError: error instanceof Error ? error.message : 'Reference 적용에 실패했습니다.' }))
    }
  }

  const handlePresetExport = () => {
    if (!referenceState.referenceMap) return
    const preset = createReferencePreset({
      referenceMap: referenceState.referenceMap,
      items: referenceState.reviewItems,
      meta: referenceState.referenceMeta,
      normalizedSheetNames: referenceState.normalizedSheetNames,
    })
    downloadJsonPreset(preset, createReferencePresetFilename(referenceState.referenceMap.sourceDocument?.fileName))
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
                  <p>IA / 기능정의서 / Sitemap Excel 또는 저장한 Reference 설정을 선택할 수 있습니다.</p>
                </div>
                <div className="reference-upload-controls reference-file-action-row">
                  <input
                    ref={fileInputRef}
                    id="reference-file-input"
                    className="reference-hidden-file-input"
                    accept=".xlsx,.pagepilot-reference.json,.json,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    type="file"
                    disabled={isDisabled || isAnalyzing || isNormalizing}
                    onChange={handleFileChange}
                  />
                  <div className="reference-file-picker-row">
                    <input className="reference-file-name-display" value={referenceState.selectedFile?.name || referenceState.presetFileName || '선택된 파일 없음'} readOnly aria-label="선택된 Reference 파일" />
                    <button className="reference-browse-button" type="button" disabled={isDisabled || isAnalyzing || isNormalizing} onClick={handleBrowseClick}>찾아보기</button>
                  </div>
                </div>
                {referenceState.selectedFile ? (
                  <button className="reference-analyze-button" type="button" disabled={isDisabled || isAnalyzing || isNormalizing} onClick={handleAnalyze}>
                    {isAnalyzing ? '분석 중...' : '분석하기'}
                  </button>
                ) : null}
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
                  onExport={handlePresetExport}
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

function isSupportedReferenceExcel(file) {
  return /\.xlsx$/i.test(file?.name || '')
}

function isSupportedPresetFile(file) {
  return /(?:\.pagepilot-reference\.json|\.json)$/i.test(file?.name || '')
}

function downloadJsonPreset(preset, filename) {
  const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
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
