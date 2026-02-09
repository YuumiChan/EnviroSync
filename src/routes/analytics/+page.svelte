<script>
	import ConnectionStatus from "$lib/components/ConnectionStatus.svelte";
	import Sidebar from "$lib/components/Sidebar.svelte";
	import { getDeviceColumnName, getQuotedColumn, getTableName } from "$lib/questdbHelpers.js";
	import html2canvas from "html2canvas";
	import { onMount } from "svelte";

	let selectedFilter = "24h";
	let customStartDate = "";
	let customEndDate = "";
	let loading = true;
	let analyticsData = null;
	let summaryRef;

	const filterOptions = [
		{ value: "24h", label: "Last 24 Hours", hours: 24 },
		{ value: "1w", label: "Last Week", hours: 168 },
		{ value: "1m", label: "Last Month", hours: 720 },
		{ value: "1y", label: "Last Year", hours: 8760 },
		{ value: "all", label: "All Time", hours: null },
		{ value: "custom", label: "Custom Range", hours: null },
	];

	async function fetchAnalytics() {
		loading = true;
		try {
			const deviceColName = await getDeviceColumnName();
			const deviceCol = getQuotedColumn(deviceColName);
			const tableName = getTableName();

			let timeCondition = "";
			const selectedOpt = filterOptions.find((f) => f.value === selectedFilter);

			if (selectedFilter === "custom" && customStartDate && customEndDate) {
				const startDate = new Date(customStartDate).toISOString();
				const endDate = new Date(customEndDate).toISOString();
				timeCondition = `AND ts BETWEEN '${startDate}' AND '${endDate}'`;
			} else if (selectedFilter !== "all" && selectedOpt && selectedOpt.hours) {
				timeCondition = `AND ts > dateadd('h', -${selectedOpt.hours}, now())`;
			}

			// Query for summary statistics
			const summaryQuery = `
				SELECT 
					${deviceCol} as device,
					COUNT(*) as total_records,
					MIN(temp) as min_temp,
					MAX(temp) as max_temp,
					AVG(temp) as avg_temp,
					MIN(humid) as min_humid,
					MAX(humid) as max_humid,
					AVG(humid) as avg_humid,
					MIN(ts) as first_record,
					MAX(ts) as last_record
				FROM ${tableName}
				WHERE 1=1 ${timeCondition}
				GROUP BY ${deviceCol}
				ORDER BY ${deviceCol}
			`;

			const response = await fetch(`/api/questdb?query=${encodeURIComponent(summaryQuery)}`);

			if (response.ok) {
				const result = await response.json();
				if (result.dataset && result.dataset.length > 0) {
					analyticsData = result.dataset.map((row) => ({
						device: row[0],
						totalRecords: row[1],
						minTemp: parseFloat(row[2]).toFixed(2),
						maxTemp: parseFloat(row[3]).toFixed(2),
						avgTemp: parseFloat(row[4]).toFixed(2),
						minHumid: parseFloat(row[5]).toFixed(1),
						maxHumid: parseFloat(row[6]).toFixed(1),
						avgHumid: parseFloat(row[7]).toFixed(1),
						firstRecord: new Date(row[8]).toLocaleString(),
						lastRecord: new Date(row[9]).toLocaleString(),
					}));
					console.log(`Loaded analytics data for ${analyticsData.length} device(s)`);
				} else {
					console.warn("No data returned from analytics query");
					analyticsData = [];
				}
			} else {
				console.error("API error:", response.status, response.statusText);
				analyticsData = [];
			}
		} catch (error) {
			console.error("Error fetching analytics:", error);
			analyticsData = [];
		} finally {
			loading = false;
		}
	}

	async function downloadPNG() {
		if (!summaryRef) return;

		try {
			const canvas = await html2canvas(summaryRef, {
				backgroundColor: "#1a1a1a",
				scale: 2,
			});

			const link = document.createElement("a");
			link.download = `envirosync-analytics-${selectedFilter}-${Date.now()}.png`;
			link.href = canvas.toDataURL("image/png");
			link.click();
		} catch (error) {
			console.error("Error generating PNG:", error);
			alert("Failed to generate PNG. Please try again.");
		}
	}

	async function downloadCSV() {
		if (!analyticsData || analyticsData.length === 0) return;

		try {
			const deviceColName = await getDeviceColumnName();
			const deviceCol = getQuotedColumn(deviceColName);
			const tableName = getTableName();

			let timeCondition = "";
			const selectedOpt = filterOptions.find((f) => f.value === selectedFilter);

			if (selectedFilter === "custom" && customStartDate && customEndDate) {
				const startDate = new Date(customStartDate).toISOString();
				const endDate = new Date(customEndDate).toISOString();
				timeCondition = `AND ts BETWEEN '${startDate}' AND '${endDate}'`;
			} else if (selectedFilter !== "all" && selectedOpt && selectedOpt.hours) {
				timeCondition = `AND ts > dateadd('h', -${selectedOpt.hours}, now())`;
			}

			// Query for raw data
			const rawQuery = `SELECT ${deviceCol}, ts, temp, humid FROM ${tableName} WHERE 1=1 ${timeCondition} ORDER BY ts DESC`;

			const response = await fetch(`/api/questdb?query=${encodeURIComponent(rawQuery)}`);

			if (response.ok) {
				const result = await response.json();
				if (result.dataset && result.dataset.length > 0) {
					// Create CSV content
					let csv = "Device,Timestamp,Temperature,Humidity\n";
					result.dataset.forEach((row) => {
						csv += `${row[0]},${row[1]},${row[2]},${row[3]}\n`;
					});

					// Download CSV
					const blob = new Blob([csv], { type: "text/csv" });
					const link = document.createElement("a");
					link.download = `envirosync-data-${selectedFilter}-${Date.now()}.csv`;
					link.href = URL.createObjectURL(blob);
					link.click();
					console.log(`CSV downloaded with ${result.dataset.length} rows`);
				} else {
					console.warn("No data available for CSV export");
					alert("No data available for the selected range.");
				}
			}
		} catch (error) {
			console.error("Error generating CSV:", error);
			alert("Failed to generate CSV. Please try again.");
		}
	}

	function handleFilterChange() {
		fetchAnalytics();
	}

	onMount(() => {
		fetchAnalytics();
	});
