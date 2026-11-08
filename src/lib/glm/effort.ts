// src/lib/glm/effort.ts
// Reasoning effort per task. glm-5.3(-flash) accepts only low | high | max (no "medium": the API
// answers "please use low, high, or max"). Reasoning tokens count toward `max_tokens`, so higher
// effort needs a much larger output limit or the JSON reply gets cut off.
//
// Background work (Job Match reconcile, coach review) can afford more thinking than interactive
// calls, but the user watches the Job Match score while reconcile runs: at "max" one pass took
// ~65 s for ~3.5K output tokens, so it runs at "high". `GLM_EFFORT_RECONCILE` / `GLM_EFFORT_REVIEW` / `GLM_EFFORT_TAILOR` override the defaults
// (handy for A/B testing on a deployment without a code change).

import "server-only";

export type Effort = "low" | "high" | "max";
export type EffortTask = "reconcile" | "review" | "tailor";

export const AI_EFFORT: Record<EffortTask, Effort> = {
    reconcile: "high",
    review: "high",
    tailor: "high",
};

const ENV: Record<EffortTask, string> = {
    reconcile: "GLM_EFFORT_RECONCILE",
    review: "GLM_EFFORT_REVIEW",
    tailor: "GLM_EFFORT_TAILOR",
};

export const isEffort = (v: unknown): v is Effort => v === "low" || v === "high" || v === "max";

export function effortFor(task: EffortTask): Effort {
    const override = process.env[ENV[task]]?.trim().toLowerCase();
    return isEffort(override) ? override : AI_EFFORT[task];
}

/** Output limit that leaves room for the reasoning tokens; `lowTokens` is the call's own limit at low effort. */
export function maxTokensFor(effort: Effort, lowTokens: number): number {
    return effort === "max" ? 64_000 : effort === "high" ? 32_000 : lowTokens;
}
