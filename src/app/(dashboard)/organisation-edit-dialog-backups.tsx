"use client";

import { useState, useEffect } from "react";
import { Trash2, History } from "lucide-react";
import {
  createBackup,
  listBackups,
  deleteBackup,
  previewRestore,
  restoreBackup,
  type BackupSummary,
  type RestoreMode,
  type RestorePreview,
} from "./backup-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface BackupsManagerProps {
  orgName: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const MODE_LABELS: Record<RestoreMode, string> = {
  member_data: "Restore member data",
  structure: "Restore structure",
  full: "Full restore",
};

const MODE_DESCRIPTIONS: Record<RestoreMode, string> = {
  member_data:
    "Updates custom fields on existing members by email. Adds new members from backup. Does not change teams or field definitions.",
  structure:
    "Restores org settings, teams, and custom field definitions. Member data is not changed.",
  full: "Replaces all members and structure. Members will be unlinked and need re-inviting. Cannot be undone.",
};

export function BackupsManager({ orgName }: BackupsManagerProps) {
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Create backup state
  const [backupName, setBackupName] = useState(
    () => `Backup ${new Date().toISOString().slice(0, 10)}`
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Delete confirm state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Restore dialog state
  const [restoreBackupItem, setRestoreBackupItem] =
    useState<BackupSummary | null>(null);
  const [restoreStep, setRestoreStep] = useState<"mode" | "preview" | "confirm">("mode");
  const [restoreMode, setRestoreMode] = useState<RestoreMode>("member_data");
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState(false);

  useEffect(() => {
    loadBackups();
  }, []);

  async function loadBackups() {
    setLoadError(null);
    const result = await listBackups();
    if (result.success && result.backups) {
      setBackups(result.backups);
    } else {
      setLoadError(result.error ?? "Failed to load backups");
    }
  }

  async function handleCreate() {
    if (!backupName.trim()) return;
    setCreating(true);
    setCreateError(null);
    const result = await createBackup(backupName.trim());
    if (result.success) {
      setBackupName(`Backup ${new Date().toISOString().slice(0, 10)}`);
      await loadBackups();
    } else {
      setCreateError(result.error ?? "Failed to create backup");
    }
    setCreating(false);
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    const result = await deleteBackup(id);
    if (result.success) {
      setBackups((prev) => prev.filter((b) => b.id !== id));
      setDeleteConfirmId(null);
    }
    setDeleting(false);
  }

  function openRestoreDialog(backup: BackupSummary) {
    setRestoreBackupItem(backup);
    setRestoreStep("mode");
    setRestoreMode("member_data");
    setPreview(null);
    setPreviewError(null);
    setConfirmText("");
    setRestoreError(null);
    setRestoreSuccess(false);
  }

  function closeRestoreDialog() {
    setRestoreBackupItem(null);
  }

  async function handlePreview() {
    if (!restoreBackupItem) return;
    setPreviewLoading(true);
    setPreviewError(null);
    const result = await previewRestore(restoreBackupItem.id, restoreMode);
    if (result.success && result.preview) {
      setPreview(result.preview);
      setRestoreStep("preview");
    } else {
      setPreviewError(result.error ?? "Failed to load preview");
    }
    setPreviewLoading(false);
  }

  function handleProceedFromPreview() {
    if (restoreMode === "full") {
      setConfirmText("");
      setRestoreStep("confirm");
    } else {
      handleRestore();
    }
  }

  async function handleRestore() {
    if (!restoreBackupItem) return;
    setRestoreLoading(true);
    setRestoreError(null);
    const result = await restoreBackup(
      restoreBackupItem.id,
      restoreMode,
      restoreMode === "full" ? confirmText : undefined
    );
    if (result.success) {
      setRestoreSuccess(true);
    } else {
      setRestoreError(result.error ?? "Restore failed");
    }
    setRestoreLoading(false);
  }

  const canConfirmRestore =
    restoreMode !== "full" || confirmText === orgName;

  return (
    <div className="space-y-4">
      {/* Create backup */}
      <div className="space-y-2">
        <Label>Create Backup</Label>
        <div className="flex gap-2">
          <Input
            value={backupName}
            onChange={(e) => setBackupName(e.target.value)}
            placeholder="Backup name"
            maxLength={100}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreate();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleCreate}
            disabled={creating || !backupName.trim()}
            className="shrink-0"
          >
            {creating ? "Creating…" : "Create Backup"}
          </Button>
        </div>
        {createError && (
          <p className="text-sm text-destructive">{createError}</p>
        )}
      </div>

      {/* Backup list */}
      <div className="space-y-2">
        {loadError && (
          <p className="text-sm text-destructive">{loadError}</p>
        )}
        {backups.length === 0 && !loadError && (
          <p className="text-sm text-muted-foreground">No backups yet.</p>
        )}
        {backups.map((b) => (
          <div
            key={b.id}
            className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <p className="font-medium truncate">{b.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(b.created_at)} · {b.member_count} member
                {b.member_count !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Restore"
                onClick={() => openRestoreDialog(b)}
              >
                <History className="h-3.5 w-3.5" />
              </Button>
              {deleteConfirmId === b.id ? (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-destructive">Delete?</span>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => handleDelete(b.id)}
                    disabled={deleting}
                  >
                    Yes
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setDeleteConfirmId(null)}
                  >
                    No
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Delete"
                  onClick={() => setDeleteConfirmId(b.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Restore dialog */}
      <Dialog
        open={!!restoreBackupItem}
        onOpenChange={(open) => { if (!open) closeRestoreDialog(); }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Restore: {restoreBackupItem?.name}
            </DialogTitle>
          </DialogHeader>

          {restoreSuccess ? (
            <div className="space-y-4">
              <p className="text-sm text-green-600">
                Restore completed successfully.
              </p>
              <DialogFooter>
                <Button type="button" onClick={closeRestoreDialog}>
                  Close
                </Button>
              </DialogFooter>
            </div>
          ) : restoreStep === "mode" ? (
            <div className="space-y-4">
              <RadioGroup
                value={restoreMode}
                onValueChange={(v) => setRestoreMode(v as RestoreMode)}
                className="space-y-3"
              >
                {(["member_data", "structure", "full"] as RestoreMode[]).map(
                  (mode) => (
                    <label
                      key={mode}
                      className="flex items-start gap-3 rounded-md border px-3 py-2.5 cursor-pointer has-[[data-state=checked]]:border-primary"
                    >
                      <RadioGroupItem
                        value={mode}
                        id={`restore-mode-${mode}`}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-sm font-medium">
                          {MODE_LABELS[mode]}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {MODE_DESCRIPTIONS[mode]}
                        </p>
                      </div>
                    </label>
                  )
                )}
              </RadioGroup>
              {previewError && (
                <p className="text-sm text-destructive">{previewError}</p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeRestoreDialog}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handlePreview}
                  disabled={previewLoading}
                >
                  {previewLoading ? "Loading…" : "Preview →"}
                </Button>
              </DialogFooter>
            </div>
          ) : restoreStep === "preview" && preview ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">
                {MODE_LABELS[restoreMode]} — changes to apply:
              </p>

              {(restoreMode === "member_data" || restoreMode === "full") && (
                <div className="rounded-md border px-3 py-2 space-y-1 text-sm">
                  <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-1">
                    Members
                  </p>
                  {preview.membersToUpdate > 0 && (
                    <p>{preview.membersToUpdate} will be updated</p>
                  )}
                  {preview.membersToAdd > 0 && (
                    <p>{preview.membersToAdd} will be added</p>
                  )}
                  {preview.membersToDelete > 0 && (
                    <p className="text-destructive">
                      {preview.membersToDelete} will be deleted
                    </p>
                  )}
                  {preview.membersUnchanged > 0 && (
                    <p className="text-muted-foreground">
                      {preview.membersUnchanged} unchanged
                    </p>
                  )}
                  {preview.membersToUpdate === 0 &&
                    preview.membersToAdd === 0 &&
                    preview.membersToDelete === 0 && (
                      <p className="text-muted-foreground">No changes</p>
                    )}
                </div>
              )}

              {(restoreMode === "structure" || restoreMode === "full") && (
                <div className="rounded-md border px-3 py-2 space-y-1 text-sm">
                  <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-1">
                    Structure
                  </p>
                  {preview.orgSettingsChanged && (
                    <p>Organisation settings will be updated</p>
                  )}
                  {preview.teamsToAdd.length > 0 && (
                    <p>
                      Teams to add:{" "}
                      <span className="font-medium">
                        {preview.teamsToAdd.join(", ")}
                      </span>
                    </p>
                  )}
                  {preview.fieldDefsToAdd.length > 0 && (
                    <p>
                      Fields to add:{" "}
                      <span className="font-medium">
                        {preview.fieldDefsToAdd.join(", ")}
                      </span>
                    </p>
                  )}
                  {preview.fieldDefsToUpdate.length > 0 && (
                    <p>
                      Fields to update:{" "}
                      <span className="font-medium">
                        {preview.fieldDefsToUpdate.join(", ")}
                      </span>
                    </p>
                  )}
                  {!preview.orgSettingsChanged &&
                    preview.teamsToAdd.length === 0 &&
                    preview.fieldDefsToAdd.length === 0 &&
                    preview.fieldDefsToUpdate.length === 0 && (
                      <p className="text-muted-foreground">No changes</p>
                    )}
                </div>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRestoreStep("mode")}
                >
                  ← Back
                </Button>
                <Button
                  type="button"
                  onClick={handleProceedFromPreview}
                  disabled={restoreLoading}
                >
                  {restoreMode === "full"
                    ? "Proceed"
                    : restoreLoading
                      ? "Restoring…"
                      : "Restore"}
                </Button>
              </DialogFooter>
            </div>
          ) : restoreStep === "confirm" ? (
            <div className="space-y-4">
              <div className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                This will delete all non-owner members and replace all data from
                the backup. This cannot be undone.
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-org-name">
                  Type{" "}
                  <span className="font-semibold">{orgName}</span> to confirm
                </Label>
                <Input
                  id="confirm-org-name"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={orgName}
                />
              </div>
              {restoreError && (
                <p className="text-sm text-destructive">{restoreError}</p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRestoreStep("preview")}
                >
                  ← Back
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleRestore}
                  disabled={restoreLoading || !canConfirmRestore}
                >
                  {restoreLoading ? "Restoring…" : "Restore"}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
