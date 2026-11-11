// LinkedIn glyph in the icon set's own stroke style (lucide dropped its brand icons). Drawn with
// currentColor like every other icon, so it follows the tokens; no brand colour.
import { createLucideIcon } from "lucide-react";

export const Linkedin = createLucideIcon("linkedin", [
    ["path", { d: "M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z", key: "body" }],
    ["rect", { width: "4", height: "12", x: "2", y: "9", key: "stem" }],
    ["circle", { cx: "4", cy: "4", r: "2", key: "dot" }],
]);
