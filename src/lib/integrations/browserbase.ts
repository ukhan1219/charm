import "server-only";

import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { env } from "~/env";
import { claudeModels } from "~/lib/ai";

/**
 * Browserbase/Stagehand client configuration
 * Used for autonomous web navigation and product discovery
 *
 * Uses a minimal system prompt to reduce token usage (~90% reduction vs default)
 */
export function createStagehand() {
  if (!env.BROWSERBASE_API_KEY || !env.BROWSERBASE_PROJECT_ID) {
    throw new Error("Browserbase credentials not configured");
  }

  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("Anthropic API key not configured for Stagehand");
  }

  // Get Claude model identifier from our config
  const claudeModelId =
    claudeModels[0]?.apiIdentifier || "claude-haiku-4-5-20251001";

  // Per Stagehand docs: model format must include provider prefix
  const stagehandModelId = `anthropic/${claudeModelId}`;

  console.log("Creating Stagehand with model:", stagehandModelId);

  // Stagehand needs ANTHROPIC_API_KEY in process.env (per docs)
  if (env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  }
  // TODO: REMOVE MINIMAL PROMPT WHEN RATES INCREASED
  // Minimal system prompt to reduce token usage significantly
  // Default Stagehand prompt is ~2000+ tokens, this is ~20 tokens (90% reduction)
  const minimalSystemPrompt =
    "Extract structured data from web pages. Return only requested fields in JSON format.";

  // Per Stagehand docs: model as "provider/model-name" string
  // systemPrompt goes in constructor, not init()
  return new Stagehand({
    env: "BROWSERBASE" as any,
    apiKey: env.BROWSERBASE_API_KEY,
    projectId: env.BROWSERBASE_PROJECT_ID!,
    model: stagehandModelId, // Format: "anthropic/claude-haiku-4-5-20251001"
    systemPrompt: minimalSystemPrompt, // Custom minimal prompt to reduce tokens
    verbose: 1,
    disablePino: true,
    domSettleTimeout: 30000,
  });
}

/**
 * Session management helper
 * Tracks active Browserbase sessions
 */
export class BrowserbaseSessionManager {
  private activeSessions = new Map<
    string,
    { stagehand: Stagehand; createdAt: Date }
  >();

  /**
   * Create a new session
   */
  async createSession(sessionId: string): Promise<Stagehand> {
    const stagehand = createStagehand();
    await stagehand.init();

    this.activeSessions.set(sessionId, {
      stagehand,
      createdAt: new Date(),
    });

    return stagehand;
  }

  /**
   * Get existing session
   */
  getSession(sessionId: string): Stagehand | null {
    return this.activeSessions.get(sessionId)?.stagehand ?? null;
  }

  /**
   * Close and cleanup session
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      try {
        await session.stagehand.close();
      } catch (error) {
        console.error("Error closing Stagehand session:", error);
      }
      this.activeSessions.delete(sessionId);
    }
  }

  /**
   * Cleanup old sessions (older than 30 minutes)
   */
  async cleanupOldSessions(): Promise<void> {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.createdAt < thirtyMinutesAgo) {
        await this.closeSession(sessionId);
      }
    }
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.activeSessions.size;
  }
}

/**
 * Global session manager instance
 */
export const sessionManager = new BrowserbaseSessionManager();

/**
 * Product search result type
 */
export interface ProductSearchResult {
  name: string;
  url: string;
  price?: string;
  merchant: string;
  imageUrl?: string;
  description?: string;
  availability?: string;
}

/**
 * Search for products using Browserbase/Stagehand
 * This is the core feature - autonomous product discovery
 */
