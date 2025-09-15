<script>
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";

	let isConnected = true;
	let connectionStatus = "Connected";
	let statusClass = "connected";
	let checkInterval;
	let lastSuccessfulCheck = Date.now();

	// Function to check internet connectivity
	async function checkConnection() {
		try {
			// Check if browser is online
			if (!navigator.onLine) {
				setDisconnected("No Internet");
				return;
			}

			// Test database connectivity with a simple query
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

			const response = await fetch('/api/questdb?query=SELECT 1', {
				signal: controller.signal,
				cache: 'no-store'
			});

			clearTimeout(timeoutId);

			if (response.ok) {
				setConnected();
				lastSuccessfulCheck = Date.now();
			} else {
				setDisconnected("Database Error");
			}
		} catch (error) {
			console.log('Connection check failed:', error.name);
			
			if (error.name === 'AbortError') {
				setDisconnected("Timeout");
			} else if (error.message.includes('fetch')) {
				setDisconnected("Network Error");
			} else {
				setDisconnected("Database Down");
			}
		}
	}

	function setConnected() {
		isConnected = true;
		connectionStatus = "Connected";
		statusClass = "connected";
	}

	function setDisconnected(reason) {
		isConnected = false;
		connectionStatus = "Disconnected";
		statusClass = "disconnected";
		
		// If we've been disconnected for more than 30 seconds, show reason
		if (Date.now() - lastSuccessfulCheck > 30000) {
			connectionStatus = `Disconnected (${reason})`;
		}
	}

	onMount(() => {
		if (browser) {
			// Initial check
			checkConnection();

			// Set up periodic checks every 10 seconds
			checkInterval = setInterval(checkConnection, 10000);

			// Listen for online/offline events
			window.addEventListener('online', () => {
				console.log('Browser came online');
				checkConnection();
			});

			window.addEventListener('offline', () => {
				console.log('Browser went offline');
				setDisconnected("No Internet");
			});
		}
	});

	onDestroy(() => {
		if (checkInterval) {
			clearInterval(checkInterval);
		}
	});
</script>

<div class="connection-status {statusClass}">
	<div class="status-dot"></div>
	<span>{connectionStatus}</span>
</div>

<style>
	.connection-status {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		transition: color 0.3s ease;
	}

	.connection-status.connected {
		color: #4CAF50;
	}

	.connection-status.disconnected {
		color: #f44336;
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		transition: background-color 0.3s ease;
	}

	.connected .status-dot {
		background-color: #4CAF50;
		box-shadow: 0 0 6px rgba(76, 175, 80, 0.6);
	}

	.disconnected .status-dot {
		background-color: #f44336;
		box-shadow: 0 0 6px rgba(244, 67, 54, 0.6);
		animation: pulse 2s infinite;
	}

	@keyframes pulse {
		0% {
			box-shadow: 0 0 6px rgba(244, 67, 54, 0.6);
		}
		50% {
			box-shadow: 0 0 12px rgba(244, 67, 54, 0.8);
		}
		100% {
			box-shadow: 0 0 6px rgba(244, 67, 54, 0.6);
		}
	}
</style>
