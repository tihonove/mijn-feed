import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        coverage: {
            skipFull: true,
            reportOnFailure: true,
            provider: "v8",
            // Ratchet: autoUpdate raises the numbers after each coverage run; they never go down by hand.
            thresholds: {
                autoUpdate: true,
                statements: 96.35,
                branches: 88.73,
                functions: 94.24,
                lines: 97.93,
            },
            reporter: ["text", "lcov", "json-summary", "text-summary"],
            include: ["src/**/*.ts", "src/**/*.tsx"],
            exclude: [
                "src/**/*.test.ts",
                "src/**/*.test.tsx",
                "src/**/*.d.ts",
                "src/shared/**/types.ts", // type-only contracts
                "src/server/main.ts", // composition root: env + DI wiring, covered by a live run
                "src/app/main.tsx", // browser entry point
            ],
        },
    },
});
