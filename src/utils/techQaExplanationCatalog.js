const MAX_CAUSES = 5
const MAX_STEPS = 6
const MAX_GUIDE = 4

export const TECH_QA_EXPLANATION_INVENTORY = [
  { screenName: '주요 검사 결과', type: 'check', categories: ['access', 'http-status', 'title', 'console-errors', 'images', 'resource-size', 'links', 'missing-href', 'mobile', 'headings', 'duplicate-ids', 'network-failures', 'forms'] },
  { screenName: 'URL 검사', type: 'link', categories: ['missing-navigation-url', 'same-page-anchor', 'javascript-pseudo-url', 'special-scheme', 'invalid-url', 'timeout', 'request-failed', 'http-4xx', 'http-5xx', 'redirect', 'sparse-success-page', 'url-not-required-ui-control', 'http-ok', 'valid-url'] },
  { screenName: '클릭 동작 검사', type: 'click', categories: ['covered-or-not-interactable', 'missing-navigation-action', 'javascript-pseudo-url', 'no-observable-action', 'ambiguous-action', 'skipped-safe-click', 'UI-control-no-url-required', 'observable-action', 'valid-url', 'runtime-error'] },
  { screenName: '랜딩 페이지 검사', type: 'landing', categories: ['landing-ok', 'landing-redirect-ok', 'http-4xx', 'http-5xx', 'missing-title', 'needs-review', 'blank-screen', 'timeout', 'restricted', 'browser-error-page', 'critical-script-error', 'unexpected-redirect-destination'] },
  { screenName: 'Form QA', type: 'form-interaction', categories: ['submit-not-blocked', 'label', 'autocomplete', 'validation', 'skipped', 'ok'] },
  { screenName: 'Hover / Dropdown QA', type: 'hover-interaction', categories: ['dropdown', 'tooltip', 'native-tooltip', 'no-change', 'clipped', 'blocked', 'runtime-error'] },
  { screenName: 'Modal QA', type: 'modal-interaction', categories: ['modal-ok', 'open-failed', 'close-failed', 'duplicate-dialog', 'accessibility-review', 'runtime-error'] },
  { screenName: 'Scroll QA', type: 'scroll-interaction', categories: ['bottom-reach', 'overflow-hidden', 'lazy-load', 'fixed-overlay', 'restore-failed', 'height-growth', 'runtime-error'] },
  { screenName: 'Responsive QA', type: 'responsive-layout', categories: ['viewport', 'overflow', 'clipped', 'text-clipped', 'intended-scroller', 'navigation-failed', 'blank-screen', 'runtime-error'] },
  { screenName: 'Download QA', type: 'download-resource', categories: ['http-error', 'timeout', 'zero-byte', 'mime-mismatch', 'restricted', 'download-ok', 'skipped'] },
  { screenName: 'Cookie QA', type: 'cookie-security', categories: ['samesite-none-without-secure', 'httponly-review', 'scope-conflict', 'long-expiry', 'third-party', 'cookie-ok'] },
  { screenName: 'Image QA', type: 'image-rendering', categories: ['broken-image', 'http-error', 'html-mime', 'aspect-ratio', 'upscaled', 'oversized-source', 'svg-or-data', 'image-ok'] },
  { screenName: 'Performance QA', type: 'performance-resource', categories: ['overview', 'large-resource', 'slow-resource', 'compression', 'cache-policy', 'duplicate-request', 'render-blocking', 'failed-resource'] },
  { screenName: 'SEO QA', type: 'seo-readiness', categories: ['search-meta', 'canonical', 'indexing', 'structured-data', 'social-meta', 'hreflang', 'robots-txt', 'sitemap-xml'] },
  { screenName: '마크업 및 접근성 검사', type: 'markup', categories: ['meta', 'image-alt', 'external-links', 'headings', 'duplicate-ids', 'forms', 'unlabeled-clickables'] },
]

export function createTechQaExplanation(item = {}, context = {}) {
  const raw = getRaw(item)
  const displayStatus = context.displayStatus || item.statusLabel || getFallbackStatusLabel(item)
  const auditType = resolveAuditType(item)
  const category = getCategory(item)
  const target = getTargetName(item)
  const helpers = { item, raw, displayStatus, auditType, category, target, statusTitle: `왜 '${displayStatus}'로 분류됐나요?` }
  const factory = selectFactory(helpers)
  return normalizeExplanation(factory(helpers), helpers)
}

function selectFactory(helpers) {
  if (helpers.displayStatus === '해당 없음') return createNotApplicableExplanation
  if (helpers.auditType === 'link') return createUrlExplanation
  if (helpers.auditType === 'click') return createClickExplanation
  if (helpers.auditType === 'landing') return createLandingExplanation
  if (helpers.auditType === 'form-interaction') return createFormExplanation
  if (helpers.auditType === 'hover-interaction') return createHoverExplanation
  if (helpers.auditType === 'modal-interaction') return createModalExplanation
  if (helpers.auditType === 'scroll-interaction') return createScrollExplanation
  if (helpers.auditType === 'responsive-layout') return createResponsiveExplanation
  if (helpers.auditType === 'download-resource') return createDownloadExplanation
  if (helpers.auditType === 'cookie-security') return createCookieExplanation
  if (helpers.auditType === 'image-rendering') return createImageExplanation
  if (helpers.auditType === 'performance-resource') return createPerformanceExplanation
  if (helpers.auditType === 'seo-readiness') return createSeoExplanation
  if (helpers.auditType === 'markup') return createMarkupExplanation
  if (isBasicCheckType(helpers.auditType)) return createBasicCheckExplanation
  if (helpers.displayStatus === '검사 불가') return createUnavailableExplanation
  if (helpers.displayStatus === '정상') return createNormalExplanation
  return createGenericExplanation
}

