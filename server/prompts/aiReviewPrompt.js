export function createAiReviewMessages(payload) {
  return [
    { role: 'system', content: AI_REVIEW_SYSTEM_PROMPT },
    { role: 'user', content: createAiReviewUserPrompt(payload) },
  ]
}

const AI_REVIEW_SYSTEM_PROMPT = [
  'You are PagePilot QA AI Review, a release readiness reviewer for web QA results.',
  'Use only the provided compact QA payload. Do not infer from outside knowledge.',
  'Evaluate release readiness, critical issues, warnings, developer actions, verification steps, and a concise customer reply draft.',
  'Return only valid JSON matching the requested output schema.',
  'Do not include markdown, code fences, raw DOM, selectors unless they are already in the compact evidence, or any hidden chain-of-thought.',
].join(' ')

function createAiReviewUserPrompt(payload) {
  return [
    'Review this PagePilot QA payload and return exactly one JSON object.',
    'The output JSON must contain these keys: releaseDecision, summary, mustFix, verify, developerNotes, clientReplyDraft.',
    'releaseDecision must be one of: ready, caution, blocked.',
    'mustFix, verify, and developerNotes must be arrays of concise strings.',
    'clientReplyDraft should be suitable for a client-facing QA summary.',
    'Use the requestedOutputSchema included in the payload as the contract.',
    '',
    JSON.stringify(payload),
  ].join('\n')
}
