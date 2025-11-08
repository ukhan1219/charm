CREATE TABLE "charmv2_address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"street1" varchar(128) NOT NULL,
	"street2" varchar(128),
	"city" varchar(64) NOT NULL,
	"state" varchar(2) NOT NULL,
	"zipCode" varchar(10) NOT NULL,
	"isPrimary" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charmv2_agent_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intentId" uuid,
	"subscriptionId" uuid,
	"phase" varchar(32) NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"browserbaseSessionId" varchar(128),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"endedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "charmv2_credential" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"merchant" varchar(128) NOT NULL,
	"secret" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charmv2_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"role" varchar(32) NOT NULL,
	"content" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charmv2_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscriptionId" uuid NOT NULL,
	"agentRunId" uuid,
	"merchant" varchar(128),
	"productUrl" text,
	"orderId" varchar(128),
	"priceCents" integer,
	"currency" varchar(8) DEFAULT 'USD',
	"receipt" jsonb,
	"status" varchar(32) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charmv2_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscriptionId" uuid NOT NULL,
	"stripeInvoiceId" varchar(255),
	"stripePaymentIntentId" varchar(255),
	"amount" varchar(20) NOT NULL,
	"productCost" varchar(20),
	"serviceFee" varchar(20),
	"shippingCost" varchar(20),
	"status" varchar(32) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charmv2_product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"imageUrl" text,
	"merchant" varchar(128),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charmv2_stripe_customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"stripeCustomerId" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charmv2_stripe_customer_stripeCustomerId_unique" UNIQUE("stripeCustomerId")
);
--> statement-breakpoint
CREATE TABLE "charmv2_stripe_fee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"stripeSubscriptionId" varchar(255) NOT NULL,
	"amount" varchar(20) NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"canceledAt" timestamp with time zone,
	CONSTRAINT "charmv2_stripe_fee_stripeSubscriptionId_unique" UNIQUE("stripeSubscriptionId")
);
--> statement-breakpoint
CREATE TABLE "charmv2_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"productId" uuid NOT NULL,
	"intentId" uuid,
	"stripeSubscriptionId" varchar(255),
	"renewalFrequencyDays" integer NOT NULL,
	"lastPriceCents" integer,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"addressId" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"nextRenewalAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "charmv2_subscription_intent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"title" text NOT NULL,
	"productUrl" text NOT NULL,
	"cadenceDays" integer NOT NULL,
	"maxPriceCents" integer,
	"constraints" jsonb,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charmv2_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"clerkId" varchar(255),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charmv2_user_email_unique" UNIQUE("email"),
	CONSTRAINT "charmv2_user_clerkId_unique" UNIQUE("clerkId")
);
--> statement-breakpoint
ALTER TABLE "charmv2_address" ADD CONSTRAINT "charmv2_address_userId_charmv2_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."charmv2_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charmv2_agent_run" ADD CONSTRAINT "charmv2_agent_run_intentId_charmv2_subscription_intent_id_fk" FOREIGN KEY ("intentId") REFERENCES "public"."charmv2_subscription_intent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charmv2_agent_run" ADD CONSTRAINT "charmv2_agent_run_subscriptionId_charmv2_subscription_id_fk" FOREIGN KEY ("subscriptionId") REFERENCES "public"."charmv2_subscription"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charmv2_credential" ADD CONSTRAINT "charmv2_credential_userId_charmv2_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."charmv2_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charmv2_message" ADD CONSTRAINT "charmv2_message_userId_charmv2_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."charmv2_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charmv2_order" ADD CONSTRAINT "charmv2_order_subscriptionId_charmv2_subscription_id_fk" FOREIGN KEY ("subscriptionId") REFERENCES "public"."charmv2_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charmv2_order" ADD CONSTRAINT "charmv2_order_agentRunId_charmv2_agent_run_id_fk" FOREIGN KEY ("agentRunId") REFERENCES "public"."charmv2_agent_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charmv2_payment" ADD CONSTRAINT "charmv2_payment_subscriptionId_charmv2_subscription_id_fk" FOREIGN KEY ("subscriptionId") REFERENCES "public"."charmv2_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charmv2_stripe_customer" ADD CONSTRAINT "charmv2_stripe_customer_userId_charmv2_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."charmv2_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charmv2_stripe_fee" ADD CONSTRAINT "charmv2_stripe_fee_userId_charmv2_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."charmv2_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charmv2_subscription" ADD CONSTRAINT "charmv2_subscription_userId_charmv2_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."charmv2_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charmv2_subscription" ADD CONSTRAINT "charmv2_subscription_productId_charmv2_product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."charmv2_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charmv2_subscription" ADD CONSTRAINT "charmv2_subscription_intentId_charmv2_subscription_intent_id_fk" FOREIGN KEY ("intentId") REFERENCES "public"."charmv2_subscription_intent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charmv2_subscription" ADD CONSTRAINT "charmv2_subscription_addressId_charmv2_address_id_fk" FOREIGN KEY ("addressId") REFERENCES "public"."charmv2_address"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charmv2_subscription_intent" ADD CONSTRAINT "charmv2_subscription_intent_userId_charmv2_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."charmv2_user"("id") ON DELETE cascade ON UPDATE no action;