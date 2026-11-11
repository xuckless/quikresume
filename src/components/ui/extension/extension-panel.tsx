// src/components/ui/extension/extension-panel.tsx
"use client";

// /dashboard/extension: connect this browser (click: the extension's content script picks the code
// up via window.postMessage; fallback: an 8-character code typed into the extension popup) and
// manage connected browsers.

import React, { useEffect, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { createExtensionCode, revokeExtensionDevice } from "@/app/actions/extension-actions";
import { detectExtension, postToExtension, readExtMessage } from "@/lib/ext/bridge";
import { idlePairing, pairingTransition, type ExtensionDetection } from "@/lib/ext/pairing-flow";
import type { ExtensionDevice } from "@/lib/ext/tokens";
import { useOperation } from "@/lib/ui/use-operation";
import { Button, Card, CardBody, CardHeader, ConfirmDialog, NoticeBanner } from "@/components/ui/primitives";
import { Puzzle } from "@/components/ui/primitives/icons";

const STORE_URL = process.env.NEXT_PUBLIC_EXTENSION_URL ?? "";

function when(iso: string | null): string {
    if (!iso) return "never";
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60_000);
    if (mins < 2) return "just now";
    if (mins < 60) return `${mins} min ago`;
    if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
    return d.toLocaleDateString();
}

