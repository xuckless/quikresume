import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
            // Pure modules only; anything importing "server-only" is out of scope for unit tests.
            "server-only": path.resolve(__dirname, "test/server-only-stub.ts"),
        },
    },
    test: { include: ["test/**/*.test.ts"], environment: "node" },
});