function createUrlExplanation({ raw, displayStatus, category, target }) {
  const statusCode = getStatusCode(raw)
  if (category === 'missing-navigation-url') return {
    meaning: `'${target}' 요소에서 사용자가 이동할 목적지 URL이나 action 근거가 충분히 확인되지 않았습니다.`,
    commonCauses: ['href 값이 비어 있을 수 있습니다.', '버튼처럼 보이지만 클릭 이벤트가 연결되지 않았을 수 있습니다.', 'CMS 또는 배포 데이터에서 목적지 URL이 빠졌을 수 있습니다.', '실제로는 모달/탭 제어인데 URL 검사에 포함됐을 수 있습니다.'],
    classificationReason: '클릭 가능한 CTA 후보에서 href, resolved URL, action evidence가 모두 부족해 자동 검사에서 이동 목적을 확인하지 못했습니다.',
    verifySteps: [`'${target}' 요소를 직접 클릭합니다.`, 'URL 이동, 모달, 탭 전환, 아코디언 변화가 있는지 확인합니다.', 'Elements에서 href와 onclick 또는 data-action 값을 확인합니다.', '이동 CTA라면 CMS/관리 화면의 목적지 URL 값을 확인합니다.'],
    decisionGuide: ['클릭 후 의도한 UI 변화가 있으면 URL이 필요 없는 제어일 수 있습니다.', '이동해야 하는 CTA인데 변화가 없으면 링크 또는 이벤트 연결 확인이 필요합니다.', '관리 데이터가 비어 있으면 콘텐츠 설정 확인이 필요합니다.'],
  }
  if (category === 'javascript-pseudo-url') return {
    meaning: `'${target}' 링크가 일반 URL이 아니라 JavaScript 실행용 주소로 설정되어 있습니다. 실제 이동 링크인지, 화면 안에서 동작하는 버튼인지 직접 확인이 필요합니다.`,
    commonCauses: ['모달, 탭, 드롭다운처럼 페이지 이동이 필요 없는 UI일 수 있습니다.', '이동 CTA인데 실제 URL 연결이 아직 빠졌을 가능성이 있습니다.', '클릭 이벤트 스크립트가 별도로 연결되어 있을 수 있습니다.'],
    classificationReason: 'href 값이 javascript:void(0) 계열로 확인되어 HTTP 응답 검사를 할 수 없고, 자동 검사만으로 의도된 이동 여부를 확정할 수 없어서 검토 대상으로 분류했습니다.',
    verifySteps: [`브라우저에서 '${target}' 요소를 찾습니다.`, '해당 요소를 클릭합니다.', '페이지 이동, 모달 열림, 탭 전환 등 의도한 반응이 있는지 확인합니다.', '이동 CTA라면 Elements에서 실제 목적지 URL 또는 클릭 이벤트 연결을 확인합니다.'],
    decisionGuide: ['클릭 후 의도한 UI 변화가 명확하면 페이지 이동이 없는 버튼일 수 있습니다.', '이동해야 하는 CTA인데 URL 변화나 화면 변화가 없으면 연결 확인이 필요합니다.', '스크립트 오류가 함께 보이면 클릭 이벤트 처리 확인이 필요합니다.'],
  }
  if (category === 'same-page-anchor') return {
    meaning: `'${target}' 링크가 같은 페이지 내부 위치로 이동하는 anchor로 설정되어 있습니다.`,
    commonCauses: ['페이지 안 특정 섹션으로 이동하는 의도일 수 있습니다.', '임시 href="#"가 남아 있을 가능성이 있습니다.', '클릭 이벤트가 별도 스크립트로 연결되어 있을 수 있습니다.'],
    classificationReason: 'href 값이 # 또는 같은 페이지 anchor로 확인되어 외부/랜딩 URL 이동 여부를 자동 검사만으로 확정할 수 없었습니다.',
    verifySteps: [`'${target}' 요소를 클릭합니다.`, '클릭 직후 페이지 위치가 의도한 섹션으로 이동하는지 확인합니다.', '화면 변화가 없다면 href 값과 클릭 이벤트 연결을 Elements에서 확인합니다.'],
    decisionGuide: ['의도한 섹션으로 이동하면 내부 anchor 동작으로 볼 수 있습니다.', '아무 변화가 없으면 임시 링크 또는 이벤트 연결 누락 가능성이 있습니다.', '이동 CTA라면 실제 랜딩 URL이 필요한지 확인이 필요합니다.'],
  }
  if (category === 'special-scheme' || raw.linkType === 'mailto' || raw.linkType === 'tel') return {
    meaning: `'${target}' 링크는 웹페이지가 아니라 메일 앱 또는 전화 앱을 여는 특수 링크입니다.`,
    commonCauses: ['상담 메일 또는 전화 연결 CTA일 수 있습니다.', 'HTTP 페이지가 아니므로 서버 응답 검사를 생략합니다.', '기기나 브라우저 설정에 따라 실행 앱이 달라질 수 있습니다.'],
    classificationReason: `${raw.linkType || 'special scheme'} 링크로 분류되어 일반 URL처럼 HTTP status를 요청하지 않았습니다.`,
    verifySteps: [`'${target}' 링크의 href 값을 Elements에서 확인합니다.`, '클릭했을 때 메일 작성 화면 또는 전화 연결 화면이 열리는지 확인합니다.', '표시되는 수신자, 전화번호가 운영 정책과 맞는지 확인합니다.'],
    decisionGuide: ['의도한 앱과 수신 정보가 열리면 특수 링크로 볼 수 있습니다.', '잘못된 번호나 수신자가 보이면 콘텐츠 수정이 필요합니다.', '일반 페이지 이동 CTA라면 HTTP URL로 변경이 필요한지 확인합니다.'],
  }
  if (category === 'invalid-url') return {
    meaning: `'${target}' 링크 주소를 브라우저가 안정적인 URL로 해석하지 못했습니다.`,
    commonCauses: ['href 값이 비어 있거나 형식이 깨졌을 수 있습니다.', '템플릿 변수나 CMS 값이 치환되지 않았을 가능성이 있습니다.', '프로토콜 또는 도메인 일부가 누락됐을 수 있습니다.'],
    classificationReason: 'URL 파싱 단계에서 요청 가능한 주소로 정규화되지 않아 HTTP 검사를 진행할 수 없었습니다.',
    verifySteps: ['Elements에서 해당 링크의 href 값을 확인합니다.', '주소를 브라우저 주소창에 직접 입력해 열리는지 확인합니다.', 'CMS 또는 배포 데이터에 실제 URL 값이 들어갔는지 확인합니다.'],
    decisionGuide: ['브라우저에서 열 수 없는 형식이면 링크 값 수정이 필요합니다.', '운영 데이터 치환 전 상태라면 배포 데이터 확인이 필요합니다.', '클릭 이벤트만 사용하는 UI라면 URL 검사가 아닌 클릭 동작으로 확인합니다.'],
  }
  if (category === 'url-not-required-ui-control') return {
    meaning: `'${target}' 요소는 일반 URL 이동이 아니라 화면 안의 UI 상태를 바꾸는 컨트롤로 분류됐습니다.`,
    commonCauses: ['모달, 탭, 아코디언, 메뉴 버튼일 수 있습니다.', 'href 없이 JavaScript 또는 ARIA 상태로 동작할 수 있습니다.', '페이지 이동이 필요 없는 컴포넌트일 수 있습니다.'],
    classificationReason: 'URL이 없어도 되는 UI 제어 신호가 확인되어 URL 오류로 분류하지 않았습니다.',
    verifySteps: [`'${target}' 요소를 클릭합니다.`, '모달, 메뉴, 탭, 아코디언 변화가 의도대로 발생하는지 확인합니다.', '키보드로도 같은 제어가 가능한지 확인합니다.'],
    decisionGuide: ['의도한 UI 변화가 발생하면 URL 없음은 자연스러운 결과입니다.', '화면 변화가 없으면 클릭 이벤트 또는 접근성 상태 확인이 필요합니다.', '실제 이동 CTA라면 목적지 URL 필요 여부를 확인합니다.'],
  }
  if (category === 'timeout') return {
    meaning: `'${target}' 링크의 응답을 제한 시간 안에 받지 못했습니다.`,
    commonCauses: ['대상 서버 응답이 느릴 수 있습니다.', '자동화 환경에서 네트워크 접근이 제한됐을 수 있습니다.', '리다이렉트가 길거나 외부 서비스가 지연됐을 수 있습니다.'],
    classificationReason: '자동 HTTP 요청이 timeout으로 종료되어 정상 응답 여부를 확인하지 못했습니다.',
    verifySteps: ['같은 네트워크 환경에서 링크를 직접 클릭합니다.', '브라우저 DevTools Network에서 요청 시간이 길게 지연되는지 확인합니다.', '새로고침 후에도 같은 지연이 반복되는지 확인합니다.'],
    decisionGuide: ['일반 브라우저에서도 반복 지연되면 대상 서버 또는 리다이렉트 확인이 필요합니다.', '브라우저에서는 빠르게 열리면 자동화 환경 또는 일시적 네트워크 영향일 수 있습니다.', '특정 시간대에만 발생하면 외부 서비스 상태를 함께 확인합니다.'],
  }
  if (category === 'request-failed') return {
    meaning: `'${target}' 링크 요청이 네트워크 단계에서 실패했습니다.`,
    commonCauses: ['DNS, TLS, CORS, 방화벽 등 네트워크 조건이 맞지 않을 수 있습니다.', '외부 도메인이 자동화 환경 요청을 차단했을 수 있습니다.', '대상 URL이 현재 배포 환경에서 접근 불가일 수 있습니다.'],
    classificationReason: `자동 요청에서 ${raw.message || raw.note || 'network failure'} 신호가 확인되어 HTTP status를 얻지 못했습니다.`,
    verifySteps: ['해당 링크를 직접 클릭합니다.', 'DevTools Network에서 요청 실패 사유와 최종 URL을 확인합니다.', '사내망/VPN/권한 조건이 필요한 링크인지 확인합니다.'],
    decisionGuide: ['일반 브라우저에서도 실패하면 링크 또는 대상 서버 확인이 필요합니다.', '권한 환경에서만 열리는 링크라면 접근 조건을 기록합니다.', '외부 서비스 차단이면 자동화 한계와 실제 사용자 접근 여부를 분리해 판단합니다.'],
  }
  if (statusCode === 403 || statusCode === 401) return {
    meaning: `'${target}' 대상이 접근 권한을 요구하거나 자동 요청을 제한했습니다.`,
    commonCauses: ['로그인 또는 권한이 필요한 페이지일 수 있습니다.', '외부 서비스가 bot 또는 비정상 요청을 제한했을 수 있습니다.', '공개 전 페이지이거나 IP 제한이 있을 수 있습니다.'],
    classificationReason: `자동 URL 검사에서 HTTP ${statusCode} 응답이 확인되어 공개 접근 가능 여부를 검토 대상으로 분류했습니다.`,
    verifySteps: ['일반 브라우저에서 로그인 전후로 링크를 클릭합니다.', '권한이 필요한 페이지인지 확인합니다.', '공개 CTA라면 비로그인 사용자도 접근 가능한지 확인합니다.'],
    decisionGuide: ['권한이 필요한 내부 링크라면 의도된 제한일 수 있습니다.', '공개 사용자가 접근해야 하는 링크라면 권한/공개 설정 확인이 필요합니다.', '자동화만 차단된 경우 실제 브라우저 접근 결과를 기준으로 판단합니다.'],
  }
  if (statusCode === 404 || statusCode === 410 || category === 'http-4xx') return {
    meaning: `'${target}' 링크의 대상 페이지를 서버에서 찾을 수 없거나 사용할 수 없는 상태로 응답했습니다.`,
    commonCauses: ['URL 경로가 잘못됐을 수 있습니다.', '대상 페이지가 삭제되었거나 아직 배포되지 않았을 수 있습니다.', '리다이렉트 설정이 누락됐을 수 있습니다.'],
    classificationReason: `자동 URL 검사에서 HTTP ${statusCode || '4xx'} 응답이 확인됐기 때문에 강한 실패 신호로 분류했습니다.`,
    verifySteps: ['해당 링크를 직접 클릭합니다.', '브라우저 주소창의 최종 URL과 오류 페이지 내용을 확인합니다.', 'CMS 또는 라우팅 설정에서 대상 경로가 존재하는지 확인합니다.'],
    decisionGuide: ['직접 클릭해도 404/410이면 링크 또는 대상 페이지 확인이 필요합니다.', '운영 전 임시 페이지라면 배포 일정과 연결 시점을 확인합니다.', '리다이렉트가 의도됐다면 최종 URL 설정을 확인합니다.'],
  }
  if (statusCode >= 500 || category === 'http-5xx') return {
    meaning: `'${target}' 대상 서버가 요청을 정상 처리하지 못했습니다.`,
    commonCauses: ['대상 서버 장애 또는 배포 오류가 있을 수 있습니다.', 'API 또는 SSR 처리 중 예외가 발생했을 수 있습니다.', '외부 서비스 의존성이 실패했을 수 있습니다.'],
    classificationReason: `자동 URL 검사에서 HTTP ${statusCode || '5xx'} 응답이 확인되어 사용자 이동 실패 가능성이 큰 상태로 분류했습니다.`,
    verifySteps: ['링크를 직접 클릭합니다.', 'DevTools Network에서 document 요청의 status와 응답 내용을 확인합니다.', '반복 새로고침해도 같은 서버 오류가 재현되는지 확인합니다.'],
    decisionGuide: ['반복해서 5xx가 보이면 서버/배포 확인이 필요합니다.', '일시적으로만 발생하면 배포나 외부 서비스 상태를 함께 확인합니다.', '특정 지역 또는 네트워크에서만 발생하면 접근 환경 차이를 기록합니다.'],
  }
  if (category === 'sparse-success-page') return {
    meaning: `'${target}' 링크는 HTTP 200으로 응답했지만, 수집된 제목이나 본문 신호가 매우 적었습니다.`,
    commonCauses: ['빈 템플릿 또는 오류 안내 페이지가 200으로 응답했을 수 있습니다.', 'SPA 콘텐츠가 자동화 수집 시점 이후에 늦게 렌더링됐을 수 있습니다.', '권한/지역 조건에 따라 콘텐츠가 축소됐을 수 있습니다.'],
    classificationReason: 'HTTP status는 성공이지만 페이지 제목, 본문 길이, 화면 요소 수가 부족해 정상 랜딩으로 확정하지 않고 검토 대상으로 분류했습니다.',
    verifySteps: ['링크를 클릭해 최종 페이지가 충분한 콘텐츠를 보여주는지 확인합니다.', '새로고침 후 콘텐츠가 늦게 나타나는지 확인합니다.', '로그인/지역/쿠키 조건에 따라 콘텐츠가 달라지는지 확인합니다.'],
    decisionGuide: ['직접 확인 시 정상 콘텐츠가 보이면 자동 검사 시점의 렌더링 지연일 수 있습니다.', '항상 빈 화면이나 오류 안내만 보이면 랜딩 페이지 구성 확인이 필요합니다.', '조건부 페이지라면 필요한 접근 조건을 기록합니다.'],
  }
  if (category === 'redirect') return {
    meaning: `'${target}' 링크가 요청한 주소에서 다른 최종 URL로 이동했습니다.`,
    commonCauses: ['정상적인 캠페인/언어/인증 리다이렉트일 수 있습니다.', '오래된 URL을 새 URL로 넘기는 설정일 수 있습니다.', '의도하지 않은 외부 도메인으로 이동할 가능성이 있습니다.'],
    classificationReason: `자동 URL 검사에서 최종 URL이 원래 URL과 다르게 확인됐습니다${raw.finalUrl ? `: ${raw.finalUrl}` : ''}.`,
    verifySteps: [`'${target}' 링크를 클릭합니다.`, '브라우저 주소창의 최종 URL을 확인합니다.', '최종 페이지가 의도한 캠페인/상품/언어 페이지인지 확인합니다.'],
    decisionGuide: ['의도한 최종 페이지라면 리다이렉트는 정상 정책일 수 있습니다.', '예상과 다른 도메인이나 페이지로 이동하면 링크 또는 리다이렉트 설정 확인이 필요합니다.', '중간 리다이렉트가 많아 느리면 성능 영향도 확인합니다.'],
  }
  if (displayStatus === '정상' || category === 'http-ok' || category === 'valid-url') return {
    meaning: `'${target}' 링크의 대상 URL에서 현재 검사 조건 기준 성공 응답이 확인됐습니다.`,
    commonCauses: ['대상 페이지가 정상 응답했습니다.', '특수 제한 없이 자동 요청으로 확인 가능한 링크입니다.'],
    classificationReason: `자동 URL 검사에서 HTTP ${statusCode || 200} 계열 성공 신호가 확인되어 정상으로 분류했습니다.`,
    verifySteps: ['필요 시 링크를 직접 클릭합니다.', '최종 페이지가 의도한 콘텐츠와 맞는지 확인합니다.'],
    decisionGuide: ['동일 조건에서 의도한 페이지가 열리면 현재 검사 범위에서는 정상입니다.', '콘텐츠나 리다이렉트 정책이 바뀐 경우 다시 검사합니다.'],
  }
  return createGenericTypedExplanation({ displayStatus, auditType: 'link', category, target, raw })
}

