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
                statements: 96.5,
                branches: 89.35,
                functions: 94.55,
                lines: 98.06,
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
