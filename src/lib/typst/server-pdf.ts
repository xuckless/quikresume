// src/lib/typst/server-pdf.ts
// Server-only PDF compile with the native typst.ts compiler (same Typst 0.13, same templates and
// vendored fonts as the browser). Used where there is no browser Typst: the extension's résumé file
// for application forms. The compiler is created once per instance; compiles are synchronous and
// take ~10–150 ms. Next must not bundle the native module (serverExternalPackages) and must trace
// public/typst into the function (outputFileTracingIncludes), see next.config.ts.

import "server-only";
import path from "node:path";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { toTypstDoc, pdfFileName } from "@/lib/typst/doc";
import { DEFAULT_TEMPLATE, isTemplateId } from "@/lib/typst/templates";
import type { ResumeData } from "@/types/schema";

const ROOT = path.join(process.cwd(), "public", "typst");
let compiler: NodeCompiler | null = null;

function getCompiler(): NodeCompiler {
    compiler ??= NodeCompiler.create({ workspace: ROOT, fontArgs: [{ fontPaths: [path.join(ROOT, "fonts")] }] });
    return compiler;
}

export class ServerPdfError extends Error {}

export function compileResumePdf(data: ResumeData): { bytes: Uint8Array; fileName: string } {
    const doc = toTypstDoc(data);
    const template = isTemplateId(doc.layout.theme.template) ? doc.layout.theme.template : DEFAULT_TEMPLATE;
    const c = getCompiler();
    const res = c.pdf({ mainFilePath: path.join(ROOT, "main.typ"), inputs: { resume: JSON.stringify(doc), template } });
    c.evictCache(30);
    const bytes = (res as { result?: Uint8Array | null }).result ?? (res instanceof Uint8Array ? res : null);
    if (!bytes || bytes.length === 0) {
        const detail = (res as { printErrors?: () => void }).printErrors ? "see server log" : String(res);
        (res as { printErrors?: () => void }).printErrors?.();
        throw new ServerPdfError(`The résumé PDF could not be compiled (${detail}).`);
    }
    return { bytes, fileName: pdfFileName(data.personalInfo) };
}
