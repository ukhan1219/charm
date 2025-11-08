import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/nextjs";
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
    <main className="font-sans bg-background text-foreground flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center">
      <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
        <h1 className="text-charm-primary text-5xl font-bold tracking-tight sm:text-[5rem]">
          Charm
        </h1>
        <p className="text-2xl font-medium">Subscription Management Platform</p>
        <p className="text-muted-foreground max-w-2xl text-center text-lg font-normal">
          Subscribe to anything using natural language. We handle the rest.
        </p>
        <div className="flex gap-4">
          <SignInButton mode="modal">
            <button className="bg-background border border-border text-foreground hover:bg-background/75 hover:border-charm-primary/50 rounded-full px-8 py-3 font-medium transition-all shadow-sm hover:shadow-md">
              Sign In
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button className="bg-charm-primary/75 text-primary-foreground hover:bg-charm-primary rounded-full px-8 py-3 font-medium transition-all shadow-sm hover:shadow-md">
              Sign Up
            </button>
          </SignUpButton>
        </div>
      </div>
    </main>
  );
}
