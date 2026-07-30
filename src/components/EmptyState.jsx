import { useEffect, useRef, useState } from 'react'
import {
  getActiveScanningStageIndex,
  getNextDisplayedScanningStageIndex,
  getScanningProgressValue,
  getScanningStages,
  getStageClassName,
  getStageRollOffset,
  SCAN_STAGE_TRANSITION_MS,
} from '../utils/scanningStages'

function EmptyState({ scanState, scanError, mode = 'visual', combined = false, scanStage = 'idle' }) {
  const isScanning = scanState === 'scanning' || scanState === 'loading'
  const isFailed = scanState === 'failed' || scanState === 'error'
  const isSkipped = scanState === 'skipped'
  const isTech = mode === 'tech'
  const isOverview = mode === 'overview'
  const prefersReducedMotion = usePrefersReducedMotion()
  const [displayedActiveStageIndex, setDisplayedActiveStageIndex] = useState(0)
  const [stageTransitionTick, setStageTransitionTick] = useState(0)
  const [displayedProgressValue, setDisplayedProgressValue] = useState(0)
  const stageTransitionTimerRef = useRef(null)
  const stageStepAnimationFrameRef = useRef(null)
  const progressAnimationFrameRef = useRef(null)
  const hasStartedProgressRef = useRef(false)
  const scanStages = isScanning ? getScanningStages({ isTech, combined }) : []
  const actualActiveStageIndex = isScanning ? getActiveScanningStageIndex({ isTech, combined, scanStage }) : 0
  const displayedScanStage = displayedActiveStageIndex >= actualActiveStageIndex ? scanStage : 'catching-up'
  const stageRollOffset = getStageRollOffset(displayedActiveStageIndex)
  const progressTargetValue = isScanning ? getScanningProgressValue({
    activeStageIndex: displayedActiveStageIndex,
    stagesLength: scanStages.length,
    scanStage: displayedScanStage,
  }) : 0
  const currentStatusText = isScanning ? scanStages[actualActiveStageIndex] : ''
  const stageRows = isScanning ? createStageRows(scanStages, displayedActiveStageIndex) : []

  useEffect(() => () => {
    if (stageTransitionTimerRef.current !== null) window.clearTimeout(stageTransitionTimerRef.current)
    if (stageStepAnimationFrameRef.current !== null) window.cancelAnimationFrame(stageStepAnimationFrameRef.current)
    if (progressAnimationFrameRef.current !== null) window.cancelAnimationFrame(progressAnimationFrameRef.current)
  }, [])

  useEffect(() => {
    if (!isScanning) {
      if (stageTransitionTimerRef.current !== null) {
        window.clearTimeout(stageTransitionTimerRef.current)
        stageTransitionTimerRef.current = null
      }
      if (stageStepAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(stageStepAnimationFrameRef.current)
        stageStepAnimationFrameRef.current = null
      }
      return undefined
    }

    if (prefersReducedMotion) {
      if (stageTransitionTimerRef.current !== null) {
        window.clearTimeout(stageTransitionTimerRef.current)
        stageTransitionTimerRef.current = null
      }
      if (stageStepAnimationFrameRef.current === null) {
        stageStepAnimationFrameRef.current = window.requestAnimationFrame(() => {
          stageStepAnimationFrameRef.current = null
          setDisplayedActiveStageIndex(actualActiveStageIndex)
        })
      }
      return () => {
        if (stageStepAnimationFrameRef.current !== null) {
          window.cancelAnimationFrame(stageStepAnimationFrameRef.current)
          stageStepAnimationFrameRef.current = null
        }
      }
    }

    if (displayedActiveStageIndex > actualActiveStageIndex) {
      if (stageTransitionTimerRef.current !== null) {
        window.clearTimeout(stageTransitionTimerRef.current)
        stageTransitionTimerRef.current = null
      }
      if (stageStepAnimationFrameRef.current === null) {
        stageStepAnimationFrameRef.current = window.requestAnimationFrame(() => {
          stageStepAnimationFrameRef.current = null
          setDisplayedActiveStageIndex(actualActiveStageIndex)
        })
      }
      return () => {
        if (stageStepAnimationFrameRef.current !== null) {
          window.cancelAnimationFrame(stageStepAnimationFrameRef.current)
          stageStepAnimationFrameRef.current = null
        }
      }
    }

    if (stageTransitionTimerRef.current !== null || stageStepAnimationFrameRef.current !== null || displayedActiveStageIndex >= actualActiveStageIndex) return undefined

    stageStepAnimationFrameRef.current = window.requestAnimationFrame(() => {
      stageStepAnimationFrameRef.current = null
      setDisplayedActiveStageIndex((currentDisplayedStageIndex) => getNextDisplayedScanningStageIndex({
        displayedActiveStageIndex: currentDisplayedStageIndex,
        actualActiveStageIndex,
      }))
      stageTransitionTimerRef.current = window.setTimeout(() => {
        stageTransitionTimerRef.current = null
        setStageTransitionTick((currentTick) => currentTick + 1)
      }, SCAN_STAGE_TRANSITION_MS)
    })

    return () => {
      if (stageStepAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(stageStepAnimationFrameRef.current)
        stageStepAnimationFrameRef.current = null
      }
    }
  }, [actualActiveStageIndex, displayedActiveStageIndex, isScanning, prefersReducedMotion, stageTransitionTick])

  useEffect(() => {
    if (!isScanning) {
      hasStartedProgressRef.current = false
      if (progressAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(progressAnimationFrameRef.current)
        progressAnimationFrameRef.current = null
      }
      return undefined
    }

    if (!hasStartedProgressRef.current) {
      hasStartedProgressRef.current = true

      if (typeof window === 'undefined' || !window.requestAnimationFrame) {
        return undefined
      }

      progressAnimationFrameRef.current = window.requestAnimationFrame(() => {
        progressAnimationFrameRef.current = null
        setDisplayedProgressValue((currentProgress) => Math.max(currentProgress, progressTargetValue))
      })
      return () => {
        if (progressAnimationFrameRef.current !== null) {
          window.cancelAnimationFrame(progressAnimationFrameRef.current)
          progressAnimationFrameRef.current = null
        }
      }
    }

    if (progressAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(progressAnimationFrameRef.current)
      progressAnimationFrameRef.current = null
    }

    if (progressAnimationFrameRef.current === null) {
      progressAnimationFrameRef.current = window.requestAnimationFrame(() => {
        progressAnimationFrameRef.current = null
        setDisplayedProgressValue((currentProgress) => Math.max(currentProgress, progressTargetValue))
      })
    }
    return () => {
      if (progressAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(progressAnimationFrameRef.current)
        progressAnimationFrameRef.current = null
      }
    }
  }, [isScanning, progressTargetValue])

  return (
    <section className={`empty-state ${isScanning ? 'is-scanning' : ''} ${isFailed ? 'is-failed' : ''}`}>
      <div>
        <div className="state-indicator" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="state-label">{isFailed ? '검사 실패' : isScanning ? '검사 중' : isSkipped ? '미실행' : '검사 전'}</p>
        <h2>{getTitle({ isFailed, isScanning, isSkipped, isTech, isOverview, combined })}</h2>
        <p>{isFailed ? scanError : getDescription({ isTech, isSkipped, isScanning, isOverview, combined })}</p>
        {isScanning ? (
          <>
            <p className="scan-stage-current-sr" aria-live="polite">현재 상태: {currentStatusText}</p>
            <div className="scan-stage-viewport" aria-hidden="true">
              <ol
                className="scan-stage-list"
                style={{ '--stage-roll-offset': stageRollOffset }}
              >
                {stageRows.map((stageRow) => (
                  <li className={stageRow.className} key={stageRow.id}>
                    {stageRow.isPlaceholder ? null : (
                      <span className="scan-stage-group">
                        <span className="scan-stage-dot" aria-hidden="true" />
                        <span className="scan-stage-text">{stageRow.text}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
            <div
              className={`scan-stage-progress ${prefersReducedMotion ? 'is-reduced-motion' : ''}`}
              style={{ '--scan-stage-progress': `${displayedProgressValue}%` }}
              aria-hidden="true"
            >
              <span className="scan-stage-progress-track">
                <span className="scan-stage-progress-fill" />
              </span>
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
}

function createStageRows(scanStages, displayedActiveStageIndex) {
  return [
    { id: 'scan-stage-placeholder-before', className: 'scan-stage-row is-placeholder', isPlaceholder: true, text: '' },
    ...scanStages.map((stage, index) => ({
      id: `scan-stage-${index}`,
      className: `scan-stage-row ${getStageClassName(index, displayedActiveStageIndex)}`,
      isPlaceholder: false,
      text: stage,
    })),
    { id: 'scan-stage-placeholder-after', className: 'scan-stage-row is-placeholder', isPlaceholder: true, text: '' },
  ]
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined

    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = () => setPrefersReducedMotion(query.matches)
    updatePreference()

    if (query.addEventListener) {
      query.addEventListener('change', updatePreference)
      return () => query.removeEventListener('change', updatePreference)
    }

    query.addListener(updatePreference)
    return () => query.removeListener(updatePreference)
  }, [])

  return prefersReducedMotion
}

function getTitle({ isFailed, isScanning, isSkipped, isTech, isOverview, combined }) {
  if (isFailed) return '검사 요청을 완료하지 못했습니다.'
  if (isScanning && combined) return 'Web 페이지와 Figma 시안을 비교하고 있습니다.'
  if (isScanning) return 'Web 페이지를 점검하고 있습니다.'
  if (isSkipped) return 'Figma URL을 입력하면 Visual QA를 함께 실행합니다.'
  if (isOverview) return 'PagePilot QA'
  return isTech ? 'Tech QA' : 'Visual QA'
}

function getDescription({ isTech, isSkipped, isScanning, isOverview, combined }) {
  if (isOverview) return <>Web URL만 입력하면 Tech QA를 실행합니다.<br />Figma URL을 함께 입력하면 Visual QA도 같이 실행합니다.</>
  if (isSkipped) return '왼쪽 입력 영역에 Figma Frame URL을 추가하고 검사 시작을 누르면 Visual QA도 실행됩니다.'
  if (!isScanning) return isTech ? 'Web URL을 입력하고 검사를 시작하세요. 페이지 접속 상태와 기술 항목을 검사합니다.' : 'Web URL과 Figma URL을 입력하세요. Figma 시안과 Web 페이지를 비교합니다.'
  if (combined) return '기술 품질과 디자인 차이를 함께 확인합니다.'
  return isTech
    ? '기술 품질과 주요 기능을 순차적으로 확인합니다.'
    : '기술 품질과 디자인 차이를 함께 확인합니다.'
}

export default EmptyState
