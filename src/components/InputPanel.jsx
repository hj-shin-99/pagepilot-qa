function InputPanel({
  url,
  figmaUrl,
  figmaJson,
  inputError,
  figmaError,
  figmaInspectError,
  figmaInspectResult,
  figmaInspectState,
  isCollapsed,
  isScanning,
  designImages,
  onUrlChange,
  onFigmaUrlChange,
  onFigmaInspect,
  onFigmaTextChange,
  onFigmaFileSelect,
  onDesignImagesSelect,
  onDesignImageDelete,
  onToggleCollapsed,
  onStartScan,
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

      <h1>PagePilot QA</h1>
      <p className="lead-text">
        AI가 URL과 Figma 시안을 비교해 배포 전 QA 항목을 정리합니다.
      </p>

      <form className="scan-form" onSubmit={handleSubmit}>
        <label className="field-label" htmlFor="target-url">
          테스트 URL
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
        <button className="primary-button" type="submit" disabled={isScanning}>
          {isScanning ? '검사 중...' : '검사 시작'}
        </button>
      </form>

      <section className="panel-section" aria-label="Figma 시안 이미지 입력">
        <div className="section-title-row compact-title-row">
          <h3>Figma 시안</h3>
          <span>{designImages[0]?.name || '미선택'}</span>
        </div>
        <label className="file-drop-label" htmlFor="design-image-files">
          시안 선택
          <input id="design-image-files" type="file" accept="image/*" onChange={onDesignImagesSelect} />
        </label>
        {designImages.length > 0 ? (
          <div className="single-design-preview">
            <figure className="image-preview-card">
              {designImages[0].previewUrl ? (
                <img src={designImages[0].previewUrl} alt={`${designImages[0].name} preview`} />
              ) : (
                <div className="image-preview-placeholder">미리보기 없음</div>
              )}
              <figcaption>{designImages[0].name}</figcaption>
            </figure>
            <button className="secondary-button design-delete-button" type="button" onClick={onDesignImageDelete}>
              시안 삭제
            </button>
          </div>
        ) : null}
      </section>

      <section className="panel-section advanced-options" aria-label="Figma JSON 입력">
        <div className="section-title-row compact-title-row">
          <h3>Figma JSON</h3>
          <span>선택 사항</span>
        </div>
          <p className="panel-note">JSON을 함께 입력하면 텍스트와 CTA 비교 정확도를 보완합니다.</p>
          <textarea
            className="figma-textarea"
            value={figmaJson}
            placeholder='{"document":{"children":[...]}}'
            rows="7"
            onChange={(event) => onFigmaTextChange(event.target.value)}
          />
          <label className="file-drop-label" htmlFor="figma-json-file">
            JSON 파일 선택
            <input id="figma-json-file" type="file" accept="application/json,.json" onChange={onFigmaFileSelect} />
          </label>
          {figmaError ? <p className="input-error">{figmaError}</p> : null}
      </section>

      <section className="panel-section advanced-options" aria-label="Figma REST API 연결 테스트">
        <div className="section-title-row compact-title-row">
          <h3>Figma 연결 테스트</h3>
          <span>개발 확인용</span>
        </div>
          <p className="panel-note">Frame URL만 서버로 보내 최소 연결만 확인합니다.</p>
          <input
            className="url-input"
            type="url"
            value={figmaUrl}
            placeholder="https://www.figma.com/design/...?..."
            onChange={(event) => onFigmaUrlChange(event.target.value)}
          />
          <button className="primary-button figma-inspect-button" type="button" onClick={onFigmaInspect} disabled={figmaInspectState === 'loading'}>
            {figmaInspectState === 'loading' ? '확인 중...' : 'Figma 연결 확인'}
          </button>
          {figmaInspectError ? <p className="input-error">{figmaInspectError}</p> : null}
          {figmaInspectResult?.success ? (
            <div className="figma-inspect-result" aria-live="polite">
              <p className="figma-inspect-status">Figma API 연결 성공</p>
              <div className="figma-inspect-grid">
                <div className="figma-inspect-item">
                  <span>Frame 이름</span>
                  <strong>{figmaInspectResult.nodeName}</strong>
                </div>
                <div className="figma-inspect-item">
                  <span>Node type</span>
                  <strong>{figmaInspectResult.nodeType}</strong>
                </div>
                <div className="figma-inspect-item">
                  <span>Visible text count</span>
                  <strong>{figmaInspectResult.visibleTextCount}</strong>
                </div>
                <div className="figma-inspect-item">
                  <span>Descendant count</span>
                  <strong>{figmaInspectResult.totalDescendantCount}</strong>
                </div>
              </div>
            </div>
          ) : null}
      </section>
        </>
      )}
    </aside>
  )
}

export default InputPanel
