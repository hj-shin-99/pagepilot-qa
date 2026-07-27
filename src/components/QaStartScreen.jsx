import TechScanOptions from './TechScanOptions'

function QaStartScreen({
  url,
  figmaUrl,
  inputError,
  figmaError,
  isScanning,
  isWebUrlReady,
  techScanOptions,
  onUrlChange,
  onFigmaUrlChange,
  onOpenHistory,
  onStartScan,
  onTechScanOptionsChange,
}) {
  const handleSubmit = (event) => {
    event.preventDefault()
    if (!isWebUrlReady || isScanning) return
    onStartScan()
  }

  return (
    <main className="qa-start-screen">
      <button className="qa-start-history-button" type="button" onClick={onOpenHistory}>History</button>

      <div className="qa-start-inner">
        <header className="qa-start-header" aria-label="PagePilot QA">
          <span className="qa-start-brand">
            <span className="qa-start-version">v0.6.0</span>
            <strong>PagePilot QA</strong>
          </span>
        </header>

        <section className="qa-start-panel" aria-label="QA 검사 시작">
          <div className="qa-start-copy">
            <h1>웹 QA, 이제 한 번에 확인하세요</h1>
            <p>기술 품질과 디자인 차이를 자동으로 확인합니다.</p>
          </div>

          <form className="qa-start-form" onSubmit={handleSubmit}>
            <div className="qa-start-field qa-start-url-field">
              <input
                id="target-url"
                className={`qa-start-input ${url ? 'has-value' : ''}`}
                aria-label="Web URL"
                type="url"
                value={url}
                placeholder="검사할 웹 URL을 입력하세요"
                disabled={isScanning}
                onChange={(event) => onUrlChange(event.target.value)}
              />
              {isWebUrlReady ? <span className="qa-start-url-check" aria-hidden="true">✓</span> : null}
              {inputError ? <p className="qa-start-error">{inputError}</p> : null}
            </div>

            <div className={`qa-start-progressive ${isWebUrlReady ? 'is-visible' : ''}`} aria-hidden={!isWebUrlReady}>
              <div className="qa-start-step qa-start-step-figma-copy qa-start-figma-intro">
                <h2>비주얼 QA도 진행할까요?</h2>
              </div>

              <div className="qa-start-step qa-start-step-figma-input qa-start-field">
                <input
                  id="figma-frame-url"
                  className={`qa-start-input ${figmaUrl ? 'has-value' : ''}`}
                  aria-label="Figma URL"
                  type="url"
                  value={figmaUrl}
                  placeholder="Figma URL을 입력하세요"
                  disabled={!isWebUrlReady || isScanning}
                  onChange={(event) => onFigmaUrlChange(event.target.value)}
                />
                {figmaError ? <p className="qa-start-error">{figmaError}</p> : null}
              </div>

              <div className="qa-start-step qa-start-step-options">
                <TechScanOptions
                  isScanning={isScanning}
                  techScanOptions={techScanOptions}
                  onTechScanOptionsChange={onTechScanOptionsChange}
                />
              </div>

              <button className="primary-button qa-start-submit qa-start-step qa-start-step-submit" type="submit" disabled={!isWebUrlReady || isScanning}>
                검사 시작
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  )
}

export default QaStartScreen