export function ExtensionPanel({ devices, autoConnect }: { devices: ExtensionDevice[]; autoConnect: boolean }) {
    const router = useRouter();
    const [detection, setDetection] = useState<ExtensionDetection>({ phase: "checking" });
    const [pairing, dispatch] = useReducer(pairingTransition, idlePairing);
    const [revoking, setRevoking] = useState<ExtensionDevice | null>(null);
    const revoke = useOperation();

    const found = detection.phase === "found" ? detection : null;
    const busy = pairing.phase === "issuing";
    const code = pairing.phase === "awaiting" || pairing.phase === "pairing-failed" ? pairing.code : null;
    const notice = pairing.phase === "connected"
        ? { tone: "success" as const, text: "This browser is connected. Open a job posting and click the quikResume button to save it and see your match." }
        : pairing.phase === "failed" || pairing.phase === "pairing-failed"
            ? { tone: "danger" as const, text: pairing.error } : null;

    // Is the extension here? It answers a ping with its version and whether it is paired. The probe runs
    // once, so ?connect=1 (opened from the extension popup) connects once, when the extension answers unpaired.
    useEffect(() => {
        const probe = detectExtension();
        void probe.result.then(m => {
            if (m?.type !== "hello") return setDetection({ phase: "missing" });
            setDetection({ phase: "found", version: m.version, paired: m.paired });
            if (autoConnect && !m.paired) dispatch({ type: "issue", mode: "automatic" });
        });
        return probe.cancel;
    }, [autoConnect]);

    // The extension's answer to a pair request (and to pairings started elsewhere).
    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            const m = readExtMessage(e);
            if (m?.type !== "paired") return;
            dispatch({ type: "paired", ok: m.ok, error: m.error });
            if (!m.ok) return;
            setDetection(d => d.phase === "found" ? { ...d, paired: true } : d);
            router.refresh();
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [router]);

    // Issuing: fetch a single-use code. Leaving the phase (paired meanwhile, unmount) drops the answer.
    const issuingMode = pairing.phase === "issuing" ? pairing.mode : null;
    useEffect(() => {
        if (!issuingMode) return;
        let live = true;
        createExtensionCode().then(res => {
            if (!live) return;
            if (!res.ok) return dispatch({ type: "failed", error: res.error });
            // Record the code before asking the extension: a fast reply cannot resurrect a used code.
            dispatch({ type: "code", code: { code: res.code, expiresAt: res.expiresAt } });
            if (issuingMode === "automatic") postToExtension({ type: "pair", code: res.code });
        }).catch(err => {
            if (live) dispatch({ type: "failed", error: err instanceof Error ? err.message : "Could not create a connection code." });
        });
        return () => { live = false; };
    }, [issuingMode]);

    return (
        <div className="space-y-4">
            {notice && <NoticeBanner tone={notice.tone} onDismiss={() => dispatch({ type: "dismiss" })}>{notice.text}</NoticeBanner>}

            <Card>
                <CardHeader
                    title="Connect this browser"
                    hint={found ? `Extension found (v${found.version})${found.paired ? " · connected" : ""}.` : detection.phase === "checking" ? "Checking this browser…" : "Chrome only for now."}
                />
                <CardBody className="space-y-4 text-13">
                    {found ? (
                        <div className="flex flex-wrap items-center gap-2">
                            <Button variant="primary" onClick={() => dispatch({ type: "issue", mode: "automatic" })} loading={busy}>{found.paired ? "Reconnect" : "Connect"}</Button>
                            <Button variant="ghost" onClick={() => dispatch({ type: "issue", mode: "manual" })} disabled={busy}>Use a code instead</Button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <p className="text-fg-muted">
                                {STORE_URL
                                    ? <>Install the extension from the <a className="text-accent-text underline underline-offset-2" href={STORE_URL} target="_blank" rel="noreferrer noopener">Chrome Web Store</a>, then reload this page.</>
                                    : <>The extension isn&apos;t installed in this browser. Install it, reload this page, or connect with a code from its popup.</>}
                            </p>
                            <Button onClick={() => dispatch({ type: "issue", mode: "manual" })} loading={busy}>Get a connection code</Button>
                        </div>
                    )}
                    {code && (
                        <div className="rounded-md border border-border bg-surface-muted/50 p-3">
                            <p className="text-fg-muted">Type this into the extension popup. It works once and expires in 10 minutes.</p>
                            <p className="mt-2 select-all font-mono text-2xl tracking-[0.2em] text-fg" aria-label="Connection code">{code.code.slice(0, 4)}-{code.code.slice(4)}</p>
                        </div>
                    )}
                </CardBody>
            </Card>

            <Card>
                <CardHeader title="Connected browsers" hint="Disconnecting signs that browser's extension out at once." />
                <CardBody>
                    {devices.length === 0 ? (
                        <p className="flex items-center gap-2 text-13 text-fg-muted"><Puzzle className="size-4" aria-hidden />No browsers connected yet.</p>
                    ) : (
                        <ul className="divide-y divide-border">
                            {devices.map(d => (
                                <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 text-13">
                                    <span className="min-w-0">
                                        <span className="font-medium text-fg">{d.deviceName}</span>
                                        <span className="block text-xs text-fg-subtle">Connected {when(d.createdAt)} · last used {when(d.lastUsedAt)}</span>
                                    </span>
                                    <Button size="sm" variant="ghost" onClick={() => { revoke.reset(); setRevoking(d); }}>Disconnect</Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>

            <Card>
                <CardHeader title="What the extension can do" />
                <CardBody className="space-y-1.5 text-13 text-fg-muted">
                    <p>It reads job postings you open, saves the ones you choose to your Job Tracker, and shows your match.</p>
                    <p>It imports your own LinkedIn profile when you start Import from LinkedIn on the Import page.</p>
                    <p>On application forms it fills fields from your profile and Autofill preferences when you click Auto Fill. It never submits an application.</p>
                    <p>AI can make mistakes. Please review the work before applying.</p>
                </CardBody>
            </Card>

            <ConfirmDialog
                open={revoking !== null}
                title={`Disconnect ${revoking?.deviceName ?? "this browser"}?`}
                confirmLabel="Disconnect"
                danger
                busy={revoke.running !== null}
                onCancel={() => setRevoking(null)}
                onConfirm={async () => {
                    if (!revoking) return;
                    const res = await revoke.run("run", () => revokeExtensionDevice(revoking.id), "Could not disconnect.");
                    if (!res?.ok) return;
                    setRevoking(null);
                    router.refresh();
                }}
            >
                The extension in that browser stops working until you connect it again.
                {revoke.error && <p role="alert" className="text-danger">{revoke.error}</p>}
            </ConfirmDialog>
        </div>
    );
}
