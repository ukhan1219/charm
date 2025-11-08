"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Dynamically import UserButton to prevent hydration issues
const UserButton = dynamic(
  () => import("@clerk/nextjs").then((mod) => mod.UserButton),
  {
    ssr: false,
    loading: () => (
      <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
    ),
  }
);

export function NavigationHeader() {
  const pathname = usePathname();

  // Determine the route based on current path
  const getRoute = () => {
    if (pathname === "/chat" || pathname === "/overview") {
      return "/dashboard";
    }
    if (pathname === "/dashboard") {
      return "/chat";
    }
    // Default to dashboard for other routes
    return "/dashboard";
  };

  // Determine the label based on current path
  const getLabel = () => {
    if (pathname === "/chat" || pathname === "/overview") {
      return "Dashboard";
    }
    if (pathname === "/dashboard") {
      return "Chat";
    }
    return "Dashboard";
  };

  return (
    <header className="navbar-transparent sticky top-0 z-50 flex h-16 items-center gap-4 p-4 font-sans">
      <Link
        href={getRoute()}
        className="pl-4 text-foreground hover:text-primary text-sm font-medium transition-colors"
      >
        {getLabel()}
      </Link>
      <div className="ml-auto pr-4">
        <UserButton />
      </div>
    </header>
  );
}

