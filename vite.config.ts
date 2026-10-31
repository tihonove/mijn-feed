import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The React app lives in src/app; the server serves dist/app in production.
export default defineConfig({
    root: "src/app",
    plugins: [react()],
    build: { outDir: "../../dist/app", emptyOutDir: true },
    server: {
        port: 5173,
        proxy: { "/v1": "http://localhost:3000", "/auth": "http://localhost:3000", "/media": "http://localhost:3000" },
    },
});
