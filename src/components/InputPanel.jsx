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
      <div className="sidebar-topbar">
        {isCollapsed ? null : (
          <div className="brand-mark">
            <span className="brand-version">v0.3</span>
          </div>
        )}
        <button
          className="sidebar-toggle-button"
          type="button"
          onClick={onToggleCollapsed}
          aria-label={isCollapsed ? '사이드바 열기' : '사이드바 접기'}
          title={isCollapsed ? '사이드바 열기' : '사이드바 접기'}
        >
          <span className="sidebar-toggle-icon" aria-hidden="true" />
        </button>
      </div>
      {isCollapsed ? null : (
        <div className="sidebar-content">
          <div className="sidebar-intro">
            <h1>PagePilot QA</h1>
            <p className="sidebar-description">
              <strong>AI 기반 Web QA 플랫폼</strong>
              <span>Tech QA로 웹 품질을 분석하고<br />Visual QA로 Figma와 화면을 비교합니다.</span>
            </p>
          </div>

          <form className="scan-form sidebar-input-section" onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="target-url">
              Web URL
            </label>
            <input
              id="target-url"
              className={`url-input ${url ? 'has-value' : ''}`}
              type="url"
              value={url}
              placeholder="https://staging.example.com/page"
              onChange={(event) => onUrlChange(event.target.value)}
            />
            {inputError ? <p className="input-error">{inputError}</p> : null}

            <label className="field-label" htmlFor="figma-frame-url">
              Figma URL <span className="field-label-note">Visual QA용</span>
            </label>
            <input
              id="figma-frame-url"
              className={`url-input ${figmaUrl ? 'has-value' : ''}`}
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
        </div>
      )}
    </aside>
  )
}

export default InputPanel
