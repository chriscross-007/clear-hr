// A member may replace a file they uploaded to their own record (e.g. they
// picked the wrong file) until HR verifies it — the same window HR has.
// Shared by the server action (`replaceMemberDocument`) and the detail
// context (`DocumentDetailContext.memberCanReplace`) so the button and the
// gate always agree. Plain module, no "use server".

export const SELF_REPLACE_NOT_ALLOWED_ERROR =
  "You can only replace a file you uploaded yourself, before it has been verified.";

export function memberCanReplaceOwnDocument(input: {
  callerMemberId: string;
  ownerId: string | null;
  uploadedBy: string | null;
  verifiedOn: string | null;
  archivedAt: string | null;
  hasAcknowledgements: boolean;
  employeeCanUpload: boolean;
}): boolean {
  return (
    input.ownerId === input.callerMemberId &&
    input.uploadedBy === input.callerMemberId &&
    input.employeeCanUpload &&
    input.verifiedOn === null &&
    input.archivedAt === null &&
    !input.hasAcknowledgements
  );
}
