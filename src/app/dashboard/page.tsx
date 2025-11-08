"use client";

import { api } from "~/trpc/react";
import { LoaderIcon } from "~/components/icons";

/**
 * Dashboard with Real-Time Updates
 * Uses TanStack Query for automatic cache invalidation
 */
export default function DashboardPage() {
  const utils = api.useUtils();

  // Query with real-time refetching
  const { data: dashboard, isLoading } = api.subscription.getDashboard.useQuery(undefined, {
    refetchInterval: 5000, // Refetch every 5 seconds
  });
  
  const { data: addresses } = api.address.getMyAddresses.useQuery();

  // Mutations with optimistic updates
  const pauseIntent = api.subscription.pauseIntent.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await utils.subscription.getDashboard.cancel();

      // Snapshot previous value
      const previousData = utils.subscription.getDashboard.getData();

      // Optimistically update to new value
      if (previousData) {
        utils.subscription.getDashboard.setData(undefined, {
          ...previousData,
          intents: previousData.intents.map((intent) =>
            intent.id === variables.intentId
              ? { ...intent, status: "paused" as const }
              : intent
          ),
        });
      }

      return { previousData };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        utils.subscription.getDashboard.setData(undefined, context.previousData);
      }
    },
    onSettled: () => {
      // Refetch after mutation
      utils.subscription.getDashboard.invalidate();
    },
  });

  const resumeIntent = api.subscription.resumeIntent.useMutation({
    onSettled: () => {
      utils.subscription.getDashboard.invalidate();
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderIcon className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl p-8">
      <h1 className="mb-8 text-4xl font-bold font-sans text-charm-primary">Subscription Dashboard</h1>

      {/* Stats Overview */}
      <div className="mb-8 grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border p-4">
          <div className="text-2xl font-bold">{dashboard?.stats.totalIntents || 0}</div>
          <div className="text-sm text-muted-foreground">Total Subscriptions</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-2xl font-bold text-green-600">
            {dashboard?.stats.activeIntents || 0}
          </div>
          <div className="text-sm text-muted-foreground">Active</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-2xl font-bold text-yellow-600">
            {dashboard?.stats.pausedIntents || 0}
          </div>
          <div className="text-sm text-muted-foreground">Paused</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-2xl font-bold">{addresses?.count || 0}</div>
          <div className="text-sm text-muted-foreground">Addresses</div>
        </div>
      </div>

      {/* Subscription Intents */}
      <div className="mb-8">
        <h2 className="mb-4 text-2xl font-semibold">Your Subscriptions</h2>
        <div className="space-y-4">
          {dashboard?.intents.map((intent) => (
            <div
              key={intent.id}
              className="rounded-lg border p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold">{intent.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    Every {intent.cadenceDays} days
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 break-all">
                    {intent.productUrl}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${
                      intent.status === "active"
                        ? "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400"
                        : intent.status === "paused"
                          ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400"
                          : "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400"
                    }`}
                  >
                    {intent.status}
                  </span>
                  <div className="flex gap-2">
                    {intent.status === "active" && (
                      <button
                        onClick={() => pauseIntent.mutate({ intentId: intent.id })}
                        disabled={pauseIntent.isPending}
                        className="text-xs text-yellow-600 hover:underline disabled:opacity-50"
                      >
                        {pauseIntent.isPending ? "Pausing..." : "Pause"}
                      </button>
                    )}
                    {intent.status === "paused" && (
                      <button
                        onClick={() => resumeIntent.mutate({ intentId: intent.id })}
                        disabled={resumeIntent.isPending}
                        className="text-xs text-green-600 hover:underline disabled:opacity-50"
                      >
                        {resumeIntent.isPending ? "Resuming..." : "Resume"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {dashboard?.intents.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
              <p>No subscriptions yet</p>
              <p className="text-sm mt-2">
                Go to <a href="/chat" className="text-primary hover:underline">chat</a> to create your first subscription
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Addresses */}
      <div>
        <h2 className="mb-4 text-2xl font-semibold">Delivery Addresses</h2>
        <div className="space-y-4">
          {addresses?.addresses.map((address) => (
            <div
              key={address.id}
              className="rounded-lg border p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{address.street1}</p>
                  {address.street2 && (
                    <p className="text-sm text-muted-foreground">{address.street2}</p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {address.city}, {address.state} {address.zipCode}
                  </p>
                </div>
                {address.isPrimary && (
                  <span className="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-800 dark:bg-blue-900/20 dark:text-blue-400">
                    Primary
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

