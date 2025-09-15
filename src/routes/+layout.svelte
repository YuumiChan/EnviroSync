<script>
	import favicon from "$lib/assets/favicon.svg";
	import { cacheManager } from "$lib/cache.js";
	import { browser } from "$app/environment";
	import "../app.css";

	let { children } = $props();

	// Initialize cache management
	if (browser) {
		// Clear expired cache on app start
		const stats = cacheManager.getStats();
		console.log('Cache stats:', stats);
		
		// Clean up expired items
		stats.items.forEach(item => {
			if (item.isExpired) {
				cacheManager.delete(item.key);
			}
		});

		// Service worker registration
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.register('/service-worker.js')
				.then(registration => {
					console.log('Service Worker registered successfully:', registration);
				})
				.catch(error => {
					console.log('Service Worker registration failed:', error);
				});
		}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app-container">
	{@render children?.()}
</div>