</script>

<Sidebar />

<main class="main-content">
	<div class="dashboard-header">
		<div>
			<h1 class="dashboard-title">Analytics</h1>
			<p class="dashboard-subtitle">Comprehensive data analysis across all devices</p>
		</div>

		<div class="user-info">
			<ConnectionStatus />
		</div>
	</div>

	<div class="controls-section">
		<div class="filter-group">
			<label for="filter">Time Range:</label>
			<select id="filter" bind:value={selectedFilter} on:change={handleFilterChange}>
				{#each filterOptions as option}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>

			{#if selectedFilter === "custom"}
				<div class="custom-date-inputs">
					<input type="datetime-local" bind:value={customStartDate} placeholder="Start Date" />
					<span>to</span>
					<input type="datetime-local" bind:value={customEndDate} placeholder="End Date" />
					<button class="apply-btn" on:click={handleFilterChange}>Apply</button>
				</div>
			{/if}
		</div>

		<div class="export-buttons">
			<button class="export-btn" on:click={downloadPNG} disabled={loading || !analyticsData}>
				<svg viewBox="0 0 24 24" fill="currentColor">
					<path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
				</svg>
				Download PNG
			</button>
			<button class="export-btn" on:click={downloadCSV} disabled={loading || !analyticsData}>
				<svg viewBox="0 0 24 24" fill="currentColor">
					<path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z" />
				</svg>
				Download CSV
			</button>
		</div>
	</div>

	{#if loading}
		<div class="loading-container">
			<div class="spinner"></div>
			<p>Loading analytics data...</p>
		</div>
	{:else if analyticsData && analyticsData.length > 0}
		<div class="analytics-content" bind:this={summaryRef}>
			<h2>Summary Statistics</h2>

			{#each analyticsData as device}
				<div class="device-analytics-card">
					<h3>{device.device}</h3>

					<div class="stats-grid">
						<div class="stat-group">
							<h4>Temperature (°C)</h4>
							<div class="stat-row">
								<span class="stat-label">Low:</span>
								<span class="stat-value">{device.minTemp}</span>
							</div>
							<div class="stat-row">
								<span class="stat-label">High:</span>
								<span class="stat-value">{device.maxTemp}</span>
							</div>
							<div class="stat-row">
								<span class="stat-label">Average:</span>
								<span class="stat-value">{device.avgTemp}</span>
							</div>
						</div>

						<div class="stat-group">
							<h4>Humidity (%)</h4>
							<div class="stat-row">
								<span class="stat-label">Low:</span>
								<span class="stat-value">{device.minHumid}</span>
							</div>
							<div class="stat-row">
								<span class="stat-label">High:</span>
								<span class="stat-value">{device.maxHumid}</span>
							</div>
							<div class="stat-row">
								<span class="stat-label">Average:</span>
								<span class="stat-value">{device.avgHumid}</span>
							</div>
						</div>

						<div class="stat-group">
							<h4>Records</h4>
							<div class="stat-row">
								<span class="stat-label">Total:</span>
								<span class="stat-value">{device.totalRecords.toLocaleString()}</span>
							</div>
							<div class="stat-row">
								<span class="stat-label">First:</span>
								<span class="stat-value small">{device.firstRecord}</span>
							</div>
							<div class="stat-row">
								<span class="stat-label">Last:</span>
								<span class="stat-value small">{device.lastRecord}</span>
							</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="no-data">
			<p>No data available for the selected time range.</p>
		</div>
	{/if}
</main>

<style>
	.controls-section {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 2rem;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.filter-group {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.filter-group label {
		color: #b0b0b0;
		font-weight: 500;
	}

	.filter-group select {
		padding: 0.5rem 1rem;
		background: rgba(0, 0, 0, 0.3);
		border: 1px solid rgba(74, 144, 226, 0.3);
		color: #fff;
		border-radius: 6px;
		font-size: 1rem;
		cursor: pointer;
	}

	.filter-group select:focus {
		outline: none;
		border-color: #4a90e2;
	}

	.custom-date-inputs {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.custom-date-inputs input {
		padding: 0.5rem;
		background: rgba(0, 0, 0, 0.3);
		border: 1px solid rgba(74, 144, 226, 0.3);
		color: #fff;
		border-radius: 6px;
		font-size: 0.9rem;
	}

	.custom-date-inputs input:focus {
		outline: none;
		border-color: #4a90e2;
	}

	.custom-date-inputs span {
		color: #888;
	}

	.apply-btn {
		padding: 0.5rem 1rem;
		background: #4a90e2;
		border: none;
		color: #fff;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.9rem;
		transition: all 0.2s ease;
	}

	.apply-btn:hover {
		background: #357abd;
	}

	.export-buttons {
		display: flex;
		gap: 0.5rem;
	}

	.export-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: rgba(0, 0, 0, 0.3);
		border: 1px solid rgba(74, 144, 226, 0.3);
		color: #4a90e2;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.9rem;
		transition: all 0.2s ease;
	}

	.export-btn:hover:not(:disabled) {
		border-color: #4a90e2;
		background: rgba(74, 144, 226, 0.1);
	}

	.export-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.export-btn svg {
		width: 20px;
		height: 20px;
	}

	.loading-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem;
		color: #888;
	}

	.spinner {
		border: 4px solid rgba(74, 144, 226, 0.1);
		border-top: 4px solid #4a90e2;
		border-radius: 50%;
		width: 50px;
		height: 50px;
		animation: spin 1s linear infinite;
		margin-bottom: 1rem;
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	.analytics-content {
		background: rgba(0, 0, 0, 0.3);
		border-radius: 12px;
		padding: 2rem;
		border: 1px solid rgba(74, 144, 226, 0.2);
	}

	.analytics-content h2 {
		color: #fff;
		margin-bottom: 2rem;
		font-size: 1.8rem;
	}

	.device-analytics-card {
		background: rgba(0, 0, 0, 0.4);
		border-radius: 8px;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
		border: 1px solid rgba(74, 144, 226, 0.2);
	}

	.device-analytics-card h3 {
		color: #4a90e2;
		margin-bottom: 1.5rem;
		font-size: 1.5rem;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		gap: 1.5rem;
	}

	.stat-group {
		background: rgba(0, 0, 0, 0.3);
		padding: 1rem;
		border-radius: 6px;
		border: 1px solid rgba(74, 144, 226, 0.1);
	}

	.stat-group h4 {
		color: #b0b0b0;
		margin-bottom: 1rem;
		font-size: 1rem;
		text-align: center;
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	}

	.stat-row:last-child {
		border-bottom: none;
	}

	.stat-label {
		color: #888;
		font-size: 0.9rem;
	}

	.stat-value {
		color: #fff;
		font-weight: 600;
		font-size: 1rem;
	}

	.stat-value.small {
		font-size: 0.8rem;
		text-align: right;
	}

	.no-data {
		text-align: center;
		padding: 4rem;
		color: #888;
		font-size: 1.2rem;
	}

	@media (max-width: 768px) {
		.controls-section {
			flex-direction: column;
			align-items: stretch;
		}

		.export-buttons {
			width: 100%;
		}

		.export-btn {
			flex: 1;
		}

		.stats-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
