"use client";

// Advanced layout mode controls. Every control is a preset (Compact / Normal /
// Relaxed) with a Custom option revealing exact values. All edits go into the
// draft's layout; the preview follows through toTypstDoc.

import React from "react";
import type { ResumeLayout, Preset, SectionId } from "@/lib/layout/types";
import {
    DEFAULT_PAGE, DEFAULT_SECTION_SPACING, ENTRY_SECTIONS, itemLayout, PAGE_PRESETS, RANGES, SECTION_PRESETS, sectionSpacing,
    type RangeKey,
    MAX_HEADING,
} from "@/lib/layout/presets";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives/card";
import { Segmented } from "@/components/ui/primitives/segmented";
import { RangeField } from "@/components/ui/primitives/range-field";
import { Checkbox, Input } from "@/components/ui/primitives/field";
import { Switch } from "@/components/ui/primitives/switch";
import { Button } from "@/components/ui/primitives/button";

export type LayoutUpdate = (fn: (layout: ResumeLayout) => ResumeLayout) => void;

const PRESET_OPTIONS: { value: Preset; label: string }[] = [
    { value: "compact", label: "Compact" },
    { value: "normal", label: "Normal" },
    { value: "relaxed", label: "Relaxed" },
    { value: "custom", label: "Custom" },
];

function Range({ id, k, value, onChange }: { id: string; k: RangeKey; value: number; onChange: (v: number) => void }) {
    const r = RANGES[k];
    return <RangeField id={id} label={r.label} value={value} min={r.min} max={r.max} step={r.step} unit={r.unit} onChange={onChange} />;
}

export function PageLayoutCard({ layout, onChange }: { layout: ResumeLayout; onChange: LayoutUpdate }) {
    const page = layout.page;
    const setPreset = (preset: Preset) =>
        onChange(l => ({ ...l, page: preset === "custom" ? { ...l.page, preset } : { preset, ...PAGE_PRESETS[preset] } }));
    const setValue = (k: "marginMm" | "fontPt" | "leadingEm", v: number) => onChange(l => ({ ...l, page: { ...l.page, preset: "custom", [k]: v } }));
    return (
        <Card>
            <CardHeader
                title="Page layout"
                hint="Applies to the whole résumé. Section spacing is on each section's header, item overrides inside each item."
                action={<Segmented value={page.preset} onChange={setPreset} options={PRESET_OPTIONS} />}
            />
            {page.preset === "custom" && (
                <CardBody className="grid gap-4 md:grid-cols-3">
                    <Range id="layout-page-margin" k="marginMm" value={page.marginMm} onChange={v => setValue("marginMm", v)} />
                    <Range id="layout-page-font" k="fontPt" value={page.fontPt} onChange={v => setValue("fontPt", v)} />
                    <Range id="layout-page-leading" k="leadingEm" value={page.leadingEm} onChange={v => setValue("leadingEm", v)} />
                    <div className="md:col-span-3">
                        <Button size="sm" variant="ghost" onClick={() => onChange(l => ({ ...l, page: { ...DEFAULT_PAGE } }))}>Reset to normal</Button>
                    </div>
                </CardBody>
            )}
        </Card>
    );
}

export function SectionLayoutControls({ layout, id, onChange }: { layout: ResumeLayout; id: SectionId; onChange: LayoutUpdate }) {
    const sp = sectionSpacing(layout, id);
    const setPreset = (preset: Preset) =>
        onChange(l => {
            const sections = { ...l.sections };
            if (preset === "normal") delete sections[id];
            else sections[id] = preset === "custom" ? { ...sectionSpacing(l, id), preset } : { preset, ...SECTION_PRESETS[preset] };
            return { ...l, sections };
        });
    const setValue = (k: "above" | "below" | "itemGap" | "indent", v: number) =>
        onChange(l => ({ ...l, sections: { ...l.sections, [id]: { ...sectionSpacing(l, id), preset: "custom", [k]: v } } }));
    const setHeading = (v: string) =>
        onChange(l => {
            const headings = { ...l.headings };
            const h = v.slice(0, MAX_HEADING);
            if (h.trim()) headings[id] = h;
            else delete headings[id];
            return { ...l, headings };
        });
    return (
        <div className="space-y-3 rounded-lg border border-border bg-surface-muted/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={`layout-${id}-heading`} className="text-13 font-medium text-fg-muted">Printed heading</label>
                <Input
                    id={`layout-${id}-heading`}
                    className="h-8 max-w-64 text-13"
                    maxLength={MAX_HEADING}
                    value={layout.headings[id] ?? ""}
                    placeholder="Template default"
                    onChange={e => setHeading(e.target.value)}
                />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-13 font-medium text-fg-muted">Section spacing</p>
                <Segmented value={sp.preset} onChange={setPreset} options={PRESET_OPTIONS} />
            </div>
            {sp.preset === "custom" && (
                <div className="grid gap-4 sm:grid-cols-2">
                    <Range id={`layout-${id}-above`} k="above" value={sp.above} onChange={v => setValue("above", v)} />
                    <Range id={`layout-${id}-below`} k="below" value={sp.below} onChange={v => setValue("below", v)} />
                    {ENTRY_SECTIONS.has(id) && <Range id={`layout-${id}-gap`} k="itemGap" value={sp.itemGap} onChange={v => setValue("itemGap", v)} />}
                    <Range id={`layout-${id}-indent`} k="indent" value={sp.indent} onChange={v => setValue("indent", v)} />
                    <div className="sm:col-span-2">
                        <Button size="sm" variant="ghost" onClick={() => setPreset("normal")} disabled={sp === DEFAULT_SECTION_SPACING}>Reset to normal</Button>
                    </div>
                </div>
            )}
        </div>
    );
}

export function ItemLayoutControls({ layout, id, onChange }: { layout: ResumeLayout; id: string; onChange: LayoutUpdate }) {
    const it = itemLayout(layout, id);
    const set = (patch: Partial<typeof it>) =>
        onChange(l => {
            const next = { ...itemLayout(l, id), ...patch };
            const items = { ...l.items };
            const stored: ResumeLayout["items"][string] = {};
            if (next.spaceAfter > 0) stored.spaceAfter = next.spaceAfter;
            if (next.breakBefore) stored.breakBefore = true;
            if (!next.keepTogether) stored.keepTogether = false;
            if (Object.keys(stored).length > 0) items[id] = stored; else delete items[id];
            return { ...l, items };
        });
    return (
        <div className="grid gap-4 rounded-lg border border-border bg-surface-muted/50 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <Range id={`layout-item-${id}-after`} k="spaceAfter" value={it.spaceAfter} onChange={v => set({ spaceAfter: v })} />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 md:h-9">
                <label className="flex cursor-pointer items-center gap-2 text-13 text-fg-muted">
                    <Checkbox checked={it.breakBefore} onChange={e => set({ breakBefore: e.target.checked })} />
                    Page break before
                </label>
                <span className="flex items-center gap-2 text-13 text-fg-muted">
                    <Switch checked={it.keepTogether} onChange={v => set({ keepTogether: v })} label="Keep together on one page" />
                    Keep together
                </span>
            </div>
        </div>
    );
}
