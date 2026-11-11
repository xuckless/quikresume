// src/lib/typst/client.ts
// Browser-only singleton around @myriaddreamin/typst.ts. Never import this
// from a Server Component: the wasm packages only run in the browser. All
// typst imports are dynamic so an accidental server evaluation stays inert.
//
// Assets (all served from /public):
//   /typst/wasm/*.wasm        copied from node_modules by scripts/copy-typst-wasm.mjs
//   /typst/fonts/Inter-*.ttf  vendored (OFL); default remote font assets are disabled
//   /typst/main.typ           entry point (template registry + sys.inputs plumbing)
//   /typst/templates/*.typ    styling templates exporting render(data)

import type { TypstResumeDoc } from "@/lib/typst/doc";
import { DEFAULT_TEMPLATE, TEMPLATES, TYPST_LIBS, type TemplateId } from "@/lib/typst/templates";

type Snippet = typeof import("@myriaddreamin/typst.ts/contrib/snippet");
type TypstInstance = Snippet["$typst"];

export type TypstStage = "idle" | "loading" | "ready" | "failed" | "reloading";
type EngineState =
    | { stage: "idle" }
    | { stage: "loading" | "ready" | "reloading"; promise: Promise<TypstInstance> }
    | { stage: "failed"; error: unknown };

const WASM_COMPILER = "/typst/wasm/typst_ts_web_compiler_bg.wasm";
const WASM_RENDERER = "/typst/wasm/typst_ts_renderer_bg.wasm";
const MAIN_FILE = "/main.typ";
// Every family a template or font pair (lib/layout/theme.ts FONT_PAIRS) can ask for. All OFL.
const FONT_URLS = [
    ...["Regular", "Italic", "Medium", "SemiBold", "Bold"].map(w => `/typst/fonts/Inter-${w}.ttf`),
    ...["Regular", "Italic", "Medium", "SemiBold", "Bold"].map(w => `/typst/fonts/IBMPlexSans-${w}.ttf`),
    ...["Regular", "Italic", "SemiBold", "Bold"].map(w => `/typst/fonts/IBMPlexSerif-${w}.ttf`),
    ...["Regular", "Italic", "Semibold", "Bold"].map(w => `/typst/fonts/LibertinusSerif-${w}.otf`),
];

let engine: EngineState = { stage: "idle" };
// The wasm compiler is single-threaded and shares shadow-file state, so all
// compiles are serialized through this chain.
let queue: Promise<unknown> = Promise.resolve();

export function getTypstStage(): TypstStage {
    return engine.stage;
}

async function fetchText(url: string): Promise<string> {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    return res.text();
}

/** Thrown when the engine itself (wasm, fonts, templates) could not load, as opposed to a document that failed to compile. */
export class TypstEngineError extends Error {
    constructor(message: string, readonly cause?: unknown) {
        super(message);
        this.name = "TypstEngineError";
    }
}

/** Turns a low-level load failure into something a user can act on. */
function explainEngineFailure(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    if (/unsafe-eval|Content Security Policy|trusted-types/i.test(raw)) {
        return "The browser's security policy blocked the Typst engine from starting (script evaluation is not allowed on this page). This is a server configuration problem, not something in your résumé; reload the page, and if it persists report it.";
    }
    if (/Failed to fetch|NetworkError|Load failed|404|503/i.test(raw)) {
        return `A file the engine needs could not be downloaded (${raw}). Check your connection and try again.`;
    }
    if (/WebAssembly|wasm/i.test(raw)) {
        return `The Typst engine (WebAssembly) could not start in this browser: ${raw}`;
    }
    return `The preview engine could not start: ${raw}`;
}

async function init(): Promise<TypstInstance> {
    if (typeof window === "undefined") {
        throw new TypstEngineError("Typst can only be initialized in the browser");
    }
    const { TypstSnippet } = await import("@myriaddreamin/typst.ts/contrib/snippet");

    // A fresh snippet per attempt: `use()` may only be called once per instance, so re-using the
    // package's shared `$typst` after a failed start would throw "already prepare uses for instances"
    // and hide the real cause.
    const typst = new TypstSnippet();
    typst.setCompilerInitOptions({ getModule: () => WASM_COMPILER });
    typst.setRendererInitOptions({ getModule: () => WASM_RENDERER });
    // Providers must be registered before the first compile.
    typst.use(TypstSnippet.disableDefaultFontAssets(), TypstSnippet.preloadFonts(FONT_URLS));

    const templateIds = Object.keys(TEMPLATES) as TemplateId[];
    const [main, libSources, ...templateSources] = await Promise.all([
        fetchText("/typst/main.typ"),
        Promise.all(TYPST_LIBS.map(path => fetchText(`/typst${path}`))),
        ...templateIds.map(id => fetchText(TEMPLATES[id].file)),
    ]);

    // One addSource at a time, never Promise.all: typst.ts builds its compiler lazily on the first call, and
    // that lazy init is not safe to run concurrently (parallel calls crash the engine). Fetching above is fine
    // in parallel; only registering with the compiler has to be sequential.
    const sources: [string, string][] = [
        [MAIN_FILE, main],
        ...TYPST_LIBS.map((path, i): [string, string] => [path, libSources[i]]),
        ...templateIds.map((id, i): [string, string] => [`/templates/${id}.typ`, templateSources[i]]),
    ];
    for (const [path, source] of sources) await typst.addSource(path, source);

    return typst;
}

