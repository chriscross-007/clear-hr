"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";

function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}

type CallerInfo = { orgId: string; actorId: string; actorName: string };

async function getCallerOrgId(): Promise<CallerInfo> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: membership } = await supabase
    .from("members")
    .select("id, organisation_id, role, first_name, last_name")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) throw new Error("No organisation");
  if (membership.role !== "owner") throw new Error("Owner access required");

  return {
    orgId: membership.organisation_id,
    actorId: membership.id,
    actorName: `${membership.first_name} ${membership.last_name}`,
  };
}

export type BackupSummary = {
  id: string;
  name: string;
  created_at: string;
  member_count: number;
  schema_version: number;
};

type BackupMember = {
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  team_name: string | null;
  payroll_number: string | null;
  known_as: string | null;
  avatar_url: string | null;
  custom_fields: Record<string, unknown> | null;
};

type BackupFieldDef = {
  label: string;
  field_key: string;
  field_type: string;
  options: string[] | null;
  required: boolean;
  sort_order: number;
  max_decimal_places: number | null;
  object_type: string;
};

type BackupJson = {
  schema_version: 1;
  exported_at: string;
  organisation: {
    name: string;
    member_label: string;
    currency_symbol: string;
  };
  teams: Array<{ name: string }>;
  custom_field_definitions: BackupFieldDef[];
  members: BackupMember[];
};

export type RestoreMode = "member_data" | "structure" | "full";

export type RestorePreview = {
  mode: RestoreMode;
  membersToUpdate: number;
  membersToAdd: number;
  membersUnchanged: number;
  membersToDelete: number;
  orgSettingsChanged: boolean;
  teamsToAdd: string[];
  teamsToUpdate: string[];
  fieldDefsToAdd: string[];
  fieldDefsToUpdate: string[];
};