export async function searchProduct({
  query,
  merchant = "amazon",
}: {
  query: string;
  merchant?: "amazon" | "target" | "walmart" | "bestbuy" | "any";
}): Promise<ProductSearchResult[]> {
  let stagehand: Stagehand | null = null;

  try {
    stagehand = createStagehand();
    await stagehand.init();

    // Determine search URL based on merchant
    let searchUrl: string;
    let merchantName: string;
    switch (merchant) {
      case "amazon":
        searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
        merchantName = "Amazon";
        break;
      case "target":
        searchUrl = `https://www.target.com/s?searchTerm=${encodeURIComponent(query)}`;
        merchantName = "Target";
        break;
      case "walmart":
        searchUrl = `https://www.walmart.com/search?q=${encodeURIComponent(query)}`;
        merchantName = "Walmart";
        break;
      case "bestbuy":
        searchUrl = `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(query)}`;
        merchantName = "Best Buy";
        break;
      default:
        searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
        merchantName = "Amazon";
    }

    // Step 1: Navigate to search page using context.pages() (V3 API)
    console.log("Navigating to:", searchUrl);
    const pages = stagehand.context.pages();
    const page = pages[0];

    if (!page) {
      throw new Error("No page available");
    }

    await page.goto(searchUrl);

    // Step 2: Wait for page to load
    await page.waitForLoadState("domcontentloaded");
    console.log("Page loaded");

    // Step 3: Extract product information (works for ALL retailers)
    // First, extract product names, prices, and images from search results
    // Then click each product to get the actual URL from the browser's address bar
    const productInfoSchema = z.object({
      products: z
        .array(
          z.object({
            name: z.string().describe("Product title/name"),
            price: z
              .string()
              .optional()
              .describe("Price with currency symbol (e.g., $19.99)"),
            imageUrl: z.string().nullish().describe("Product image URL"),
            description: z
              .string()
              .optional()
              .describe(
                "Brief product description or identifier to help locate it",
              ),
          }),
        )
        .max(3), // Enforce max 3 products
    });

    console.log(`Extracting ${merchantName} product data...`);
    // Extract product info without URLs first
    const extractResult = await stagehand.extract(
      `Extract exactly 3 DIFFERENT products from the search results. For EACH product:

1. Find the product name/title text
2. Extract the price text (if visible)
3. Extract the product image src URL
4. Note a brief description to help identify this product

CRITICAL:
- Each product MUST be DIFFERENT (different names, different images)
- Extract REAL data from the actual DOM elements
- Do NOT use placeholder values`,
      productInfoSchema,
    );

    // Log token usage if available
    const usage = (extractResult as any)?.usage;
    const responseBody = (extractResult as any)?.body;
    const responseUsage = responseBody?.usage;

    if (usage || responseUsage) {
      const actualUsage = responseUsage || usage;
      const cacheRead =
        actualUsage?.cache_read_input_tokens ||
        actualUsage?.cacheReadInputTokens ||
        actualUsage?.cachedInputTokens ||
        0;
      const cacheCreated =
        actualUsage?.cache_creation_input_tokens ||
        actualUsage?.cacheCreationInputTokens ||
        0;

      const inputTokens =
        actualUsage?.input_tokens || actualUsage?.inputTokens || 0;
      const outputTokens =
        actualUsage?.output_tokens || actualUsage?.outputTokens || 0;
      const totalTokens =
        actualUsage?.total_tokens ||
        actualUsage?.totalTokens ||
        inputTokens + outputTokens;

      console.log(
        `[Token Usage] Input: ${inputTokens}, Output: ${outputTokens}, Total: ${totalTokens}`,
      );

      if (cacheRead > 0) {
        const savedTokens = Math.round(cacheRead * 0.9);
        console.log(
          `[Cache Hit] Read ${cacheRead} cached tokens (saved ~${savedTokens} tokens, ~${Math.round((savedTokens / inputTokens) * 100)}% reduction)`,
        );
      }
      if (cacheCreated > 0) {
        console.log(
          `[Cache Created] ${cacheCreated} tokens cached for future requests (5min TTL)`,
        );
      }
      if (cacheRead === 0 && cacheCreated === 0 && inputTokens > 0) {
        console.log(
          `[Cache Status] No cache used - Stagehand v3.0.1 does not expose prompt caching options`,
        );
      }
    }

    // Step 4: For each product, prefer using extracted hrefs; only click if missing
    const results: ProductSearchResult[] = [];

    for (let i = 0; i < extractResult.products.length; i++) {
      const product = extractResult.products[i];
      if (!product) continue;

      console.log(`Resolving URL for product ${i + 1}: ${product.name}`);

      try {
        // If we already have a real href, use it
        if (product.url && /^https?:\/\//.test(product.url)) {
          results.push({
            name: product.name,
            url: product.url,
            price: product.price,
            imageUrl: product.imageUrl ?? undefined,
            merchant: merchantName,
            description: product.name,
          });
          continue;
        }

        // Fallback: click to resolve a canonical URL, but keep waits tight
        const clickInstruction =
          `Click the product link for: "${product.name}".` +
          (product.description
            ? ` It’s described as: ${product.description}`
            : "");

        await stagehand.act(clickInstruction);

        // Wait briefly for either the URL to look like a product page OR DOM ready
        await Promise.race([
          page.waitForLoadState("networkidle",  4000),
          page.waitForLoadState("domcontentloaded", 3000),
        ]).catch(() => {
          /* swallow; we'll read whatever URL we have */
        });

        const productUrl = page.url();
        console.log(`  → Product URL: ${productUrl}`);

        results.push({
          name: product.name,
          url: productUrl,
          price: product.price,
          imageUrl: product.imageUrl ?? undefined,
          merchant: merchantName,
          description: product.name,
        });

        // Go back with a capped, lighter wait (no fixed sleep)
        if (i < extractResult.products.length - 1) {
          await page.goto(searchUrl, {
            waitUntil: "domcontentloaded",
          });
          await page
            .locator('[data-component-type="s-search-result"]')
            .first()
        }
      } catch (err) {
        console.error(
          `Error resolving product ${i + 1} (${product.name}):`,
          err,
        );
        // continue
      }
    }

    console.log("Extraction result:", JSON.stringify(results, null, 2));
    return results;
  } catch (error: any) {
    console.error("Product search error:", error);

    // Check for rate limit errors
    if (
      error?.message?.includes("429") ||
      error?.message?.includes("rate limit") ||
      error?.message?.includes("concurrent sessions")
    ) {
      throw new Error(
        "Browserbase rate limit reached. Please wait a moment and try again.",
      );
    }

    throw error;
  } finally {
    // Always close the session
    if (stagehand) {
      try {
        await stagehand.close({ force: true });
        console.log("✓ Stagehand session closed");
      } catch (closeError) {
        console.error("Error closing Stagehand:", closeError);
      }
    }
  }
}

