<script>
	import ConnectionStatus from "$lib/components/ConnectionStatus.svelte";
	import { localNow } from "$lib/config.js";
	import { getHiddenDeviceIds } from "$lib/deviceFilter.js";
	import { getDeviceColumnName, getQuotedColumn, getTableName } from "$lib/questdbHelpers.js";
	import html2canvas from "html2canvas";
	import * as XLSX from "xlsx";
	import { onMount } from "svelte";

	let selectedFilter = "24h";
	let customStartDate = "";
	let customStartTime = "00:01";
	let customEndDate = "";
	let customEndTime = "23:59";
	let loading = true;
	let analyticsData = null;
	let summaryRef;

	// Compare mode state
	let compareMode = false;
	let rightFilter = "1w";
	let rightCustomStartDate = "";
	let rightCustomStartTime = "00:01";
	let rightCustomEndDate = "";
	let rightCustomEndTime = "23:59";
	let rightLoading = false;
	let rightAnalyticsData = null;
	let animating = false;

	const filterOptions = [
		{ value: "24h", label: "Last 24 Hours", hours: 24 },
		{ value: "1w", label: "Last Week", hours: 168 },
		{ value: "1m", label: "Last Month", hours: 720 },
		{ value: "1y", label: "Last Year", hours: 8760 },
		{ value: "all", label: "All Time", hours: null },
		{ value: "custom", label: "Custom Range", hours: null },
	];

	function buildTimeCondition(filter, startDate, startTime, endDate, endTime) {
		const selectedOpt = filterOptions.find((f) => f.value === filter);
		if (filter === "custom" && startDate && endDate) {
			const start = new Date(`${startDate}T${startTime || "00:01"}`).toISOString();
			const end = new Date(`${endDate}T${endTime || "23:59"}`).toISOString();
			return `AND ts BETWEEN '${start}' AND '${end}'`;
		} else if (filter !== "all" && selectedOpt && selectedOpt.hours) {
			return `AND ts > dateadd('h', -${selectedOpt.hours}, ${localNow()})`;
		}
		return "";
	}

	async function fetchAnalyticsForFilter(filter, startDate, startTime, endDate, endTime) {
		const deviceColName = await getDeviceColumnName();
		const deviceCol = getQuotedColumn(deviceColName);
		const tableName = getTableName();

		const timeCondition = buildTimeCondition(filter, startDate, startTime, endDate, endTime);

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

		const earthquakeQuery = `
			SELECT
				${deviceCol} as device,
				MAX(rms) as max_rms
			FROM ${tableName}
			WHERE quake_flag = 2 ${timeCondition}
			GROUP BY ${deviceCol}
			ORDER BY ${deviceCol}
		`;

		const [summaryResponse, earthquakeResponse] = await Promise.all([
			fetch(`/api/questdb?query=${encodeURIComponent(summaryQuery)}`),
			fetch(`/api/questdb?query=${encodeURIComponent(earthquakeQuery)}`),
		]);

		if (summaryResponse.ok) {
			const result = await summaryResponse.json();
			const earthquakeResult = earthquakeResponse.ok ? await earthquakeResponse.json() : null;

			const earthquakeMap = new Map();
			if (earthquakeResult && earthquakeResult.dataset) {
				earthquakeResult.dataset.forEach((row) => {
					earthquakeMap.set(row[0], {
						maxRms: row[1] ? parseFloat(row[1]).toFixed(3) : "0.000",
					});
				});
			}

			if (result.dataset && result.dataset.length > 0) {
				const hiddenDevices = getHiddenDeviceIds();

				return result.dataset
					.map((row) => {
						const device = row[0];
						const earthquakeData = earthquakeMap.get(device) || { maxRms: "0.000" };

						return {
							device: device,
							totalRecords: row[1],
							minTemp: parseFloat(row[2]).toFixed(2),
							maxTemp: parseFloat(row[3]).toFixed(2),
							avgTemp: parseFloat(row[4]).toFixed(2),
							minHumid: parseFloat(row[5]).toFixed(1),
							maxHumid: parseFloat(row[6]).toFixed(1),
							avgHumid: parseFloat(row[7]).toFixed(1),
							firstRecord: new Date(row[8]).toLocaleString(),
							lastRecord: new Date(row[9]).toLocaleString(),
							...earthquakeData,
						};
					})
					.filter((device) => !hiddenDevices.includes(device.device));
			}
		}
		return [];
	}

	async function fetchAnalytics() {
		loading = true;
		try {
			analyticsData = await fetchAnalyticsForFilter(selectedFilter, customStartDate, customStartTime, customEndDate, customEndTime);
		} catch (error) {
			console.error("Error fetching analytics:", error);
			analyticsData = [];
		} finally {
			loading = false;
		}
	}

	async function fetchRightAnalytics() {
		rightLoading = true;
		try {
			rightAnalyticsData = await fetchAnalyticsForFilter(rightFilter, rightCustomStartDate, rightCustomStartTime, rightCustomEndDate, rightCustomEndTime);
		} catch (error) {
			console.error("Error fetching right analytics:", error);
			rightAnalyticsData = [];
		} finally {
			rightLoading = false;
		}
	}

	function toggleCompareMode() {
		animating = true;
		compareMode = !compareMode;
		if (compareMode) {
			fetchRightAnalytics();
		} else {
			rightAnalyticsData = null;
		}
		setTimeout(() => {
			animating = false;
		}, 300);
	}

	function exitCompareMode() {
		animating = true;
		compareMode = false;
		rightAnalyticsData = null;
		setTimeout(() => {
			animating = false;
		}, 300);
	}

	async function downloadPNG() {
		if (!summaryRef) return;

		try {
			const canvas = await html2canvas(summaryRef, {
				backgroundColor: "#1a1a1a",
				scale: 2,
			});

			const suffix = compareMode ? `compare-${selectedFilter}-vs-${rightFilter}` : selectedFilter;
			const link = document.createElement("a");
			link.download = `envirosync-analytics-${suffix}-${Date.now()}.png`;
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

			const timeCondition = buildTimeCondition(selectedFilter, customStartDate, customStartTime, customEndDate, customEndTime);

			const rawQuery = `SELECT ${deviceCol}, ts, temp, humid FROM ${tableName} WHERE 1=1 ${timeCondition} ORDER BY ts DESC`;

			const response = await fetch(`/api/questdb?query=${encodeURIComponent(rawQuery)}`);

			if (response.ok) {
				const result = await response.json();
				if (result.dataset && result.dataset.length > 0) {
					let csv = "Device,Timestamp,Temperature,Humidity\n";
					result.dataset.forEach((row) => {
						csv += `${row[0]},${row[1]},${row[2]},${row[3]}\n`;
					});

					const blob = new Blob([csv], { type: "text/csv" });
					const link = document.createElement("a");
					link.download = `envirosync-data-${selectedFilter}-${Date.now()}.csv`;
					link.href = URL.createObjectURL(blob);
					link.click();
				} else {
					alert("No data available for the selected range.");
				}
			}
		} catch (error) {
			console.error("Error generating CSV:", error);
			alert("Failed to generate CSV. Please try again.");
		}
	}

	function downloadXlsx() {
		if (!compareMode || !analyticsData || analyticsData.length === 0) return;

		try {
			const rows = [];

			// Header row
			rows.push(["Device", "Metric", getFilterLabel(selectedFilter), getFilterLabel(rightFilter)]);

			const metricRows = [
				["Min Temp (\u00B0C)", "minTemp"],
				["Max Temp (\u00B0C)", "maxTemp"],
				["Avg Temp (\u00B0C)", "avgTemp"],
				["Min Humid (%)", "minHumid"],
				["Max Humid (%)", "maxHumid"],
				["Avg Humid (%)", "avgHumid"],
				["Max RMS (g)", "maxRms"],
				["Total Records", "totalRecords"],
				["First Record", "firstRecord"],
				["Last Record", "lastRecord"],
			];

			for (const device of analyticsData) {
				const rightDevice = getRightDeviceData(device.device);
				for (let i = 0; i < metricRows.length; i++) {
					const [label, key] = metricRows[i];
					const leftVal = key === "totalRecords" ? device[key]?.toLocaleString() : device[key];
					const rightVal = rightDevice ? (key === "totalRecords" ? rightDevice[key]?.toLocaleString() : rightDevice[key]) : "\u2014";
					rows.push([i === 0 ? device.device : "", label, leftVal, rightVal]);
				}
				// Empty row between devices
				rows.push([]);
			}

			const ws = XLSX.utils.aoa_to_sheet(rows);

			// Set column widths
			ws["!cols"] = [{ wch: 16 }, { wch: 20 }, { wch: 18 }, { wch: 18 }];

			const wb = XLSX.utils.book_new();
			XLSX.utils.book_append_sheet(wb, ws, "Compare");
			XLSX.writeFile(wb, `envirosync-compare-${selectedFilter}-vs-${rightFilter}-${Date.now()}.xlsx`);
		} catch (error) {
			console.error("Error generating XLSX:", error);
			alert("Failed to generate XLSX. Please try again.");
		}
	}

	function handleFilterChange() {
		fetchAnalytics();
	}

	function handleRightFilterChange() {
		fetchRightAnalytics();
	}

	function getFilterLabel(value) {
		const opt = filterOptions.find((f) => f.value === value);
		return opt ? opt.label : value;
	}

	function getRightDeviceData(deviceName) {
		if (!rightAnalyticsData) return null;
		return rightAnalyticsData.find((d) => d.device === deviceName) || null;
	}

	onMount(() => {
		fetchAnalytics();
	});
