// src/lib/match/answered-skills.ts
// Pure: what a "Yes, I have it" answer in the skill questionnaire (/api/jobs/skill-answers) does to the
// skill category it lands in. The skills are appended (deduped by skill key) and the category ends up on
// the working selection with those skills shown: the job page scores the working selection, so a Yes put
// into a switched-off category (the AI picks among every category) or behind a hidden chip would still
// read as missing there.

import type { SkillCategory } from "@/types/schema";
import { skillEntries, skillKey } from "@/lib/sub-items";

export function withAnsweredSkills(category: SkillCategory, displays: string[]): SkillCategory {
    const entries = skillEntries(category.items);
    const have = new Set(entries.map(e => e.key));
    const added = displays.filter(d => { const k = skillKey(d); return k !== "" && !have.has(k) && !!have.add(k); });
    const answered = new Set(displays.map(skillKey));
    return {
        ...category,
        items: [...entries.map(e => e.label), ...added].join(", "),
        isSelected: true,
        hidden: (category.hidden ?? []).filter(k => !answered.has(k)),
    };
}
