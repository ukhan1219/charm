import "server-only";

import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { env } from "~/env";
import { claudeModels } from "~/lib/ai";

/**
 * Browserbase/Stagehand client configuration
 * Used for autonomous web navigation and product discovery
 */

/**
 * Create a new Stagehand instance
 * Recommended to create a new instance per session/task
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
  const claudeModelId = claudeModels[0]?.apiIdentifier || "claude-3-7-sonnet-20250219";
  
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
  const minimalSystemPrompt = "Extract structured data from web pages. Return only requested fields in JSON format.";

  // Per Stagehand docs: model as "provider/model-name" string
  // systemPrompt goes in constructor, not init()
  return new Stagehand({
    env: "BROWSERBASE" as any,
    apiKey: env.BROWSERBASE_API_KEY,
    projectId: env.BROWSERBASE_PROJECT_ID!,
    model: stagehandModelId, // Format: "anthropic/claude-3-7-sonnet-20250219"
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
  private activeSessions = new Map<string, { stagehand: Stagehand; createdAt: Date }>();

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
  merchant?: "amazon" | "target" | "walmart" | "any";
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
    
    // Step 3: Extract product ASINs (Amazon Standard Identification Number)
    // URLs from search results are redirects - we need the actual ASIN
    // Limit to 3 products to reduce token usage
    const productSchema = z.object({
      products: z.array(
        z.object({
          name: z.string().describe("Product title"),
          asin: z.string().describe("ASIN (product ID)"),
          price: z.string().optional().describe("Price with currency symbol"),
          imageUrl: z.string().optional().describe("Product image URL"),
        })
      ).max(3), // Enforce max 3 products
    });

    console.log("Extracting product data with ASINs...");
    // Optimized prompt: shorter = fewer tokens, extract only 3 products to reduce token usage
    const extractResult = await stagehand.extract(
      "Extract up to 3 product results. For each product, get: the product name, the ASIN (product ID from the URL), the price, and image URL",
      productSchema
    );

    // Log token usage if available
    const usage = (extractResult as any)?.usage;
    if (usage) {
      console.log(`[Token Usage] Input: ${usage.inputTokens}, Output: ${usage.outputTokens}, Total: ${usage.totalTokens}`);
    }
    console.log("Extraction result:", JSON.stringify(extractResult, null, 2));

    // Construct proper Amazon product URLs from ASINs
    const results = extractResult.products.map((product) => ({
      name: product.name,
      url: `https://www.amazon.com/dp/${product.asin}`, // Construct clean URL
      price: product.price,
      imageUrl: product.imageUrl,
      merchant: merchantName,
      description: product.name,
    }));

    return results;
  } catch (error: any) {
    console.error("Product search error:", error);
    
    // Check for rate limit errors
    if (error?.message?.includes("429") || error?.message?.includes("rate limit") || error?.message?.includes("concurrent sessions")) {
      throw new Error("Browserbase rate limit reached. Please wait a moment and try again.");
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
      imageUrl: z.string().optional(),
      availability: z.string().optional(),
      hasSubscriptionOption: z.boolean().optional(),
    });

    // Optimized prompt: shorter = fewer tokens
    const details = await stagehand.extract(
      "Extract: product title, current price, description, main image URL, availability, and if there's a Subscribe & Save option",
      detailsSchema
    );

    // Log token usage if available
    const usage = (details as any)?.usage;
    if (usage) {
      console.log(`[Token Usage] Input: ${usage.inputTokens}, Output: ${usage.outputTokens}, Total: ${usage.totalTokens}`);
    }
    console.log("Extraction result:", JSON.stringify(details, null, 2));

    return {
      ...details,
      merchant: extractMerchantFromUrl(productUrl),
    };
  } catch (error: any) {
    console.error("Product details error:", error);
    
    // Check for rate limit errors
    if (error?.message?.includes("429") || error?.message?.includes("rate limit") || error?.message?.includes("concurrent sessions")) {
      throw new Error("Browserbase rate limit reached. Please wait a moment and try again.");
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

