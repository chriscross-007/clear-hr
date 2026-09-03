"use server";

// CLE-209 follow-up — Storage usage summary. Counts bytes + file
// counts per bucket, scoped to the caller's organisation (every
// bucket is keyed by `{organisation_id}/...` prefix).
//
// Uses admin client because storage.list needs to see every object.

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";

export interface BucketUsage {
  bucket: string;
  label: string;
  fileCount: number;
  totalBytes: number;
}

export interface UsageResult {
  buckets: BucketUsage[];
  totalBytes: number;
  totalFiles: number;
}

const BUCKETS: { name: string; label: string }[] = [
  { name: "member-documents", label: "Per-member documents" },
  { name: "org-documents",    label: "Organisation documents" },
  { name: "member-avatars",   label: "Member avatars" },
  { name: "org-backups",      label: "Organisation backups" },
];

const PAGE_SIZE = 1000;

/**
 * Recursively walk a folder in a bucket and sum bytes. Supabase
 * storage.list is single-level per call, so we descend into any entry
 * whose metadata is null (Supabase convention for a "folder").
 */
// Loose type — the caller passes the service-role admin client.
// Typed as `unknown` at the boundary because the generic Supabase
// client shapes don't line up between `@/lib/supabase/server` and
// `@supabase/supabase-js` at the strict tsc level.
type AdminForStorage = {
  storage: {
    from: (bucket: string) => {
      list: (path: string, opts: { limit: number; offset: number }) => Promise<{
        data: Array<{ name: string; metadata: { size?: number } | null }> | null;
        error: { message: string } | null;
      }>;
    };
  };
};

async function walkFolder(
  admin: AdminForStorage,
  bucket: string,
  path: string,
): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  let offset = 0;
  while (true) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(path, { limit: PAGE_SIZE, offset });
    if (error) throw new Error(`${bucket}/${path}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entry of data) {
      // A folder shows up as { id: null, metadata: null }; a file
      // has metadata with a size.
      const size = entry.metadata?.size;
      if (typeof size === "number") {
        files++;
        bytes += size;
      } else {
        const sub = await walkFolder(admin, bucket, path ? `${path}/${entry.name}` : entry.name);
        files += sub.files;
        bytes += sub.bytes;
      }
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return { files, bytes };
}

// ---------------------------------------------------------------------------
// One-shot: pull external avatar URLs into the member-avatars bucket.
// ---------------------------------------------------------------------------
//
// Seed data historically populated `members.avatar_url` with URLs on
// third-party services (dicebear, pravatar, ui-avatars). Those images
// aren't in our storage — this action downloads each one, uploads it
// to `member-avatars/{org_id}/{member_id}.{ext}`, and rewrites the
// column. Skips members already hosted on Supabase.
//
// Gated on canEditOrgSettings. Idempotent — running it again is a
// no-op for members that already point at the bucket.

const AVATAR_BUCKET = "member-avatars";

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg":  ".jpg",
  "image/png":  ".png",
  "image/webp": ".webp",
  "image/gif":  ".gif",
  "image/svg+xml": ".svg",
};

export interface AvatarMigrationResult {
  scanned: number;
  migrated: number;
  skipped: number;
  failed: Array<{ memberId: string; name: string; error: string }>;
}

export async function migrateExternalAvatarsToStorage(): Promise<
  { success: true; result: AvatarMigrationResult } | { success: false; error: string }
> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };
    const resolved = await getEffectiveRightsForUser(user.id);
    if (!resolved) return { success: false, error: "No organisation" };
    if (!resolved.rights.canEditOrgSettings) {
      return { success: false, error: "Forbidden" };
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    const supabaseUrlHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host;

    const { data: members, error } = await admin
      .from("members")
      .select("id, first_name, last_name, avatar_url")
      .eq("organisation_id", resolved.ctx.organisationId)
      .not("avatar_url", "is", null);
    if (error) return { success: false, error: error.message };

    const rows = (members ?? []) as Array<{
      id: string; first_name: string; last_name: string; avatar_url: string | null;
    }>;

    const out: AvatarMigrationResult = {
      scanned: rows.length,
      migrated: 0,
      skipped: 0,
      failed: [],
    };

    // Cast admin to the storage shape used here — same reason as
    // walkFolder above.
    type StorageAdmin = {
      storage: {
        from: (bucket: string) => {
          upload: (path: string, body: Uint8Array, opts: { contentType: string; upsert: boolean }) => Promise<{ error: { message: string } | null }>;
          getPublicUrl: (path: string) => { data: { publicUrl: string } };
        };
      };
    };
    const storage = (admin as unknown as StorageAdmin).storage;

    for (const m of rows) {
      const url = m.avatar_url as string;
      // Already in our bucket? Skip.
      try {
        const host = new URL(url).host;
        if (host === supabaseUrlHost) {
          out.skipped++;
          continue;
        }
      } catch {
        // Not a valid URL — treat as skip.
        out.skipped++;
        continue;
      }

      try {
        const res = await fetch(url, { redirect: "follow" });
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        const ext = EXT_BY_CONTENT_TYPE[contentType];
        if (!ext) throw new Error(`unsupported content-type "${contentType}"`);
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength === 0) throw new Error("empty response");

        const path = `${resolved.ctx.organisationId}/${m.id}${ext}`;
        const { error: uErr } = await storage.from(AVATAR_BUCKET)
          .upload(path, buf, { contentType, upsert: true });
        if (uErr) throw new Error(`upload: ${uErr.message}`);

        const { data: { publicUrl } } = storage.from(AVATAR_BUCKET).getPublicUrl(path);
        // Cache-bust so already-cached external URL doesn't leak into
        // <img> tags after the swap.
        const busted = `${publicUrl}?v=${Date.now()}`;

        const { error: updErr } = await admin
          .from("members")
          .update({ avatar_url: busted })
          .eq("id", m.id)
          .eq("organisation_id", resolved.ctx.organisationId);
        if (updErr) throw new Error(`update row: ${updErr.message}`);

        out.migrated++;
      } catch (e) {
        out.failed.push({
          memberId: m.id,
          name: `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || m.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { success: true, result: out };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function getStorageUsage(): Promise<
  { success: true; usage: UsageResult } | { success: false; error: string }
> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };
    const resolved = await getEffectiveRightsForUser(user.id);
    if (!resolved) return { success: false, error: "No organisation" };
    // Gate on canEditOrgSettings — usage is admin plumbing.
    if (!resolved.rights.canEditOrgSettings) {
      return { success: false, error: "Forbidden" };
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    ) as unknown as AdminForStorage;

    const orgId = resolved.ctx.organisationId;
    const results: BucketUsage[] = [];
    for (const b of BUCKETS) {
      try {
        const { files, bytes } = await walkFolder(admin, b.name, orgId);
        results.push({ bucket: b.name, label: b.label, fileCount: files, totalBytes: bytes });
      } catch (e) {
        // Bucket may not exist (e.g. new tenant hasn't uploaded avatars).
        // Report zero rather than fail the whole panel.
        const msg = e instanceof Error ? e.message : String(e);
        if (/not.*found|does not exist|bucket/i.test(msg)) {
          results.push({ bucket: b.name, label: b.label, fileCount: 0, totalBytes: 0 });
        } else {
          throw e;
        }
      }
    }

    const totalBytes = results.reduce((s, r) => s + r.totalBytes, 0);
    const totalFiles = results.reduce((s, r) => s + r.fileCount, 0);
    return {
      success: true,
      usage: { buckets: results, totalBytes, totalFiles },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
