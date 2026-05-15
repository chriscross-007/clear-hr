import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// CLE-191 — Shared placeholder for Settings sub-routes that haven't been
// filled in yet. The existing OrganisationEditDialog remains the source
// of truth during the parallel testing period; once a section's
// real implementation lands, its page swaps from this placeholder to
// the lifted form.

interface SectionPlaceholderProps {
  title: string;
  description?: string;
}

export function SectionPlaceholder({ title, description }: SectionPlaceholderProps) {
  return (
    <div className="w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold">{title}</h1>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Under construction</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            This section of Settings hasn&apos;t been wired up yet. Until it lands, use the existing Organisation dialog from the main sidebar (the &ldquo;Organisation&rdquo; button) for these settings.
          </p>
          <p>
            The page exists so the Settings shell + navigation can be tested end-to-end alongside the old dialog.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
