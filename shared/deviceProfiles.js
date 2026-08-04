export const DEVICE_IDS = Object.freeze(['desktop', 'tablet', 'mobile'])

export const DEFAULT_DEVICE_IDS = Object.freeze(['desktop'])

const DEVICE_PROFILE_MAP = Object.freeze({
  desktop: Object.freeze({
    id: 'desktop',
    label: 'Desktop',
    viewport: Object.freeze({ width: 1440, height: 900 }),
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
    userAgent: '',
  }),
  tablet: Object.freeze({
    id: 'tablet',
    label: 'Tablet',
    viewport: Object.freeze({ width: 768, height: 1024 }),
    isMobile: false,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  }),
  mobile: Object.freeze({
    id: 'mobile',
    label: 'Mobile',
    viewport: Object.freeze({ width: 390, height: 844 }),
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  }),
})

export function normalizeDeviceIds(value) {
  const source = Array.isArray(value) ? value : DEFAULT_DEVICE_IDS
  const selected = new Set(source.map((item) => String(item || '').trim().toLowerCase()).filter((item) => DEVICE_IDS.includes(item)))
  const normalized = DEVICE_IDS.filter((deviceId) => selected.has(deviceId))
  return normalized.length > 0 ? normalized : [...DEFAULT_DEVICE_IDS]
}

export function getDeviceProfile(deviceId = 'desktop') {
  return DEVICE_PROFILE_MAP[normalizeDeviceIds([deviceId])[0]] || DEVICE_PROFILE_MAP.desktop
}

export function getDeviceProfiles(deviceIds) {
  return normalizeDeviceIds(deviceIds).map(getDeviceProfile)
}

export function createBrowserContextOptions(deviceId = 'desktop', overrides = {}) {
  const profile = getDeviceProfile(deviceId)
  return {
    ignoreHTTPSErrors: true,
    viewport: { ...profile.viewport },
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    ...(profile.userAgent ? { userAgent: profile.userAgent } : {}),
    permissions: [],
    serviceWorkers: 'block',
    ...overrides,
  }
}

export function createDeviceDescriptor(deviceId = 'desktop') {
  const profile = getDeviceProfile(deviceId)
  return {
    deviceId: profile.id,
    deviceLabel: profile.label,
    viewport: { ...profile.viewport },
    hasTouch: profile.hasTouch,
    isMobile: profile.isMobile,
    deviceScaleFactor: profile.deviceScaleFactor,
  }
}

export function formatDeviceList(deviceIds) {
  return getDeviceProfiles(deviceIds).map((profile) => profile.label).join(' · ')
}

export function formatDeviceViewport(deviceId = 'desktop') {
  const profile = getDeviceProfile(deviceId)
  return `${profile.label} · ${profile.viewport.width} × ${profile.viewport.height}${profile.hasTouch ? ' · Touch' : ''}`
}

export const DEVICE_PROFILES = DEVICE_PROFILE_MAP
