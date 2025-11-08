import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

/**
 * Home page - Redirects authenticated users to chat
 */
export default async function Home() {
  const { userId } = await auth();

  // Redirect authenticated users to chat
  if (userId) {
    redirect("/chat");
  }

  // Landing page for unauthenticated users
  return (
    <main className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center bg-background text-foreground">
      <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
        <h1 className="text-5xl font-extrabold tracking-tight sm:text-[5rem]">
          Charm <span className="text-primary">v2</span>
        </h1>
        <p className="text-2xl">Subscription Management Platform</p>
        <p className="max-w-2xl text-center text-lg text-muted-foreground">
          Subscribe to anything using natural language. We handle the rest.
        </p>
        <div className="flex gap-4">
          <Link
            href="/sign-in"
            className="rounded-full bg-muted px-8 py-3 font-semibold text-foreground transition hover:bg-muted/90"
          >
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className="rounded-full bg-primary px-8 py-3 font-semibold text-primary-foreground transition hover:bg-primary/90"
          >
            Get Started
          </Link>
        </div>
      </div>
    </main>
  );
}
