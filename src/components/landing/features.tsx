import {
  Users,
  CalendarDays,
  BarChart3,
  Shield,
  Clock,
  FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const features = [
  {
    icon: Users,
    title: "Employee Directory",
    description:
      "Centralize all employee data in one place. Easily search, filter, and manage your entire workforce.",
  },
  {
    icon: CalendarDays,
    title: "Leave Management",
    description:
      "Automate leave requests and approvals. Track balances, set policies, and keep your team in sync.",
  },
  {
    icon: BarChart3,
    title: "Performance Reviews",
    description:
      "Run structured review cycles with customizable templates. Track goals and provide continuous feedback.",
  },
  {
    icon: Shield,
    title: "Compliance Tracking",
    description:
      "Stay on top of certifications, training, and regulatory requirements with automated reminders.",
  },
  {
    icon: Clock,
    title: "Time & Attendance",
    description:
      "Track work hours, overtime, and shifts. Integrate with payroll for seamless processing.",
  },
  {
    icon: FileText,
    title: "Document Management",
    description:
      "Store and organize contracts, policies, and employee documents securely in one place.",
  },
];

export function Features() {
  return (
    <section id="features" className="bg-muted/50 py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Everything you need to manage your team
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Powerful tools to streamline every aspect of your HR operations.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title}>
              <CardHeader>
                <feature.icon className="mb-2 h-10 w-10 text-primary" />
                <CardTitle>{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