function createClickExplanation({ raw, displayStatus, category, target }) {
  if (raw.unrelatedOverlay === true || raw.hitTestStatus === 'hitTestFailed') return {
    meaning: `자동 검사가 '${target}' 요소를 클릭하려 했지만, 클릭 좌표 위에 다른 화면 요소가 있어 대상에 클릭이 전달되지 않았습니다.`,
    commonCauses: ['팝업이나 쿠키 배너가 버튼 위를 덮고 있을 수 있습니다.', '슬라이드 또는 영상 전환 중 임시 레이어가 남아 있을 수 있습니다.', 'z-index 설정으로 다른 요소가 버튼보다 위에 있을 수 있습니다.', '보이지 않는 요소의 pointer-events가 활성화돼 있을 수 있습니다.'].concat(raw.overlaySelector ? [`기술 정보에 기록된 overlay selector가 클릭 지점 위에 있었을 가능성이 있습니다.`] : []),
    classificationReason: 'Playwright hit-test에서 클릭 대상 요소가 아니라 관계없는 다른 요소가 실제 클릭 좌표의 최상단 요소로 확인됐습니다. 자동 클릭이 객관적으로 차단됐기 때문에 문제 확인으로 분류했습니다.',
    verifySteps: ['해당 페이지를 새로 엽니다.', `화면 로딩이 완료된 뒤 '${target}' 요소를 클릭합니다.`, '슬라이드 또는 영상 전환 중에도 다시 클릭합니다.', '요소 중앙과 좌우 영역을 각각 클릭합니다.', '의도한 이동 또는 화면 변화가 발생하는지 확인합니다.'],
    decisionGuide: ['모든 시점에서 정상 동작하면 자동 검사 시점의 일시적 차단 가능성이 있습니다.', '특정 전환 시점에만 클릭되지 않으면 animation 또는 overlay 확인이 필요합니다.', '항상 클릭되지 않으면 실제 클릭 차단 문제일 가능성이 있습니다.'],
  }
  if (/pointer-events/i.test(raw.pointerEvents || raw.reason || raw.message || '')) return {
    meaning: `'${target}' 요소가 화면에 있어도 브라우저가 클릭 대상으로 처리하지 않는 상태입니다.`,
    commonCauses: ['CSS pointer-events:none 설정이 적용됐을 수 있습니다.', '비활성 상태 스타일이 남아 있을 수 있습니다.', '부모 요소의 상태가 클릭을 막고 있을 수 있습니다.'],
    classificationReason: '자동 검사에서 클릭 대상 또는 관련 요소의 pointer-events 상태가 클릭 불가 신호로 확인됐습니다.',
    verifySteps: [`'${target}' 요소를 직접 클릭합니다.`, 'Elements에서 해당 요소와 부모 요소의 pointer-events 값을 확인합니다.', 'hover, active, disabled 상태에 따라 클릭 가능 여부가 달라지는지 확인합니다.'],
    decisionGuide: ['사용자가 클릭할 수 없으면 스타일 또는 상태 제어 확인이 필요합니다.', '특정 상태에서만 비활성화된다면 의도된 조건인지 확인합니다.', '정상 비활성 버튼이라면 상태 문구가 사용자에게 명확한지 확인합니다.'],
  }
  if (category === 'no-observable-action') return {
    meaning: `자동 검사가 '${target}' 요소를 클릭했지만 화면 이동이나 UI 변화가 관찰되지 않았습니다.`,
    commonCauses: ['분석/추적용 버튼처럼 눈에 보이는 변화가 없을 수 있습니다.', '클릭 이벤트가 연결되지 않았을 수 있습니다.', '변화가 매우 늦게 발생하거나 자동 검사 범위 밖에서 발생했을 수 있습니다.'],
    classificationReason: '안전 클릭은 실행됐지만 URL, DOM, modal, tab, accordion 등 관찰 가능한 변화가 확인되지 않아 검토 필요로 분류했습니다.',
    verifySteps: [`'${target}' 요소를 클릭합니다.`, 'URL, 모달, 아코디언, 탭, 안내 문구 변화가 있는지 확인합니다.', 'DevTools Console에 클릭 후 오류가 생기는지 확인합니다.', '기획상 눈에 보이지 않는 동작인지 확인합니다.'],
    decisionGuide: ['의도한 눈에 보이는 변화가 있으면 자동 검사 관찰 범위 밖일 수 있습니다.', '기획상 무반응 버튼이면 사용자 안내 필요 여부를 확인합니다.', '항상 아무 변화가 없으면 이벤트 연결 확인이 필요합니다.'],
  }
  if (/timeout/i.test(raw.message || raw.reason || raw.safeClickResult?.error || '')) return {
    meaning: `자동 검사가 '${target}' 요소를 클릭하는 동안 제한 시간 안에 완료 신호를 받지 못했습니다.`,
    commonCauses: ['클릭 직후 긴 animation 또는 로딩이 발생할 수 있습니다.', '대상 요소가 클릭 직전에 위치를 바꿨을 수 있습니다.', '클릭 핸들러가 오래 걸리거나 오류로 멈췄을 수 있습니다.'],
    classificationReason: 'Playwright 클릭 실행이 timeout으로 종료되어 클릭 완료 여부를 안정적으로 확인하지 못했습니다.',
    verifySteps: [`'${target}' 요소를 클릭합니다.`, '클릭 직후 로딩, disabled 상태, spinner가 오래 지속되는지 확인합니다.', 'DevTools Console과 Network에서 클릭 이후 오류나 지연 요청을 확인합니다.'],
    decisionGuide: ['일반 브라우저에서도 오래 멈추면 클릭 처리 또는 네트워크 확인이 필요합니다.', '브라우저에서는 즉시 동작하면 자동화 시점의 상태 변화 영향일 수 있습니다.', '특정 화면 폭에서만 발생하면 responsive 상태도 함께 확인합니다.'],
  }
  if (category === 'UI-control-no-url-required' || raw.actionClassification === 'ui-control-no-url-required') return {
    meaning: `'${target}' 요소는 페이지 이동 URL이 없어도 되는 UI 제어로 분류됐습니다.`,
    commonCauses: ['모달 열기/닫기 버튼일 수 있습니다.', '아코디언, 탭, 캐러셀, 메뉴 토글일 수 있습니다.', '같은 페이지 안에서 상태만 바꾸는 컨트롤일 수 있습니다.'],
    classificationReason: 'aria-controls, aria-expanded, role, data 속성 등에서 URL 없이 동작하는 UI 제어 신호가 확인됐습니다.',
    verifySteps: [`'${target}' 요소를 클릭합니다.`, '모달, 메뉴, 탭, 아코디언, 캐러셀 변화가 의도대로 발생하는지 확인합니다.', '키보드 Tab/Enter 또는 Space로도 조작 가능한지 확인합니다.'],
    decisionGuide: ['의도한 UI 변화가 발생하면 URL이 없어도 자연스러운 결과입니다.', '클릭해도 변화가 없으면 이벤트 연결 또는 접근성 상태 확인이 필요합니다.', '실제로 이동 CTA라면 목적지 URL 필요 여부를 확인합니다.'],
  }
  if (raw.actionClassification === 'verified-working' || category === 'valid-url' || category === 'observable-action') return {
    meaning: `'${target}' 요소에서 URL 이동 또는 관찰 가능한 UI 변화가 확인됐습니다.`,
    commonCauses: ['정상적인 링크 이동이 확인됐을 수 있습니다.', '모달, 탭, 아코디언 등 화면 변화가 확인됐을 수 있습니다.'],
    classificationReason: '자동 검사 조건에서 유효한 URL, 새 창, 화면 변화 또는 UI 상태 변화가 확인되어 정상 신호로 분류했습니다.',
    verifySteps: [`필요 시 '${target}' 요소를 직접 클릭합니다.`, '의도한 이동 또는 화면 변화가 현재도 유지되는지 확인합니다.'],
    decisionGuide: ['동일 조건에서 의도한 동작이 유지되면 현재 검사 조건에서는 정상으로 볼 수 있습니다.', '배포 후 UI가 바뀐 경우 다시 검사해 결과를 갱신합니다.'],
  }
  if (category === 'missing-navigation-action' || category === 'ambiguous-action') return {
    meaning: `'${target}' 요소가 이동 버튼처럼 보이지만 자동 검사에서 URL 또는 action 근거가 충분히 명확하지 않았습니다.`,
    commonCauses: ['href가 없거나 임시 값일 수 있습니다.', 'onclick, data-action 같은 이벤트 근거가 불완전할 수 있습니다.', '실제로는 이동이 아닌 UI 제어일 수 있습니다.', '동적 렌더링 이후에만 이벤트가 연결될 수 있습니다.'],
    classificationReason: '클릭 후보의 hrefState 또는 action evidence가 불완전해 자동 검사만으로 의도한 동작을 확정하지 않았습니다.',
    verifySteps: [`'${target}' 요소를 직접 클릭합니다.`, '페이지 이동 또는 UI 변화가 발생하는지 확인합니다.', 'Elements에서 href, role, onclick, data-action 값을 확인합니다.', '이동 CTA라면 실제 목적지 URL이 필요한지 확인합니다.'],
    decisionGuide: ['의도한 UI 변화가 있으면 이동 URL이 없어도 정상일 수 있습니다.', '이동해야 하는 CTA인데 변화가 없으면 연결 확인이 필요합니다.', '이벤트가 늦게 연결되면 로딩 완료 시점의 동작을 확인합니다.'],
  }
  if (/runtime|exception|referenceerror|typeerror|execution context/i.test(raw.message || raw.reason || raw.safeClickResult?.error || '')) return {
    meaning: `'${target}' 클릭 중 브라우저 실행 오류 또는 자동화 실행 컨텍스트 오류가 확인됐습니다.`,
    commonCauses: ['클릭 핸들러에서 JavaScript 오류가 발생했을 수 있습니다.', '클릭 직후 페이지가 이동하며 실행 컨텍스트가 바뀌었을 수 있습니다.', '동적 렌더링 중 요소가 사라졌을 수 있습니다.'],
    classificationReason: `${raw.message || raw.reason || raw.safeClickResult?.error || 'runtime error'} 신호가 클릭 검사 중 확인됐습니다.`,
    verifySteps: [`'${target}' 요소를 클릭합니다.`, 'DevTools Console에서 클릭 직후 오류가 생기는지 확인합니다.', 'Network 이동 또는 SPA route 변경과 동시에 오류가 발생하는지 확인합니다.'],
    decisionGuide: ['일반 브라우저에서도 오류가 반복되면 클릭 핸들러 확인이 필요합니다.', '정상 이동 과정에서만 자동화 컨텍스트가 바뀌면 실제 사용자 영향과 분리해 판단합니다.', '특정 viewport에서만 재현되면 반응형 상태를 함께 확인합니다.'],
  }
  if (raw.actionClassification === 'safe-click-skipped' || category === 'skipped-safe-click') return {
    meaning: `'${target}' 요소는 삭제, 결제, 제출처럼 실제 영향을 줄 수 있어 자동 클릭을 생략했습니다.`,
    commonCauses: ['위험 동작으로 분류된 버튼일 수 있습니다.', '개인정보 입력 또는 데이터 변경 가능성이 있을 수 있습니다.', '자동화가 안전 정책상 클릭하지 않는 UI일 수 있습니다.'],
    classificationReason: `safe click 정책에서 ${raw.safeClickSkippedReason || '위험 가능성'} 신호가 확인되어 실제 클릭을 실행하지 않았습니다.`,
    verifySteps: ['테스트 계정 또는 스테이징 환경에서만 직접 클릭을 검토합니다.', '클릭 전 확인 모달, 취소 경로, 데이터 변경 여부를 확인합니다.', '운영 환경에서는 영향 범위를 확인한 뒤 재현합니다.'],
    decisionGuide: ['의도한 보호 장치가 있으면 자동 생략은 안전 분류로 볼 수 있습니다.', '중요 CTA가 과도하게 위험 동작으로 분류됐다면 라벨과 동작 정책 확인이 필요합니다.', '실제 삭제/결제 동작은 운영 데이터 영향 없이 검증해야 합니다.'],
  }
  return createGenericTypedExplanation({ displayStatus, auditType: 'click', category, target, raw })
}

