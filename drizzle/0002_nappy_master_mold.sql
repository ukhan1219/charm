ALTER TABLE "charmv2_subscription" ADD COLUMN "canceledAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "charmv2_subscription_intent" ADD COLUMN "canceledAt" timestamp with time zone;