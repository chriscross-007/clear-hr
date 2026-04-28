export type AbsentMember = {
  memberId: string;
  memberName: string;
  reasonName: string;
  reasonColour: string;
  isHalfDay: boolean;
  halfDayPeriod: string | null; // "am" or "pm"
};

export type BirthdayMember = {
  memberId: string;
  memberName: string;
};

export type DashboardSummary = {
  absentToday: AbsentMember[];
  onHolidayToday: AbsentMember[];
  birthdaysToday: BirthdayMember[];
};