function createLandingExplanation({ raw, category, target }) {
  const statusCode = getStatusCode(raw)
  if (category === 'landing-ok' || category === 'landing-redirect-ok') return {
    meaning: `'${target}' 클릭 후 도착한 랜딩 페이지에서 기본 콘텐츠와 성공 응답이 확인됐습니다.`,
    commonCauses: ['정상 랜딩 페이지가 로드됐습니다.', '리다이렉트 후 최종 페이지가 정상일 수 있습니다.'],
    classificationReason: `HTTP ${statusCode || 200} 응답과 페이지 제목 또는 본문 콘텐츠가 확인되어 현재 검사 조건에서 정상으로 분류했습니다.`,
    verifySteps: ['원본 클릭 요소를 누릅니다.', '최종 랜딩 URL과 화면 콘텐츠가 의도와 맞는지 확인합니다.'],
    decisionGuide: ['의도한 최종 페이지라면 현재 검사 조건에서는 정상입니다.', '최종 도메인이나 페이지가 예상과 다르면 연결 정책을 확인합니다.'],
  }
  if (category === 'http-4xx' || category === 'http-5xx') return {
    meaning: `'${target}' 클릭 후 도착한 랜딩 페이지가 HTTP ${statusCode || (category === 'http-5xx' ? '5xx' : '4xx')} 응답을 반환했습니다.`,
    commonCauses: ['대상 페이지가 삭제되었거나 배포되지 않았을 수 있습니다.', '서버 오류 또는 권한 제한 페이지일 수 있습니다.', '리다이렉트 목적지가 잘못됐을 가능성이 있습니다.'],
    classificationReason: `랜딩 페이지 관찰에서 HTTP ${statusCode || category}가 확인되어 정상 콘텐츠 확인에 실패했습니다.`,
    verifySteps: ['원본 클릭 요소를 직접 클릭합니다.', '도착한 페이지의 URL과 HTTP status를 DevTools Network에서 확인합니다.', '오류 페이지가 실제 사용자에게 보이는지 확인합니다.'],
    decisionGuide: ['직접 재현돼도 오류 페이지가 보이면 랜딩 URL 또는 대상 서버 확인이 필요합니다.', '로그인 후 정상이라면 공개/권한 조건을 확인합니다.', '일시적 서버 오류라면 재시도 시점과 서버 상태를 함께 기록합니다.'],
  }
  if (category === 'blank-screen' || category === 'browser-error-page' || category === 'critical-script-error') return {
    meaning: `'${target}' 랜딩에서 HTTP 성공 여부와 별개로 화면 오류 또는 빈 화면 신호가 확인됐습니다.`,
    commonCauses: ['SPA 렌더링 중 JavaScript 오류가 발생했을 수 있습니다.', '브라우저 오류 페이지가 200 응답처럼 보였을 수 있습니다.', '필수 리소스 로딩 실패로 콘텐츠가 그려지지 않았을 수 있습니다.'],
    classificationReason: '랜딩 페이지 관찰에서 빈 화면, 브라우저 오류 페이지 또는 치명적인 스크립트 오류가 확인됐습니다.',
    verifySteps: ['원본 클릭 요소로 랜딩 페이지를 엽니다.', '화면 콘텐츠가 실제로 비어 있거나 오류 안내만 보이는지 확인합니다.', 'DevTools Console에서 페이지 오류를 확인합니다.', 'Network에서 필수 JS/CSS/API 실패가 있는지 확인합니다.'],
    decisionGuide: ['일반 브라우저에서도 빈 화면이면 랜딩 렌더링 확인이 필요합니다.', '새로고침 후 정상이라면 초기 로딩 타이밍 또는 일시적 리소스 실패를 확인합니다.', '특정 브라우저/viewport에서만 발생하면 환경 조건을 기록합니다.'],
  }
  if (category === 'needs-review' || category === 'missing-title') return {
    meaning: `'${target}' 랜딩이 열리긴 했지만 제목이나 본문 콘텐츠 신호가 충분하지 않았습니다.`,
    commonCauses: ['콘텐츠가 늦게 렌더링되는 SPA일 수 있습니다.', '제목 또는 본문이 비어 있는 임시 페이지일 수 있습니다.', '권한/지역 조건에 따라 일부 콘텐츠만 보였을 수 있습니다.'],
    classificationReason: 'HTTP 성공 후에도 title, 본문 길이, 주요 콘텐츠 신호가 부족해 자동 검사만으로 정상 랜딩을 확정하지 않았습니다.',
    verifySteps: ['원본 클릭 요소로 랜딩을 엽니다.', '페이지 제목, 주요 본문, CTA가 실제로 표시되는지 확인합니다.', '잠시 기다린 뒤 콘텐츠가 추가로 렌더링되는지 확인합니다.'],
    decisionGuide: ['충분한 콘텐츠가 보이면 자동 검사 시점의 렌더링 지연일 수 있습니다.', '항상 빈 제목이나 얇은 콘텐츠면 랜딩 구성 확인이 필요합니다.', '의도적으로 외부 서비스로 넘기는 페이지라면 연결 정책과 화면 안내를 확인합니다.'],
  }
  if (category === 'timeout' || category === 'restricted') return {
    meaning: `'${target}' 랜딩 페이지를 자동화 환경에서 끝까지 확인하지 못했습니다.`,
    commonCauses: ['로딩 시간이 길거나 navigation timeout이 발생했을 수 있습니다.', '로그인, IP 제한, bot protection이 있을 수 있습니다.', '외부 서비스가 자동화 브라우저 접근을 제한했을 수 있습니다.'],
    classificationReason: `${raw.navigationError || raw.loadWarning || category} 신호가 확인되어 랜딩 관찰을 완료하지 못했습니다.`,
    verifySteps: ['일반 브라우저에서 원본 클릭 요소를 누릅니다.', '로그인/권한/VPN 조건에 따라 접근 결과가 달라지는지 확인합니다.', 'DevTools Network에서 가장 오래 걸리거나 차단된 요청을 확인합니다.'],
    decisionGuide: ['일반 사용자도 접근하지 못하면 공개/권한 설정 확인이 필요합니다.', '자동화에서만 제한되면 실제 사용자 접근 여부를 기준으로 판단합니다.', '로딩 지연이 반복되면 대상 페이지 성능 또는 외부 서비스 상태를 확인합니다.'],
  }
  return createGenericTypedExplanation({ displayStatus: raw.statusLabel, auditType: 'landing', category, target, raw })
}

