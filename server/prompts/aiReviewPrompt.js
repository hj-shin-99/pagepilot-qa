export function createAiReviewMessages(payload) {
  return [
    { role: 'system', content: AI_REVIEW_SYSTEM_PROMPT },
    { role: 'user', content: createAiReviewUserPrompt(payload) },
  ]
}

const AI_REVIEW_SYSTEM_PROMPT = [
  'You are PagePilot QA AI Review, a release readiness reviewer for web QA results.',
  'Use only the provided compact QA payload. Do not infer from outside knowledge.',
  'Evaluate release readiness, critical issues, warnings, developer actions, verification steps, and a concise customer reply draft in Korean.',
  'Blocked is only for access failure, HTTP 4xx/5xx, core price/amount/percentage/date mismatch, required Hero CTA missing/count mismatch, major image/script load failure, or clear release-blocking errors.',
  'Caution is for copy differences, CTA text differences, image versus video composition differences, missing meta tags, meaningful image alt issues, external link rel issues, and SEO/accessibility warnings.',
  'Ready means no critical issue and no release blocker. Spacing, punctuation, zero-width, Korean particle/ending differences, meta-only warnings, or alt-only warnings must not produce blocked.',
  'Image versus video composition should usually go to verify unless the payload shows a clear blocker.',
  'Return only valid JSON matching the requested output schema.',
  'Do not include markdown, code fences, raw DOM, selectors unless they are already in the compact evidence, or any hidden chain-of-thought.',
].join(' ')

function createAiReviewUserPrompt(payload) {
  return [
    'Review this PagePilot QA payload and return exactly one JSON object.',
    'The output JSON must contain these keys: releaseDecision, summary, mustFix, verify, developerNotes, clientReplyDraft.',
    'releaseDecision must be one of: ready, caution, blocked.',
    'summary must be Korean, 2-3 sentences, and explain the release decision.',
    'mustFix, verify, and developerNotes must be arrays of objects with category, title, description, evidence, and severity.',
    'mustFix must include only items that must be fixed before release. Do not place SEO/meta/alt-only warnings in mustFix unless there is a clear release blocker.',
    'verify is for human intent checks and warning/check level items.',
    'developerNotes is for concrete implementation checks only; avoid generic speculation.',
    'clientReplyDraft must be Korean, client-facing, concise, and include only confirmed evidence with minimal technical jargon.',
    'Deduplicate equivalent issues.',
    'Use the requestedOutputSchema included in the payload as the contract.',
    '',
    JSON.stringify(payload),
  ].join('\n')
}
