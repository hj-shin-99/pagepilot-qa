export function isDeviceAccordionOpen(expandedByDevice = {}, deviceId = '', accordionKey = '') {
  if (!deviceId || !accordionKey) return false
  return expandedByDevice?.[deviceId]?.[accordionKey] === true
}

export function updateDeviceAccordionState(expandedByDevice = {}, deviceId = '', accordionKey = '', open = false) {
  if (!deviceId || !accordionKey) return expandedByDevice && typeof expandedByDevice === 'object' ? expandedByDevice : {}
  const current = expandedByDevice && typeof expandedByDevice === 'object' ? expandedByDevice : {}
  const deviceState = current[deviceId] && typeof current[deviceId] === 'object' ? current[deviceId] : {}
  const nextOpen = open === true
  if ((deviceState[accordionKey] === true) === nextOpen) return current
  const nextDeviceState = { ...deviceState }
  if (nextOpen) nextDeviceState[accordionKey] = true
  else delete nextDeviceState[accordionKey]
  return { ...current, [deviceId]: nextDeviceState }
}