function createFormExplanation({ raw, target }) {
  if (raw.status === 'error' || raw.category === 'submit-not-blocked') return {
    meaning: `'${target}' 입력 또는 제출 흐름에서 예상보다 강한 제출/요청 신호가 확인됐습니다.`,
    commonCauses: ['필수값 검증 전에 제출 요청이 발생했을 수 있습니다.', '브라우저 기본 validation이 우회됐을 수 있습니다.', '테스트 입력 상태에서 POST 요청이 관찰됐을 수 있습니다.'],
    classificationReason: '자동 검사에서 제출 시도 후 mutating request 또는 submit 차단 실패 신호가 확인됐습니다.',
    verifySteps: ['빈 값 또는 잘못된 형식으로 폼 제출을 시도합니다.', '필수값 안내가 표시되고 제출이 차단되는지 확인합니다.', 'DevTools Network에서 POST/PUT/PATCH 요청이 발생하는지 확인합니다.'],
    decisionGuide: ['검증 안내 후 요청이 나가지 않으면 현재 사용자 흐름은 안전할 수 있습니다.', '잘못된 값으로도 요청이 발생하면 form validation 확인이 필요합니다.', '서버 검증만 의도했다면 사용자 안내 품질을 함께 확인합니다.'],
  }
  return createInteractionExplanation('Form QA', '입력 필드의 라벨, 필수값, 형식 검증 반응을 확인한 결과입니다.', ['label 또는 접근성 이름이 빠졌을 수 있습니다.', 'autocomplete 설정이 누락됐을 수 있습니다.', '필수값 또는 이메일 형식 검증이 브라우저와 다르게 동작할 수 있습니다.'], ['폼에 값을 입력하지 않고 제출합니다.', '필수값 안내와 포커스 이동을 확인합니다.', '이메일/전화번호 같은 형식 입력의 오류 안내를 확인합니다.'], raw)
}

function createHoverExplanation({ raw, category, target }) {
  if (category === 'no-change') return {
    meaning: `'${target}' 요소에 마우스를 올렸지만 메뉴, 툴팁, ARIA 상태 같은 변화가 관찰되지 않았습니다.`,
    commonCauses: ['실제로 hover 반응이 없는 요소일 수 있습니다.', 'hover panel이 늦게 뜨거나 다른 조건에서만 뜰 수 있습니다.', 'native title 툴팁처럼 DOM 변화가 없는 동작일 수 있습니다.'],
    classificationReason: 'hover 전후 visibility, DOM, ARIA 변화가 확인되지 않아 의도 판단이 필요한 결과로 분류했습니다.',
    verifySteps: [`'${target}' 요소에 마우스를 올립니다.`, '메뉴, 툴팁, 드롭다운이 나타나는지 확인합니다.', '마우스를 벗겼을 때 원래 상태로 돌아오는지 확인합니다.'],
    decisionGuide: ['의도한 변화가 없으면 정상일 수 있습니다.', '메뉴가 떠야 하는 요소라면 hover 이벤트 또는 CSS 상태 확인이 필요합니다.', 'native title만 의도했다면 접근성 안내와 모바일 대체 동작을 확인합니다.'],
  }
  return createInteractionExplanation('Hover / Dropdown QA', '마우스 오버로 노출되는 메뉴, 툴팁, 드롭다운의 표시와 복원 상태를 확인한 결과입니다.', ['hover panel이 viewport 밖으로 잘릴 수 있습니다.', 'ARIA 상태가 화면 변화와 맞지 않을 수 있습니다.', 'hover 실행 중 스크립트 오류가 발생했을 수 있습니다.'], [`'${target}' 요소에 마우스를 올립니다.`, '표시되는 메뉴나 툴팁이 화면 안에 들어오는지 확인합니다.', '마우스를 벗겼을 때 닫힘 또는 복원이 의도대로 되는지 확인합니다.'], raw)
}

