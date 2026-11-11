import { describe, expect, it } from "vitest";
import { currentFileIndex, importReducer as reduce, initialImportState, MAX_FILES, type ImportState } from "@/lib/import/import-flow";
import { emptyResumeData } from "@/types/schema";

const file = (name: string, size = 100) => ({ name, size }) as File;
const parsed = (fileName: string) => ({ fileName, data: emptyResumeData(), warnings: [] });

describe("import flow", () => {
    it("dedupes files, caps the count and refuses an empty run", () => {
        expect(reduce(initialImportState, { type: "start", run: "r" })).toBe(initialImportState);
        const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => file(`f${i}.pdf`));
        const picked = reduce(initialImportState, { type: "add", files: [file("a.pdf"), file("a.pdf"), ...many] });
        expect(picked.step === "pick" && picked.queue.length).toBe(MAX_FILES);
        expect(picked.step === "pick" && picked.error).toMatch(/Only 6 files/);
    });

    it("works through files one at a time and ignores results from another run or file", () => {
        let s: ImportState = reduce(reduce(initialImportState, { type: "add", files: [file("a.pdf"), file("b.pdf")] }), { type: "start", run: "r" });
        expect(currentFileIndex(s)).toBe(0);
        s = reduce(s, { type: "file-status", run: "r", index: 0, status: "reading" });
        expect(currentFileIndex(s)).toBe(0);
        expect(reduce(s, { type: "file-done", run: "old", index: 0, parsed: parsed("a") })).toBe(s);
        expect(reduce(s, { type: "file-done", run: "r", index: 1, parsed: parsed("b") })).toBe(s);
        s = reduce(s, { type: "file-failed", run: "r", index: 0, error: "Offline" });
        expect(currentFileIndex(s)).toBe(1);
        s = reduce(s, { type: "file-done", run: "r", index: 1, parsed: parsed("b") });
        expect(s.step === "review" && s.result.fileNames).toEqual(["b"]);
    });

    it("goes back to pick with the per-file errors when nothing could be read", () => {
        let s: ImportState = reduce(reduce(initialImportState, { type: "add", files: [file("a.pdf")] }), { type: "start", run: "r" });
        s = reduce(s, { type: "file-failed", run: "r", index: 0, error: "Offline" });
        expect(s.step).toBe("pick");
        expect(s.step === "pick" && s.queue[0]).toMatchObject({ status: "failed", error: "Offline" });
    });

    it("opens the same review for a LinkedIn profile, only from pick", () => {
        const linkedin = reduce(initialImportState, { type: "linkedin", file: parsed("LinkedIn profile") });
        expect(linkedin.step === "review" && linkedin.result.fileNames).toEqual(["LinkedIn profile"]);
        expect(reduce(linkedin, { type: "linkedin", file: parsed("again") })).toBe(linkedin);
        expect(reduce(linkedin, { type: "restart" })).toBe(initialImportState);
    });
});
