export const dynamic = "force-dynamic";

// CLE-236 — Documents waiting for the caller's signature.

import Link from "next/link";
import { redirect } from "next/navigation";
import { PenLine } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyOutstandingSignatures } from "@/app/(dashboard)/documents/signature-actions";

export default async function DocumentsToSignPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const res = await getMyOutstandingSignatures();
  const rows = res.success ? res.rows : [];
  return (
    <div className="mx-auto max-w-3xl p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <PenLine className="h-4 w-4" /> Documents to sign
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!res.success ? (
            <p className="text-sm text-destructive">{res.error}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to sign — you&apos;re all done.</p>
          ) : (
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={`${r.documentId}-${r.role}`}>
                  <Link href={`/my-documents/sign/${r.documentId}`} className="flex items-center justify-between gap-3 py-3 hover:bg-muted/50">
                    <span>
                      <span className="font-medium">{r.subtypeName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {r.fileName}
                        {r.ownerName ? ` · ${r.ownerName}` : ""}
                        {r.role === "company" ? " · on behalf of the organisation" : ""}
                      </span>
                    </span>
                    <span className="text-sm text-primary">Read &amp; sign →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
