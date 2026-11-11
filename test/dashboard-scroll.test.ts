import { expect, it } from "vitest";
import { startsAtTop } from "@/lib/ui/use-dashboard-view";

it("starts at the top when the view or job changes, not on replace or the same URL", () => {
    const here = "http://x/dashboard?view=editor";
    expect(startsAtTop(here, "/dashboard", false)).toBe(true);
    expect(startsAtTop(here, "/dashboard?view=jobs&job=a", false)).toBe(true);
    expect(startsAtTop(here, "/dashboard?view=editor", false)).toBe(false);
    expect(startsAtTop(here, "/dashboard", true)).toBe(false);
});
