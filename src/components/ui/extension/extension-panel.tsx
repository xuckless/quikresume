// src/components/ui/extension/extension-panel.tsx
"use client";

// /dashboard/extension: connect this browser (click: the extension's content script picks the code
// up via window.postMessage; fallback: an 8-character code typed into the extension popup) and
// manage connected browsers.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createExtensionCode, revokeExtensionDevice } from "@/app/actions/extension-actions";
import { APP_SOURCE, isExtMessage, type AppMessage } from "@/lib/ext/bridge";
import type { ExtensionDevice } from "@/lib/ext/tokens";
import { Button, Card, CardBody, CardHeader, ConfirmDialog, NoticeBanner } from "@/components/ui/primitives";
import { Puzzle } from "@/components/ui/primitives/icons";

import { pairingTransition, type PairingEvent, type PairingFlow, type ExtensionDetection } from "@/lib/ext/pairing-flow";
import { useFormsOperation } from "@/lib/ui/use-forms-operation";

const post = (m: AppMessage) => window.postMessage(m, window.location.origin);
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
    const detected = detection.phase === "found" ? detection : null;
    const [pairing, setPairing] = useState<PairingFlow>({ phase: "idle" });
    const currentPairing = useRef(pairing);
    const send = useCallback((event: PairingEvent) => {
        currentPairing.current = pairingTransition(currentPairing.current, event);
        setPairing(currentPairing.current);
    }, []);
    const isIssuing = (id: string) => {
        const state = currentPairing.current;
        return state.phase === "issuing" && state.id === id;
    };
    const busy = pairing.phase === "issuing";
    const code = "code" in pairing ? pairing.code : null;
    const notice = pairing.phase === "connected"
        ? { tone: "success" as const, text: "This browser is connected. Return to Import to start your LinkedIn profile import, or open a job posting to use the job tools." }
        : pairing.phase === "failed" || pairing.phase === "pairing-failed"
            ? { tone: "danger" as const, text: pairing.error } : null;
    const [revoking, setRevoking] = useState<{ phase: "closed" } | { phase: "confirming"; device: ExtensionDevice }>({ phase: "closed" });
    const revoke = useFormsOperation<"revoke">();
    const autoAttempt = useRef<"eligible" | "attempted">("eligible");

    const issueCode = async (mode: "automatic" | "manual") => {
        if (currentPairing.current.phase === "issuing") return;
        const id = crypto.randomUUID();
        send({ type: "issue", id, mode });
        try {
            const res = await createExtensionCode();
            if (!res.ok) { send({ type: "failed", id, error: res.error }); return; }
            if (!isIssuing(id)) return;
            // Record the code before sending: a fast reply cannot resurrect a used code.
            send({ type: "code", id, code: { code: res.code, expiresAt: res.expiresAt } });
            if (mode === "automatic") post({ source: APP_SOURCE, type: "pair", code: res.code });
        } catch (err) {
            send({ type: "failed", id, error: err instanceof Error ? err.message : "Could not create a connection code." });
        }
    };
    const connect = () => issueCode("automatic");
    const showCode = () => issueCode("manual");
    const connectRef = useRef(connect);
    useEffect(() => { connectRef.current = connect; });

    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            if (!isExtMessage(e)) return;
            if (e.data.type === "hello") {
                setDetection({ phase: "found", version: e.data.version, paired: e.data.paired });
                // ?connect=1 (opened from the extension popup): connect as soon as the extension answers.
                if (autoConnect && !e.data.paired && autoAttempt.current === "eligible") {
                    autoAttempt.current = "attempted";
                    void connectRef.current();
                }
            }
            if (e.data.type === "paired") {
                send({ type: "paired", ok: e.data.ok, error: e.data.error });
                if (e.data.ok) {
                    setDetection(d => d.phase === "found" ? { ...d, paired: true } : d);
                    router.refresh();
                }
            }
        };
        window.addEventListener("message", onMessage);
        post({ source: APP_SOURCE, type: "ping" });
        const timeout = setTimeout(() => setDetection(d => d.phase === "checking" ? { phase: "missing" } : d), 3000);
        return () => { clearTimeout(timeout); window.removeEventListener("message", onMessage); };
    }, [router, autoConnect, send]);

    return (
        <div className="space-y-4">
            {notice && <NoticeBanner tone={notice.tone} onDismiss={() => send({ type: "dismiss" })}>{notice.text}</NoticeBanner>}

            <Card>
                <CardHeader
                    title="Connect this browser"
                    hint={detected ? `Extension found (v${detected.version})${detected.paired ? " · connected" : ""}.` : detection.phase === "checking" ? "Checking this browser…" : "Chrome only for now."}
                />
                <CardBody className="space-y-4 text-13">
                    {detected ? (
                        <div className="flex flex-wrap items-center gap-2">
                            <Button variant="primary" onClick={connect} loading={busy}>{detected.paired ? "Reconnect" : "Connect"}</Button>
                            <Button variant="ghost" onClick={showCode} disabled={busy}>Use a code instead</Button>
                            {detected.paired && <Button onClick={() => router.push('/dashboard?view=import')}>Return to Import from LinkedIn</Button>}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <p className="text-fg-muted">
                                {STORE_URL
                                    ? <>Install the extension from the <a className="text-accent-text underline underline-offset-2" href={STORE_URL} target="_blank" rel="noreferrer noopener">Chrome Web Store</a>, then reload this page.</>
                                    : <>The extension isn&apos;t installed in this browser. Install it, reload this page, or connect with a code from its popup.</>}
                            </p>
                            <Button onClick={showCode} loading={busy}>Get a connection code</Button>
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
                                    <Button size="sm" variant="ghost" onClick={() => { revoke.reset(); setRevoking({ phase: "confirming", device: d }); }}>Disconnect</Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>

            <Card>
                <CardHeader title="What the extension can do" />
                <CardBody className="space-y-1.5 text-13 text-fg-muted">
                    <p>To import your LinkedIn profile, start Import from LinkedIn on the website. Then open the extension in the new LinkedIn tab and click Import profile.</p>
                    <p>It reads job postings you open, saves the ones you choose to your Job Tracker, and shows your match.</p>
                    <p>On application forms it fills fields from your profile and Autofill preferences when you click Auto Fill. It never submits an application.</p>
                    <p>AI can make mistakes. Please review the work before applying.</p>
                </CardBody>
            </Card>

            <ConfirmDialog
                open={revoking.phase === "confirming"}
                title={`Disconnect ${revoking.phase === "confirming" ? revoking.device.deviceName : "this browser"}?`}
                confirmLabel="Disconnect"
                danger
                busy={revoke.state.status === "running"}
                onCancel={() => { if (revoke.state.status !== "running") setRevoking({ phase: "closed" }); }}
                onConfirm={async () => {
                    if (revoking.phase !== "confirming") return;
                    const id = revoke.begin("revoke");
                    if (id === null) return;
                    try {
                        await revokeExtensionDevice(revoking.device.id);
                        if (!revoke.active(id)) return;
                        revoke.succeed(id, undefined);
                        setRevoking({ phase: "closed" });
                        router.refresh();
                    } catch (err) { revoke.fail(id, err instanceof Error ? err.message : "Could not disconnect."); }
                }}
            >
                The extension in that browser stops working until you connect it again.
                {revoke.state.status === "failed" && <p role="alert" className="text-danger">{revoke.state.error}</p>}
            </ConfirmDialog>
        </div>
    );
}
