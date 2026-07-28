import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TECH_SCAN_OPTION_DEFINITIONS, TECH_SCAN_OPTION_KEYS, areAllTechScanOptionsSelected } from '../../shared/techScanOptions.js'

const TECH_SCAN_OPTION_GROUPS = Object.freeze([
  { title: '페이지 및 이동', optionKeys: Object.freeze(['url', 'click', 'landing']) },
  { title: '기능 및 인터랙션', optionKeys: Object.freeze(['form', 'hover', 'modal']) },
  { title: '화면 및 리소스', optionKeys: Object.freeze(['scroll', 'responsive', 'download']) },
  { title: '콘텐츠 및 데이터', optionKeys: Object.freeze(['cookie', 'image']) },
  { title: '품질 및 검색', optionKeys: Object.freeze(['performance', 'seo', 'markup']) },
])

const TECH_SCAN_OPTION_DEFINITIONS_BY_KEY = Object.freeze(TECH_SCAN_OPTION_DEFINITIONS.reduce((map, option) => {
  map[option.key] = option
  return map
}, {}))

function TechScanOptions({ isScanning, techScanOptions, onTechScanOptionsChange }) {
  const [isTechOptionsOpen, setIsTechOptionsOpen] = useState(false)
  const [draftOptions, setDraftOptions] = useState(techScanOptions)
  const triggerRef = useRef(null)
  const dialogRef = useRef(null)
  const shouldRestoreFocusRef = useRef(false)
  const titleId = 'tech-scan-options-dialog-title'
  const descriptionId = 'tech-scan-options-dialog-description'
  const selectedCount = TECH_SCAN_OPTION_KEYS.filter((key) => techScanOptions[key] === true).length
  const draftAllSelected = areAllTechScanOptionsSelected(draftOptions)
  const selectionLabel = selectedCount === 0
    ? '주요 검사만 적용'
    : `주요 검사 + ${selectedCount}개 Tech QA 적용 중`

  useEffect(() => {
    if (!isTechOptionsOpen && shouldRestoreFocusRef.current) {
      shouldRestoreFocusRef.current = false
      window.setTimeout(() => triggerRef.current?.focus(), 0)
    }
  }, [isTechOptionsOpen])

  useEffect(() => {
    if (!isTechOptionsOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.setTimeout(() => focusFirstDialogControl(dialogRef.current), 0)
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isTechOptionsOpen])

  useEffect(() => {
    if (!isTechOptionsOpen) return undefined
    const handleWindowKeyDown = (event) => {
      if (event.key !== 'Escape' && event.code !== 'Escape') return
      event.preventDefault()
      shouldRestoreFocusRef.current = true
      setIsTechOptionsOpen(false)
    }
    window.addEventListener('keydown', handleWindowKeyDown, true)
    return () => window.removeEventListener('keydown', handleWindowKeyDown, true)
  }, [isTechOptionsOpen])

  const openTechOptions = () => {
    if (isScanning) return
    setDraftOptions(techScanOptions)
    setIsTechOptionsOpen(true)
  }

  const closeTechOptions = () => {
    shouldRestoreFocusRef.current = true
    setIsTechOptionsOpen(false)
  }

  const applyTechOptions = () => {
    onTechScanOptionsChange({ ...draftOptions })
    closeTechOptions()
  }

  const handleToggleAll = (checked) => {
    setDraftOptions(TECH_SCAN_OPTION_KEYS.reduce((nextOptions, key) => {
      nextOptions[key] = checked
      return nextOptions
    }, {}))
  }

  const handleToggleOption = (key, checked) => {
    setDraftOptions((options) => ({
      ...options,
      [key]: checked,
    }))
  }

  const handleToggleGroup = (optionKeys, checked) => {
    setDraftOptions((options) => ({
      ...options,
      ...optionKeys.reduce((nextOptions, key) => {
        nextOptions[key] = checked
        return nextOptions
      }, {}),
    }))
  }

  const handleDialogKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeTechOptions()
      return
    }
    if (event.key !== 'Tab') return
    keepFocusInsideDialog(event, dialogRef.current)
  }

  const handleBackdropMouseDown = (event) => {
    if (event.target !== event.currentTarget) return
    closeTechOptions()
  }

  return (
    <div className="tech-scan-options" aria-label="Tech QA 옵션">
      <button
        ref={triggerRef}
        className="tech-scan-options-trigger"
        type="button"
        disabled={isScanning}
        aria-haspopup="dialog"
        aria-expanded={isTechOptionsOpen}
        aria-controls="tech-scan-options-dialog"
        onClick={openTechOptions}
      >
        <span className="tech-scan-options-summary-copy">
          <span className="tech-scan-options-status">{selectionLabel}</span>
          <span className="tech-scan-options-action">옵션 변경</span>
        </span>
      </button>

      {isTechOptionsOpen ? createPortal((
        <div className="tech-scan-options-backdrop" onMouseDown={handleBackdropMouseDown}>
          <section
            ref={dialogRef}
            id="tech-scan-options-dialog"
            className="tech-scan-options-dialog"
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
                <h2 id={titleId}>Tech QA 옵션</h2>
                <p id={descriptionId}>필요한 검사 항목을 선택하세요</p>
              </div>
              <button className="tech-scan-options-close-button" type="button" onClick={closeTechOptions} aria-label="Tech QA 옵션 닫기">
                닫기
              </button>
            </header>

            <div className="tech-scan-options-body">
              <section className="tech-scan-option-group tech-scan-option-basic-card">
                <label className="tech-scan-option-row is-disabled" htmlFor="tech-scan-option-basic">
                  <input
                    id="tech-scan-option-basic"
                    type="checkbox"
                    checked
                    disabled
                    readOnly
                  />
                  <span className="tech-scan-option-basic-copy">
                    <strong>주요 검사</strong>
                    <span>항상 실행됨</span>
                  </span>
                </label>
              </section>

              <label className="tech-scan-option-row tech-scan-option-toggle-row" htmlFor="tech-scan-option-all">
                <span className="tech-scan-option-toggle-title">선택 검사</span>
                <span className="tech-scan-option-toggle-control">
                  <input
                    id="tech-scan-option-all"
                    type="checkbox"
                    aria-label="선택 검사 모두 선택"
                    checked={draftAllSelected}
                    disabled={isScanning}
                    onChange={(event) => handleToggleAll(event.target.checked)}
                  />
                  <span>모두 선택</span>
                </span>
              </label>

              <div className="tech-scan-option-groups">
                {TECH_SCAN_OPTION_GROUPS.map((group) => {
                  const isGroupChecked = group.optionKeys.some((key) => draftOptions[key] === true)
                  return (
                    <section className={`tech-scan-option-group ${isGroupChecked ? 'is-selected' : ''}`} key={group.title}>
                      <label className="tech-scan-option-group-summary" htmlFor={`tech-scan-option-group-${group.title}`}>
                        <input
                          id={`tech-scan-option-group-${group.title}`}
                          className="tech-scan-group-checkbox"
                          type="checkbox"
                          checked={isGroupChecked}
                          disabled={isScanning}
                          aria-label={`${group.title} 선택`}
                          onChange={(event) => handleToggleGroup(group.optionKeys, event.target.checked)}
                        />
                        <span className="tech-scan-option-group-title">{group.title}</span>
                      </label>
                      <div className="tech-scan-option-group-body">
                        {group.optionKeys.map((optionKey) => {
                          const option = TECH_SCAN_OPTION_DEFINITIONS_BY_KEY[optionKey]
                          if (!option) return null
                          return (
                            <label className="tech-scan-option-row" htmlFor={`tech-scan-option-${option.key}`} key={option.key}>
                              <input
                                id={`tech-scan-option-${option.key}`}
                                type="checkbox"
                                checked={draftOptions[option.key] === true}
                                disabled={isScanning}
                                onChange={(event) => handleToggleOption(option.key, event.target.checked)}
                              />
                              <span>{option.label}</span>
                            </label>
                          )
                        })}
                      </div>
                    </section>
                  )
                })}
              </div>

            </div>

            <footer className="tech-scan-options-dialog-footer">
              <button className="tech-scan-options-cancel-button" type="button" onClick={closeTechOptions}>취소</button>
              <button className="tech-scan-options-apply-button" type="button" onClick={applyTechOptions}>적용</button>
            </footer>
          </section>
        </div>
      ), document.body) : null}
    </div>
  )
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

export default TechScanOptions