/**
 * Get detailed product information from a URL
 */
export async function getProductDetails(productUrl: string): Promise<{
  name: string;
  price: string;
  description?: string;
  imageUrl?: string;
  availability?: string;
  hasSubscriptionOption?: boolean;
  merchant: string;
}> {
  let stagehand: Stagehand | null = null;

  try {
    stagehand = createStagehand();
    await stagehand.init();

    // Step 1: Navigate to product page
    console.log("Navigating to:", productUrl);
    const pages = stagehand.context.pages();
    const page = pages[0];

    if (!page) {
      throw new Error("No page available");
    }

    await page.goto(productUrl);
    await page.waitForLoadState("domcontentloaded");
    console.log("Page loaded");

    // Step 2: Extract product details
    const detailsSchema = z.object({
      name: z.string(),
      price: z.string(),
      description: z.string().optional(),
      imageUrl: z.string().nullish(),
      availability: z.string().optional(),
      hasSubscriptionOption: z.boolean().optional(),
    });

    // Optimized prompt: shorter = fewer tokens
    const details = await stagehand.extract(
      "Extract: product title, current price, description, main image URL, availability, and if there's a Subscribe & Save option",
      detailsSchema,
    );

    // Log token usage and cache metrics if available
    // Check multiple possible locations for cache info (Stagehand may structure responses differently)
    const usage = (details as any)?.usage;
    const responseBody = (details as any)?.body;
    const responseUsage = responseBody?.usage;

    if (usage || responseUsage) {
      const actualUsage = responseUsage || usage;
      const cacheRead =
        actualUsage?.cache_read_input_tokens ||
        actualUsage?.cacheReadInputTokens ||
        actualUsage?.cachedInputTokens ||
        0;
      const cacheCreated =
        actualUsage?.cache_creation_input_tokens ||
        actualUsage?.cacheCreationInputTokens ||
        0;

      const inputTokens =
        actualUsage?.input_tokens || actualUsage?.inputTokens || 0;
      const outputTokens =
        actualUsage?.output_tokens || actualUsage?.outputTokens || 0;
      const totalTokens =
        actualUsage?.total_tokens ||
        actualUsage?.totalTokens ||
        inputTokens + outputTokens;

      console.log(
        `[Token Usage] Input: ${inputTokens}, Output: ${outputTokens}, Total: ${totalTokens}`,
      );

      if (cacheRead > 0) {
        const savedTokens = Math.round(cacheRead * 0.9);
        console.log(
          `[Cache Hit] Read ${cacheRead} cached tokens (saved ~${savedTokens} tokens, ~${Math.round((savedTokens / inputTokens) * 100)}% reduction)`,
        );
      }
      if (cacheCreated > 0) {
        console.log(
          `[Cache Created] ${cacheCreated} tokens cached for future requests (5min TTL)`,
        );
      }
      if (cacheRead === 0 && cacheCreated === 0 && inputTokens > 0) {
        console.log(
          `[Cache Status] No cache used - Stagehand v3.0.1 does not expose prompt caching options`,
        );
      }
    }
    console.log("Extraction result:", JSON.stringify(details, null, 2));

    return {
      ...details,
      imageUrl: details.imageUrl ?? undefined, // Convert null to undefined for type compatibility
      merchant: extractMerchantFromUrl(productUrl),
    };
  } catch (error: any) {
    console.error("Product details error:", error);

    // Check for rate limit errors
    if (
      error?.message?.includes("429") ||
      error?.message?.includes("rate limit") ||
      error?.message?.includes("concurrent sessions")
    ) {
      throw new Error(
        "Browserbase rate limit reached. Please wait a moment and try again.",
      );
    }

    throw error;
  } finally {
    // Always close the session
    if (stagehand) {
      try {
        await stagehand.close({ force: true });
        console.log("✓ Stagehand session closed");
      } catch (closeError) {
        console.error("Error closing Stagehand:", closeError);
      }
    }
  }
}

/**
 * Extract merchant name from URL
 */
function extractMerchantFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    if (hostname.includes("amazon")) return "Amazon";
    if (hostname.includes("target")) return "Target";
    if (hostname.includes("walmart")) return "Walmart";
    if (hostname.includes("bestbuy")) return "Best Buy";
    if (hostname.includes("costco")) return "Costco";
    return hostname.replace("www.", "").split(".")[0] || "Unknown";
  } catch {
    return "Unknown";
  }
}

/**
 * Types for exports
 */
export type { Stagehand };
