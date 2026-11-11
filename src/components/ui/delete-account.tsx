// src/components/ui/delete-account.tsx
"use client";

// Profile page "Delete account": permanent, so the dialog lists what goes and asks for DELETE typed out.

import { useFormsOperation } from "@/lib/ui/use-forms-operation";
import React, { useState } from "react";
import { deleteAccount } from "@/app/actions/user-actions";
import { Button, Card, CardBody, CardHeader, ConfirmDialog, Input, Label } from "@/components/ui/primitives";

export function DeleteAccountCard() {
    const [dialog, setDialog] = useState<"closed" | "confirming">("closed");
    const open = dialog === "confirming";
    const [text, setText] = useState("");
    const operation = useFormsOperation<"delete">();
    const busy = operation.state.status === "running";
    const error = operation.state.status === "failed" ? operation.state.error : null;

    const confirm = async () => {
        const id = operation.begin("delete");
        if (id === null) return;
        const typed = text.trim();
        if (typed !== "DELETE") { operation.fail(id, "Type DELETE to confirm."); return; }
        try {
            const res = await deleteAccount(typed);
            operation.fail(id, res.error);
        } catch (err) {
            // A successful delete signs out and redirects (thrown by Next); anything else is a real failure.
            if (err instanceof Error && !/NEXT_REDIRECT/.test(err.message)) operation.fail(id, "Something went wrong. Nothing may have been deleted; try again.");
            else throw err;
        }
    };

    return (
        <Card className="mt-6">
            <CardHeader title="Delete account" hint="Permanently removes your library, résumés, jobs and settings." />
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-13 text-fg-muted">This can&apos;t be undone. Download any PDFs you want to keep first.</p>
                <Button variant="secondary" className="text-danger" onClick={() => { setText(""); operation.reset(); setDialog("confirming"); }}>Delete my account</Button>
            </CardBody>
            <ConfirmDialog open={open} title="Delete your account?" danger busy={busy} confirmLabel="Delete everything" onCancel={() => { if (!busy) { operation.reset(); setDialog("closed"); } }} onConfirm={() => void confirm()}>
                <div className="space-y-3 text-13">
                    <p>This permanently deletes your library, variants, tracked jobs, About you answers, Autofill preferences, connected browser extensions and your sign-in. It can&apos;t be undone.</p>
                    <div className="space-y-1.5">
                        <Label htmlFor="delete-confirm">Type DELETE to confirm</Label>
                        <Input id="delete-confirm" value={text} autoComplete="off" onChange={e => setText(e.target.value)} />
                    </div>
                    {error && <p role="alert" className="text-danger">{error}</p>}
                </div>
            </ConfirmDialog>
        </Card>
    );
}
