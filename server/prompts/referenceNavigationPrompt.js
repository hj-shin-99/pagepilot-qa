export function createReferenceNavigationMessages(payload) {
  return [
    { role: 'system', content: REFERENCE_NAVIGATION_SYSTEM_PROMPT },
    { role: 'user', content: createReferenceNavigationUserPrompt(payload) },
  ]
}

const REFERENCE_NAVIGATION_SYSTEM_PROMPT = [
  'You normalize compact spreadsheet facts into expected web navigation intent candidates for PagePilot QA.',
  'Use only the provided compactReferenceInput. Do not use outside knowledge, customer-specific rules, hidden assumptions, or guessed website structure.',
  'Do not inspect or judge any real web page. Do not compare against DOM, screenshots, links, landing pages, or QA results.',
  'Every expected URL must be explicitly present in the provided row cells, detectedUrls, or hyperlink evidence for that same source row.',
  'If a URL is not explicitly supported by the source row, omit it. Never invent, complete, translate, or rewrite URLs.',
  'Keep confidence conservative. Lower confidence when the label or context requires inference from neighboring cells.',
  'Return only valid JSON. Do not include markdown, comments, chain-of-thought, or raw prompt text.',
].join(' ')

function createReferenceNavigationUserPrompt(payload) {
  return [
    'Return exactly one JSON object matching this contract:',
    '{"items":[{"source":{"candidateId":"cand-0001","sheetName":"string","rowNumber":1,"evidenceText":"string"},"pageContext":{"depthPath":["string"],"sectionHint":"string","pageUrlHint":"string"},"element":{"label":"string","aliases":["string"],"roleHint":"link|button|menu-item|tab|unknown","actionHint":"navigation|download|modal|unknown"},"expected":{"type":"url","urls":[{"raw":"string","matchMode":"exact-url|path-and-query|pattern","allowSameOrigin":true,"allowRedirect":false,"allowTrailingSlashVariant":true,"dynamicParameters":["string"]}],"urlPatterns":[],"notes":"string"},"provenance":{"urlSource":"explicit-absolute-url|explicit-relative-path|hyperlink-cell|descriptive-text-url-like|explicit-document-cell","labelSource":"document-cell|document-depth|inferred-from-row","inferenceUsed":false,"aiRationale":"string"},"confidence":0.5}]}',
    'Rules:',
    '- items must contain only navigation expectations grounded in compactReferenceInput.',
    '- source.candidateId must match one candidateId from this chunk exactly.',
    '- source.sheetName and source.rowNumber must match an input row exactly.',
    '- Do not infer candidates from other chunks or from omitted rows.',
    '- source.evidenceText must summarize only values from that source row.',
    '- expected.urls[].raw must exactly match a URL-like text or hyperlink available in the same source row.',
    '- Prefer rows with explicit-absolute-url, explicit-relative-path, or hyperlink-cell detectedUrls; treat descriptive-text-url-like evidence conservatively.',
    '- Do not include userDecision or referenceId. The server will add them.',
    '- If the document has no grounded navigation URL expectation, return {"items":[]}.',
    '',
    JSON.stringify(payload),
  ].join('\n')
}
