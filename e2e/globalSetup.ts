import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Builds the app and the server bundle once per run. Set E2E_SKIP_BUILD=1 to reuse an existing dist/. */
export default function globalSetup(): void {
    const root = resolve(import.meta.dirname, "..");
    if (process.env.E2E_SKIP_BUILD && existsSync(resolve(root, "dist/server/main.js"))) return;
    execSync("npm run build", { cwd: root, stdio: "inherit" });
}
