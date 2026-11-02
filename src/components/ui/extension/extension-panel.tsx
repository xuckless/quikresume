// src/components/ui/extension/extension-panel.tsx
"use client";

// /dashboard/extension: connect this browser (click: the extension's content script picks the code
// up via window.postMessage; fallback: an 8-character code typed into the extension popup) and
// manage connected browsers.

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createExtensionCode, revokeExtensionDevice } from "@/app/actions/extension-actions";
import { APP_SOURCE, isExtMessage, type AppMessage } from "@/lib/ext/bridge";
import type { ExtensionDevice } from "@/lib/ext/tokens";
import { Button, Card, CardBody, CardHeader, ConfirmDialog, NoticeBanner } from "@/components/ui/primitives";
import { Puzzle } from "@/components/ui/primitives/icons";

type Detected = { version: string; paired: boolean } | null;

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
    const [detected, setDetected] = useState<Detected>(null);
    const [busy, setBusy] = useState(false);
    const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
    const [notice, setNotice] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);
    const [revoking, setRevoking] = useState<ExtensionDevice | null>(null);
    const autoTried = useRef(false);

    const connect = async () => {
        setBusy(true);
        setNotice(null);
        try {
            const res = await createExtensionCode();
            if (!res.ok) { setNotice({ tone: "danger", text: res.error }); return; }
            post({ source: APP_SOURCE, type: "pair", code: res.code });
            // If the extension doesn't answer, the code stays on screen to type in.
            setCode({ code: res.code, expiresAt: res.expiresAt });
        } finally {
            setBusy(false);
        }
    };

    const connectRef = useRef(connect);
    useEffect(() => { connectRef.current = connect; });

    const showCode = async () => {
        setBusy(true);
        try {
            const res = await createExtensionCode();
            if (res.ok) setCode({ code: res.code, expiresAt: res.expiresAt });
            else setNotice({ tone: "danger", text: res.error });
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            if (!isExtMessage(e)) return;
            if (e.data.type === "hello") {
                setDetected({ version: e.data.version, paired: e.data.paired });
                // ?connect=1 (opened from the extension popup): connect as soon as the extension answers.
                if (autoConnect && !e.data.paired && !autoTried.current) {
                    autoTried.current = true;
                    void connectRef.current();
                }
            }
            if (e.data.type === "paired") {
                if (e.data.ok) {
                    setCode(null);
                    setNotice({ tone: "success", text: "This browser is connected. Open any job posting and click the quikResume button." });
                    setDetected(d => (d ? { ...d, paired: true } : d));
                    router.refresh();
                } else {
                    setNotice({ tone: "danger", text: e.data.error ?? "The extension could not connect. Type the code into its popup instead." });
                }
            }
        };
        window.addEventListener("message", onMessage);
        post({ source: APP_SOURCE, type: "ping" });
        return () => window.removeEventListener("message", onMessage);
    }, [router, autoConnect]);

    return (
        <div className="space-y-4">
            {notice && <NoticeBanner tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</NoticeBanner>}

            <Card>
                <CardHeader
                    title="Connect this browser"
                    hint={detected ? `Extension found (v${detected.version})${detected.paired ? " · connected" : ""}.` : "Chrome only for now."}
                />
                <CardBody className="space-y-4 text-13">
                    {detected ? (
                        <div className="flex flex-wrap items-center gap-2">
                            <Button variant="primary" onClick={connect} loading={busy}>{detected.paired ? "Reconnect" : "Connect"}</Button>
                            <Button variant="ghost" onClick={showCode} disabled={busy}>Use a code instead</Button>
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
                                    <Button size="sm" variant="ghost" onClick={() => setRevoking(d)}>Disconnect</Button>
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
                    <p>On application forms it fills fields from your profile and Autofill preferences when you click Auto Fill. It never submits an application.</p>
                    <p>AI can make mistakes. Please review the work before applying.</p>
                </CardBody>
            </Card>

            <ConfirmDialog
                open={revoking !== null}
                title={`Disconnect ${revoking?.deviceName ?? "this browser"}?`}
                confirmLabel="Disconnect"
                danger
                onCancel={() => setRevoking(null)}
                onConfirm={async () => {
                    const d = revoking;
                    setRevoking(null);
                    if (!d) return;
                    try { await revokeExtensionDevice(d.id); router.refresh(); }
                    catch (err) { setNotice({ tone: "danger", text: err instanceof Error ? err.message : "Could not disconnect." }); }
                }}
            >
                The extension in that browser stops working until you connect it again.
            </ConfirmDialog>
        </div>
    );
}
