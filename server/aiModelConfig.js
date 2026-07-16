export const DEFAULT_AI_QA_MODEL = 'gpt-5.6-sol'

export function getAiQaModel(env = process.env) {
  const configured = typeof env.AI_QA_MODEL === 'string' ? env.AI_QA_MODEL.trim() : ''
  return configured || DEFAULT_AI_QA_MODEL
}
