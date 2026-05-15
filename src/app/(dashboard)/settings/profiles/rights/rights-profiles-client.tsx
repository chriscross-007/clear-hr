"use client";

import { useState } from "react";
import { ProfileManager } from "@/app/(dashboard)/organisation-edit-dialog-profiles";
import type { Profile } from "@/app/(dashboard)/employees/profile-actions";
import type { RightDef } from "@/lib/rights-config";
import { cn } from "@/lib/utils";

// CLE-191 — Rights profiles client. Reuses ProfileManager (the existing
// CRUD component used by the old dialog) for each profile type. Switch
// between Admin / Employee inline since they're closely related but
// have separate underlying tables.

interface RightsProfilesClientProps {
  initialAdminProfiles: Profile[];
  initialEmployeeProfiles: Profile[];
  teams: { id: string; name: string }[];
  adminRights: RightDef[];
  employeeRights: RightDef[];
}

export function RightsProfilesClient({
  initialAdminProfiles,
  initialEmployeeProfiles,
  teams,
  adminRights,
  employeeRights,
}: RightsProfilesClientProps) {
  const [type, setType] = useState<"admin" | "employee">("admin");
  const [adminProfiles, setAdminProfiles] = useState<Profile[]>(initialAdminProfiles);
  const [employeeProfiles, setEmployeeProfiles] = useState<Profile[]>(initialEmployeeProfiles);

  return (
    <div className="space-y-4">
      <div className="flex overflow-hidden rounded-md border border-input text-sm w-fit">
        {(["admin", "employee"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={cn(
              "px-4 py-1.5 transition-colors",
              type === t
                ? "bg-primary text-primary-foreground font-medium"
                : "bg-background hover:bg-muted",
            )}
          >
            {t === "admin" ? "Admin" : "Employee"}
          </button>
        ))}
      </div>

      {type === "admin" ? (
        <ProfileManager
          type="admin"
          rightDefs={adminRights}
          profiles={adminProfiles}
          onProfilesChange={setAdminProfiles}
          teams={teams}
        />
      ) : (
        <ProfileManager
          type="employee"
          rightDefs={employeeRights}
          profiles={employeeProfiles}
          onProfilesChange={setEmployeeProfiles}
        />
      )}
    </div>
  );
}
