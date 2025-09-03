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