function createModalExplanation({ raw, target }) {
  return createInteractionExplanation('Modal QA', `'${target}' 트리거로 열리는 모달의 열기, 닫기, ESC, 포커스, 배경 스크롤 상태를 확인한 결과입니다.`, ['모달 트리거가 열림 상태를 만들지 못했을 수 있습니다.', '닫기 버튼, ESC, backdrop 닫기가 누락됐을 수 있습니다.', 'focus 이동 또는 반환이 맞지 않을 수 있습니다.', '배경 스크롤 잠금이 의도와 다르게 동작할 수 있습니다.'], [`'${target}' 요소로 모달을 엽니다.`, '닫기 버튼, ESC, 배경 클릭으로 닫히는지 확인합니다.', '모달을 연 뒤 배경 스크롤이 의도대로 잠기는지 확인합니다.', '닫은 뒤 포커스와 스크롤 위치가 자연스럽게 돌아오는지 확인합니다.'], raw)
}

function createScrollExplanation({ raw }) {
  return createInteractionExplanation('Scroll QA', '페이지 스크롤, 하단 도달, 지연 로딩, 고정 요소 차단 여부를 확인한 결과입니다.', ['페이지 높이가 동적으로 계속 늘어날 수 있습니다.', 'lazy image 또는 무한 스크롤 콘텐츠가 늦게 로드될 수 있습니다.', '고정 헤더나 배너가 콘텐츠를 가릴 수 있습니다.', '스크롤 복원 위치가 달라질 수 있습니다.'], ['페이지 맨 위에서 시작해 천천히 아래로 스크롤합니다.', '하단 근처에서 이미지와 콘텐츠가 모두 표시되는지 확인합니다.', '고정 요소가 CTA나 본문을 가리지 않는지 확인합니다.', '새로고침 또는 뒤로가기 후 스크롤 위치가 의도대로 복원되는지 확인합니다.'], raw)
}

function createResponsiveExplanation({ raw, target }) {
  const viewport = raw.type || raw.viewport || raw.viewportState || target
  return {
    meaning: `${viewport} viewport에서 레이아웃 넘침, 잘림, 빈 화면 또는 실행 오류 신호를 확인한 결과입니다.`,
    commonCauses: ['일부 요소의 고정 너비가 viewport보다 클 수 있습니다.', '의도된 가로 스크롤 영역과 실제 overflow가 구분되어야 합니다.', '숨겨진 duplicate slide나 off-canvas 메뉴가 측정에 영향을 줄 수 있습니다.', '특정 viewport에서만 JavaScript 오류가 발생할 수 있습니다.'],
    classificationReason: `${raw.issues?.join(' ') || raw.note || raw.reason || 'viewport 관찰값'} 신호를 기준으로 현재 상태를 분류했습니다.`,
    verifySteps: [`브라우저 viewport를 ${viewport || '해당 결과의 화면 크기'}로 맞춥니다.`, '페이지를 새로고침합니다.', '좌우로 의도치 않은 가로 스크롤이 생기는지 확인합니다.', 'CTA, 카드, 텍스트가 viewport 밖으로 잘리는지 확인합니다.', '의도된 carousel 또는 table 가로 스크롤인지 구분합니다.'],
    decisionGuide: ['전체 페이지가 좌우로 밀리면 레이아웃 overflow 확인이 필요합니다.', 'carousel/table 내부만 스크롤되면 디자인 의도일 수 있습니다.', '특정 요소만 잘리면 해당 breakpoint 스타일 확인이 필요합니다.', '빈 화면이나 오류가 반복되면 해당 viewport 실행 오류를 확인합니다.'],
  }
}

function createDownloadExplanation({ raw, target }) {
  return createInteractionExplanation('Download QA', `'${target}' 다운로드 링크의 응답 상태, 파일 형식, 파일 크기 신호를 확인한 결과입니다.`, ['파일 URL이 삭제되었거나 권한이 필요할 수 있습니다.', '서버가 파일 대신 HTML 오류 페이지를 반환할 수 있습니다.', 'HEAD 요청과 실제 GET 응답이 다를 수 있습니다.', '파일 확장자와 Content-Type이 맞지 않을 수 있습니다.'], [`'${target}' 다운로드 링크를 클릭합니다.`, '파일이 다운로드되거나 새 탭에서 정상 표시되는지 확인합니다.', 'DevTools Network에서 status, Content-Type, Content-Length를 확인합니다.', '파일명이 의도한 확장자와 맞는지 확인합니다.'], raw)
}

function createCookieExplanation({ raw, target }) {
  return createInteractionExplanation('Cookie QA', `'${target}' 쿠키의 Secure, HttpOnly, SameSite, 만료 기간, scope 설정을 확인한 결과입니다.`, ['SameSite=None 쿠키에 Secure가 없을 수 있습니다.', '세션성 쿠키에 HttpOnly가 필요할 수 있습니다.', '같은 이름의 쿠키가 여러 domain/path에 있어 충돌할 수 있습니다.', '만료 기간이 정책보다 길 수 있습니다.'], ['DevTools Application 탭에서 Cookies를 엽니다.', `'${target}' 쿠키의 Secure, HttpOnly, SameSite 값을 확인합니다.`, '같은 이름 쿠키가 여러 domain/path에 중복되는지 확인합니다.', '로그인/비로그인 상태에 따라 쿠키가 달라지는지 확인합니다.'], raw)
}

function createImageExplanation({ raw, target }) {
  return createInteractionExplanation('Image QA', `'${target}' 이미지의 로딩 응답, 실제 렌더링 크기, 비율, 리소스 상태를 확인한 결과입니다.`, ['이미지 요청이 404/5xx 또는 HTML 응답을 받을 수 있습니다.', '원본 비율과 렌더링 비율이 맞지 않을 수 있습니다.', '작은 원본을 크게 확대했을 수 있습니다.', 'SVG, data, blob 이미지는 일부 raster 기준이 적용되지 않을 수 있습니다.'], ['페이지에서 해당 이미지를 찾습니다.', '이미지가 깨지거나 빈 영역으로 보이는지 확인합니다.', 'DevTools Network에서 이미지 status와 Content-Type을 확인합니다.', 'Elements에서 rendered size와 natural size를 비교합니다.'], raw)
}

function createPerformanceExplanation({ raw, category }) {
  const networkStep = 'DevTools Network 탭에서 해당 리소스의 Size, Time, Status, Encoding 값을 확인합니다.'
  if (category === 'failed-resource') return createInteractionExplanation('Performance QA', '페이지 구성에 필요한 리소스 요청 중 실패 응답이 확인됐습니다.', ['JS, CSS, font, image 요청이 4xx/5xx로 실패했을 수 있습니다.', 'first-party 핵심 리소스가 배포 경로에서 누락됐을 수 있습니다.', 'CDN 또는 cache purge 상태가 맞지 않을 수 있습니다.'], ['페이지를 새로고침합니다.', networkStep, '실패 리소스가 화면 기능이나 스타일에 영향을 주는지 확인합니다.'], raw)
  if (category === 'large-resource' || category === 'slow-resource') return createInteractionExplanation('Performance QA', '큰 용량 또는 느린 리소스가 로딩 시간에 영향을 줄 수 있는 신호로 수집됐습니다.', ['이미지, 영상, JS bundle 크기가 클 수 있습니다.', 'first-party 리소스 응답 시간이 길 수 있습니다.', '외부 스크립트 지연이 체감 속도에 영향을 줄 수 있습니다.'], ['페이지를 새로고침합니다.', networkStep, '가장 큰 리소스와 가장 오래 걸린 요청을 정렬해 확인합니다.', '해당 리소스가 첫 화면 표시 전에 필요한지 확인합니다.'], raw)
  return createInteractionExplanation('Performance QA', 'Network 기반으로 압축, 캐시, 중복 요청, render-blocking 후보를 확인한 결과입니다.', ['텍스트 리소스에 gzip/br 압축이 없을 수 있습니다.', 'fingerprinted 정적 리소스 cache policy가 짧을 수 있습니다.', '동일 파일이 중복 요청될 수 있습니다.', 'head script가 렌더링을 지연할 수 있습니다.'], ['페이지를 새로고침합니다.', networkStep, 'Disable cache를 끄고 다시 측정해 cache policy를 확인합니다.', '문제 리소스가 실제 초기 화면에 필요한지 확인합니다.'], raw)
}

function createSeoExplanation({ raw, category }) {
  const sourceStep = '페이지 소스 또는 Elements에서 해당 meta/link/script 태그를 확인합니다.'
  if (category === 'structured-data') return createInteractionExplanation('SEO QA', 'JSON-LD 구조화 데이터가 검색 엔진이 읽을 수 있는 JSON 형식인지 확인한 결과입니다.', ['JSON 문법이 깨졌을 수 있습니다.', '템플릿 변수 치환이 실패했을 수 있습니다.', '여러 JSON-LD 중 일부만 오류일 수 있습니다.'], [sourceStep, 'application/ld+json script 내용을 확인합니다.', '따옴표, 쉼표, 중괄호가 올바른지 확인합니다.'], raw)
  if (category === 'canonical') return createInteractionExplanation('SEO QA', 'canonical URL이 검색 대표 주소로 적절하게 설정됐는지 확인한 결과입니다.', ['canonical 태그가 없거나 여러 개일 수 있습니다.', '현재 도메인과 다른 canonical이 설정됐을 수 있습니다.', 'http/https 또는 trailing slash 정책이 섞였을 수 있습니다.'], [sourceStep, 'link rel="canonical" href 값을 확인합니다.', '현재 페이지의 대표 URL 정책과 맞는지 확인합니다.'], raw)
  return createInteractionExplanation('SEO QA', '검색 노출과 공유 미리보기에 필요한 title, description, robots, OG, hreflang, sitemap 신호를 확인한 결과입니다.', ['title 또는 meta description이 없거나 중복될 수 있습니다.', 'robots noindex/disallow 설정이 의도와 다를 수 있습니다.', 'OG/Twitter 일부 값이 누락됐을 수 있습니다.', 'hreflang 또는 sitemap 경로가 맞지 않을 수 있습니다.'], [sourceStep, 'title, meta description, robots, OG 태그를 확인합니다.', 'robots.txt와 sitemap.xml 응답을 브라우저에서 확인합니다.', '검색 노출을 막아야 하는 페이지인지 정책을 확인합니다.'], raw)
}

