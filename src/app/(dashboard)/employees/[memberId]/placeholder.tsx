export function PlaceholderSection({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-6 rounded-md border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
        Coming Soon
      </p>
    </div>
  );
}
