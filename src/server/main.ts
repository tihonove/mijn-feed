// Composition root: env → config → container → listen.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { Container } from "./di/container.ts";
import { HttpServerDIToken } from "./http/server.ts";
import { appModule } from "./modules.ts";

if (existsSync(".env")) process.loadEnvFile(".env");

const env = (name: string, dflt = ""): string => process.env[name] ?? dflt;
const dataDir = resolve(env("DATA_DIR", "./data"));
const port = Number(env("PORT", "3000"));
const appDir = resolve("dist/app");

const container = new Container().use(appModule, {
    dbPath: resolve(dataDir, "feed.db"),
    mediaDir: resolve(dataDir, "media"),
    appDir: existsSync(appDir) ? appDir : null,
    auth: {
        ownerEmails: env("OWNER_EMAILS")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        producerToken: env("PRODUCER_TOKEN") || null,
        googleClientId: env("GOOGLE_CLIENT_ID") || null,
        googleClientSecret: env("GOOGLE_CLIENT_SECRET") || null,
        devLogin: env("DEV_LOGIN") === "1",
        publicOrigin: env("PUBLIC_ORIGIN") || null,
        secureCookies: env("SECURE_COOKIES", env("PUBLIC_ORIGIN").startsWith("https") ? "1" : "0") === "1",
    },
});

const server = container.get(HttpServerDIToken);
await server.listen(port);
console.log(
    `mijn-feed listening on http://localhost:${port} (data: ${dataDir}, app: ${existsSync(appDir) ? appDir : "vite dev"})`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
        void server.close().then(() => process.exit(0));
    });
}
