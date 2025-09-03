<script>
	import { onMount } from "svelte";

	let currentDate = new Date();
	let dateNumber = "";
	let monthName = "";
	let timeDisplay = "";

	function updateDateTime() {
		currentDate = new Date();
		dateNumber = currentDate.getDate().toString();
		monthName = currentDate.toLocaleString("default", { month: "long" }).toUpperCase();
		timeDisplay = currentDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}

	onMount(() => {
		updateDateTime();
		const interval = setInterval(updateDateTime, 1000);

		return () => clearInterval(interval);
	});
</script>

<div class="date-time-display">
	<div class="month-name">{monthName}</div>
	<div class="date-number">{dateNumber}</div>
	<div class="time-display">{timeDisplay}</div>
</div>

<style>
	.date-time-display {
		background: rgba(0, 0, 0, 0.3);
		border-radius: 8px;
		padding: 1rem;
		border: 1px solid rgba(74, 144, 226, 0.2);
		text-align: center;
		transition: all 0.3s ease;
		height: fit-content;
	}

	.date-time-display:hover {
		border-color: #4a90e2;
		transform: translateY(-2px);
		box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
	}

	.month-name {
		font-size: 1.1rem;
		color: #b0b0b0;
		font-weight: 500;
		margin-bottom: 0.2rem;
	}

	.date-number {
		font-size: 4rem;
		font-weight: bold;
		color: #fff;
		line-height: 1;
		margin-bottom: 0.2rem;
	}

	.time-display {
		font-size: 1.1rem;
		color: #888;
	}
</style>
