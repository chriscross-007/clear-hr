export const dynamic = "force-dynamic";

// CLE-236 — Signing screen. Reached from the signature email, the
// "N to sign" dashboard chip and the Please sign pill. Only the named
// signer (or, for organisation documents set to Sign, a member the
// audience expects) gets the document; everyone else sees a short
// message. Access is decided by `getSigningView`.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSigningView } from "@/app/(dashboard)/documents/signature-actions";
import { SignDocumentClient } from "./sign-document-client";

export default async function SignDocumentPage({ params }: { params: Promise<{ documentId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { documentId } = await params;
  const res = await getSigningView(documentId);
  return (
    <div className="mx-auto max-w-5xl p-6">
      <SignDocumentClient documentId={documentId} view={res.success ? res.view : null} error={res.success ? null : res.error} />
    </div>
  );
}
