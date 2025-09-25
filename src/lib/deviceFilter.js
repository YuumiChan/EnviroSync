import deviceFilterConfig from './deviceFilter.json';

/**
 * Check if a device ID should be hidden from the dashboard
 * @param {string} deviceId - The device ID to check
 * @returns {boolean} - True if the device should be hidden, false otherwise
 */
export function isDeviceHidden(deviceId) {
    return deviceFilterConfig.hiddenDeviceIds.includes(deviceId);
}

/**
 * Filter out hidden devices from a list of devices
 * @param {Array} devices - Array of device objects or device IDs
 * @param {string} idField - The field name containing the device ID (default: 'id')
 * @returns {Array} - Filtered array with hidden devices removed
 */
export function filterVisibleDevices(devices, idField = 'id') {
    return devices.filter(device => {
        const deviceId = typeof device === 'string' ? device : device[idField];
        return !isDeviceHidden(deviceId);
    });
}

/**
 * Get the list of hidden device IDs
 * @returns {Array} - Array of hidden device IDs
 */
export function getHiddenDeviceIds() {
    return [...deviceFilterConfig.hiddenDeviceIds];
}