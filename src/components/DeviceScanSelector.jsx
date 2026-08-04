import { DEVICE_IDS, getDeviceProfile, normalizeDeviceIds } from '../../shared/deviceProfiles.js'

function DeviceScanSelector({ devices, isScanning, onDevicesChange }) {
  const selectedDevices = normalizeDeviceIds(devices)
  const selectedSet = new Set(selectedDevices)

  const toggleDevice = (deviceId) => {
    if (isScanning) return
    const next = selectedSet.has(deviceId)
      ? selectedDevices.filter((item) => item !== deviceId)
      : [...selectedDevices, deviceId]
    onDevicesChange(normalizeDeviceIds(next))
  }

  return (
    <section className="device-scan-selector" aria-label="검사 환경">
      <div className="device-scan-selector-head">
        <span>검사 환경을 선택하세요.</span>
      </div>
      <div className="device-scan-options" role="group" aria-label="Tech QA 검사 환경 선택">
        {DEVICE_IDS.map((deviceId) => {
          const profile = getDeviceProfile(deviceId)
          const checked = selectedSet.has(deviceId)
          return (
            <label className={`device-scan-option ${checked ? 'is-selected' : ''}`} htmlFor={`device-scan-${deviceId}`} key={deviceId}>
              <input
                id={`device-scan-${deviceId}`}
                type="checkbox"
                checked={checked}
                disabled={isScanning || (checked && selectedDevices.length === 1)}
                onChange={() => toggleDevice(deviceId)}
              />
              <span>{profile.label}</span>
            </label>
          )
        })}
      </div>
    </section>
  )
}

export default DeviceScanSelector
