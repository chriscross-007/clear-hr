export const dynamic = "force-dynamic";

import { DocsClient } from "./docs-client";

export default async function DocsPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  return <DocsClient memberId={memberId} />;
}
