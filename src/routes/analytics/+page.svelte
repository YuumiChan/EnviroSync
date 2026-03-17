<script>
	import { localNow } from "$lib/config.js";
	import { getHiddenDeviceIds } from "$lib/deviceFilter.js";
	import { rmsToMagnitude } from "$lib/magnitude.js";
	import { getDeviceColumnName, getQuotedColumn, getTableName } from "$lib/questdbHelpers.js";
	import { magnitudeMode } from "$lib/stores.js";
	import { Chart, registerables } from "chart.js";
	import "chartjs-adapter-date-fns";
	import html2canvas from "html2canvas";
	import { onMount, tick } from "svelte";
	import * as XLSX from "xlsx";

	Chart.register(...registerables);

	// ── Custom Chart.js plugin for missing data highlights ──────
	const missingDataPlugin = {
		id: "missingDataHighlight",
		beforeDraw(chart) {
			const opts = chart.options.plugins.missingDataHighlight;
			if (!opts || !opts.gaps || opts.gaps.length === 0) return;
			const ctx = chart.ctx;
			const xScale = chart.scales.x;
			const { top, bottom } = chart.chartArea;
			ctx.save();
			ctx.fillStyle = "rgba(255, 0, 0, 0.12)";
			for (const gap of opts.gaps) {
				const xStart = xScale.getPixelForValue(gap.start);
				const xEnd = xScale.getPixelForValue(gap.end);
				if (xEnd > xStart) {
					ctx.fillRect(xStart, top, xEnd - xStart, bottom - top);
				}
			}
			ctx.restore();
		},
	};
	Chart.register(missingDataPlugin);

	// ── State ──────────────────────────────────────────────────────
	let selectedFilter = "24h";
	let customStartDate = "";
	let customStartTime = "00:01";
	let customEndDate = "";
	let customEndTime = "23:59";
	let loading = true;
	let analyticsData = null;
	let summaryRef;

	// Compare mode
	let compareMode = false;
	let rightFilter = "1w";
	let rightCustomStartDate = "";
	let rightCustomStartTime = "00:01";
	let rightCustomEndDate = "";
	let rightCustomEndTime = "23:59";
	let rightLoading = false;
	let rightAnalyticsData = null;
	let animating = false;

	// Missing data highlight
	let showMissingData = false;

	// Time series data
	let timeSeriesData = null;
	let rightTimeSeriesData = null;

	// Chart instance tracking
	let chartInstances = {};
	let chartRenderTimer;

	// ── Constants ──────────────────────────────────────────────────
	const filterOptions = [
		{ value: "24h", label: "Last 24 Hours", hours: 24 },
		{ value: "1w", label: "Last Week", hours: 168 },
		{ value: "1m", label: "Last Month", hours: 720 },
		{ value: "1y", label: "Last Year", hours: 8760 },
		{ value: "all", label: "All Time", hours: null },
		{ value: "custom", label: "Custom Range", hours: null },
	];

	const chartColors = ["#4a90e2", "#ff6b47", "#4caf50", "#9b59b6", "#f39c12", "#1abc9c", "#e74c3c", "#3498db", "#2ecc71", "#e67e22", "#8e44ad", "#16a085"];

	// ── Derived state ─────────────────────────────────────────────
	$: processedLeft = timeSeriesData ? processTimeSeries(timeSeriesData) : {};
	$: processedRight = rightTimeSeriesData ? processTimeSeries(rightTimeSeriesData) : {};
	$: chartDevices = Object.keys(processedLeft);

	// Trigger chart re-render when dependencies change
	$: chartTrigger = [loading, compareMode, $magnitudeMode, showMissingData, chartDevices.length, Object.keys(processedRight).length, rightLoading].join(",");

	$: if (chartTrigger && !loading && chartDevices.length > 0) {
		scheduleChartRender();
	}

	// ── Helpers ────────────────────────────────────────────────────
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

	function getFilterLabel(value) {
		const opt = filterOptions.find((f) => f.value === value);
		return opt ? opt.label : value;
	}

	function getRightDeviceData(deviceName) {
		if (!rightAnalyticsData) return null;
		return rightAnalyticsData.find((d) => d.device === deviceName) || null;
	}

	function getCSSVar(name) {
		if (typeof document === "undefined") return "";
		return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	}

	function hexToRgba(hex, alpha) {
		if (!hex || !hex.startsWith("#")) return `rgba(128,128,128,${alpha})`;
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	// ── Missing data gap detection ────────────────────────────────
	function findGaps(processedData, thresholdMinutes = 30) {
		const allTimestamps = [];
		for (const device in processedData) {
			for (const point of processedData[device]) {
				allTimestamps.push(new Date(point.ts).getTime());
			}
		}
		const sorted = [...new Set(allTimestamps)].sort((a, b) => a - b);
		const thresholdMs = thresholdMinutes * 60 * 1000;
		const gaps = [];
		for (let i = 1; i < sorted.length; i++) {
			if (sorted[i] - sorted[i - 1] > thresholdMs) {
				gaps.push({ start: sorted[i - 1], end: sorted[i] });
			}
		}
		return gaps;
	}

	// ── Chart tooltip sync ────────────────────────────────────────
	function getSyncGroup(chartId) {
		if (chartId.startsWith("chart-left-")) return "left";
		if (chartId.startsWith("chart-right-")) return "right";
		return "main";
	}

	function handleChartHover(chartId) {
		return function (event, activeElements, chart) {
			if (chart._syncing) return;
			const group = getSyncGroup(chartId);
			for (const id in chartInstances) {
				if (id === chartId || getSyncGroup(id) !== group) continue;
				const target = chartInstances[id];
				if (!target || target._syncing) continue;
				target._syncing = true;
				try {
					if (activeElements.length > 0) {
						const idx = activeElements[0].index;
						const elements = [];
						target.data.datasets.forEach((ds, di) => {
							if (idx < ds.data.length) {
								elements.push({ datasetIndex: di, index: idx });
							}
						});
						if (elements.length > 0) {
							target.setActiveElements(elements);
							target.tooltip.setActiveElements(elements, { x: activeElements[0].element.x, y: 0 });
							target.update("none");
						}
					} else {
						target.setActiveElements([]);
						target.tooltip.setActiveElements([], { x: 0, y: 0 });
						target.update("none");
					}
				} finally {
					target._syncing = false;
				}
			}
		};
	}

	// ── Time series processing ─────────────────────────────────────
	function processTimeSeries(data) {
		if (!data || data.length === 0) return {};
		const byDevice = {};
		for (const point of data) {
			if (!byDevice[point.device]) byDevice[point.device] = [];
			byDevice[point.device].push(point);
		}
		const maxPoints = 200;
		for (const device in byDevice) {
			const arr = byDevice[device];
			if (arr.length > maxPoints) {
				const step = Math.ceil(arr.length / maxPoints);
				byDevice[device] = arr.filter((_, i) => i % step === 0);
			}
		}
		return byDevice;
	}

	async function fetchTimeSeriesForFilter(filter, startDate, startTime, endDate, endTime) {
		const deviceColName = await getDeviceColumnName();
		const deviceCol = getQuotedColumn(deviceColName);
		const tableName = getTableName();
		const timeCondition = buildTimeCondition(filter, startDate, startTime, endDate, endTime);

		// Server-side downsampling: compute SAMPLE BY interval to target ~200 points
		const selectedOpt = filterOptions.find((f) => f.value === filter);
		let sampleClause = "";
		if (selectedOpt && selectedOpt.hours && selectedOpt.hours > 24) {
			const targetPoints = 200;
			const sampleMinutes = Math.max(1, Math.floor((selectedOpt.hours * 60) / targetPoints));
			sampleClause = `SAMPLE BY ${sampleMinutes}m FILL(null)`;
		} else if (filter === "all") {
			// For 'all time', use 1-hour sampling
			sampleClause = "SAMPLE BY 1h FILL(null)";
		}

		let query;
		if (sampleClause) {
			query = `SELECT ts, ${deviceCol} as device, avg(temp) as temp, avg(humid) as humid, avg(rms) as rms FROM ${tableName} WHERE 1=1 ${timeCondition} ${sampleClause} ORDER BY ts ASC`;
		} else {
			query = `SELECT ts, ${deviceCol} as device, temp, humid, rms FROM ${tableName} WHERE 1=1 ${timeCondition} ORDER BY ts ASC`;
		}

		try {
			const response = await fetch(`/api/questdb?query=${encodeURIComponent(query)}`);
			if (response.ok) {
				const result = await response.json();
				if (result.dataset) {
					const hiddenDevices = getHiddenDeviceIds();
					return result.dataset
						.map((row) => ({
							ts: row[0],
							device: row[1],
							temp: parseFloat(row[2]) || 0,
							humid: parseFloat(row[3]) || 0,
							rms: parseFloat(row[4]) || 0,
						}))
						.filter((d) => !hiddenDevices.includes(d.device));
				}
			}
		} catch (e) {
			console.error("Error fetching time series:", e);
		}
		return [];
	}

	// ── Chart rendering ────────────────────────────────────────────
	function getChartOptions(title, chartId, gaps, metric) {
		const textColor = getCSSVar("--text-primary") || "#5c6166";
		const mutedColor = getCSSVar("--text-muted") || "#8a9199";
		const rawMuted = mutedColor.startsWith("#") ? mutedColor : "#888888";
		const gridColor = hexToRgba(rawMuted, 0.15);

		const useMag = $magnitudeMode;
		let yMax = undefined;
		if (metric === "temp" || metric === "humid") {
			yMax = 100;
		} else if (metric === "rms") {
			yMax = useMag ? 10 : 1.0;
		}

		return {
			responsive: true,
			maintainAspectRatio: false,
			animation: { duration: 300 },
			onHover: handleChartHover(chartId),
			plugins: {
				title: {
					display: true,
					text: title,
					color: textColor,
					font: { size: 16, weight: "600" },
					align: "start",
				},
				legend: {
					position: "top",
					align: "end",
					labels: {
						color: mutedColor,
						font: { size: 13 },
						usePointStyle: true,
						pointStyle: "circle",
					},
				},
				tooltip: {
					mode: "index",
					intersect: false,
				},
				missingDataHighlight: {
					gaps: gaps || [],
				},
			},
			interaction: {
				mode: "nearest",
				axis: "x",
				intersect: false,
			},
			scales: {
				x: {
					type: "time",
					time: {
						tooltipFormat: "MMM d, yyyy HH:mm",
						displayFormats: {
							minute: "HH:mm",
							hour: "HH:mm",
							day: "MMM d",
							week: "MMM d",
							month: "MMM yyyy",
						},
					},
					ticks: {
						color: mutedColor,
						maxTicksLimit: 8,
						font: { size: 10 },
					},
					grid: { color: gridColor },
				},
				y: {
					beginAtZero: true,
					max: yMax,
					ticks: {
						color: mutedColor,
						font: { size: 10 },
					},
					grid: { color: gridColor },
				},
			},
		};
	}

	function buildChartConfig(deviceData, metric, title, devices, colors, chartId, gaps) {
		const useMag = $magnitudeMode;
		const datasets = devices.map((device, i) => {
			const data = deviceData[device] || [];
			return {
				label: device,
				data: data.map((p) => ({
					x: new Date(p.ts),
					y: metric === "rms" ? (useMag ? rmsToMagnitude(p.rms) : p.rms) : p[metric],
				})),
				borderColor: colors[i % colors.length],
				backgroundColor: "transparent",
				borderWidth: 1.5,
				pointRadius: 0,
				pointHoverRadius: 3,
				tension: 0.3,
				fill: false,
			};
		});

		return {
			type: "line",
			data: { datasets },
			options: getChartOptions(title, chartId, gaps, metric),
		};
	}

	function clearSyncedCharts(chartId) {
		const group = getSyncGroup(chartId);
		for (const id in chartInstances) {
			if (id === chartId || getSyncGroup(id) !== group) continue;
			const target = chartInstances[id];
			if (!target) continue;
			target._syncing = true;
			try {
				target.setActiveElements([]);
				target.tooltip.setActiveElements([], { x: 0, y: 0 });
				target.update("none");
			} finally {
				target._syncing = false;
			}
		}
	}

	function renderChart(canvasId, config) {
		const canvas = document.getElementById(canvasId);
		if (!canvas) return;
		if (chartInstances[canvasId]) {
			chartInstances[canvasId].destroy();
			delete chartInstances[canvasId];
		}
		chartInstances[canvasId] = new Chart(canvas.getContext("2d"), config);

		// Clear synced charts when mouse leaves this canvas
		canvas.addEventListener("mouseleave", () => {
			clearSyncedCharts(canvasId);
		});
	}

	function destroyAllCharts() {
		for (const id in chartInstances) {
			if (chartInstances[id]) {
				chartInstances[id].destroy();
			}
		}
		chartInstances = {};
	}

	function renderAllCharts() {
		destroyAllCharts();
		if (!timeSeriesData || timeSeriesData.length === 0) return;

		const useMag = $magnitudeMode;
		const rmsLabel = useMag ? "Magnitude" : "RMS (g)";
		const processed = processedLeft;
		const devices = chartDevices;
		if (devices.length === 0) return;

		const leftGaps = showMissingData ? findGaps(processed) : [];

		if (!compareMode) {
			renderChart("chart-temp", buildChartConfig(processed, "temp", "Temperature (\u00B0C)", devices, chartColors, "chart-temp", leftGaps));
			renderChart("chart-humid", buildChartConfig(processed, "humid", "Humidity (%)", devices, chartColors, "chart-humid", leftGaps));
			renderChart("chart-rms", buildChartConfig(processed, "rms", rmsLabel, devices, chartColors, "chart-rms", leftGaps));
		} else {
			// Compare mode: grouped by metric, left and right side by side
			renderChart("chart-left-temp", buildChartConfig(processed, "temp", "Temperature (\u00B0C)", devices, chartColors, "chart-left-temp", leftGaps));
			renderChart("chart-left-humid", buildChartConfig(processed, "humid", "Humidity (%)", devices, chartColors, "chart-left-humid", leftGaps));
			renderChart("chart-left-rms", buildChartConfig(processed, "rms", rmsLabel, devices, chartColors, "chart-left-rms", leftGaps));

			if (rightTimeSeriesData && rightTimeSeriesData.length > 0) {
				const rightDevices = Object.keys(processedRight);
				const rGaps = showMissingData ? findGaps(processedRight) : [];
				renderChart("chart-right-temp", buildChartConfig(processedRight, "temp", "Temperature (\u00B0C)", rightDevices, chartColors, "chart-right-temp", rGaps));
				renderChart("chart-right-humid", buildChartConfig(processedRight, "humid", "Humidity (%)", rightDevices, chartColors, "chart-right-humid", rGaps));
				renderChart("chart-right-rms", buildChartConfig(processedRight, "rms", rmsLabel, rightDevices, chartColors, "chart-right-rms", rGaps));
			}
		}
	}

	function scheduleChartRender() {
		clearTimeout(chartRenderTimer);
		chartRenderTimer = setTimeout(async () => {
			await tick();
			renderAllCharts();
		}, 100);
	}

	// ── Data fetching ──────────────────────────────────────────────
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

		const [summaryResponse, earthquakeResponse] = await Promise.all([fetch(`/api/questdb?query=${encodeURIComponent(summaryQuery)}`), fetch(`/api/questdb?query=${encodeURIComponent(earthquakeQuery)}`)]);

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
			const [summary, ts] = await Promise.all([fetchAnalyticsForFilter(selectedFilter, customStartDate, customStartTime, customEndDate, customEndTime), fetchTimeSeriesForFilter(selectedFilter, customStartDate, customStartTime, customEndDate, customEndTime)]);
			analyticsData = summary;
			timeSeriesData = ts;
		} catch (error) {
			console.error("Error fetching analytics:", error);
			analyticsData = [];
			timeSeriesData = [];
		} finally {
			loading = false;
		}
	}

	async function fetchRightAnalytics() {
		rightLoading = true;
		try {
			const [summary, ts] = await Promise.all([fetchAnalyticsForFilter(rightFilter, rightCustomStartDate, rightCustomStartTime, rightCustomEndDate, rightCustomEndTime), fetchTimeSeriesForFilter(rightFilter, rightCustomStartDate, rightCustomStartTime, rightCustomEndDate, rightCustomEndTime)]);
			rightAnalyticsData = summary;
			rightTimeSeriesData = ts;
		} catch (error) {
			console.error("Error fetching right analytics:", error);
			rightAnalyticsData = [];
			rightTimeSeriesData = [];
		} finally {
			rightLoading = false;
		}
	}

	// ── UI event handlers ──────────────────────────────────────────
	function handleFilterChange() {
		fetchAnalytics();
	}

	function handleRightFilterChange() {
		fetchRightAnalytics();
	}

	function toggleCompareMode() {
		animating = true;
		compareMode = !compareMode;
		if (compareMode) {
			fetchRightAnalytics();
		} else {
			rightAnalyticsData = null;
			rightTimeSeriesData = null;
		}
		setTimeout(() => {
			animating = false;
		}, 300);
	}

	function exitCompareMode() {
		animating = true;
		compareMode = false;
		rightAnalyticsData = null;
		rightTimeSeriesData = null;
		setTimeout(() => {
			animating = false;
		}, 300);
	}

	// ── Export functions ────────────────────────────────────────────
	async function downloadPNG() {
		if (!summaryRef) return;

		try {
			const bgColor = getComputedStyle(document.documentElement).getPropertyValue("--bg-primary").trim() || "#fafafa";
			const canvas = await html2canvas(summaryRef, {
				backgroundColor: bgColor,
				scale: 2,
				useCORS: true,
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

			const rawQuery = `SELECT ${deviceCol}, ts, temp, humid, rms FROM ${tableName} WHERE 1=1 ${timeCondition} ORDER BY ts DESC`;

			const response = await fetch(`/api/questdb?query=${encodeURIComponent(rawQuery)}`);

			if (response.ok) {
				const result = await response.json();
				if (result.dataset && result.dataset.length > 0) {
					let csv = "Device,Timestamp,Temperature,Humidity,RMS\n";
					result.dataset.forEach((row) => {
						csv += `${row[0]},${row[1]},${row[2]},${row[3]},${row[4]}\n`;
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

			rows.push(["Device", "Metric", getFilterLabel(selectedFilter), getFilterLabel(rightFilter)]);

			const metricRows = [
				["Min Temp (\u00B0C)", "minTemp"],
				["Max Temp (\u00B0C)", "maxTemp"],
				["Avg Temp (\u00B0C)", "avgTemp"],
				["Min Humid (%)", "minHumid"],
				["Max Humid (%)", "maxHumid"],
				["Avg Humid (%)", "avgHumid"],
				["Max Magnitude (g)", "maxRms"],
				["Total Records", "totalRecords"],
				["First Record", "firstRecord"],
				["Last Record", "lastRecord"],
			];

			for (const device of analyticsData) {
				const rightDevice = getRightDeviceData(device.device);
				for (let i = 0; i < metricRows.length; i++) {
					const [label, key] = metricRows[i];
					const leftVal = key === "totalRecords" ? device[key]?.toLocaleString() : device[key];
					const rightVal = rightDevice ? (key === "totalRecords" ? rightDevice[key]?.toLocaleString() : rightDevice[key]) : "No Data";
					rows.push([i === 0 ? device.device : "", label, leftVal, rightVal]);
				}
				rows.push([]);
			}

			const ws = XLSX.utils.aoa_to_sheet(rows);
			ws["!cols"] = [{ wch: 16 }, { wch: 20 }, { wch: 18 }, { wch: 18 }];

			const wb = XLSX.utils.book_new();
			XLSX.utils.book_append_sheet(wb, ws, "Compare");

			// Add time series data as additional sheets
			if (timeSeriesData && timeSeriesData.length > 0) {
				const tsRows = [["Timestamp", "Device", "Temperature (\u00B0C)", "Humidity (%)", "RMS (g)"]];
				for (const point of timeSeriesData) {
					tsRows.push([new Date(point.ts).toLocaleString(), point.device, point.temp, point.humid, point.rms]);
				}
				const tsSheet = XLSX.utils.aoa_to_sheet(tsRows);
				tsSheet["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 12 }];
				XLSX.utils.book_append_sheet(wb, tsSheet, getFilterLabel(selectedFilter));
			}

			if (rightTimeSeriesData && rightTimeSeriesData.length > 0) {
				const rtsRows = [["Timestamp", "Device", "Temperature (\u00B0C)", "Humidity (%)", "RMS (g)"]];
				for (const point of rightTimeSeriesData) {
					rtsRows.push([new Date(point.ts).toLocaleString(), point.device, point.temp, point.humid, point.rms]);
				}
				const rtsSheet = XLSX.utils.aoa_to_sheet(rtsRows);
				rtsSheet["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 12 }];
				XLSX.utils.book_append_sheet(wb, rtsSheet, getFilterLabel(rightFilter));
			}

			XLSX.writeFile(wb, `envirosync-compare-${selectedFilter}-vs-${rightFilter}-${Date.now()}.xlsx`);
		} catch (error) {
			console.error("Error generating XLSX:", error);
			alert("Failed to generate XLSX. Please try again.");
		}
	}

	// ── Lifecycle ──────────────────────────────────────────────────
	onMount(() => {
		try {
			const stored = localStorage.getItem("magnitudeMode");
			if (stored !== null) {
				magnitudeMode.set(JSON.parse(stored));
			}
		} catch (e) {}

		fetchAnalytics();

		return () => {
			clearTimeout(chartRenderTimer);
			destroyAllCharts();
		};
	});
</script>

<div class="dashboard-header">
	<div>
		<h1 class="dashboard-title">Analytics</h1>
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

		<div class="mode-buttons">
			<button
				class="mode-btn"
				class:active={showMissingData}
				on:click={() => {
					showMissingData = !showMissingData;
				}}
			>
				<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
					<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
				</svg>
				{showMissingData ? "Hide Missing Data" : "Show Missing Data"}
			</button>

			{#if !compareMode}
				<button class="mode-btn" on:click={toggleCompareMode}>
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
	<div bind:this={summaryRef}>
		<div class="analytics-content" class:compare-mode={compareMode} class:mode-transition={animating}>
			{#if !compareMode}
				<!-- Normal mode: device cards -->
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
									<span class="stat-label">{$magnitudeMode ? "Max Magnitude:" : "Max RMS:"}</span>
									<span class="stat-value small">{$magnitudeMode ? rmsToMagnitude(parseFloat(device.maxRms)).toFixed(1) + " Mag" : device.maxRms + "g"}</span>
								</div>
							</div>
						</div>
					</div>
				{/each}
			{:else}
				<!-- Compare mode: table format -->
				{#each analyticsData as device}
					{@const rightDevice = rightAnalyticsData?.find((d) => d.device === device.device) ?? null}
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
										<td class="value-cell">{rightDevice ? rightDevice.minTemp : "No Data"}</td>
									</tr>
									<tr>
										<td class="metric-cell">Max Temp (&deg;C)</td>
										<td class="value-cell">{device.maxTemp}</td>
										<td class="value-cell">{rightDevice ? rightDevice.maxTemp : "No Data"}</td>
									</tr>
									<tr>
										<td class="metric-cell">Avg Temp (&deg;C)</td>
										<td class="value-cell">{device.avgTemp}</td>
										<td class="value-cell">{rightDevice ? rightDevice.avgTemp : "No Data"}</td>
									</tr>
									<tr class="section-separator">
										<td class="metric-cell">Min Humid (%)</td>
										<td class="value-cell">{device.minHumid}</td>
										<td class="value-cell">{rightDevice ? rightDevice.minHumid : "No Data"}</td>
									</tr>
									<tr>
										<td class="metric-cell">Max Humid (%)</td>
										<td class="value-cell">{device.maxHumid}</td>
										<td class="value-cell">{rightDevice ? rightDevice.maxHumid : "No Data"}</td>
									</tr>
									<tr>
										<td class="metric-cell">Avg Humid (%)</td>
										<td class="value-cell">{device.avgHumid}</td>
										<td class="value-cell">{rightDevice ? rightDevice.avgHumid : "No Data"}</td>
									</tr>
									<tr class="section-separator">
										<td class="metric-cell">{$magnitudeMode ? "Max Magnitude" : "Max RMS (g)"}</td>
										<td class="value-cell">{$magnitudeMode ? rmsToMagnitude(parseFloat(device.maxRms)).toFixed(1) + " Mag" : device.maxRms + "g"}</td>
										<td class="value-cell">{rightDevice ? ($magnitudeMode ? rmsToMagnitude(parseFloat(rightDevice.maxRms)).toFixed(1) + " Mag" : rightDevice.maxRms + "g") : "No Data"}</td>
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

		<!-- Charts section -->
		{#if timeSeriesData && timeSeriesData.length > 0}
			<div class="charts-section">
				{#if !compareMode}
					<div class="chart-box">
						<div class="chart-canvas-wrapper">
							<canvas id="chart-temp"></canvas>
						</div>
					</div>
					<div class="chart-box">
						<div class="chart-canvas-wrapper">
							<canvas id="chart-humid"></canvas>
						</div>
					</div>
					<div class="chart-box">
						<div class="chart-canvas-wrapper">
							<canvas id="chart-rms"></canvas>
						</div>
					</div>
				{:else}
					<!-- Compare: grouped by metric -->
					<div class="compare-metric-group">
						<h3 class="compare-metric-title">Temperature (&deg;C)</h3>
						<div class="compare-charts-row">
							<div class="compare-chart-col">
								<span class="compare-chart-label">{getFilterLabel(selectedFilter)}</span>
								<div class="chart-box"><div class="chart-canvas-wrapper"><canvas id="chart-left-temp"></canvas></div></div>
							</div>
							<div class="compare-chart-col">
								<span class="compare-chart-label">{getFilterLabel(rightFilter)}</span>
								{#if rightLoading}
									<div class="chart-loading">
										<div class="spinner-small"></div>
										<p>Loading...</p>
									</div>
								{:else}
									<div class="chart-box"><div class="chart-canvas-wrapper"><canvas id="chart-right-temp"></canvas></div></div>
								{/if}
							</div>
						</div>
					</div>

					<div class="compare-metric-group">
						<h3 class="compare-metric-title">Humidity (%)</h3>
						<div class="compare-charts-row">
							<div class="compare-chart-col">
								<span class="compare-chart-label">{getFilterLabel(selectedFilter)}</span>
								<div class="chart-box"><div class="chart-canvas-wrapper"><canvas id="chart-left-humid"></canvas></div></div>
							</div>
							<div class="compare-chart-col">
								<span class="compare-chart-label">{getFilterLabel(rightFilter)}</span>
								{#if rightLoading}
									<div class="chart-loading">
										<div class="spinner-small"></div>
										<p>Loading...</p>
									</div>
								{:else}
									<div class="chart-box"><div class="chart-canvas-wrapper"><canvas id="chart-right-humid"></canvas></div></div>
								{/if}
							</div>
						</div>
					</div>

					<div class="compare-metric-group">
						<h3 class="compare-metric-title">{$magnitudeMode ? "Magnitude" : "RMS (g)"}</h3>
						<div class="compare-charts-row">
							<div class="compare-chart-col">
								<span class="compare-chart-label">{getFilterLabel(selectedFilter)}</span>
								<div class="chart-box"><div class="chart-canvas-wrapper"><canvas id="chart-left-rms"></canvas></div></div>
							</div>
							<div class="compare-chart-col">
								<span class="compare-chart-label">{getFilterLabel(rightFilter)}</span>
								{#if rightLoading}
									<div class="chart-loading">
										<div class="spinner-small"></div>
										<p>Loading...</p>
									</div>
								{:else}
									<div class="chart-box"><div class="chart-canvas-wrapper"><canvas id="chart-right-rms"></canvas></div></div>
								{/if}
							</div>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{:else}
	<div class="no-data">
		<p>No data available for the selected time range.</p>
	</div>
{/if}

<style>
	/* ── Controls ─────────────────────────────────────────────── */
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
		color: var(--text-secondary);
		font-weight: 500;
		min-width: 40px;
	}

	.filter-group select {
		padding: 0.5rem 1rem;
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		color: var(--text-primary);
		border-radius: 6px;
		font-size: 1rem;
		cursor: pointer;
	}

	.filter-group select option {
		background: var(--bg-card);
		color: var(--text-primary);
	}

	.filter-group select:focus {
		outline: none;
		border-color: var(--text-muted);
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
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		color: var(--text-primary);
		border-radius: 6px;
		font-size: 0.9rem;
	}

	.custom-date-inputs input:focus {
		outline: none;
		border-color: var(--text-muted);
	}

	.custom-date-inputs span {
		color: var(--text-muted);
	}

	.apply-btn {
		padding: 0.5rem 1rem;
		background: var(--text-primary);
		border: none;
		color: var(--bg-primary);
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.9rem;
		transition: all 0.2s ease;
	}

	.apply-btn:hover {
		opacity: 0.85;
	}

	/* ── Mode buttons row ──────────────────────────────────────── */
	.mode-buttons {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.mode-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: var(--bg-overlay);
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.9rem;
		transition: all 0.2s ease;
		font-family: inherit;
	}

	.mode-btn:hover {
		border-color: var(--text-muted);
		color: var(--text-primary);
	}

	.mode-btn.active {
		background: var(--text-primary);
		color: var(--bg-primary);
		border-color: var(--text-primary);
	}

	.mode-btn svg {
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
		background: var(--bg-hover);
		border: 1px solid var(--border-color);
		border-radius: 50%;
		cursor: pointer;
		transition: all 0.2s ease;
		padding: 0;
		flex-shrink: 0;
	}

	.close-compare-btn:hover {
		background: var(--bg-overlay);
		border-color: var(--text-muted);
	}

	.close-x {
		color: var(--text-muted);
		font-size: 1.2rem;
		line-height: 1;
		font-weight: 300;
		transition: color 0.2s ease;
	}

	.close-compare-btn:hover .close-x {
		color: var(--text-primary);
	}

	/* ── Export buttons ─────────────────────────────────────────── */
	.export-buttons {
		display: flex;
		gap: 0.5rem;
	}

	.export-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: var(--bg-overlay);
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.9rem;
		transition: all 0.2s ease;
		font-family: inherit;
	}

	.export-btn:hover:not(:disabled) {
		border-color: var(--text-muted);
		color: var(--text-primary);
	}

	.export-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.export-btn svg {
		width: 20px;
		height: 20px;
	}

	/* ── Loading ────────────────────────────────────────────────── */
	.loading-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem;
		color: var(--text-muted);
	}

	.spinner {
		border: 4px solid var(--border-color);
		border-top: 4px solid var(--text-primary);
		border-radius: 50%;
		width: 50px;
		height: 50px;
		animation: spin 1s linear infinite;
		margin-bottom: 1rem;
	}

	.spinner-small {
		border: 3px solid var(--border-color);
		border-top: 3px solid var(--text-primary);
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

	/* ── Analytics content (summary cards / tables) ─────────────── */
	.analytics-content {
		background: var(--bg-overlay);
		border-radius: 12px;
		padding: 1.5rem;
		border: 1px solid var(--border-color);
		transition: all 0.3s ease;
	}

	.analytics-content.compare-mode {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1rem;
		padding: 1rem;
	}

	.device-analytics-card {
		background: var(--bg-card);
		border-radius: 8px;
		padding: 1rem;
		margin-bottom: 1rem;
		border: 1px solid var(--border-color);
	}

	.device-analytics-card:last-child {
		margin-bottom: 0;
	}

	.analytics-content.compare-mode .device-analytics-card {
		margin-bottom: 0;
	}

	.device-analytics-card h3 {
		color: var(--text-primary);
		margin-bottom: 1rem;
		font-size: 1.3rem;
	}

	.compare-card h3 {
		font-size: 1.1rem;
		margin-bottom: 0.75rem;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
	}

	@media (max-width: 900px) {
		.stats-grid {
			grid-template-columns: 1fr;
		}
	}

	/* ── Compare table ──────────────────────────────────────────── */
	.compare-table-wrapper {
		position: relative;
	}

	.compare-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}

	.compare-table thead tr {
		border-bottom: 2px solid var(--border-color);
	}

	.compare-table th {
		padding: 0.6rem 0.75rem;
		text-align: left;
		color: var(--text-primary);
		font-weight: 600;
		font-size: 0.85rem;
	}

	.compare-table th.value-col {
		text-align: right;
	}

	.compare-table td {
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--bg-hover);
	}

	.compare-table tbody tr:last-child td {
		border-bottom: none;
	}

	.compare-table tr.section-separator td {
		border-top: 1px solid var(--border-color);
	}

	.metric-cell {
		color: var(--text-muted);
		font-weight: 500;
	}

	.value-cell {
		color: var(--text-primary);
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
		background: var(--bg-overlay);
		border-radius: 8px;
	}

	/* ── Stat groups ────────────────────────────────────────────── */
	.stat-group {
		background: var(--bg-overlay);
		padding: 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--border-color);
	}

	.stat-group h4 {
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
		font-size: 0.95rem;
		text-align: center;
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.35rem 0;
		border-bottom: 1px solid var(--bg-hover);
	}

	.stat-row:last-child {
		border-bottom: none;
	}

	.stat-label {
		color: var(--text-muted);
		font-size: 0.9rem;
	}

	.stat-value {
		color: var(--text-primary);
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
		color: var(--text-muted);
		font-size: 1.2rem;
	}

	/* ── Charts section ─────────────────────────────────────────── */
	.charts-section {
		margin-top: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.chart-box {
		background: var(--bg-overlay);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 1.5rem;
	}

	.chart-canvas-wrapper {
		position: relative;
		height: 300px;
	}

	.chart-canvas-wrapper canvas {
		width: 100% !important;
		height: 100% !important;
	}

	/* Compare charts grouped by metric */
	.compare-metric-group {
		background: var(--bg-overlay);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 1.5rem;
	}

	.compare-metric-title {
		color: var(--text-primary);
		font-size: 1.25rem;
		font-weight: 600;
		margin-bottom: 1rem;
	}

	.compare-charts-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	.compare-chart-col {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.compare-chart-label {
		color: var(--text-secondary);
		font-size: 0.9rem;
		font-weight: 500;
		text-align: center;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border-color);
	}

	.compare-chart-col .chart-box {
		background: transparent;
		border: none;
		padding: 0;
	}

	.chart-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 1rem;
		color: var(--text-muted);
		gap: 1rem;
	}

	.chart-loading p {
		font-size: 0.9rem;
	}

	/* ── Responsive ─────────────────────────────────────────────── */
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

		.compare-charts-row {
			grid-template-columns: 1fr;
		}

		.mode-buttons {
			flex-direction: column;
			align-items: stretch;
		}

		.mode-btn {
			justify-content: center;
		}
	}

	@media (max-width: 1200px) {
		.analytics-content.compare-mode {
			grid-template-columns: 1fr;
		}

		.compare-charts-row {
			grid-template-columns: 1fr;
		}
	}
</style>
