"use client";

import { useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TeamCalendar, type TeamMember, type TeamBooking, type TeamBankHoliday } from "@/components/team-calendar";
import { StickyPageHeader } from "@/components/ui/sticky-page-header";
import { getAvailabilityBookingsForMonth } from "./actions";
import { saveGridPrefs } from "@/lib/grid-prefs-actions";

interface AvailabilityClientProps {
  teams: { id: string; name: string; min_cover: number | null }[];
  members: (TeamMember & { teamId: string | null })[];
  bookings: TeamBooking[];
  bankHolidays: TeamBankHoliday[];
  bankHolidayColour?: string;
  initialMonth?: string;
  /** "YYYY-MM" keys covered by the server's initial fetch. The client
   *  skips re-fetching these on the first navigation events. */
  initialLoadedMonths: string[];
  /** CLE-189 — admin's persisted Team dropdown selection (or "__all__"). */
  initialSelectedTeamId: string;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function AvailabilityClient({ teams, members, bookings: initialBookings, bankHolidays, bankHolidayColour, initialMonth, initialLoadedMonths, initialSelectedTeamId }: AvailabilityClientProps) {
  const [selectedTeamId, setSelectedTeamId] = useState<string>(initialSelectedTeamId);

  // CLE-189 — persist the selection so it survives reloads + navigation.
  // Fire-and-forget; the upsert is keyed by (user_id, grid_id) so concurrent
  // changes simply overwrite. No debounce needed — the Select only fires on
  // discrete picks.
  function handleTeamChange(newTeamId: string) {
    setSelectedTeamId(newTeamId);
    void saveGridPrefs("availability", { columns: [], selectedKey: newTeamId });
  }

  // CLE-188 — bookings live in state so we can append lazy-loaded months.
  // Dedupe by booking.id (which the server always provides for these rows)
  // — bookings spanning month boundaries appear in adjacent months' fetches
  // and would otherwise show twice.
  const [bookings, setBookings] = useState<TeamBooking[]>(initialBookings);
  const loadedMonths = useRef<Set<string>>(new Set(initialLoadedMonths));
  // Track in-flight fetches so two near-simultaneous month nav clicks don't
  // both fire the same fetch.
  const inFlightMonths = useRef<Set<string>>(new Set());

  async function handleMonthChange(year: number, month: number) {
    const key = monthKey(year, month);
    if (loadedMonths.current.has(key)) return;
    if (inFlightMonths.current.has(key)) return;
    inFlightMonths.current.add(key);
    try {
      const res = await getAvailabilityBookingsForMonth(year, month);
      if (!res.success) return;
      loadedMonths.current.add(key);
      setBookings((prev) => {
        const byId = new Map<string, TeamBooking>();
        for (const b of prev) {
          if (b.id) byId.set(b.id, b);
        }
        for (const b of res.bookings) {
          if (b.id) byId.set(b.id, b);
        }
        // Preserve any bookings without ids (legacy callers) by keeping
        // the previous array's non-id entries.
        const merged = [
          ...prev.filter((b) => !b.id),
          ...byId.values(),
        ];
        return merged;
      });
    } finally {
      inFlightMonths.current.delete(key);
    }
  }

  const selectedTeam = teams.find((t) => t.id === selectedTeamId);

  // CLE-185 — single team per member, filter by members.team_id directly.
  const filteredMembers = selectedTeamId === "__all__"
    ? members
    : members.filter((m) => m.teamId === selectedTeamId);

  const heading = selectedTeam
    ? `${selectedTeam.name} Availability`
    : "Team Availability";

  return (
    <>
      <StickyPageHeader>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{heading}</h1>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Team:</span>
            <Select value={selectedTeamId} onValueChange={handleTeamChange}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Teams</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </StickyPageHeader>
      <div className="mb-4" />

      <div className="flex justify-center">
        <div className="w-fit overflow-x-auto">
          {/* CLE-189 — match the Approvals inline calendar: bottom row
              shows members **present** (Cover) rather than off, and any
              working day where present falls below the team's Min Cover
              is highlighted in red. When the viewer has "All Teams"
              selected we still show cover-mode numbers but skip the
              Required cover threshold + red highlights (no single team
              minimum to compare against). */}
          <TeamCalendar
            members={filteredMembers}
            bookings={bookings}
            bankHolidays={bankHolidays}
            bankHolidayColour={bankHolidayColour}
            initialMonth={initialMonth}
            onMonthChange={handleMonthChange}
            coverMode
            requiredCover={selectedTeam?.min_cover ?? undefined}
          />
        </div>
      </div>
    </>
  );
}
