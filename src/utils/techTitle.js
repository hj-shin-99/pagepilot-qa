const TECH_QA_RESULT_SUFFIX = 'Tech QA 결과'

export function createTechQaTitle(pageTitle) {
  const title = typeof pageTitle === 'string' ? pageTitle.trim() : ''
  if (!title) return TECH_QA_RESULT_SUFFIX
  return title.includes(TECH_QA_RESULT_SUFFIX) ? title : `${title} ${TECH_QA_RESULT_SUFFIX}`
}
