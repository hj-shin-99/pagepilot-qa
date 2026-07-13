function InputPanel({
  url,
  figmaUrl,
  inputError,
  figmaError,
  isCollapsed,
  isScanning,
  onUrlChange,
  onFigmaUrlChange,
  onStartScan,
  onToggleCollapsed,
}) {
  const handleSubmit = (event) => {
    event.preventDefault()
    onStartScan()
  }

  return (
    <aside className={`control-panel ${isCollapsed ? 'is-collapsed' : ''}`}>
      <button className="sidebar-toggle-button" type="button" onClick={onToggleCollapsed}>
        {isCollapsed ? '열기' : '접기'}
      </button>
      {isCollapsed ? null : (
        <>
          <div className="brand-mark">
            <span className="brand-dot" aria-hidden="true" />
            PagePilot QA
          </div>

          <h1>PagePilot QA v0.3</h1>
          <p className="lead-text">
            Web URL을 입력하면 Tech QA를 실행합니다. Figma Frame URL을 함께 입력하면 Visual QA도 동시에 실행합니다.
          </p>

          <form className="scan-form" onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="target-url">
              Web URL
            </label>
            <input
              id="target-url"
              className="url-input"
              type="url"
              value={url}
              placeholder="https://staging.example.com/page"
              onChange={(event) => onUrlChange(event.target.value)}
            />
            {inputError ? <p className="input-error">{inputError}</p> : null}

            <label className="field-label" htmlFor="figma-frame-url">
              Figma Frame URL <span className="field-label-note">Visual QA용</span>
            </label>
            <input
              id="figma-frame-url"
              className="url-input"
              type="url"
              value={figmaUrl}
              placeholder="https://www.figma.com/design/...?...node-id=..."
              onChange={(event) => onFigmaUrlChange(event.target.value)}
            />
            {figmaError ? <p className="input-error">{figmaError}</p> : null}

            <button className="primary-button" type="submit" disabled={isScanning}>
              {isScanning ? '검사 중...' : '검사 시작'}
            </button>
          </form>

          <section className="panel-section" aria-label="QA 안내">
            <div className="section-title-row compact-title-row">
              <h3>실행 범위</h3>
              <span>MVP</span>
            </div>
            <p className="panel-note">
              Figma Frame URL이 비어 있으면 기존 `/api/scan`만 실행합니다. Figma Frame URL이 있으면 `/api/scan`과 `/api/visual/payload`를 함께 실행합니다.
            </p>
          </section>
        </>
      )}
    </aside>
  )
}

export default InputPanel
