"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TeamCalendar, type TeamMember, type TeamBooking, type TeamBankHoliday } from "@/components/team-calendar";

interface AvailabilityClientProps {
  teams: { id: string; name: string; min_cover: number | null }[];
  members: (TeamMember & { teamId: string | null })[];
  bookings: TeamBooking[];
  bankHolidays: TeamBankHoliday[];
  initialMonth?: string;
}

export function AvailabilityClient({ teams, members, bookings, bankHolidays, initialMonth }: AvailabilityClientProps) {
  const [selectedTeamId, setSelectedTeamId] = useState<string>("__all__");

  const selectedTeam = teams.find((t) => t.id === selectedTeamId);

  const filteredMembers = selectedTeamId === "__all__"
    ? members
    : members.filter((m) => m.teamId === selectedTeamId);

  const heading = selectedTeam
    ? `${selectedTeam.name} Availability`
    : "Team Availability";

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">{heading}</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Team:</span>
          <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
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
      {selectedTeam?.min_cover != null && selectedTeam.min_cover > 0 && (
        <p className="text-sm text-muted-foreground mb-4">Minimum Cover: {selectedTeam.min_cover}</p>
      )}
      {(!selectedTeam || !selectedTeam.min_cover || selectedTeam.min_cover <= 0) && <div className="mb-4" />}

      <div className="flex justify-center">
        <div className="w-fit overflow-x-auto">
          <TeamCalendar
            members={filteredMembers}
            bookings={bookings}
            bankHolidays={bankHolidays}
            initialMonth={initialMonth}
          />
        </div>
      </div>
    </>
  );
}