function createMarkupExplanation({ item, raw }) {
  const id = item.id || raw.id || raw.category
  if (id === 'image-alt') return createInteractionExplanation('마크업 및 접근성 검사', '의미 있는 이미지에 사용자와 검색 엔진이 이해할 수 있는 대체 텍스트가 있는지 확인한 결과입니다.', ['alt가 비어 있거나 누락됐을 수 있습니다.', '장식 이미지는 alt 비움이 의도일 수 있습니다.', 'carousel duplicate 또는 hidden 이미지는 제외 대상일 수 있습니다.'], ['Elements에서 해당 img 태그를 확인합니다.', '이미지가 정보를 전달하는지, 장식용인지 판단합니다.', '정보성 이미지라면 alt가 이미지 의미를 설명하는지 확인합니다.'], raw)
  if (id === 'external-links') return createInteractionExplanation('마크업 및 접근성 검사', '새 창 외부 링크에 rel 보안 속성이 충분한지 확인한 결과입니다.', ['target="_blank"에 noopener 또는 noreferrer가 빠졌을 수 있습니다.', '외부 링크와 내부 링크 분류가 섞였을 수 있습니다.', 'CMS 링크 컴포넌트가 rel을 자동 추가하지 않을 수 있습니다.'], ['Elements에서 해당 a 태그를 확인합니다.', 'target="_blank"와 rel 값을 확인합니다.', '외부 새 창 링크에 noopener/noreferrer 정책이 적용되는지 확인합니다.'], raw)
  if (id === 'headings') return createInteractionExplanation('마크업 및 접근성 검사', '페이지 heading 구조가 콘텐츠 계층을 이해하기 쉽게 구성됐는지 확인한 결과입니다.', ['H1이 없거나 여러 개일 수 있습니다.', 'heading level이 건너뛰어졌을 수 있습니다.', '시각적 제목이 heading 태그가 아닐 수 있습니다.'], ['Elements 또는 접근성 트리에서 heading 목록을 확인합니다.', '페이지 대표 제목이 H1인지 확인합니다.', '섹션 제목 순서가 콘텐츠 구조와 맞는지 확인합니다.'], raw)
  if (id === 'forms') return createInteractionExplanation('마크업 및 접근성 검사', '입력 요소에 label 또는 접근성 이름이 연결되어 있는지 확인한 결과입니다.', ['label for/id 연결이 누락됐을 수 있습니다.', 'placeholder만 label처럼 사용했을 수 있습니다.', '아이콘 버튼에 aria-label이 없을 수 있습니다.'], ['Elements에서 input, select, textarea와 label 연결을 확인합니다.', '스크린리더용 aria-label 또는 aria-labelledby가 있는지 확인합니다.', '사용자가 입력 목적을 이해할 수 있는지 확인합니다.'], raw)
  return createInteractionExplanation('마크업 및 접근성 검사', '문서 meta, 중복 id, 접근성 이름 등 기본 HTML 품질 신호를 확인한 결과입니다.', ['metadata 일부가 빠졌을 수 있습니다.', '동일 id가 여러 요소에 중복됐을 수 있습니다.', '언어 속성이나 접근성 이름이 누락됐을 수 있습니다.'], ['페이지 소스 또는 Elements를 엽니다.', '결과에 표시된 요소와 속성을 확인합니다.', '디자인 의도상 숨김/장식 요소인지 구분합니다.'], raw)
}

function createBasicCheckExplanation({ auditType, raw }) {
  const labels = {
    access: ['페이지 접속', '검사 대상 페이지가 브라우저에서 열리는지 확인한 결과입니다.', '일반 브라우저에서 페이지를 엽니다.'],
    'http-status': ['HTTP 상태', '메인 문서 요청에 서버가 반환한 HTTP status를 확인한 결과입니다.', 'DevTools Network에서 document 요청 status를 확인합니다.'],
    title: ['Title', '문서 title이 브라우저와 검색 결과에 표시될 수 있는지 확인한 결과입니다.', '페이지 소스에서 title 태그를 확인합니다.'],
    'console-errors': ['Console', '페이지 실행 중 브라우저 콘솔 오류가 발생했는지 확인한 결과입니다.', 'DevTools Console에서 first-party 오류를 확인합니다.'],
    images: ['이미지 로딩', '페이지 이미지 요청과 렌더링 실패 여부를 확인한 결과입니다.', 'DevTools Network와 화면에서 깨진 이미지를 확인합니다.'],
    links: ['링크 수집', '페이지에서 링크가 수집되고 요청 문제가 있는지 확인한 결과입니다.', 'URL 검사 섹션의 문제 링크를 함께 확인합니다.'],
    'missing-href': ['버튼 URL', '이동 목적 버튼에 URL 또는 action 근거가 있는지 확인한 결과입니다.', '대상 버튼을 클릭하고 href 또는 이벤트 연결을 확인합니다.'],
    mobile: ['모바일 viewport', '모바일 화면 크기에서 페이지 접속 상태를 확인한 결과입니다.', '모바일 viewport로 페이지를 새로고침합니다.'],
    headings: ['Heading', '페이지 heading 구조와 H1 신호를 확인한 결과입니다.', 'Elements 또는 접근성 트리에서 heading 순서를 확인합니다.'],
    'duplicate-ids': ['중복 ID', '같은 id 값이 여러 요소에 중복 사용됐는지 확인한 결과입니다.', 'Elements에서 동일 id를 가진 요소를 검색합니다.'],
    'network-failures': ['네트워크 요청', '페이지 구성 중 실패한 document, API, JS, CSS, font 요청을 확인한 결과입니다.', 'DevTools Network에서 실패 요청의 status와 URL을 확인합니다.'],
    forms: ['Form 기본 검사', '입력 요소에 label 또는 접근성 이름이 연결되어 있는지 확인한 결과입니다.', 'Elements에서 input과 label 또는 aria-label 연결을 확인합니다.'],
  }
  const [title, meaning, step] = labels[auditType] || ['주요 검사 결과', '페이지 기본 Tech QA 신호를 확인한 결과입니다.', '해당 항목을 브라우저에서 직접 확인합니다.']
  return createInteractionExplanation(title, meaning, ['페이지 상태나 실행 시점에 따라 결과가 달라질 수 있습니다.', '렌더링, 권한, 네트워크 조건이 영향을 줄 수 있습니다.', '마크업 또는 리소스 설정이 의도와 다를 수 있습니다.'], [step, '자동 검사에 기록된 기술 정보를 실제 화면과 대조합니다.', '동일 조건에서 반복 재현되는지 확인합니다.'], raw)
}

function createNotApplicableExplanation({ auditType }) {
  return {
    meaning: '현재 페이지 또는 선택한 검사 옵션에서 이 항목에 해당하는 검사 대상이 확인되지 않았습니다.',
    commonCauses: ['해당 기능이나 요소가 현재 페이지에 없을 수 있습니다.', '선택한 viewport 또는 상태에서 대상이 숨겨져 있을 수 있습니다.'],
    classificationReason: '자동 검사 메타에서 noTarget 또는 정보성 생략 신호가 확인되어 해당 없음으로 분류했습니다.',
    verifySteps: auditType === 'link' ? ['현재 페이지에 해당 링크나 버튼이 필요한지 확인합니다.'] : ['현재 페이지에 해당 기능 또는 요소가 필요한지 확인합니다.'],
    decisionGuide: ['페이지 목적상 대상이 없다면 조치하지 않아도 됩니다.', '있어야 하는 기능이라면 노출 조건이나 렌더링 여부를 확인합니다.'],
  }
}

