import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The public landing page (cutroom's website), built separately from the app.
// The app's own vite.config.ts also starts the local processing service; the
// site needs none of that, so it gets its own config and its own port.
export default defineConfig({
	root: import.meta.dirname,
	plugins: [react(), tailwindcss()],
	resolve: {
		// Shares the app's design tokens and logo rather than copying them.
		alias: { "@": path.resolve(import.meta.dirname, "../src") },
	},
	server: { port: 3461, strictPort: true },
	build: { outDir: "dist", emptyOutDir: true },
});
