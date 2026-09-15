// CLE-216 — Client-side event bus for "this member's docs changed".
//
// Consumed by the sidebar avatar traffic light (and any future
// per-member docs summary) so those surfaces reload their status
// without a full page refresh whenever an upload / verify / renew /
// delete / expiry / review-date / expected-doc change happens
// elsewhere on the page.
//
// Fire this after any client-side mutation that could shift a
// member's required-docs health. Server actions can't reach the
// window, so the caller (dialog, card, etc.) is responsible for
// dispatching once its own action has resolved successfully.

const EVENT_NAME = "clearhr:member-docs-changed";

export function dispatchMemberDocsChanged(memberId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(EVENT_NAME, { detail: { memberId } }),
  );
}

export function onMemberDocsChanged(
  memberId: string,
  handler: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  function listener(e: Event) {
    const detail = (e as CustomEvent<{ memberId?: string }>).detail;
    if (!detail || detail.memberId !== memberId) return;
    handler();
  }
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
