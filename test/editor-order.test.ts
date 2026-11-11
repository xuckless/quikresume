import { describe, expect, it } from "vitest";
import { orderedItems, orderedItemsPinned, pinBeforeEdit } from "@/lib/layout/order";
import { defaultLayout } from "@/lib/layout/presets";
import type { ResumeData } from "@/types/schema";

type Work = ResumeData["workExperience"][number];
const job = (id: string, startDate: string, endDate: string): Work => ({ id, position: id, company: "Co", startDate, endDate, description: "" } as unknown as Work);
const layout = defaultLayout();

describe("editor order while dates are edited", () => {
    const a = job("a", "2022-01-01", "2023-01-01");
    const b = job("b", "2020-01-01", "2021-01-01");
    it("keeps the edited row in place until it settles, while the real order moves", () => {
        const pin = pinBeforeEdit(b, { startDate: "2024-01-01" })!;
        const edited = { ...b, startDate: "2024-01-01", endDate: "2025-01-01" };
        expect(orderedItems("workExperience", [a, edited], layout).map(x => x.id)).toEqual(["b", "a"]);
        const shown = orderedItemsPinned("workExperience", [a, edited], layout, { b: pin });
        expect(shown.map(x => x.id)).toEqual(["a", "b"]);
        expect(shown[1]).toBe(edited);
        expect(orderedItemsPinned("workExperience", [a, edited], layout, {}).map(x => x.id)).toEqual(["b", "a"]);
    });
    it("pins only when a date field changes", () => {
        expect(pinBeforeEdit(a, { position: "x" })).toBeNull();
        expect(pinBeforeEdit(a, { endDate: "Present" })).toMatchObject({ startDate: "2022-01-01", endDate: "2023-01-01" });
    });
    it("leaves a manual order alone", () => {
        const manual = { ...layout, itemOrder: { ...layout.itemOrder, workExperience: ["b", "a"] } };
        expect(orderedItemsPinned("workExperience", [a, b], manual, { a: pinBeforeEdit(a, { startDate: "x" })! }).map(x => x.id)).toEqual(["b", "a"]);
    });
});
