import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Chat } from "~/components/chat";
import { getOrCreateUserByClerkId, getMessagesByUserId } from "~/server/db/queries";

/**
 * Chat page - Single persistent conversation per user
 * Requires authentication via Clerk
 */
export default async function ChatPage() {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    redirect("/sign-in");
  }

  // Get current user info from Clerk
  const clerkUser = await currentUser();
  const email = clerkUser?.emailAddresses[0]?.emailAddress || "unknown@example.com";

  // Map Clerk user to database user (get or create)
  const dbUser = await getOrCreateUserByClerkId({
    clerkId: clerkUserId,
    email,
  });

  // Load previous messages for this user
  const previousMessages = await getMessagesByUserId(dbUser.id);

  // Convert database messages to AI SDK UIMessage format
  const initialMessages = previousMessages.map((msg: any) => ({
    id: msg.id,
    role: msg.role as "user" | "assistant",
    parts: [
      {
        type: "text" as const,
        text: typeof msg.content === "string" ? msg.content : msg.content?.text || "",
      },
    ],
  }));

  return <Chat initialMessages={initialMessages} />;
}

