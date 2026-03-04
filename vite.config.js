import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [sveltekit()],
	build: {
		// Enable compression
		rollupOptions: {
			output: {
				manualChunks: (id) => {
					// Only apply manualChunks to client-side code
					if (id.includes("node_modules")) {
						if (id.includes("chart.js") || id.includes("chartjs-")) {
							return "charts";
						}
					}
				},
			},
		},
		// Enable source maps for better debugging
		sourcemap: true,
	},
	server: {
		// Enable compression in dev
		headers: {
			"Cache-Control": "public, max-age=3600",
		},
		// Allow network access (used with --host flag)
		host: true,
		// Fix HMR WebSocket so it works when accessed via network IP
		// The client will use the same host it loaded the page from
		hmr: {
			clientPort: 5173,
		},
	},
});
