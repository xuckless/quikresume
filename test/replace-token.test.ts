import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { tokenToReplace } from "@/lib/ext/replace-token";

const token = "qr_" + "A".repeat(43);
const id = createHash("sha256").update(token).digest("hex");

it("replaces the browser's own previous token", () => {
    expect(tokenToReplace(token, "u1", [{ id, uid: "u1" }, { id: "other", uid: "u1" }])).toBe(id);
});
it("never touches another user's token", () => {
    expect(tokenToReplace(token, "u1", [{ id, uid: "u2" }])).toBeNull();
});
it("ignores unknown, malformed or missing tokens", () => {
    expect(tokenToReplace(token, "u1", [])).toBeNull();
    expect(tokenToReplace("nope", "u1", [{ id, uid: "u1" }])).toBeNull();
    expect(tokenToReplace(undefined, "u1", [{ id, uid: "u1" }])).toBeNull();
    expect(tokenToReplace(42, "u1", [{ id, uid: "u1" }])).toBeNull();
});
