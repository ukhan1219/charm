"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { useEffect, useState } from "react";

/**
 * ClerkProvider wrapper that syncs with app theme
 * Centers modals and matches light/dark mode
 */
export function ClerkThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    // Get initial theme
    const getTheme = () => {
      const stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark") {
        return stored as "light" | "dark";
      }
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      return prefersDark ? "dark" : "light";
    };

    setTheme(getTheme());

    // Watch for theme changes
    const observer = new MutationObserver(() => {
      const html = document.documentElement;
      if (html.classList.contains("dark")) {
        setTheme("dark");
      } else if (html.classList.contains("light")) {
        setTheme("light");
      } else {
        setTheme(getTheme());
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // Also listen to storage changes (from theme toggle)
    const handleStorageChange = () => {
      setTheme(getTheme());
    };
    window.addEventListener("storage", handleStorageChange);

    return () => {
      observer.disconnect();
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  const appearance = {
    baseTheme: (theme === "dark" ? "dark" : "light") as "dark" | "light",
        variables: {
          colorPrimary: "#00FF84", // Charm primary color
          colorBackground: theme === "dark" ? "#0c0c0c" : "#f5f5f5",
          colorText: theme === "dark" ? "#f5f5f5" : "#0c0c0c",
          colorInputBackground: theme === "dark" ? "#262626" : "#ffffff",
          colorInputText: theme === "dark" ? "#f5f5f5" : "#0c0c0c",
          colorTextSecondary: theme === "dark" ? "#a3a3a3" : "#737373",
          colorNeutral: theme === "dark" ? "#f5f5f5" : "#0c0c0c",
          borderRadius: "0.5rem",
          fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        },
        elements: {
          rootBox: "mx-auto",
          modalContent: "mx-auto",
          card: "mx-auto shadow-lg",
          headerTitle: "text-foreground",
          headerSubtitle: "text-muted-foreground",
          socialButtonsBlockButton: "border-border hover:bg-muted",
          formButtonPrimary: "bg-primary hover:bg-primary/90 text-primary-foreground",
          formFieldInput: "bg-background border-border text-foreground",
          formFieldLabel: "text-foreground",
          footerActionLink: "text-primary hover:text-primary/80",
          identityPreviewText: "text-foreground",
          identityPreviewEditButton: "text-primary hover:text-primary/80",
        },
        layout: {
          socialButtonsPlacement: "top",
          socialButtonsVariant: "blockButton",
          showOptionalFields: false,
    },
  };

  return <ClerkProvider appearance={appearance as any}>{children}</ClerkProvider>;
}

