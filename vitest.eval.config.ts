// Evals that call the real models (npm run eval:match); never part of `npm test`.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
            "server-only": path.resolve(__dirname, "test/server-only-stub.ts"),
        },
    },
    test: { include: ["test/eval/**/*.eval.ts"], environment: "node", testTimeout: 3_600_000, silent: false },
});
