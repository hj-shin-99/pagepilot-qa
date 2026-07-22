import { createTechQaViewModel } from './techQa.js'

export const statusLabels = {
  ok: '정상',
  error: '오류',
  warn: '확인 필요',
}

export function getStatusCounts(checks) {
  return checks.reduce(
    (counts, check) => ({
      ...counts,
      [check.status]: counts[check.status] + 1,
    }),
    { ok: 0, error: 0, warn: 0 },
  )
}

export function createResultSummary(result) {
  const counts = createTechQaViewModel(result).issueCounts
  const issueText = counts.errorUniqueElementCount > 0 ? `오류 ${counts.errorUniqueElementCount}개` : '오류 없음'
  const warningText = counts.warningUniqueElementCount > 0 ? `확인 필요 ${counts.warningUniqueElementCount}개` : '확인 필요 없음'
  const actionText = counts.errorUniqueElementCount > 0 ? '오류 항목을 우선 확인해 주세요.' : counts.warningUniqueElementCount > 0 ? '확인 필요 항목을 검토해 주세요.' : '오류와 확인 필요 항목은 없습니다.'

  return `${result.pageTitle || result.targetUrl} 페이지는 총 ${(result.checks || []).length}개 QA 항목 중 정상 검사 ${counts.normalCheckCount}개, ${issueText}, ${warningText}으로 검사되었습니다. ${actionText}`
}

export function formatScanTime(value) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function buildReportText(result, summary) {
  const checkLines = result.checks
    .map((check) => `- ${check.title}: ${statusLabels[check.status]} (${check.value})`)
    .join('\n')

  const linkLines = result.links
    .map((link) => `- ${link.label}: ${link.statusCode} ${link.url}`)
    .join('\n')

  return [
    '[PagePilot QA Report]',
    `대상 URL: ${result.targetUrl}`,
    `점검 시각: ${formatScanTime(result.scannedAt)}`,
    `HTTP 상태: ${result.httpStatus || '응답 없음'}`,
    `요약: ${summary}`,
    '',
    '점검 항목',
    checkLines,
    '',
    '링크 응답',
    linkLines,
  ].join('\n')
}