export async function createBackup(
  name: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { orgId, actorId, actorName } = await getCallerOrgId();
    const admin = createAdminClient();

    const { data: org } = await admin
      .from("organisations")
      .select("name, member_label, currency_symbol")
      .eq("id", orgId)
      .single();
    if (!org) return { success: false, error: "Organisation not found" };

    const { data: teams } = await admin
      .from("teams")
      .select("id, name")
      .eq("organisation_id", orgId)
      .order("name");

    const { data: fieldDefs } = await admin
      .from("custom_field_definitions")
      .select(
        "label, field_key, field_type, options, required, sort_order, max_decimal_places, object_type"
      )
      .eq("organisation_id", orgId)
      .order("sort_order");

    const { data: members } = await admin
      .from("members")
      .select(
        "first_name, last_name, email, role, team_id, payroll_number, known_as, avatar_url, custom_fields"
      )
      .eq("organisation_id", orgId);

    const teamMap = new Map((teams ?? []).map((t) => [t.id, t.name]));

    const backupMembers: BackupMember[] = (members ?? []).map((m) => ({
      first_name: m.first_name,
      last_name: m.last_name,
      email: m.email,
      role: m.role,
      team_name: m.team_id ? (teamMap.get(m.team_id) ?? null) : null,
      payroll_number: m.payroll_number ?? null,
      known_as: m.known_as ?? null,
      avatar_url: m.avatar_url ?? null,
      custom_fields: (m.custom_fields as Record<string, unknown>) ?? null,
    }));

    const backupJson: BackupJson = {
      schema_version: 1,
      exported_at: new Date().toISOString(),
      organisation: {
        name: org.name,
        member_label: org.member_label ?? "member",
        currency_symbol: org.currency_symbol ?? "£",
      },
      teams: (teams ?? []).map((t) => ({ name: t.name })),
      custom_field_definitions: (fieldDefs ?? []) as BackupFieldDef[],
      members: backupMembers,
    };

    const safeName = name.replace(/[^a-z0-9]/gi, "_").slice(0, 50);
    const filePath = `${orgId}/${Date.now()}_${safeName}.json`;
    const blob = new Blob([JSON.stringify(backupJson, null, 2)], {
      type: "application/json",
    });

    const { error: uploadError } = await admin.storage
      .from("org-backups")
      .upload(filePath, blob, { contentType: "application/json" });
    if (uploadError) return { success: false, error: uploadError.message };

    const { error: insertError } = await admin.from("org_backups").insert({
      organisation_id: orgId,
      name,
      file_path: filePath,
      schema_version: 1,
      member_count: backupMembers.length,
    });
    if (insertError) {
      await admin.storage.from("org-backups").remove([filePath]);
      return { success: false, error: insertError.message };
    }

    logAudit({
      organisationId: orgId,
      actorId,
      actorName,
      action: "backup.created",
      targetType: "backup",
      targetLabel: name,
      metadata: { member_count: backupMembers.length },
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function listBackups(): Promise<{
  success: boolean;
  backups?: BackupSummary[];
  error?: string;
}> {
  try {
    const { orgId } = await getCallerOrgId();
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("org_backups")
      .select("id, name, created_at, member_count, schema_version")
      .eq("organisation_id", orgId)
      .order("created_at", { ascending: false });

    if (error) return { success: false, error: error.message };
    return { success: true, backups: data as BackupSummary[] };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function deleteBackup(
  backupId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { orgId } = await getCallerOrgId();
    const admin = createAdminClient();

    const { data: row } = await admin
      .from("org_backups")
      .select("file_path, organisation_id")
      .eq("id", backupId)
      .single();

    if (!row) return { success: false, error: "Backup not found" };
    if (row.organisation_id !== orgId)
      return { success: false, error: "Not your backup" };

    await admin.storage.from("org-backups").remove([row.file_path]);

    const { error } = await admin
      .from("org_backups")
      .delete()
      .eq("id", backupId);
    if (error) return { success: false, error: error.message };

    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

async function downloadBackupJson(
  backupId: string,
  orgId: string
): Promise<BackupJson> {
  const admin = createAdminClient();

  const { data: row } = await admin
    .from("org_backups")
    .select("file_path, organisation_id")
    .eq("id", backupId)
    .single();

  if (!row) throw new Error("Backup not found");
  if (row.organisation_id !== orgId) throw new Error("Not your backup");

  const { data: fileData, error: downloadError } = await admin.storage
    .from("org-backups")
    .download(row.file_path);
  if (downloadError || !fileData)
    throw new Error(downloadError?.message ?? "Failed to download backup");

  const text = await fileData.text();
  return JSON.parse(text) as BackupJson;
}

export async function previewRestore(
  backupId: string,
  mode: RestoreMode
): Promise<{ success: boolean; preview?: RestorePreview; error?: string }> {
  try {
    const { orgId } = await getCallerOrgId();
    const admin = createAdminClient();
    const backup = await downloadBackupJson(backupId, orgId);

    const preview: RestorePreview = {
      mode,
      membersToUpdate: 0,
      membersToAdd: 0,
      membersUnchanged: 0,
      membersToDelete: 0,
      orgSettingsChanged: false,
      teamsToAdd: [],
      teamsToUpdate: [],
      fieldDefsToAdd: [],
      fieldDefsToUpdate: [],
    };

    if (mode === "member_data" || mode === "full") {
      const { data: currentMembers } = await admin
        .from("members")
        .select("email, role")
        .eq("organisation_id", orgId);

      const currentEmailSet = new Set(
        (currentMembers ?? []).map((m) => m.email)
      );
      const backupEmailSet = new Set(backup.members.map((m) => m.email));

      for (const bm of backup.members) {
        if (currentEmailSet.has(bm.email)) {
          preview.membersToUpdate++;
        } else {
          preview.membersToAdd++;
        }
      }

      for (const cm of currentMembers ?? []) {
        if (!backupEmailSet.has(cm.email)) {
          if (mode === "full" && cm.role !== "owner") {
            preview.membersToDelete++;
          } else {
            preview.membersUnchanged++;
          }
        }
      }
    }

    if (mode === "structure" || mode === "full") {
      const { data: org } = await admin
        .from("organisations")
        .select("name, member_label, currency_symbol")
        .eq("id", orgId)
        .single();
      if (org) {
        preview.orgSettingsChanged =
          org.name !== backup.organisation.name ||
          org.member_label !== backup.organisation.member_label ||
          org.currency_symbol !== backup.organisation.currency_symbol;
      }

      const { data: currentTeams } = await admin
        .from("teams")
        .select("name")
        .eq("organisation_id", orgId);
      const currentTeamNames = new Set(
        (currentTeams ?? []).map((t) => t.name)
      );
      for (const bt of backup.teams) {
        if (!currentTeamNames.has(bt.name)) {
          preview.teamsToAdd.push(bt.name);
        }
      }

      const { data: currentDefs } = await admin
        .from("custom_field_definitions")
        .select(
          "field_key, label, field_type, options, required, sort_order, max_decimal_places"
        )
        .eq("organisation_id", orgId);
      const currentDefsMap = new Map(
        (currentDefs ?? []).map((d) => [d.field_key, d])
      );

      for (const bf of backup.custom_field_definitions) {
        if (!currentDefsMap.has(bf.field_key)) {
          preview.fieldDefsToAdd.push(bf.label);
        } else {
          const cur = currentDefsMap.get(bf.field_key)!;
          const changed =
            cur.label !== bf.label ||
            cur.field_type !== bf.field_type ||
            JSON.stringify(cur.options) !== JSON.stringify(bf.options) ||
            cur.required !== bf.required ||
            cur.sort_order !== bf.sort_order ||
            cur.max_decimal_places !== bf.max_decimal_places;
          if (changed) preview.fieldDefsToUpdate.push(bf.label);
        }
      }
    }

    return { success: true, preview };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function restoreBackup(
  backupId: string,
  mode: RestoreMode,
  confirmText?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { orgId } = await getCallerOrgId();
    const admin = createAdminClient();

    if (mode === "full") {
      const { data: org } = await admin
        .from("organisations")
        .select("name")
        .eq("id", orgId)
        .single();
      if (!org) return { success: false, error: "Organisation not found" };
      if (confirmText !== org.name)
        return { success: false, error: "Organisation name does not match" };
    }

    const backup = await downloadBackupJson(backupId, orgId);

    // Apply structure
    if (mode === "structure" || mode === "full") {
      await admin
        .from("organisations")
        .update({
          name: backup.organisation.name,
          member_label: backup.organisation.member_label,
          currency_symbol: backup.organisation.currency_symbol,
        })
        .eq("id", orgId);

      for (const bt of backup.teams) {
        const { data: existing } = await admin
          .from("teams")
          .select("id")
          .eq("organisation_id", orgId)
          .eq("name", bt.name)
          .maybeSingle();
        if (!existing) {
          await admin
            .from("teams")
            .insert({ organisation_id: orgId, name: bt.name });
        }
      }

      for (const bf of backup.custom_field_definitions) {
        const { error: upsertError } = await admin
          .from("custom_field_definitions")
          .upsert(
            {
              organisation_id: orgId,
              object_type: bf.object_type,
              label: bf.label,
              field_key: bf.field_key,
              field_type: bf.field_type,
              options: bf.options,
              required: bf.required,
              sort_order: bf.sort_order,
              max_decimal_places: bf.max_decimal_places,
            },
            { onConflict: "organisation_id,field_key" }
          );
        if (upsertError) return { success: false, error: upsertError.message };
      }
    }

    // Apply members
    if (mode === "member_data" || mode === "full") {
      if (mode === "full") {
        await admin
          .from("members")
          .delete()
          .eq("organisation_id", orgId)
          .neq("role", "owner");
      }

      const { data: currentMembers } = await admin
        .from("members")
        .select("id, email")
        .eq("organisation_id", orgId);
      const currentByEmail = new Map(
        (currentMembers ?? []).map((m) => [m.email, m])
      );

      const { data: currentTeams } = await admin
        .from("teams")
        .select("id, name")
        .eq("organisation_id", orgId);
      const teamNameToId = new Map(
        (currentTeams ?? []).map((t) => [t.name, t.id])
      );

      for (const bm of backup.members) {
        const teamId = bm.team_name
          ? (teamNameToId.get(bm.team_name) ?? null)
          : null;
        const existing = currentByEmail.get(bm.email);

        if (existing) {
          await admin
            .from("members")
            .update({
              custom_fields: bm.custom_fields ?? {},
              payroll_number: bm.payroll_number,
              known_as: bm.known_as,
              avatar_url: bm.avatar_url,
              team_id: teamId,
            })
            .eq("id", existing.id);
        } else {
          const insertRole =
            bm.role === "owner" ? "employee" : bm.role;
          await admin.from("members").insert({
            organisation_id: orgId,
            email: bm.email,
            first_name: bm.first_name,
            last_name: bm.last_name,
            role: insertRole,
            team_id: teamId,
            payroll_number: bm.payroll_number,
            known_as: bm.known_as,
            avatar_url: bm.avatar_url,
            custom_fields: bm.custom_fields ?? {},
            user_id: null,
          });
        }
      }
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
