import StatusChip from './StatusChip'

function DetailPanel({ result }) {
  const problemLinks = result.links.filter((link) => link.status !== 'ok')
  const normalLinks = result.links.filter((link) => link.status === 'ok')
  const visibleNormalLinks = normalLinks.slice(0, 10)
  const hiddenNormalLinks = normalLinks.slice(10)
  const issueLogs = result.images.concat(result.consoleMessages)
  const visibleIssueLogs = issueLogs.slice(0, 10)
  const hiddenIssueLogs = issueLogs.slice(10)

  return (
    <section className="detail-grid" aria-label="수집 상세 정보">
      <article className="detail-card">
        <div className="section-title-row">
          <h3>링크 응답 상태</h3>
          <span>전체 링크 {result.links.length}개 확인</span>
        </div>
        <ul className="table-list">
          {result.links.length > 0 ? problemLinks.concat(visibleNormalLinks).map((link) => (
            <li className="table-row" key={`${link.index}-${link.url}`}>
              <div>
                <span className="row-url">{link.label}</span>
                <div className="row-note">{link.url}</div>
              </div>
              <span className="http-code">{link.statusCode || '-'}</span>
              <StatusChip status={link.status} />
            </li>
          )) : <li className="empty-row">검사 가능한 http(s) 링크가 없습니다.</li>}
        </ul>
        {hiddenNormalLinks.length > 0 ? (
          <details className="tech-detail-list">
            <summary>정상 링크 {hiddenNormalLinks.length}개 더 보기</summary>
            <ul className="table-list">
              {hiddenNormalLinks.map((link) => (
                <li className="table-row" key={`${link.index}-${link.url}`}>
                  <div>
                    <span className="row-url">{link.label}</span>
                    <div className="row-note">{link.url}</div>
                  </div>
                  <span className="http-code">{link.statusCode || '-'}</span>
                  <StatusChip status={link.status} />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </article>

      <div className="section-stack">
        <article className="detail-card">
          <div className="section-title-row">
            <h3>이미지 / 콘솔 이슈</h3>
            <span>{issueLogs.length}개 로그</span>
          </div>
          <ul className="issue-list">
            {visibleIssueLogs.map((item, index) => <IssueLogRow item={item} key={getIssueLogKey(item, index)} />)}
            {issueLogs.length === 0 ? (
              <li className="empty-row">수집된 이미지 또는 콘솔 에러가 없습니다.</li>
            ) : null}
          </ul>
          {hiddenIssueLogs.length > 0 ? (
            <details className="tech-detail-list">
              <summary>로그 {hiddenIssueLogs.length}개 더 보기</summary>
              <ul className="issue-list">
                {hiddenIssueLogs.map((item, index) => <IssueLogRow item={item} key={getIssueLogKey(item, index + 10)} />)}
              </ul>
            </details>
          ) : null}
        </article>

        <article className="detail-card">
          <div className="section-title-row">
            <h3>페이지 메타 / 모바일</h3>
          </div>
          <ul className="evidence-list">
            <li className="evidence-row">
              <span className="evidence-label">Title</span>
              <span className="evidence-value">{result.pageTitle || '타이틀 없음'}</span>
            </li>
            <li className="evidence-row">
              <span className="evidence-label">Main HTTP</span>
              <span className="evidence-value">{result.httpStatus || '응답 없음'}</span>
            </li>
            <li className="evidence-row">
              <span className="evidence-label">Viewport</span>
              <span className="evidence-value">
                Mobile · {result.mobile.viewport.width}×{result.mobile.viewport.height} · {result.mobile.statusCode || '응답 없음'}
                <span className="evidence-note">{result.mobile.note}</span>
              </span>
            </li>
            <li className="evidence-row">
              <span className="evidence-label">Missing URL</span>
              <span className="evidence-value">{result.missingHrefLinks.length}개</span>
            </li>
          </ul>
          {result.missingHrefLinks.length > 0 ? (
            <details className="tech-detail-list">
              <summary>URL 누락 링크/버튼 상세 보기</summary>
              <ul className="issue-list">
                {result.missingHrefLinks.map((item, index) => (
                  <li className="issue-row warn" key={`${index}-${item.selector}-${item.label}`}>
                    <span className="issue-path">{item.label || item.ariaLabel || `${item.kind} ${index + 1}`}</span>
                    <span className="issue-message">{item.kind} · {item.selector || 'selector 없음'}</span>
                    <TechIssueMeta item={item} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </article>
      </div>
    </section>
  )
}

function IssueLogRow({ item }) {
  const isConsole = item.level !== undefined
  if (isConsole) {
    return (
      <li className={`issue-row ${item.level === 'error' ? 'error' : 'warn'}`}>
        <span className="issue-path">{item.level.toUpperCase()} · {item.source}{item.lineNumber !== null && item.lineNumber !== undefined ? `:${item.lineNumber}` : ''}</span>
        <span className="issue-message">{item.message}</span>
      </li>
    )
  }

  return (
    <li className={`issue-row ${item.status}`}>
      <span className="issue-path">{item.src || `Image ${item.index}`}</span>
      <span className="issue-message">{item.message}</span>
      <TechIssueMeta item={item} />
    </li>
  )
}

function getIssueLogKey(item, index) {
  return `${index}-${item.source || item.index || ''}-${item.src || item.message || ''}`
}

function TechIssueMeta({ item }) {
  const box = item.boundingBox

  return (
    <details className="tech-detail-list">
      <summary>기술 정보</summary>
      <dl className="tech-issue-meta">
        {item.domPath ? <div><dt>DOM path</dt><dd>{item.domPath}</dd></div> : null}
        {item.section ? <div><dt>Section</dt><dd>{item.section}</dd></div> : null}
        {Number.isFinite(Number(item.y)) ? <div><dt>Y</dt><dd>{Math.round(Number(item.y))}px</dd></div> : null}
        {box ? <div><dt>Bounding box</dt><dd>x {box.x}, y {box.y}, w {box.width}, h {box.height}</dd></div> : null}
        {item.text ? <div><dt>Text</dt><dd>{item.text}</dd></div> : null}
        {item.ariaLabel ? <div><dt>ARIA</dt><dd>{item.ariaLabel}</dd></div> : null}
        {item.altCategory ? <div><dt>Image category</dt><dd>{item.altCategory}</dd></div> : null}
        {item.altReason ? <div><dt>Reason</dt><dd>{item.altReason}</dd></div> : null}
      </dl>
    </details>
  )
}

export default DetailPanel
