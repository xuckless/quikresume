import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every vendored font (Inter, IBM Plex Sans / Serif, Libertinus Serif) has these. Anything else
// (e.g. U+25B8 "▸", which none has) must be drawn, not typed: the preview compiles with vendored
// fonts only, so a missing glyph prints as an empty box.
const SAFE = new Set(["•", "·", "—", "–"]);

const root = join(__dirname, "..", "public", "typst");
const files = [join(root, "main.typ"), join(root, "lib", "theme.typ"), ...readdirSync(join(root, "templates")).map((f) => join(root, "templates", f))];

describe("typst sources", () => {
    it("only use non-ASCII characters every vendored font contains", () => {
        for (const file of files) {
            const code = readFileSync(file, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).map((l) => l.replace(/\s\/\/.*$/, ""));
            const bad = new Set<string>();
            for (const ch of code.join("\n")) if (ch.charCodeAt(0) > 127 && !SAFE.has(ch)) bad.add(ch);
            expect({ file, bad: [...bad] }).toEqual({ file, bad: [] });
        }
    });
});
