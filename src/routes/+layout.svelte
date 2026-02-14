<script>
	import { browser } from "$app/environment";
	import { page } from "$app/stores";
	import favicon from "$lib/assets/favicon.svg";
	import Sidebar from "$lib/components/Sidebar.svelte";
	import "../app.css";

	// Svelte 5 syntax for children
	let { children } = $props();

	let isLoginPage = $derived($page.url.pathname === "/login");

	if (browser) {
		console.log("EnviroSync app initialized");

		// Service worker registration - only register if available
		if ("serviceWorker" in navigator && import.meta.env.PROD) {
			navigator.serviceWorker
				.register("/service-worker.js")
				.then((registration) => {
					console.log("Service Worker registered successfully:", registration);
				})
				.catch((error) => {
					console.log("Service Worker registration failed:", error);
				});
		}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if isLoginPage}
	{@render children()}
{:else}
	<div class="app-container">
		<Sidebar />
		<main class="main-content">
			{@render children()}
		</main>
	</div>
{/if}
