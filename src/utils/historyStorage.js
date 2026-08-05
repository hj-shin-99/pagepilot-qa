import { createCompactHistoryItemForStorage, HISTORY_KEY, LEGACY_HISTORY_KEY, MAX_HISTORY_ITEMS, normalizeHistoryItems, sortHistoryItems } from './history.js'

const DATABASE_NAME = 'pagepilot-qa'
const DATABASE_VERSION = 1
const STORE_NAME = 'history'
const SCANNED_AT_INDEX = 'scannedAt'
const MIGRATION_COMPLETE_KEY = 'pagepilot-qa-history-idb-migrated'

let databasePromise = null
let historyWriteQueue = Promise.resolve()
let memoryItems = new Map()
let lastSavedOrder = 0

export function openHistoryDatabase() {
  if (!hasIndexedDB()) return Promise.resolve(createMemoryDatabase())
  if (databasePromise) return databasePromise

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      if (!store.indexNames.contains(SCANNED_AT_INDEX)) store.createIndex(SCANNED_AT_INDEX, SCANNED_AT_INDEX, { unique: false })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'))
    request.onblocked = () => reject(new Error('IndexedDB open blocked'))
  })

  databasePromise.catch(() => {
    databasePromise = null
  })
  return databasePromise
}

export async function loadHistoryItems() {
  await migrateLegacyHistory()
  return readAllHistoryItems()
}

export function saveHistoryItem(item) {
  historyWriteQueue = historyWriteQueue.then(() => performSaveHistoryItem(item), () => performSaveHistoryItem(item))
  return historyWriteQueue
}

export async function deleteHistoryItem(id) {
  await migrateLegacyHistory()
  const targetId = getString(id)
  if (!targetId) return loadHistoryItems()

  const database = await openHistoryDatabase()
  if (database.memory) {
    memoryItems.delete(targetId)
    return readAllHistoryItems()
  }

  await runTransaction(database, 'readwrite', (store) => store.delete(targetId))
  return readAllHistoryItems()
}

export async function clearHistoryItems() {
  await migrateLegacyHistory()
  const database = await openHistoryDatabase()
  if (database.memory) {
    memoryItems.clear()
    return []
  }

  await runTransaction(database, 'readwrite', (store) => store.clear())
  return []
}

export async function countHistoryItems() {
  await migrateLegacyHistory()
  const database = await openHistoryDatabase()
  if (database.memory) return memoryItems.size
  return runTransaction(database, 'readonly', (store) => store.count())
}

export async function migrateLegacyHistory() {
  if (!hasLocalStorage()) return { ok: true, migratedCount: 0, reason: 'storage-unavailable' }
  if (localStorage.getItem(MIGRATION_COMPLETE_KEY) === '1') return { ok: true, migratedCount: 0, reason: 'already-complete' }

  const legacyItems = readLegacyHistoryItems()
  const itemsToMigrate = normalizeHistoryItems(legacyItems).slice(0, MAX_HISTORY_ITEMS)
  if (itemsToMigrate.length === 0) {
    markMigrationComplete()
    return { ok: true, migratedCount: 0, reason: 'no-legacy-items' }
  }

  try {
    const database = await openHistoryDatabase()
    if (database.memory) {
      for (const item of itemsToMigrate) memoryItems.set(item.id, item)
    } else {
      await runTransaction(database, 'readwrite', (store) => {
        for (const item of itemsToMigrate) store.put(item)
      })
    }
    markMigrationComplete()
    localStorage.setItem(HISTORY_KEY, JSON.stringify([]))
    return { ok: true, migratedCount: itemsToMigrate.length, reason: 'migrated' }
  } catch (error) {
    return { ok: false, migratedCount: 0, reason: getString(error?.name) || 'migration-failed' }
  }
}

async function performSaveHistoryItem(item) {
  await migrateLegacyHistory()
  const currentItems = await readAllHistoryItems()
  const compactItem = createCompactHistoryItemForStorage(item)
  const safeItem = compactItem ? { ...compactItem, savedAt: new Date().toISOString(), savedOrder: createSavedOrder() } : null
  if (!safeItem) return createSaveResult({ ok: false, savedItemId: '', items: currentItems, beforeCount: currentItems.length, reason: 'invalid-item' })

  try {
    const database = await openHistoryDatabase()
    const transactionResult = database.memory
      ? saveMemoryHistoryItem(safeItem)
      : await saveIndexedDbHistoryItem(database, safeItem)
    const finalItems = await readAllHistoryItems()
    const result = createSaveResult({ ok: true, savedItemId: safeItem.id, items: finalItems, beforeCount: transactionResult.beforeCount, afterInsertCount: transactionResult.afterInsertCount, trimmedCount: transactionResult.trimmedCount, reason: 'saved' })
    logHistorySaveDiagnostic(result)
    return result
  } catch (error) {
    const items = await readAllHistoryItems().catch(() => currentItems)
    const result = createSaveResult({ ok: false, savedItemId: safeItem.id, items, beforeCount: currentItems.length, finalCount: items.length, reason: getString(error?.name) || 'save-failed' })
    logHistorySaveDiagnostic(result)
    return result
  }
}

