// src/components/ui/linkedin-import.tsx
// "Import from LinkedIn" on the Import view: one guided session at a time (lib/import/linkedin-session.ts).
// The hook owns the session and its side effects, each keyed on the phase's id; the card renders it.
// The extension sends the profile already structured (parsed from the page, gaps read with AI only when its
// parser was unsure); it is validated here and handed to the
// caller, which opens the same review step file imports use. Unmounting (leaving the Import view) cancels
// a live session.
"use client";

import React, { useEffect, useEffectEvent, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { saveLinkedInUrl } from "@/app/actions/user-actions";
import { detectExtension, postToExtension, readExtMessage } from "@/lib/ext/bridge";
import { interceptNavigation } from "@/lib/ui/leave-guard";
import { canonicalProfileUrl } from "@/lib/import/linkedin";
import { linkedInCaptureToFile } from "@/lib/import/linkedin-capture";
import {
    idleSession, linkedInReducer, liveSessionId, LINKEDIN_STEPS, sessionBusy, sessionStep,
    type ExtensionReason, type LinkedInEvent, type LinkedInSession,
} from "@/lib/import/linkedin-session";
import type { ParsedFile } from "@/lib/import/merge";
import { RESUME_LIST_KEYS } from "@/types/schema";
import { cn } from "@/lib/cn";
import { Button, Card, CardBody, CardHeader, Dialog, Field, Input, NoticeBanner, Swap } from "@/components/ui/primitives";
import { Check, Circle, Linkedin, Loader2 } from "@/components/ui/primitives/icons";

/** The extension answers linkedin-start once it has checked the account and opened the tab. */
const START_TIMEOUT_MS = 15_000;

interface LinkedInImportOptions {
    /** The signed-in user; the extension refuses to run for a different paired account. */
    uid: string;
    /** The LinkedIn URL saved on the profile (server truth, not the editor draft). */
    savedUrl: string;
    onResult: (file: ParsedFile) => void;
    /** A URL entered in the dialog was saved to the profile. */
    onUrlSaved: (url: string) => void;
}

export type LinkedInImport = {
    session: LinkedInSession;
    dispatch: (event: LinkedInEvent) => void;
    submitUrl: (id: string, raw: string) => Promise<void>;
};

export function useLinkedInImport({ uid, savedUrl, onResult, onUrlSaved }: LinkedInImportOptions): LinkedInImport {
    const [session, dispatch] = useReducer(linkedInReducer, idleSession);
    const deliver = useEffectEvent(onResult);

    // Session messages from the extension; the reducer drops any for another session.
    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            const m = readExtMessage(e);
            if (!m || m.type === "hello" || m.type === "paired") return;
            if (m.type !== "linkedin-captured") return dispatch(m);
            const file = linkedInCaptureToFile(m.url, m.data, m.warnings);
            dispatch({ type: "captured", id: m.id, url: m.url, file: hasContent(file) ? file : null });
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, []);

    // checking: is the extension installed, current and paired?
    const checkingId = session.phase === "checking" ? session.id : "";
    const saved = canonicalProfileUrl(savedUrl) ?? "";
    useEffect(() => {
        if (!checkingId) return;
        const probe = detectExtension();
        void probe.result.then(hello => dispatch({ type: "detected", id: checkingId, hello, savedUrl: saved || null }));
        return probe.cancel;
    }, [checkingId, saved]);

    // starting: ask the extension to open the profile; it must answer in time.
    const startingId = session.phase === "starting" ? session.id : "";
    const startingUrl = session.phase === "starting" ? session.url : "";
    useEffect(() => {
        if (!startingId) return;
        postToExtension({ type: "linkedin-start", id: startingId, uid, url: startingUrl });
        const timer = setTimeout(() => dispatch({ type: "start-timeout", id: startingId }), START_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [startingId, startingUrl, uid]);

    // While the extension follows this session, tell it when the page stops (cancel, unmount, done).
    const liveId = liveSessionId(session);
    useEffect(() => {
        if (!liveId) return;
        return () => postToExtension({ type: "linkedin-cancel", id: liveId });
    }, [liveId]);

    // received: acknowledge (the extension shows its checkmark) and open the review step.
    const received = session.phase === "received" ? session : null;
    const receivedId = received?.id ?? "";
    const receivedFile = received?.file ?? null;
    useEffect(() => {
        if (!receivedId || !receivedFile) return;
        postToExtension({ type: "linkedin-received", id: receivedId, ok: true });
        deliver(receivedFile);
    }, [receivedId, receivedFile]);

    // A capture this page refused: tell the extension, which offers Import again.
    const refusedId = session.phase === "waiting" && session.reject ? session.id : "";
    const refusal = session.phase === "waiting" && session.reject ? session.error ?? "" : "";
    useEffect(() => {
        if (refusedId) postToExtension({ type: "linkedin-received", id: refusedId, ok: false, error: refusal });
    }, [refusedId, refusal]);

    const submitUrl = async (id: string, raw: string) => {
        dispatch({ type: "url-submitted", id });
        const res = await saveLinkedInUrl(raw).catch(() => ({ ok: false as const, error: "Could not save your LinkedIn URL. Try again." }));
        if (!res.ok) {
            dispatch({ type: "url-rejected", id, error: res.error });
            return;
        }
        onUrlSaved(res.url);
        dispatch({ type: "url-saved", id, url: res.url });
    };

    return { session, dispatch, submitUrl };
}

const EXTENSION_NEEDED: Record<ExtensionReason, string> = {
    missing: "Importing from LinkedIn needs the quikResume browser extension, and it isn't installed in this browser.",
    pair: "Connect the quikResume extension to your account to import from LinkedIn.",
    update: "Your quikResume extension is out of date. Update it to import from LinkedIn.",
};

const display = (url: string) => url.replace(/^https:\/\/www\./, "");

/** At least one item or personal detail; otherwise the capture read nothing usable. */
function hasContent(file: ParsedFile): boolean {
    const { data } = file;
    return Object.values(data.personalInfo).some(v => v.trim() !== "" && v !== data.personalInfo.linkedin)
        || RESUME_LIST_KEYS.some(key => data[key].length > 0);
}

export function LinkedInImportCard({ linkedIn, savedUrl, disabled }: { linkedIn: LinkedInImport; savedUrl: string; disabled: boolean }) {
    const router = useRouter();
    const { session, dispatch } = linkedIn;
    const start = () => dispatch({ type: "start", id: crypto.randomUUID() });
    // Extension setup is another page: an unsaved editor draft gets the leave dialog first.
    const openSetup = (reason: ExtensionReason) => {
        const href = `/dashboard/extension?reason=${reason}`;
        if (!interceptNavigation(href)) router.push(href);
    };
    const saved = canonicalProfileUrl(savedUrl);
    const busy = sessionBusy(session);

    return (
        <Card>
            <CardHeader
                title="Import from LinkedIn"
                hint={saved ? <>Reads your profile at <span className="text-fg">{display(saved)}</span> with the quikResume extension.</> : "Reads your own LinkedIn profile with the quikResume extension."}
                action={!busy && <Button icon={Linkedin} onClick={start} disabled={disabled}>Import from LinkedIn</Button>}
            />
            {session.phase === "extension-needed" && (
                <CardBody>
                    <NoticeBanner tone="warning">
                        <p>{EXTENSION_NEEDED[session.reason]}</p>
                        <Button size="sm" className="mt-2" onClick={() => openSetup(session.reason)}>Set up the extension</Button>
                    </NoticeBanner>
                </CardBody>
            )}
            {session.phase === "failed" && (
                <CardBody>
                    <NoticeBanner tone="danger">
                        <p>{session.error}</p>
                        {session.fix === "reload" && <Button size="sm" className="mt-2" onClick={() => window.location.reload()}>Reload page</Button>}
                        {session.fix === "reconnect" && <Button size="sm" className="mt-2" onClick={() => openSetup("pair")}>Reconnect the extension</Button>}
                    </NoticeBanner>
                </CardBody>
            )}
            {busy && session.phase !== "need-url" && <Progress session={session} onCancel={() => dispatch({ type: "cancel" })} />}
            <UrlDialog
                open={session.phase === "need-url"}
                saving={session.phase === "need-url" && session.saving}
                error={session.phase === "need-url" ? session.error : null}
                onSubmit={raw => { if (session.phase === "need-url") void linkedIn.submitUrl(session.id, raw); }}
                onClose={() => { if (session.phase === "need-url") dispatch({ type: "url-dismissed", id: session.id }); }}
            />
        </Card>
    );
}

function statusLine(session: LinkedInSession): string {
    switch (session.phase) {
        case "checking": return "Looking for the extension…";
        case "starting": return "Opening your profile in a new tab…";
        case "waiting": return "In the LinkedIn tab, sign in if asked, then open the quikResume extension and click Import.";
        case "capturing": return session.analysing ? "Some sections needed AI to read. This takes a few seconds…" : "Reading your profile…";
        default: return "";
    }
}

function Progress({ session, onCancel }: { session: LinkedInSession; onCancel: () => void }) {
    const step = sessionStep(session);
    const error = session.phase === "waiting" ? session.error : null;
    return (
        <CardBody className="fade-in space-y-3">
            <ol className="space-y-1.5" aria-label="Import from LinkedIn progress">
                {LINKEDIN_STEPS.map((label, i) => {
                    const state = i < step ? "done" : i === step ? "current" : "next";
                    return (
                        <li key={label} className="rise-in flex items-center gap-2 text-13" style={{ "--i": i } as React.CSSProperties} aria-current={state === "current" ? "step" : undefined}>
                            <Swap swapKey={state} className="size-4">
                                {state === "done" ? <Check className="size-4 text-accent-text" aria-hidden />
                                    : state === "current" ? <Loader2 className="size-4 animate-spin text-fg-muted" aria-hidden />
                                        : <Circle className="size-3 text-border-strong" aria-hidden />}
                            </Swap>
                            <span className={cn(state === "next" ? "text-fg-subtle" : "text-fg", state === "current" && "font-medium")}>{label}</span>
                        </li>
                    );
                })}
            </ol>
            {error
                ? <NoticeBanner tone="danger">{error} Click Import in the extension to try again.</NoticeBanner>
                : <p key={session.phase === "capturing" && session.analysing ? "analysing" : session.phase} role="status" className="fade-in text-13 text-fg-muted">{statusLine(session)}</p>}
            <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
            </div>
        </CardBody>
    );
}

function UrlDialog({ open, saving, error, onSubmit, onClose }: { open: boolean; saving: boolean; error: string | null; onSubmit: (raw: string) => void; onClose: () => void }) {
    const [value, setValue] = useState("");
    return (
        <Dialog
            open={open}
            onClose={() => { if (!saving) onClose(); }}
            title="Your LinkedIn profile"
            description="The import opens this profile. It is also saved to your Profile."
            footer={<>
                <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
                <Button variant="primary" type="submit" form="linkedin-url" loading={saving} disabled={!value.trim()}>Save and continue</Button>
            </>}
        >
            <form id="linkedin-url" onSubmit={e => { e.preventDefault(); if (value.trim()) onSubmit(value); }}>
                <Field label="Profile URL" htmlFor="linkedin-url-input" error={error ?? undefined}>
                    <Input id="linkedin-url-input" value={value} onChange={e => setValue(e.target.value)} placeholder="linkedin.com/in/your-name" autoFocus disabled={saving} inputMode="url" />
                </Field>
            </form>
        </Dialog>
    );
}