const CSP_RELOAD_KEY = "quikresume.typst-csp-reload";
const isCspBlock = (err: unknown) => /unsafe-eval|Content Security Policy|trusted-types/i.test(err instanceof Error ? err.message : String(err));

/**
 * The browser keeps the CSP of the document it first loaded, so a client-side navigation from a public page
 * (strict policy, no wasm eval) into the app leaves the engine blocked until a full load. Reload once to pick
 * up the app's policy; the session flag stops a loop if the policy itself is wrong.
 */
function reloadForCsp(err: unknown): boolean {
    if (!isCspBlock(err)) return false;
    try {
        if (sessionStorage.getItem(CSP_RELOAD_KEY)) return false;
        sessionStorage.setItem(CSP_RELOAD_KEY, "1");
    } catch {
        return false;
    }
    window.location.reload();
    return true;
}

/** Idempotent: loads wasm, fonts and template sources once. Re-armed on failure, so a retry starts clean. */
export function ensureTypst(): Promise<TypstInstance> {
    if ("promise" in engine) return engine.promise;
    const promise = init().then(
            inst => {
                engine = { stage: "ready", promise };
                try { sessionStorage.removeItem(CSP_RELOAD_KEY); } catch { /* storage unavailable */ }
                return inst;
            },
            err => {
                engine = { stage: "failed", error: err };
                console.error("[typst] engine failed to start:", err);
                if (reloadForCsp(err)) {
                    engine = { stage: "reloading", promise };
                    return new Promise<never>(() => {});
                }
                throw err instanceof TypstEngineError ? err : new TypstEngineError(explainEngineFailure(err), err);
            },
        );
    engine = { stage: "loading", promise };
    return promise;
}

export const isEngineError = (err: unknown): err is TypstEngineError => err instanceof TypstEngineError;

function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work, work);
    queue = run.catch(() => undefined);
    return run;
}

function compileInputs(doc: TypstResumeDoc, template: TemplateId): Record<string, string> {
    return { resume: JSON.stringify(doc), template };
}

const A4_HEIGHT_PT = 841.89;

export function countSvgPages(svg: string): number {
    const marked = (svg.match(/class="typst-page"/g) ?? []).length;
    if (marked > 0) return marked;
    const h = /<svg[^>]*\sheight="([\d.]+)/.exec(svg);
    return h ? Math.max(1, Math.round(Number(h[1]) / A4_HEIGHT_PT)) : 1;
}

export interface SvgResult {
    svg: string;
    pageCount: number;
}

/** `template` overrides the document's own (`doc.layout.theme.template`), e.g. for gallery thumbnails. */
export function compileSvg(doc: TypstResumeDoc, template: TemplateId = doc.layout.theme?.template ?? DEFAULT_TEMPLATE): Promise<SvgResult> {
    return enqueue(async () => {
        const $typst = await ensureTypst();
        const svg = await $typst.svg({ mainFilePath: MAIN_FILE, inputs: compileInputs(doc, template) });
        if (!svg) throw new Error("Typst returned an empty document");
        return { svg, pageCount: countSvgPages(svg) };
    });
}

export function compilePdf(doc: TypstResumeDoc, template: TemplateId = doc.layout.theme?.template ?? DEFAULT_TEMPLATE): Promise<Uint8Array> {
    return enqueue(async () => {
        const $typst = await ensureTypst();
        const pdf = await $typst.pdf({ mainFilePath: MAIN_FILE, inputs: compileInputs(doc, template) });
        if (!pdf) throw new Error("Typst returned no PDF data");
        return pdf;
    });
}

// typst.ts 0.7 throws compile errors as a Rust debug string such as
// `[SourceDiagnostic { severity: Error, span: ..., message: "...", hints: [] }]`.
// Pull out the human-readable parts.
function prettifyDiagnostics(raw: string): string {
    const messages = [...raw.matchAll(/severity:\s*(\w+)[^{}]*?message:\s*"((?:[^"\\]|\\.)*)"/g)]
        .map(m => `${m[1].toLowerCase()}: ${m[2].replace(/\\"/g, '"').replace(/\\n/g, "\n")}`);
    if (messages.length > 0) return messages.join("\n");
    // The package's own guard against a double `use()`: only reachable after a failed start.
    if (/already prepare uses/.test(raw)) return "The preview engine was started twice after a failed load. Reload the page.";
    return raw;
}

/** Turns whatever typst.ts throws (string, Error, diagnostics array/object) into readable text. */
export function formatTypstError(err: unknown): string {
    if (typeof err === "string") return prettifyDiagnostics(err);
    if (err instanceof Error) return err.message;
    if (Array.isArray(err)) return err.map(formatTypstError).join("\n");
    if (err && typeof err === "object") {
        const o = err as Record<string, unknown>;
        if (typeof o.message === "string") {
            const range = typeof o.range === "string" ? ` (${o.range})` : "";
            const path = typeof o.path === "string" ? `${o.path}: ` : "";
            return `${path}${o.message}${range}`;
        }
        if (Array.isArray(o.diagnostics)) return formatTypstError(o.diagnostics);
        try {
            return JSON.stringify(err, null, 2);
        } catch {
            /* fall through */
        }
    }
    return String(err);
}
