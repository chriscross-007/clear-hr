"use client";

import { useRef } from "react";
import {
  ApprovalsManager,
  type ApprovalsManagerHandle,
} from "@/app/(dashboard)/organisation-edit-dialog-approvals";

// CLE-191 — Approver profiles client. The dialog needed the manager's
// forwardRef commit/revert API to bridge to the global Save button.
// On a full page the manager saves inline (its internal Save button
// commits per-profile via its own server actions), so we hold the ref
// only so the existing onDirtyChange prop is satisfied — we don't act
// on dirty changes here. router.refresh isn't needed either: the
// manager re-fetches its own list after each save.

export function ApproverProfilesClient() {
  const ref = useRef<ApprovalsManagerHandle>(null);
  return <ApprovalsManager ref={ref} onDirtyChange={() => {}} />;
}
