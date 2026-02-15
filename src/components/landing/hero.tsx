import Link from "next/link";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        {/* Left: Headline + CTA */}
        <div className="space-y-6">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            HR management,{" "}
            <span className="text-primary">simplified</span>
          </h1>
          <p className="max-w-lg text-lg text-muted-foreground">
            Streamline your people operations with ClearHR. From onboarding to
            performance reviews, manage your entire workforce in one intuitive
            platform.
          </p>
          <div className="flex gap-4">
            <Link href="/signup">
              <Button size="lg">Get started free</Button>
            </Link>
            <Link href="#features">
              <Button variant="outline" size="lg">
                Learn more
              </Button>
            </Link>
          </div>
        </div>

        {/* Right: Graphic */}
        <div className="flex items-center justify-center">
          <div className="grid h-80 w-full max-w-md grid-cols-3 gap-3">
            <div className="col-span-2 rounded-xl bg-primary/10 p-6">
              <div className="mb-3 h-3 w-20 rounded bg-primary/30" />
              <div className="mb-2 h-2 w-full rounded bg-primary/20" />
              <div className="mb-2 h-2 w-3/4 rounded bg-primary/20" />
              <div className="mb-6 h-2 w-1/2 rounded bg-primary/20" />
              <div className="flex gap-2">
                <div className="h-8 w-8 rounded-full bg-primary/30" />
                <div className="h-8 w-8 rounded-full bg-primary/20" />
                <div className="h-8 w-8 rounded-full bg-primary/15" />
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl bg-muted p-4">
                <div className="mb-2 h-6 w-6 rounded bg-primary/30" />
                <div className="h-2 w-full rounded bg-primary/20" />
              </div>
              <div className="rounded-xl bg-muted p-4">
                <div className="mb-2 h-6 w-6 rounded bg-primary/30" />
                <div className="h-2 w-full rounded bg-primary/20" />
              </div>
            </div>
            <div className="col-span-3 rounded-xl bg-muted p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/20" />
                <div className="flex-1 space-y-1">
                  <div className="h-2 w-24 rounded bg-primary/30" />
                  <div className="h-2 w-16 rounded bg-primary/15" />
                </div>
                <div className="h-6 w-16 rounded bg-primary/20" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
