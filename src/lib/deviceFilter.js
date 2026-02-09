/**
 * Check if a device ID should be hidden from the dashboard
 * @param {string} deviceId - The device ID to check
 * @returns {boolean} - True if the device should be hidden, false otherwise
 */
export function isDeviceHidden(deviceId) {
	const hiddenDevices = getHiddenDeviceIds();
	return hiddenDevices.includes(deviceId);
}

/**
 * Filter out hidden devices from a list of devices
 * @param {Array} devices - Array of device objects or device IDs
 * @param {string} idField - The field name containing the device ID (default: 'id')
 * @returns {Array} - Filtered array with hidden devices removed
 */
export function filterVisibleDevices(devices, idField = "id") {
	const hiddenDevices = getHiddenDeviceIds();
	return devices.filter((device) => {
		const deviceId = typeof device === "string" ? device : device[idField];
		return !hiddenDevices.includes(deviceId);
	});
}

/**
 * Get the list of hidden device IDs from localStorage
 * @returns {Array} - Array of hidden device IDs
 */
export function getHiddenDeviceIds() {
	if (typeof localStorage === "undefined") {
		return [];
	}
	const saved = localStorage.getItem("enviroSyncHiddenDevices");
	if (saved) {
		try {
			return JSON.parse(saved);
		} catch (err) {
			return [];
		}
	}
	return [];
}

/**
 * Save the list of hidden device IDs to localStorage
 * @param {Array} hiddenIds - Array of device IDs to hide
 */
export function setHiddenDeviceIds(hiddenIds) {
	if (typeof localStorage === "undefined") {
		return;
	}
	localStorage.setItem("enviroSyncHiddenDevices", JSON.stringify(hiddenIds));
}

/**
 * Toggle visibility of a device
 * @param {string} deviceId - The device ID to toggle
 * @returns {boolean} - New hidden state (true if now hidden)
 */
export function toggleDeviceVisibility(deviceId) {
	const hiddenDevices = getHiddenDeviceIds();
	const index = hiddenDevices.indexOf(deviceId);
	if (index === -1) {
		hiddenDevices.push(deviceId);
	} else {
		hiddenDevices.splice(index, 1);
	}
	setHiddenDeviceIds(hiddenDevices);
	return index === -1;
}
