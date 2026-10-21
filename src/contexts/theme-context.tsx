"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "dark" | "vibrant" | "accessible" | "accessible-dark";

/** Picker options, in display order. Labels are user-facing. */
export const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "vibrant", label: "Vibrant" },
  { value: "accessible", label: "Accessible (light)" },
  { value: "accessible-dark", label: "Accessible (dark)" },
];

const THEME_VALUES: Theme[] = THEME_OPTIONS.map((o) => o.value);

/** Stored value → theme. The retired "bq" placeholder maps to
 *  Accessible (light) (CLE-232); anything unknown falls back to Dark. */
export function normaliseTheme(stored: string | null): Theme {
  if (stored === "bq") return "accessible";
  return (THEME_VALUES as string[]).includes(stored ?? "") ? (stored as Theme) : "dark";
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setThemeState(normaliseTheme(localStorage.getItem("clearhr-theme")));
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const html = document.documentElement;
    html.classList.remove("dark", "vibrant", "bq", "accessible", "accessible-dark");
    html.classList.add(theme);
    localStorage.setItem("clearhr-theme", theme);
  }, [theme, mounted]);

  function setTheme(newTheme: Theme) {
    setThemeState(newTheme);
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
