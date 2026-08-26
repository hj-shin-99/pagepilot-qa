import { DEFAULT_AI_QA_MODEL } from './aiModelConfig.js'

export function getReferenceQaModel(env = process.env) {
  const referenceModel = typeof env.REFERENCE_QA_MODEL === 'string' ? env.REFERENCE_QA_MODEL.trim() : ''
  if (referenceModel) return referenceModel

  const aiQaModel = typeof env.AI_QA_MODEL === 'string' ? env.AI_QA_MODEL.trim() : ''
  return aiQaModel || DEFAULT_AI_QA_MODEL
}
