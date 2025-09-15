// Cache utility for local storage
class CacheManager {
	constructor() {
		this.prefix = 'envirosync_';
		this.defaultTTL = 5 * 60 * 1000; // 5 minutes default TTL
	}

	// Set data in cache with TTL
	set(key, data, ttl = this.defaultTTL) {
		try {
			const item = {
				data,
				timestamp: Date.now(),
				ttl
			};
			localStorage.setItem(this.prefix + key, JSON.stringify(item));
			return true;
		} catch (error) {
			console.warn('Failed to cache data:', error);
			return false;
		}
	}

	// Get data from cache if still valid
	get(key) {
		try {
			const item = localStorage.getItem(this.prefix + key);
			if (!item) return null;

			const parsed = JSON.parse(item);
			const now = Date.now();

			// Check if expired
			if (now - parsed.timestamp > parsed.ttl) {
				this.delete(key);
				return null;
			}

			return parsed.data;
		} catch (error) {
			console.warn('Failed to get cached data:', error);
			this.delete(key);
			return null;
		}
	}

	// Delete specific cache entry
	delete(key) {
		try {
			localStorage.removeItem(this.prefix + key);
		} catch (error) {
			console.warn('Failed to delete cache:', error);
		}
	}

	// Clear all app cache
	clearAll() {
		try {
			const keys = Object.keys(localStorage);
			keys.forEach(key => {
				if (key.startsWith(this.prefix)) {
					localStorage.removeItem(key);
				}
			});
		} catch (error) {
			console.warn('Failed to clear cache:', error);
		}
	}

	// Get cache size and stats
	getStats() {
		try {
			const keys = Object.keys(localStorage);
			const appKeys = keys.filter(key => key.startsWith(this.prefix));
			
			let totalSize = 0;
			const items = appKeys.map(key => {
				const value = localStorage.getItem(key);
				const size = value ? value.length : 0;
				totalSize += size;
				
				try {
					const parsed = JSON.parse(value);
					return {
						key: key.replace(this.prefix, ''),
						size,
						timestamp: parsed.timestamp,
						isExpired: Date.now() - parsed.timestamp > parsed.ttl
					};
				} catch {
					return { key: key.replace(this.prefix, ''), size, timestamp: null, isExpired: true };
				}
			});

			return {
				totalItems: appKeys.length,
				totalSize,
				items
			};
		} catch (error) {
			console.warn('Failed to get cache stats:', error);
			return { totalItems: 0, totalSize: 0, items: [] };
		}
	}
}

// Create singleton instance
export const cacheManager = new CacheManager();

// Cache keys constants
export const CACHE_KEYS = {
	DEVICES: 'devices',
	DEVICE_DATA: (deviceId) => `device_data_${deviceId}`,
	CHART_DATA: (deviceId, timeRange) => `chart_data_${deviceId}_${timeRange}`,
	METRICS: (deviceId) => `metrics_${deviceId}`
};
