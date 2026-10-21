import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/theme-context";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ClearHR - Modern HR Management",
  description:
    "Streamline your people operations with ClearHR. From onboarding to performance reviews, manage your entire workforce in one intuitive platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            // Apply the stored theme before first paint (avoids a flash of
            // Dark). Mirrors normaliseTheme() in contexts/theme-context.tsx.
            __html: `try{var t=localStorage.getItem('clearhr-theme');if(t==='bq')t='accessible';if(t==='vibrant'||t==='accessible'||t==='accessible-dark'){var c=document.documentElement.classList;c.remove('dark');c.add(t);}}catch(e){}`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
