// src/lib/import/linkedin-capture.ts
// A LinkedIn profile captured by the extension (an ImportEnvelope built from the page, no model involved)
// -> the same ParsedFile a file import produces, so it enters the same review step. Validation, date and
// contact normalisation are parseImportObject's (parsed-resume.ts). Pure; runs in the browser.

import type { ParsedFile } from "./merge";
import { parseImportObject } from "./parsed-resume";
import { LINKEDIN_SOURCE } from "./linkedin";

/** `url` is the canonical profile URL the extension checked the tab against. */
export function linkedInCaptureToFile(url: string, data: Record<string, unknown>, captureWarnings: string[]): ParsedFile {
    const parsed = parseImportObject(data);
    parsed.data.personalInfo.linkedin = url;
    return { fileName: LINKEDIN_SOURCE, data: parsed.data, warnings: [...captureWarnings, ...parsed.warnings] };
}
