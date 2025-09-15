import { build, files, version } from '$service-worker';

// Create a unique cache name for this deployment
const CACHE = `envirosync-cache-${version}`;

// Files to cache immediately
const ASSETS = [
	...build, // the app itself
	...files  // everything in `static`
];

self.addEventListener('install', (event) => {
	// Create a new cache and add all files to it
	async function addFilesToCache() {
		const cache = await caches.open(CACHE);
		await cache.addAll(ASSETS);
	}

	event.waitUntil(addFilesToCache());
});

self.addEventListener('activate', (event) => {
	// Remove previous cached data from disk
	async function deleteOldCaches() {
		for (const key of await caches.keys()) {
			if (key !== CACHE) await caches.delete(key);
		}
	}

	event.waitUntil(deleteOldCaches());
});

self.addEventListener('fetch', (event) => {
	// Ignore POST and other non-GET requests
	if (event.request.method !== 'GET') return;

	async function respond() {
		const url = new URL(event.request.url);
		const cache = await caches.open(CACHE);

		// Serve build files from cache
		if (ASSETS.includes(url.pathname)) {
			const response = await cache.match(url.pathname);
			if (response) {
				return response;
			}
		}

		// For API requests, try cache first, then network
		if (url.pathname.startsWith('/api/')) {
			// Try to get from cache first
			const cachedResponse = await cache.match(event.request);
			
			if (cachedResponse) {
				// Check if cache is fresh (less than 5 minutes old)
				const cacheDate = new Date(cachedResponse.headers.get('sw-cache-date') || 0);
				const now = new Date();
				const fiveMinutes = 5 * 60 * 1000;
				
				if (now - cacheDate < fiveMinutes) {
					return cachedResponse;
				}
			}

			// Fetch from network
			try {
				const networkResponse = await fetch(event.request);
				
				if (networkResponse.ok) {
					// Clone the response and add timestamp
					const responseClone = networkResponse.clone();
					const headers = new Headers(responseClone.headers);
					headers.set('sw-cache-date', new Date().toISOString());
					
					const cachedResponse = new Response(responseClone.body, {
						status: responseClone.status,
						statusText: responseClone.statusText,
						headers: headers
					});
					
					// Cache the response
					cache.put(event.request, cachedResponse);
				}
				
				return networkResponse;
			} catch (err) {
				// Network failed, return cached version if available
				const cachedResponse = await cache.match(event.request);
				if (cachedResponse) {
					return cachedResponse;
				}
				throw err;
			}
		}

		// For everything else, try network first, then cache
		try {
			const networkResponse = await fetch(event.request);
			
			// Cache successful responses
			if (networkResponse.ok && event.request.url.startsWith(self.location.origin)) {
				cache.put(event.request, networkResponse.clone());
			}
			
			return networkResponse;
		} catch (err) {
			const cachedResponse = await cache.match(event.request);
			if (cachedResponse) {
				return cachedResponse;
			}
			throw err;
		}
	}

	event.respondWith(respond());
});

// Listen for messages from the app
self.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'SKIP_WAITING') {
		self.skipWaiting();
	}
});
