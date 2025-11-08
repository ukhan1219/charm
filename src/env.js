import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    // Database
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    
    // Clerk Authentication
    CLERK_SECRET_KEY: z.string().min(1).optional(),
    
    // Anthropic (Claude 4.5 Haiku)
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    
    // Browserbase + Stagehand
    BROWSERBASE_API_KEY: z.string().min(1).optional(),
    BROWSERBASE_PROJECT_ID: z.string().min(1).optional(),
    
    // Stripe
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    STRIPE_SERVICE_FEE_PRICE_ID: z.string().optional(), // Existing price ID from dashboard
    
    // Cron Jobs
    CRON_SECRET_KEY: z.string().optional(), // Secret key for cron job authentication
    
    // Merchant Account Credentials (Company Accounts)
    // TODO: Add your company's merchant credentials here
    AMAZON_EMAIL: z.string().optional(),
    AMAZON_PASSWORD: z.string().optional(),
    TARGET_EMAIL: z.string().optional(),
    TARGET_PASSWORD: z.string().optional(),
    WALMART_EMAIL: z.string().optional(),
    WALMART_PASSWORD: z.string().optional(),
    BESTBUY_EMAIL: z.string().optional(),
    BESTBUY_PASSWORD: z.string().optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // Clerk (public key)
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
    
    // Stripe (public key)
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
    
    // App URL for webhooks
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY,
    BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_SERVICE_FEE_PRICE_ID: process.env.STRIPE_SERVICE_FEE_PRICE_ID,
    CRON_SECRET_KEY: process.env.CRON_SECRET_KEY,
    AMAZON_EMAIL: process.env.AMAZON_EMAIL,
    AMAZON_PASSWORD: process.env.AMAZON_PASSWORD,
    TARGET_EMAIL: process.env.TARGET_EMAIL,
    TARGET_PASSWORD: process.env.TARGET_PASSWORD,
    WALMART_EMAIL: process.env.WALMART_EMAIL,
    WALMART_PASSWORD: process.env.WALMART_PASSWORD,
    BESTBUY_EMAIL: process.env.BESTBUY_EMAIL,
    BESTBUY_PASSWORD: process.env.BESTBUY_PASSWORD,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
