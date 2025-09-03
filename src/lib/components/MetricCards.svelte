<script>
	// Current environmental readings (matching the screenshot)
	export let temperature = 29.7;
	export let temperatureAvg = 25.52;
	export let humidity = 87;
	export let humidityAvg = 68.99;
</script>

<div class="metrics-grid">
	<!-- Temperature Card -->
	<div class="metric-card">
		<div class="metric-header">
			<svg class="metric-icon" viewBox="0 0 24 24" fill="#FF6B47">
				<path d="M15 13V5c0-1.66-1.34-3-3-3S9 3.34 9 5v8c-1.21.91-2 2.37-2 4 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.63-.79-3.09-2-4zm-4-2V5c0-.55.45-1 1-1s1 .45 1 1v6h-2z" />
			</svg>
			<span class="metric-label">Temperature</span>
		</div>
		<div class="metric-value temperature">{temperature}°C</div>
		<div class="metric-average">Avg: {temperatureAvg}°C</div>
	</div>

	<!-- Humidity Card -->
	<div class="metric-card">
		<div class="metric-header">
			<svg class="metric-icon" viewBox="0 0 24 24" fill="#4A90E2">
				<path d="M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8zM12 20c-3.35 0-6-2.57-6-5.2 0-2.34 1.95-5.44 6-9.14 4.05 3.7 6 6.79 6 9.14 0 2.63-2.65 5.2-6 5.2z" />
			</svg>
			<span class="metric-label">Humidity</span>
		</div>
		<div class="metric-value humidity">{humidity}%</div>
		<div class="metric-average">Avg: {humidityAvg}%</div>
	</div>

	<!-- Status Card -->
	<div class="metric-card">
		<div class="metric-header">
			<svg class="metric-icon" viewBox="0 0 24 24" fill="#4CAF50">
				<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
			</svg>
			<span class="metric-label">Status</span>
		</div>
		<div class="metric-value status">NORMAL</div>
		<div class="status-details">as of 3:00 PM</div>
	</div>
</div>
