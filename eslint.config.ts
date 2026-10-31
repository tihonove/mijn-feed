import eslint from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";

export default tseslint.config(
    { ignores: ["dist/", "node_modules/", "coverage/", "*.config.*", "src/app/public/"] },
    eslint.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: { allowDefaultProject: ["eslint.config.ts"] },
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: { "simple-import-sort": simpleImportSort },
        rules: {
            "simple-import-sort/imports": "error",
            "simple-import-sort/exports": "error",
            "@typescript-eslint/explicit-member-accessibility": "error",
            "@typescript-eslint/consistent-type-imports": "error",
            "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
        },
    },
    {
        files: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        rules: { "@typescript-eslint/no-non-null-assertion": "off", "@typescript-eslint/unbound-method": "off" },
    },
    eslintPluginPrettier,
);
