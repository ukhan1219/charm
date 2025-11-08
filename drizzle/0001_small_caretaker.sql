ALTER TABLE "charmv2_product" ADD COLUMN "currentPriceCents" integer;--> statement-breakpoint
ALTER TABLE "charmv2_product" ADD COLUMN "lastPriceCheckAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "charmv2_product" ADD COLUMN "priceUpdatedAt" timestamp with time zone;