function saveMemoryHistoryItem(safeItem) {
  const beforeCount = memoryItems.size
  memoryItems.set(safeItem.id, safeItem)
  const afterInsertItems = sortHistoryItems([...memoryItems.values()])
  const excessItems = afterInsertItems.slice(MAX_HISTORY_ITEMS)
  for (const item of excessItems) memoryItems.delete(item.id)
  return { beforeCount, afterInsertCount: afterInsertItems.length, trimmedCount: excessItems.length }
}

async function saveIndexedDbHistoryItem(database, safeItem) {
  return runTransaction(database, 'readwrite', async (store) => {
    const beforeItems = await requestToPromise(store.getAll())
    store.put(safeItem)
    const afterInsertItems = sortHistoryItems([safeItem, ...beforeItems.filter((item) => item?.id !== safeItem.id)])
    const excessItems = afterInsertItems.slice(MAX_HISTORY_ITEMS)
    for (const item of excessItems) store.delete(item.id)
    return { beforeCount: beforeItems.length, afterInsertCount: afterInsertItems.length, trimmedCount: excessItems.length }
  })
}

async function readAllHistoryItems() {
  const database = await openHistoryDatabase()
  if (database.memory) return sortHistoryItems([...memoryItems.values()])
  const items = await runTransaction(database, 'readonly', (store) => store.getAll())
  return sortHistoryItems(items)
}

function runTransaction(database, mode, run) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)
    let result
    transaction.oncomplete = () => resolve(result)
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'))

    try {
      const runResult = run(store)
      if (runResult && typeof runResult.then === 'function') {
        runResult.then((value) => { result = value }, reject)
      } else if (isIndexedDbRequest(runResult)) {
        runResult.onsuccess = () => { result = runResult.result }
        runResult.onerror = () => reject(runResult.error || new Error('IndexedDB request failed'))
      } else {
        result = runResult
      }
    } catch (error) {
      reject(error)
    }
  })
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

function createSaveResult({ ok, savedItemId, items, beforeCount = 0, afterInsertCount = ok ? items.length : beforeCount, trimmedCount = 0, finalCount = items.length, reason }) {
  return {
    ok,
    savedItemId,
    items,
    beforeCount,
    afterInsertCount,
    trimmedCount,
    finalCount,
    reason,
  }
}

function logHistorySaveDiagnostic(result) {
  if (!shouldLogHistoryDiagnostics()) return
  console.info(`[History IDB Save] incomingId=${result.savedItemId} beforeCount=${result.beforeCount} afterInsertCount=${result.afterInsertCount} trimmedCount=${result.trimmedCount} finalCount=${result.finalCount} reason=${result.reason}`)
}

function shouldLogHistoryDiagnostics() {
  return typeof window !== 'undefined'
    && typeof console !== 'undefined'
    && typeof console.info === 'function'
    && ['localhost', '127.0.0.1', ''].includes(window.location?.hostname || '')
}

function readLegacyHistoryItems() {
  try {
    const storedHistory = localStorage.getItem(HISTORY_KEY) || localStorage.getItem(LEGACY_HISTORY_KEY) || '[]'
    const parsed = JSON.parse(storedHistory)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function markMigrationComplete() {
  try {
    localStorage.setItem(MIGRATION_COMPLETE_KEY, '1')
  } catch {
    // Migration can still proceed when the flag cannot be written.
  }
}

function hasIndexedDB() {
  return typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function'
}

function hasLocalStorage() {
  return typeof localStorage !== 'undefined'
}

function createMemoryDatabase() {
  return { memory: true }
}

function isIndexedDbRequest(value) {
  return value && typeof value === 'object' && 'onsuccess' in value && 'onerror' in value
}

function getString(value) {
  return typeof value === 'string' ? value : ''
}

function createSavedOrder() {
  const nextOrder = Date.now()
  lastSavedOrder = Math.max(nextOrder, lastSavedOrder + 1)
  return lastSavedOrder
}

export function resetHistoryStorageForTests() {
  databasePromise = null
  historyWriteQueue = Promise.resolve()
  memoryItems = new Map()
  lastSavedOrder = 0
}
