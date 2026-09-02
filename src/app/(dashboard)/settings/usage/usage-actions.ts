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
