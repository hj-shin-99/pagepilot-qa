import { useEffect, useState } from 'react'
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
  onUrlChange,
  onFigmaUrlChange,
  onOpenHistory,
  onStartScan,
  onUrlBlur,
  onUrlConfirm,
  onTechScanOptionsChange,
}) {
  const isFigmaUrlReady = isValidFigmaUrl(figmaUrl.trim())
  const isWebUrlInvalid = Boolean(inputError)
  const [shouldRenderProgressive, setShouldRenderProgressive] = useState(isWebUrlReady)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setShouldRenderProgressive(isWebUrlReady)
    }, isWebUrlReady ? 0 : 560)
    return () => window.clearTimeout(timeoutId)
  }, [isWebUrlReady])

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
          <span className="start-brand-symbol" aria-hidden="true" />
          <strong>PagePilot QA</strong>
          <span className="start-version">v0.6.0</span>
        </span>
        <button className="start-history-button" type="button" onClick={onOpenHistory}>History</button>
      </header>

      <main className="start-main">
        <section className="start-hero" aria-label="QA 검사 시작">
          <div className="start-copy">
            <h1>웹페이지의 품질을 한 번에 확인하세요.</h1>
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
                  placeholder="검사할 Web URL을 입력하세요."
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

            {shouldRenderProgressive ? (
              <div className={`start-progressive ${isWebUrlReady ? 'is-visible' : 'is-closing'}`} aria-hidden={!isWebUrlReady}>
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
                  <TechScanOptions
                    isScanning={!isWebUrlReady || isScanning}
                    techScanOptions={techScanOptions}
                    onTechScanOptionsChange={onTechScanOptionsChange}
                  />
                </div>

                <button className="primary-button start-submit start-step start-step-submit" type="submit" disabled={!canStartScan || isScanning}>
                  <span>검사 시작</span>
                </button>
              </div>
            ) : null}
          </form>
        </section>
      </main>
    </div>
  )
}

export default QaStartScreen
