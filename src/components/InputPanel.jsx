function InputPanel({
  url,
  inputError,
  isScanning,
  onUrlChange,
  onStartScan,
}) {
  const handleSubmit = (event) => {
    event.preventDefault()
    onStartScan()
  }

  return (
    <aside className="control-panel">
      <div className="brand-mark">
        <span className="brand-dot" aria-hidden="true" />
        PagePilot QA
      </div>

      <h1>실시간 웹 QA 검사</h1>
      <p className="lead-text">
        입력한 URL만 로컬 Playwright로 열어 접속, 링크, 이미지, 콘솔, 모바일 상태를 점검합니다.
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
    </aside>
  )
}

export default InputPanel