function createUnavailableExplanation({ raw, category }) {
  const text = [category, raw.errorCode, raw.message, raw.reason, raw.note, raw.navigationError, raw.loadWarning].filter(Boolean).join(' ')
  const lower = text.toLowerCase()
  const cause = /login|auth|unauthorized|401/.test(lower) ? 'login required'
    : /access|denied|forbidden|restricted|403/.test(lower) ? 'access denied'
      : /timeout|timed\s*out|408/.test(lower) ? 'timeout'
        : /network|net::|dns|tls|ssl|connection|request[-\s]?failed|err_/.test(lower) ? 'network'
          : '검사 불가'
  return {
    meaning: `${cause} 신호로 인해 자동 검사가 해당 항목을 끝까지 확인하지 못했습니다. 이 결과만으로 실제 사용자 장애를 확정할 수는 없습니다.`,
    commonCauses: ['로그인 또는 권한이 필요한 페이지일 수 있습니다.', '자동화 환경에서 네트워크 또는 보안 정책이 다를 수 있습니다.', '대상 서버 응답이 제한 시간 안에 끝나지 않았을 수 있습니다.', 'bot protection 또는 외부 서비스 제한이 있을 수 있습니다.'],
    classificationReason: `${text || cause} 신호가 수집되어 자동 검사를 완료하지 못했기 때문에 '검사 불가'로 분류했습니다.`,
    verifySteps: ['일반 브라우저에서 같은 항목을 직접 확인합니다.', '로그인, 권한, VPN, 지역 조건이 필요한지 확인합니다.', 'DevTools Network에서 timeout, 401/403, DNS, TLS 오류 여부를 확인합니다.'],
    decisionGuide: ['일반 브라우저에서도 접근할 수 없으면 접근 조건 또는 대상 서버 확인이 필요합니다.', '일반 브라우저에서는 정상이라면 자동화 환경 제한일 수 있습니다.', '특정 계정이나 네트워크에서만 재현되면 조건을 기록해 판단합니다.'],
  }
}

function createNormalExplanation({ auditType, target, raw }) {
  return {
    meaning: `현재 자동 검사 조건에서 '${target}' 항목의 기대 신호가 확인됐습니다. 페이지 전체에 문제가 없다는 의미는 아닙니다.`,
    commonCauses: ['현재 viewport와 실행 시점에서는 실패 신호가 수집되지 않았습니다.', '배포 이후 콘텐츠나 외부 서비스 상태가 바뀌면 결과가 달라질 수 있습니다.'],
    classificationReason: `${raw.note || raw.reason || raw.category || auditType || '검사 조건'} 기준으로 실패 또는 검토 필요 신호가 확인되지 않아 '정상'으로 분류했습니다.`,
    verifySteps: ['필요 시 동일 조건에서 페이지를 다시 확인합니다.', '배포 직후 또는 콘텐츠 변경 후 같은 항목을 재검사합니다.'],
    decisionGuide: ['동일 조건에서 기대 동작이 유지되면 현재 검사 범위에서는 정상으로 볼 수 있습니다.', '다른 viewport, 로그인 상태, 시간대에서는 별도로 확인할 수 있습니다.'],
  }
}

function createInteractionExplanation(name, meaning, commonCauses, verifySteps, raw = {}) {
  const statusLabel = getFallbackStatusLabel(raw)
  return {
    meaning,
    commonCauses,
    classificationReason: `${name} 자동 검사에서 ${raw.note || raw.reason || raw.message || raw.category || '관련 관찰값'} 신호가 확인되어 '${statusLabel}' 상태로 분류했습니다.`,
    verifySteps,
    decisionGuide: ['직접 확인 결과 의도한 동작이면 현재 결과는 검토 기록으로 남길 수 있습니다.', '동일 조건에서 반복 재현되면 해당 UI 또는 리소스 설정 확인이 필요합니다.', '자동화 환경에서만 발생하면 접근 조건과 실행 시점을 함께 기록합니다.'],
  }
}

function createGenericTypedExplanation({ displayStatus, auditType, category, target, raw }) {
  const base = createGenericExplanation({ displayStatus, auditType, category, target, raw })
  if (auditType === 'link') base.verifySteps = ['해당 링크 또는 버튼의 실제 동작을 브라우저에서 확인합니다.', 'DevTools Network에서 요청 status와 최종 URL을 확인합니다.', '의도한 링크 유형인지 확인합니다.']
  if (auditType === 'click') base.verifySteps = [`'${target}' 요소를 직접 클릭합니다.`, 'URL 이동 또는 UI 변화가 의도대로 발생하는지 확인합니다.', '클릭 시점에 overlay나 비활성 상태가 없는지 확인합니다.']
  if (auditType === 'landing') base.verifySteps = ['원본 클릭 요소로 랜딩 페이지를 엽니다.', '최종 URL, 화면 콘텐츠, 오류 안내 여부를 확인합니다.', 'DevTools Console과 Network에서 오류를 확인합니다.']
  return base
}

function createGenericExplanation({ displayStatus, auditType, category, target, raw }) {
  return {
    meaning: `자동 검사에서 '${target}' 항목에 추가 확인이 필요한 신호가 발견됐습니다.`,
    commonCauses: ['페이지 상태 또는 실행 시점에 따라 결과가 달라질 수 있습니다.', '자동화만으로 서비스 의도를 판단하기 어려울 수 있습니다.', '접근 권한, viewport, 네트워크 조건이 결과에 영향을 줄 수 있습니다.'],
    classificationReason: `${raw.message || raw.reason || raw.note || category || auditType || '수집된 검사 결과'} 내용을 바탕으로 '${displayStatus}' 상태로 표시했습니다.`,
    verifySteps: ['대상 페이지에서 해당 검사 항목과 관련된 UI를 확인합니다.', '자동 검사에 기록된 selector, URL, status 같은 기술 정보를 함께 대조합니다.', '동일 조건에서 결과가 반복되는지 확인합니다.'],
    decisionGuide: ['의도한 동작과 일치하면 검토 기록으로 남길 수 있습니다.', '동일 조건에서 반복 재현되면 담당 영역에서 세부 확인이 필요합니다.', '자동화 환경에서만 보이면 접근 조건 또는 실행 시점 영향을 분리해 판단합니다.'],
  }
}

function normalizeExplanation(explanation = {}, helpers = {}) {
  const fallback = createGenericExplanation(helpers)
  return {
    meaning: cleanText(explanation.meaning || fallback.meaning),
    commonCauses: limitList(explanation.commonCauses || fallback.commonCauses, MAX_CAUSES),
    classificationReason: cleanText(explanation.classificationReason || fallback.classificationReason),
    verifySteps: limitList(explanation.verifySteps || fallback.verifySteps, MAX_STEPS),
    decisionGuide: limitList(explanation.decisionGuide || fallback.decisionGuide, MAX_GUIDE),
  }
}

function resolveAuditType(item = {}) {
  const raw = getRaw(item)
  const rowId = String(item.rowId || item.detailTargetId || '')
  if (item.type === 'link' || rowId.startsWith('tech-link')) return 'link'
  if (rowId.startsWith('tech-click') || raw.actionClassification || raw.hrefState) return 'click'
  if (rowId.startsWith('tech-landing') || raw.requestedUrl && Array.isArray(raw.sources)) return 'landing'
  if (rowId.startsWith('tech-form') || item.id === 'form-interaction') return 'form-interaction'
  if (rowId.startsWith('tech-hover') || item.id === 'hover-interaction') return 'hover-interaction'
  if (rowId.startsWith('tech-modal') || item.id === 'modal-interaction') return 'modal-interaction'
  if (rowId.startsWith('tech-scroll') || item.id === 'scroll-interaction') return 'scroll-interaction'
  if (rowId.startsWith('tech-responsive') || item.id === 'responsive-layout') return 'responsive-layout'
  if (rowId.startsWith('tech-download') || item.id === 'download-resource') return 'download-resource'
  if (rowId.startsWith('tech-cookie') || item.id === 'cookie-security') return 'cookie-security'
  if (rowId.startsWith('tech-image') || item.id === 'image-rendering') return 'image-rendering'
  if (rowId.startsWith('tech-performance') || item.id === 'performance-resource' || item.id === 'resource-size') return 'performance-resource'
  if (rowId.startsWith('tech-seo') || item.id === 'seo-readiness' || item.id === 'meta' || item.id === 'title') return 'seo-readiness'
  if (rowId.startsWith('tech-markup') || ['image-alt', 'external-links', 'headings', 'duplicate-ids', 'forms', 'unlabeled-clickables'].includes(item.id)) return 'markup'
  return item.id || item.type || 'generic'
}

function isBasicCheckType(value = '') {
  return ['access', 'http-status', 'title', 'console-errors', 'images', 'links', 'missing-href', 'mobile', 'headings', 'duplicate-ids', 'network-failures', 'forms'].includes(value)
}

function getRaw(item = {}) {
  return item.raw && typeof item.raw === 'object' ? item.raw : item
}

function getCategory(item = {}) {
  const raw = getRaw(item)
  return String(raw.category || item.category || raw.id || item.id || '').trim()
}

function getTargetName(item = {}) {
  const raw = getRaw(item)
  return cleanText(raw.label || raw.text || raw.ariaLabel || item.title || item.label || raw.url || raw.href || raw.requestedUrl || '해당 요소')
}

function getStatusCode(raw = {}) {
  const value = Number(raw.statusCode || raw.httpStatus || 0)
  return Number.isFinite(value) ? value : 0
}

function getFallbackStatusLabel(item = {}) {
  const status = String(item.status || item.raw?.status || '').toLowerCase()
  if (status === 'ok') return '정상'
  if (status === 'info' || status === 'skipped') return '해당 없음'
  if (status === 'error') return '문제 확인'
  if (status === 'unavailable') return '검사 불가'
  return '검토 필요'
}

function limitList(value, max) {
  const items = Array.isArray(value) ? value : [value]
  return items.map(cleanText).filter(Boolean).slice(0, max)
}

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim()
}
