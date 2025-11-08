import { z } from "zod";
import { createTRPCRouter, privateProcedure, publicProcedure } from "~/server/api/trpc";
import { getOrCreateProduct, getAllProducts } from "~/server/db/queries";
import { searchProduct, getProductDetails } from "~/lib/integrations/browserbase";

/**
 * Product Router
 * Product discovery, search, and information retrieval
 */
export const productRouter = createTRPCRouter({
  /**
   * Search for products using Browserbase
   * This is the main product discovery endpoint
   */
  search: privateProcedure
    .input(
      z.object({
        query: z.string().min(1, "Search query is required"),
        merchant: z.enum(["amazon", "target", "walmart", "any"]).default("amazon"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        console.log(`🔍 Searching for "${input.query}" on ${input.merchant}`);
        
        const results = await searchProduct({
          query: input.query,
          merchant: input.merchant,
        });

        return {
          success: true,
          products: results,
          count: results.length,
          message: `Found ${results.length} products`,
        };
      } catch (error) {
        console.error("Product search failed:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Search failed",
          products: [],
          count: 0,
        };
      }
    }),

  /**
   * Get detailed product information from URL
   */
  getDetails: privateProcedure
    .input(
      z.object({
        productUrl: z.string().url("Must be a valid URL"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        console.log(`📦 Getting details for ${input.productUrl}`);
        
        const details = await getProductDetails(input.productUrl);

        return {
          success: true,
          product: details,
        };
      } catch (error) {
        console.error("Failed to get product details:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to get product details",
        };
      }
    }),

  /**
   * Get or create a product in our database
   */
  getOrCreate: privateProcedure
    .input(
      z.object({
        name: z.string(),
        url: z.string().url(),
        description: z.string().optional(),
        imageUrl: z.string().url().optional(),
        merchant: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const product = await getOrCreateProduct(input);

        return {
          success: true,
          product,
        };
      } catch (error) {
        console.error("Failed to get/create product:", error);
        return {
          success: false,
          error: "Failed to process product",
        };
      }
    }),

  /**
   * List all products (public - for browsing catalog)
   */
  list: publicProcedure
    .input(
      z.object({
        limit: z.number().int().positive().default(50),
        offset: z.number().int().default(0),
      })
    )
    .query(async ({ input }) => {
      const products = await getAllProducts();
      
      // Simple pagination
      const paginatedProducts = products.slice(
        input.offset,
        input.offset + input.limit
      );

      return {
        products: paginatedProducts,
        total: products.length,
        hasMore: input.offset + input.limit < products.length,
      };
    }),
});

