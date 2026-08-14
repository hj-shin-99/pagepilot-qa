import { useEffect, useState } from 'react'
import DeviceScanSelector from './DeviceScanSelector'
import TechScanOptions from './TechScanOptions'
import { isValidFigmaUrl } from '../utils/scanSession'

function QaStartScreen({
  url,
  figmaUrl,
  inputError,
  figmaError,
  canStartScan,
  isScanning,
  isWebUrlReady,
  techScanOptions,
  devices,
  onUrlChange,
  onFigmaUrlChange,
  onOpenHistory,
  onStartScan,
  onUrlBlur,
  onUrlConfirm,
  onTechScanOptionsChange,
  onDevicesChange,
}) {
  const isFigmaUrlReady = isValidFigmaUrl(figmaUrl.trim())
  const isWebUrlInvalid = Boolean(inputError)
  const [shouldRenderProgressive, setShouldRenderProgressive] = useState(false)
  const [isProgressiveVisible, setIsProgressiveVisible] = useState(false)
  const [isSubmitVisible, setIsSubmitVisible] = useState(false)
  const shouldShowProgressive = isWebUrlReady || shouldRenderProgressive
  const isProgressiveOpen = isWebUrlReady && isProgressiveVisible

  useEffect(() => {
    let frameId = 0
    let timeoutId = 0

    if (isWebUrlReady) {
      frameId = window.requestAnimationFrame(() => {
        setShouldRenderProgressive(true)
        setIsProgressiveVisible(true)
      })
      return () => {
        window.cancelAnimationFrame(frameId)
        window.clearTimeout(timeoutId)
      }
    }

    frameId = window.requestAnimationFrame(() => setIsProgressiveVisible(false))
    timeoutId = window.setTimeout(() => setShouldRenderProgressive(false), 420)
    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
    }
  }, [isWebUrlReady])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => setIsSubmitVisible(isProgressiveOpen))
    return () => window.cancelAnimationFrame(frameId)
  }, [isProgressiveOpen])

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!canStartScan || isScanning) return
    onStartScan()
  }

  const handleUrlKeyDown = (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    onUrlConfirm()
  }

  return (
    <div className="start-screen">
      <header className="start-header" aria-label="PagePilot QA">
        <span className="start-brand">
          <strong>PagePilot QA</strong>
          <span className="start-version">v1.0</span>
        </span>
        <button className="start-history-button" type="button" onClick={onOpenHistory}>History</button>
      </header>

      <main className="start-main">
        <section className="start-hero" aria-label="QA 검사 시작">
          <div className="start-copy">
            <h1>기술과 디자인, 한 번에 검증하세요.</h1>
            <p>AI 기반 Tech QA와 Visual QA로 웹페이지의 품질과 디자인 차이를 빠르게 확인하세요.</p>
          </div>

          <form className="start-form" noValidate onSubmit={handleSubmit}>
            <div className={`start-field start-url-field ${isWebUrlReady ? 'is-valid' : ''} ${isWebUrlInvalid ? 'is-invalid' : ''}`}>
              <div className="start-composer start-url-composer">
                <input
                  id="target-url"
                  className={`start-input ${url ? 'has-value' : ''}`}
                  aria-label="Web URL"
                  aria-invalid={isWebUrlInvalid}
                  type="url"
                  value={url}
                  placeholder="Tech QA를 진행할 Web URL을 입력하세요."
                  disabled={isScanning}
                  onBlur={onUrlBlur}
                  onChange={(event) => onUrlChange(event.target.value)}
                  onKeyDown={handleUrlKeyDown}
                />
                {isWebUrlReady ? <span className="start-valid-check start-url-check" aria-hidden="true">✓</span> : null}
              </div>
              {isWebUrlReady ? <span className="start-sr-only">Web URL이 확인되었습니다.</span> : null}
              {inputError ? <p className="start-error">{inputError}</p> : null}
            </div>

            {shouldShowProgressive ? (
              <div className={`start-progressive ${isProgressiveOpen ? 'is-visible' : 'is-closing'}`} aria-hidden={!isProgressiveOpen}>
                <div className="start-progressive-inner">
                  <div className="start-step start-step-figma-copy start-figma-intro">
                    <h2>Visual QA도 진행할까요?</h2>
                  </div>

                  <div className={`start-step start-step-figma-input start-field ${isFigmaUrlReady ? 'is-valid' : ''}`}>
                    <div className="start-composer start-figma-composer">
                      <input
                        id="figma-frame-url"
                        className={`start-input ${figmaUrl ? 'has-value' : ''}`}
                        aria-label="Figma URL"
                        type="url"
                        value={figmaUrl}
                        placeholder="Figma URL을 입력하세요. 선택 사항입니다."
                        disabled={!isWebUrlReady || isScanning}
                        onChange={(event) => onFigmaUrlChange(event.target.value)}
                      />
                      {isFigmaUrlReady ? <span className="start-valid-check start-figma-check" aria-hidden="true">✓</span> : null}
                    </div>
                    {figmaError ? <p className="start-error">{figmaError}</p> : null}
                  </div>

                  <div className="start-step start-step-options">
                    <DeviceScanSelector
                      devices={devices}
                      isScanning={!isWebUrlReady || isScanning}
                      onDevicesChange={onDevicesChange}
                    />
                    <TechScanOptions
                      isScanning={!isWebUrlReady || isScanning}
                      techScanOptions={techScanOptions}
                      onTechScanOptionsChange={onTechScanOptionsChange}
                    />
                  </div>

                  <div className="start-submit-slot">
                    <div className={`start-submit-reveal ${isSubmitVisible ? 'is-visible' : ''}`}>
                      <button className="primary-button start-submit start-step-submit" type="submit" disabled={!canStartScan || isScanning}>
                        <span>검사 시작</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </form>
        </section>
      </main>
    </div>
  )
}

export default QaStartScreen