</script>

<div class="dashboard-header">
	<div>
		<h1 class="dashboard-title">Analytics</h1>
	</div>

	<div class="user-info">
		<ConnectionStatus />
	</div>
</div>

<div class="controls-section">
	<div class="filter-area">
		<div class="filter-group">
			<label for="filter">{compareMode ? "Left:" : "Time Range:"}</label>
			<select id="filter" bind:value={selectedFilter} on:change={handleFilterChange}>
				{#each filterOptions as option}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>

			{#if selectedFilter === "custom"}
				<div class="custom-date-inputs">
					<input type="date" bind:value={customStartDate} />
					<input type="time" bind:value={customStartTime} />
					<span>to</span>
					<input type="date" bind:value={customEndDate} />
					<input type="time" bind:value={customEndTime} />
					<button class="apply-btn" on:click={handleFilterChange}>Apply</button>
				</div>
			{/if}
		</div>

		{#if !compareMode}
			<button class="compare-btn" on:click={toggleCompareMode}>
				<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
					<path d="M10 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h5v2h2V1h-2v2zm0 15H5l5-6v6zm4-15v2h5v13l-5-6v9h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-5z" />
				</svg>
				Compare Mode
			</button>
		{:else}
			<div class="filter-group right-filter">
				<label for="right-filter">Right:</label>
				<select id="right-filter" bind:value={rightFilter} on:change={handleRightFilterChange}>
					{#each filterOptions as option}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>

				{#if rightFilter === "custom"}
					<div class="custom-date-inputs">
						<input type="date" bind:value={rightCustomStartDate} />
						<input type="time" bind:value={rightCustomStartTime} />
						<span>to</span>
						<input type="date" bind:value={rightCustomEndDate} />
						<input type="time" bind:value={rightCustomEndTime} />
						<button class="apply-btn" on:click={handleRightFilterChange}>Apply</button>
					</div>
				{/if}

				<button class="close-compare-btn" on:click={exitCompareMode} title="Exit compare mode">
					<span class="close-x">&times;</span>
				</button>
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
		{#if compareMode}
			<button class="export-btn" on:click={downloadXlsx} disabled={loading || !analyticsData || rightLoading}>
				<svg viewBox="0 0 24 24" fill="currentColor">
					<path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15.01l1.41 1.41L11 14.84V19h2v-4.16l1.59 1.59L16 15.01 12.01 11z" />
				</svg>
				Download XLSX
			</button>
		{:else}
			<button class="export-btn" on:click={downloadCSV} disabled={loading || !analyticsData}>
				<svg viewBox="0 0 24 24" fill="currentColor">
					<path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z" />
				</svg>
				Download CSV
			</button>
		{/if}
	</div>
</div>

{#if loading}
	<div class="loading-container">
		<div class="spinner"></div>
		<p>Loading analytics data...</p>
	</div>
{:else if analyticsData && analyticsData.length > 0}
	<div class="analytics-content" class:compare-mode={compareMode} class:mode-transition={animating} bind:this={summaryRef}>
		{#if !compareMode}
			<!-- Normal mode -->
			{#each analyticsData as device}
				<div class="device-analytics-card">
					<h3>{device.device}</h3>

					<div class="stats-grid">
						<div class="stat-group">
							<h4>Temperature (&deg;C)</h4>
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
							<h4>Earthquake Detection</h4>
							<div class="stat-row">
								<span class="stat-label">Max RMS:</span>
								<span class="stat-value small">{device.maxRms}g</span>
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
		{:else}
			<!-- Compare mode: table format, 2-column grid -->
			{#each analyticsData as device}
				{@const rightDevice = getRightDeviceData(device.device)}
				<div class="device-analytics-card compare-card">
					<h3>{device.device}</h3>

					<div class="compare-table-wrapper">
						<table class="compare-table">
							<thead>
								<tr>
									<th class="metric-col">Metric</th>
									<th class="value-col">{getFilterLabel(selectedFilter)}</th>
									<th class="value-col">{getFilterLabel(rightFilter)}</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td class="metric-cell">Min Temp (&deg;C)</td>
									<td class="value-cell">{device.minTemp}</td>
									<td class="value-cell">{rightDevice ? rightDevice.minTemp : "&mdash;"}</td>
								</tr>
								<tr>
									<td class="metric-cell">Max Temp (&deg;C)</td>
									<td class="value-cell">{device.maxTemp}</td>
									<td class="value-cell">{rightDevice ? rightDevice.maxTemp : "&mdash;"}</td>
								</tr>
								<tr>
									<td class="metric-cell">Avg Temp (&deg;C)</td>
									<td class="value-cell">{device.avgTemp}</td>
									<td class="value-cell">{rightDevice ? rightDevice.avgTemp : "&mdash;"}</td>
								</tr>
								<tr class="section-separator">
									<td class="metric-cell">Min Humid (%)</td>
									<td class="value-cell">{device.minHumid}</td>
									<td class="value-cell">{rightDevice ? rightDevice.minHumid : "&mdash;"}</td>
								</tr>
								<tr>
									<td class="metric-cell">Max Humid (%)</td>
									<td class="value-cell">{device.maxHumid}</td>
									<td class="value-cell">{rightDevice ? rightDevice.maxHumid : "&mdash;"}</td>
								</tr>
								<tr>
									<td class="metric-cell">Avg Humid (%)</td>
									<td class="value-cell">{device.avgHumid}</td>
									<td class="value-cell">{rightDevice ? rightDevice.avgHumid : "&mdash;"}</td>
								</tr>
								<tr class="section-separator">
									<td class="metric-cell">Max RMS (g)</td>
									<td class="value-cell">{device.maxRms}</td>
									<td class="value-cell">{rightDevice ? rightDevice.maxRms : "&mdash;"}</td>
								</tr>
								<tr class="section-separator">
									<td class="metric-cell">Total Records</td>
									<td class="value-cell">{device.totalRecords.toLocaleString()}</td>
									<td class="value-cell">{rightDevice ? rightDevice.totalRecords.toLocaleString() : "&mdash;"}</td>
								</tr>
								<tr>
									<td class="metric-cell">First Record</td>
									<td class="value-cell small">{device.firstRecord}</td>
									<td class="value-cell small">{rightDevice ? rightDevice.firstRecord : "&mdash;"}</td>
								</tr>
								<tr>
									<td class="metric-cell">Last Record</td>
									<td class="value-cell small">{device.lastRecord}</td>
									<td class="value-cell small">{rightDevice ? rightDevice.lastRecord : "&mdash;"}</td>
								</tr>
							</tbody>
						</table>
						{#if rightLoading}
							<div class="compare-loading-overlay">
								<div class="spinner-small"></div>
							</div>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</div>
{:else}
	<div class="no-data">
		<p>No data available for the selected time range.</p>
	</div>
{/if}

<style>
	.controls-section {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 2rem;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.filter-area {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
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
		min-width: 40px;
	}

	.filter-group select {
		padding: 0.5rem 1rem;
		background: #1e1e1e;
		border: 1px solid rgba(74, 144, 226, 0.3);
		color: #fff;
		border-radius: 6px;
		font-size: 1rem;
		cursor: pointer;
	}

	.filter-group select option {
		background: #1e1e1e;
		color: #fff;
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

	.custom-date-inputs input[type="date"],
	.custom-date-inputs input[type="time"] {
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

	/* Compare mode button - theme colors */
	.compare-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: rgba(74, 144, 226, 0.1);
		border: 1px solid rgba(74, 144, 226, 0.3);
		color: #4a90e2;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.9rem;
		transition: all 0.2s ease;
	}

	.compare-btn:hover {
		background: rgba(74, 144, 226, 0.2);
		border-color: #4a90e2;
	}

	.compare-btn svg {
		width: 16px;
		height: 16px;
	}

	.right-filter {
		animation: slideIn 0.3s ease;
	}

	.close-compare-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 50%;
		cursor: pointer;
		transition: all 0.2s ease;
		padding: 0;
		flex-shrink: 0;
	}

	.close-compare-btn:hover {
		background: rgba(244, 67, 54, 0.2);
		border-color: #f44336;
	}

	.close-x {
		color: #888;
		font-size: 1.2rem;
		line-height: 1;
		font-weight: 300;
		transition: color 0.2s ease;
	}

	.close-compare-btn:hover .close-x {
		color: #f44336;
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

	.spinner-small {
		border: 3px solid rgba(74, 144, 226, 0.1);
		border-top: 3px solid #4a90e2;
		border-radius: 50%;
		width: 30px;
		height: 30px;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Mode transition animation */
	.mode-transition {
		animation: fadeSwitch 0.3s ease;
	}

	@keyframes fadeSwitch {
		0% {
			opacity: 0.5;
			transform: scale(0.98);
		}
		100% {
			opacity: 1;
			transform: scale(1);
		}
	}

	.analytics-content {
		background: rgba(0, 0, 0, 0.3);
		border-radius: 12px;
		padding: 2rem;
		border: 1px solid rgba(74, 144, 226, 0.2);
		transition: all 0.3s ease;
	}

	/* Compare mode: 2-column grid */
	.analytics-content.compare-mode {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1.5rem;
		padding: 1.5rem;
	}

	.device-analytics-card {
		background: rgba(0, 0, 0, 0.4);
		border-radius: 8px;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
		border: 1px solid rgba(74, 144, 226, 0.2);
	}

	.device-analytics-card:last-child {
		margin-bottom: 0;
	}

	/* In compare mode, cards are in grid so no margin-bottom needed */
	.analytics-content.compare-mode .device-analytics-card {
		margin-bottom: 0;
	}

	.device-analytics-card h3 {
		color: #4a90e2;
		margin-bottom: 1.5rem;
		font-size: 1.5rem;
	}

	.compare-card h3 {
		font-size: 1.2rem;
		margin-bottom: 1rem;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		gap: 1.5rem;
	}

	@media (min-width: 1200px) {
		.stats-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	/* Compare table styles */
	.compare-table-wrapper {
		position: relative;
	}

	.compare-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}

	.compare-table thead tr {
		border-bottom: 2px solid rgba(74, 144, 226, 0.3);
	}

	.compare-table th {
		padding: 0.6rem 0.75rem;
		text-align: left;
		color: #4a90e2;
		font-weight: 600;
		font-size: 0.85rem;
	}

	.compare-table th.value-col {
		text-align: right;
	}

	.compare-table td {
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	}

	.compare-table tbody tr:last-child td {
		border-bottom: none;
	}

	.compare-table tr.section-separator td {
		border-top: 1px solid rgba(74, 144, 226, 0.15);
	}

	.metric-cell {
		color: #888;
		font-weight: 500;
	}

	.value-cell {
		color: #fff;
		font-weight: 600;
		text-align: right;
	}

	.value-cell.small {
		font-size: 0.78rem;
		font-weight: 500;
	}

	.compare-loading-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.5);
		border-radius: 8px;
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

		.analytics-content.compare-mode {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 1200px) {
		.analytics-content.compare-mode {
			grid-template-columns: 1fr;
		}
	}
</style>
