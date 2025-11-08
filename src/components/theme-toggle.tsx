"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  // Initialize from localStorage or system preference
  useEffect(() => {
    const stored = (typeof window !== "undefined" && localStorage.getItem("theme")) as
      | "light"
      | "dark"
      | null;

    if (stored === "light" || stored === "dark") {
      setTheme(stored);
      // Apply immediately on mount
      const root = document.documentElement;
      root.classList.remove(stored === "dark" ? "light" : "dark");
      root.classList.add(stored);
    } else if (typeof window !== "undefined") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const initialTheme = prefersDark ? "dark" : "light";
      setTheme(initialTheme);
      // Apply immediately on mount
      const root = document.documentElement;
      root.classList.remove(initialTheme === "dark" ? "light" : "dark");
      root.classList.add(initialTheme);
    }
    setMounted(true);
  }, []);

  // Apply class to <html> and persist when theme changes
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    root.classList.remove(theme === "dark" ? "light" : "dark");
    root.classList.add(theme);
    localStorage.setItem("theme", theme);
  }, [theme, mounted]);

  const toggle = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    console.log("Toggling theme from", theme, "to", newTheme);
    setTheme(newTheme);
  };

  if (!mounted) return null;

  return (
    <button
      aria-label="Toggle theme"
      onClick={toggle}
      className="fixed bottom-4 right-4 z-50 rounded-full bg-muted text-foreground shadow-lg ring-1 ring-border transition-colors hover:bg-muted/90 focus:outline-none"
    >
      <div className="flex items-center justify-center p-3">
        {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
      </div>
    </button>
  );
}
