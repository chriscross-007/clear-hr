// CLE-237 — Word (.docx) → PDF conversion.
//
// The ONLY place that knows which renderer is in use. Today (development
// stage, Chris 2026-11-05): Adobe PDF Services "Create PDF" over REST.
// Before customer data goes through it, either sign a DPA with Adobe or
// swap this file's body for a self-hosted converter (Gotenberg:
// POST {DOC_CONVERTER_URL}/forms/libreoffice/convert). Nothing else
// changes — merge-field filling happens in ClearHR
// (`document-template-fields.ts`), never in the renderer.
//
// Env (server-only):
//   PDF_SERVICES_CLIENT_ID, PDF_SERVICES_CLIENT_SECRET — Adobe credentials
//   PDF_SERVICES_BASE_URL — optional; defaults to the EU region host.

import { DOCX_CONTENT_TYPE } from "@/lib/document-template-fields";

const DEFAULT_BASE = "https://pdf-services-ew1.adobe.io";
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 90_000;

export const RENDERER_NOT_CONFIGURED_ERROR =
  "PDF conversion isn't set up yet (PDF Services credentials are missing), so documents can't be generated from templates.";

function config() {
  const clientId = process.env.PDF_SERVICES_CLIENT_ID?.trim();
  const clientSecret = process.env.PDF_SERVICES_CLIENT_SECRET?.trim();
  const base = (process.env.PDF_SERVICES_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
  return { clientId, clientSecret, base };
}

/** True when the renderer has the credentials it needs. */
export function rendererConfigured(): boolean {
  const { clientId, clientSecret } = config();
  return Boolean(clientId && clientSecret);
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const { clientId, clientSecret, base } = config();
  const res = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId!, client_secret: clientSecret! }).toString(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PDF conversion sign-in failed (${res.status}).`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("PDF conversion sign-in failed (no token).");
  cachedToken = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Converts a filled .docx to PDF bytes. Throws a readable Error on failure. */
export async function renderDocxToPdf(docx: Uint8Array): Promise<Uint8Array> {
  if (!rendererConfigured()) throw new Error(RENDERER_NOT_CONFIGURED_ERROR);
  const { clientId, base } = config();
  const token = await getAccessToken();
  const auth = { Authorization: `Bearer ${token}`, "x-api-key": clientId! };

  // 1. Ask for an upload slot.
  const assetRes = await fetch(`${base}/assets`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ mediaType: DOCX_CONTENT_TYPE }),
    cache: "no-store",
  });
  if (!assetRes.ok) throw new Error(`PDF conversion failed at upload (${assetRes.status}).`);
  const { uploadUri, assetID } = (await assetRes.json()) as { uploadUri: string; assetID: string };

  try {
    // 2. Upload the filled .docx.
    const put = await fetch(uploadUri, {
      method: "PUT",
      headers: { "Content-Type": DOCX_CONTENT_TYPE },
      body: Buffer.from(docx),
      cache: "no-store",
    });
    if (!put.ok) throw new Error(`PDF conversion failed while uploading (${put.status}).`);

    // 3. Start the Create PDF job.
    const job = await fetch(`${base}/operation/createpdf`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ assetID }),
      cache: "no-store",
    });
    const location = job.headers.get("location");
    if (!job.ok || !location) throw new Error(`PDF conversion could not start (${job.status}).`);

    // 4. Poll until done.
    const started = Date.now();
    let downloadUri: string | null = null;
    while (Date.now() - started < POLL_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS);
      const st = await fetch(location, { headers: auth, cache: "no-store" });
      if (!st.ok) throw new Error(`PDF conversion status check failed (${st.status}).`);
      const body = (await st.json()) as {
        status?: string;
        asset?: { downloadUri?: string; assetID?: string };
        error?: { message?: string };
      };
      if (body.status === "done") {
        downloadUri = body.asset?.downloadUri ?? null;
        if (body.asset?.assetID) void deleteAsset(base, auth, body.asset.assetID);
        break;
      }
      if (body.status === "failed") {
        throw new Error(`PDF conversion failed: ${body.error?.message ?? "unknown error"}.`);
      }
    }
    if (!downloadUri) throw new Error("PDF conversion timed out. Please try again.");

    // 5. Fetch the PDF.
    const pdf = await fetch(downloadUri, { cache: "no-store" });
    if (!pdf.ok) throw new Error(`PDF conversion download failed (${pdf.status}).`);
    return new Uint8Array(await pdf.arrayBuffer());
  } finally {
    // Don't leave the member's filled document on Adobe's side longer
    // than needed (they also expire it automatically).
    void deleteAsset(base, auth, assetID);
  }
}

async function deleteAsset(base: string, auth: Record<string, string>, assetID: string): Promise<void> {
  try {
    await fetch(`${base}/assets/${encodeURIComponent(assetID)}`, { method: "DELETE", headers: auth, cache: "no-store" });
  } catch {
    /* best effort */
  }
}
