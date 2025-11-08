import "~/styles/globals.css";

import {
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/nextjs";
import { type Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { TRPCReactProvider } from "~/trpc/react";
import { ThemeToggle } from "~/components/theme-toggle";
import { NavigationHeader } from "~/components/navigation-header";
import { ClerkThemeProvider } from "~/components/clerk-theme-provider";

export const metadata: Metadata = {
  title: "Charm v2 - Subscription Management",
  description: "Subscribe to anything using natural language",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkThemeProvider>
      <html
        lang="en"
        className={`${geist.variable} ${geistMono.variable}`}
        suppressHydrationWarning
      >
        <head>
          <script
            dangerouslySetInnerHTML={{
              __html: `
                (function() {
                  const stored = localStorage.getItem('theme');
                  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  const theme = stored === 'light' || stored === 'dark' ? stored : (prefersDark ? 'dark' : 'light');
                  document.documentElement.classList.add(theme);
                })();
              `,
            }}
          />
        </head>
        <body className="font-sans bg-background text-foreground antialiased">
          <SignedIn>
            <NavigationHeader />
          </SignedIn>

          <TRPCReactProvider>{children}</TRPCReactProvider>
          <ThemeToggle />
        </body>
      </html>
    </ClerkThemeProvider>
  );
}

/*
            <SignedOut>
              <SignInButton>
                <button className="text-foreground/80 hover:text-foreground transition-colors">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton>
                <button className="bg-primary text-primary-foreground rounded-full font-medium text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 cursor-pointer hover:bg-primary/90 transition-colors">
                  Sign Up
                </button>
              </SignUpButton>
            </SignedOut>
*/
