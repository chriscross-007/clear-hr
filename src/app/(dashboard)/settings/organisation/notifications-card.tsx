"use client";

// CLE-235 — Settings → Organisation → Notifications card. Three switches
// for the nightly document emails; Save is enabled only when something
// has changed.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize, pluralize } from "@/lib/label-utils";
import {
  updateDocumentNotificationSettings,
  type DocumentNotificationSettings,
} from "./notification-actions";

export function NotificationsCard({ initial }: { initial: DocumentNotificationSettings }) {
  const router = useRouter();
  const { memberLabel } = useMemberLabel();
  // Mid-sentence uses lower case ("Remind colleagues…"); sentence starts capitalise.
  const membersLower = pluralize(memberLabel).toLowerCase();
  const members = capitalize(membersLower);
  const [values, setValues] = useState<DocumentNotificationSettings>(initial);
  const [saved, setSaved] = useState<DocumentNotificationSettings>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);

  const rows: Array<{ key: keyof DocumentNotificationSettings; label: string; help: string }> = [
    {
      key: "memberAcks",
      label: `Remind ${membersLower} to acknowledge documents`,
      help: `${members} get an email the night after a document needs their acknowledgement, then reminders after 7 and 30 days.`,
    },
    {
      key: "memberExpiry",
      label: `Tell ${membersLower} when their certificates are expiring`,
      help: `${members} get an email 30, 14 and 3 days before one of their own certificates or Right to Work documents expires.`,
    },
    {
      key: "adminDigest",
      label: "Daily documents summary for admins",
      help: `Admins get one email each morning listing what is new: expired, overdue for review, expiring, awaiting verification and missing documents. Only the ${membersLower} they can manage are included. Nothing is sent on days with nothing new.`,
    },
  ];

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await updateDocumentNotificationSettings(values);
      if (!r.success) {
        setError(r.error ?? "Save failed");
        return;
      }
      setSaved(values);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Notifications</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Document emails are sent overnight, combined into one email per person.
      </p>
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.key} className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor={`notify-${r.key}`} className="text-sm font-medium">
                {r.label}
              </Label>
              <p className="text-xs text-muted-foreground">{r.help}</p>
            </div>
            <Switch
              id={`notify-${r.key}`}
              checked={values[r.key]}
              onCheckedChange={(v) => setValues((prev) => ({ ...prev, [r.key]: v }))}
            />
          </div>
        ))}
      </div>
      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
