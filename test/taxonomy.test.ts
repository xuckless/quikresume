import { describe, expect, it } from "vitest";
import { categoryTitle, groupsOfName, taxonomySatisfiers } from "@/lib/match/taxonomy";

describe("O*NET taxonomy", () => {
    it("knows products by full and short name", () => {
        expect(groupsOfName("Epic").map(categoryTitle)).toContain("Medical software");
        expect(groupsOfName("Microsoft Excel").map(categoryTitle)).toContain("Spreadsheet software");
        expect(groupsOfName("Excel").map(categoryTitle)).toContain("Spreadsheet software");
        expect(groupsOfName("AutoCAD").map(categoryTitle)).toContain("Computer aided design CAD software");
    });
    it("satisfies a category with a product of that category only", () => {
        const medical = groupsOfName("Epic Systems");
        const inv = [{ name: "epic", display: "Epic" }, { name: "kubernetes", display: "Kubernetes" }];
        expect(taxonomySatisfiers(medical, inv)?.satisfiers).toEqual(["epic"]);
        expect(taxonomySatisfiers(groupsOfName("Intuit QuickBooks"), inv)).toBeNull();
    });
});
