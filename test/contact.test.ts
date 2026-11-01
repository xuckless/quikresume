import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/contact/normalize";

describe("normalizePhone", () => {
    it("formats North American numbers", () => {
        expect(normalizePhone("416.555.0100").value).toBe("(416) 555-0100");
        expect(normalizePhone("+1 416 555 0100 ext 12").value).toBe("(416) 555-0100 x12");
    });
    it("keeps national numbers from elsewhere with a note, not a warning", () => {
        const uk = normalizePhone("07700 900123");
        expect(uk).toMatchObject({ value: "07700 900123", level: "note" });
        expect(normalizePhone("+44 7700 900123").level).toBe("note");
    });
    it("warns on junk", () => {
        expect(normalizePhone("call me").level).toBe("warning");
    });
});
