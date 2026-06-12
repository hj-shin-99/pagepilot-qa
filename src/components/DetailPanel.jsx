import StatusChip from './StatusChip'

function DetailPanel({ result }) {
  return (
    <section className="detail-grid" aria-label="수집 상세 정보">
      <article className="detail-card">
        <div className="section-title-row">
          <h3>링크 응답 상태</h3>
          <span>최대 {result.links.length}개 확인</span>
        </div>
        {result.uncheckedLinkCount > 0 ? (
          <p className="panel-note">추가 링크 {result.uncheckedLinkCount}개는 검사 시간 보호를 위해 상태 확인을 생략했습니다.</p>
        ) : null}
        <ul className="table-list">
          {result.links.length > 0 ? result.links.map((link) => (
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
      </article>

      <div className="section-stack">
        <article className="detail-card">
          <div className="section-title-row">
            <h3>이미지 / 콘솔 이슈</h3>
            <span>{result.images.length + result.consoleMessages.length}개 로그</span>
          </div>
          <ul className="issue-list">
            {result.images.map((image) => (
              <li className={`issue-row ${image.status}`} key={`${image.index}-${image.src}`}>
                <span className="issue-path">{image.src || `Image ${image.index}`}</span>
                <span className="issue-message">{image.message}</span>
              </li>
            ))}
            {result.consoleMessages.map((message) => (
              <li className={`issue-row ${message.level === 'error' ? 'error' : 'warn'}`} key={`${message.source}-${message.message}`}>
                <span className="issue-path">{message.level.toUpperCase()} · {message.source}</span>
                <span className="issue-message">{message.message}</span>
              </li>
            ))}
            {result.images.length === 0 && result.consoleMessages.length === 0 ? (
              <li className="empty-row">수집된 이미지 또는 콘솔 에러가 없습니다.</li>
            ) : null}
          </ul>
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
              <span className="evidence-label">Missing href</span>
              <span className="evidence-value">{result.missingHrefLinks.length}개</span>
            </li>
          </ul>
        </article>
      </div>
    </section>
  )
}

export default DetailPanel
