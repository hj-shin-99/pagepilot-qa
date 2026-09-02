export function appendNdjsonChunk(buffer, chunk) {
  const text = `${buffer || ''}${chunk || ''}`
  const lines = text.split(/\r?\n/)
  const nextBuffer = lines.pop() || ''
  const events = []

  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine) continue
    events.push(JSON.parse(trimmedLine))
  }

  return { buffer: nextBuffer, events }
}

import { normalizeDeviceIds } from '../../shared/deviceProfiles.js'

export async function requestQaRunStream({ webUrl, figmaUrl, scanOptions, devices, navigationReference = null, onProgress, fetchFn = fetch }) {
  const body = navigationReference
    ? { webUrl, figmaUrl, scanOptions, devices: normalizeDeviceIds(devices), navigationReference }
    : { webUrl, figmaUrl, scanOptions, devices: normalizeDeviceIds(devices) }
  let response
  try {
    response = await fetchFn('/api/qa/run-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw createFallbackError(error)
  }

  if (!response.ok) {
    const message = await readErrorMessage(response)
    const error = new Error(message || `통합 검사 스트림 요청에 실패했습니다. (${response.status})`)
    error.fallbackToJson = response.status === 404 || response.status === 405
    throw error
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    throw createFallbackError(new Error('이 브라우저는 검사 스트림을 지원하지 않습니다.'))
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result = null
  let receivedEvent = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const parsed = appendNdjsonChunk(buffer, decoder.decode(value, { stream: true }))
      buffer = parsed.buffer
      for (const event of parsed.events) {
        receivedEvent = true
        if (event?.type === 'progress') {
          if (typeof onProgress === 'function') onProgress(event)
          continue
        }
        if (event?.type === 'result') {
          result = event.result
          continue
        }
        if (event?.type === 'error') throw new Error(event.message || '통합 검사 요청에 실패했습니다.')
      }
    }
  } catch (error) {
    if (!receivedEvent) throw createFallbackError(error)
    throw error
  }

  const finalText = decoder.decode()
  if (finalText || buffer) {
    const parsed = appendNdjsonChunk(buffer, `${finalText}\n`)
    for (const event of parsed.events) {
      if (event?.type === 'progress') {
        if (typeof onProgress === 'function') onProgress(event)
      } else if (event?.type === 'result') {
        result = event.result
      } else if (event?.type === 'error') {
        throw new Error(event.message || '통합 검사 요청에 실패했습니다.')
      }
    }
  }

  if (!result) throw new Error('통합 검사 결과를 받지 못했습니다.')

  return {
    ...result,
    webUrl,
    figmaUrl,
    devices: normalizeDeviceIds(result.devices || devices),
    shouldSaveCombined: Boolean(figmaUrl),
  }
}

async function readErrorMessage(response) {
  try {
    const text = await response.text()
    if (!text) return ''
    return JSON.parse(text)?.message || text
  } catch {
    return ''
  }
}

function createFallbackError(error) {
  const fallbackError = error instanceof Error ? error : new Error('통합 검사 스트림 요청에 실패했습니다.')
  fallbackError.fallbackToJson = true
  return fallbackError
}
