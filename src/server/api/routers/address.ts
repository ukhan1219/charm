import { z } from "zod";
import { createTRPCRouter, privateProcedure } from "~/server/api/trpc";
import {
  createUserAddress,
  getUserAddresses,
  getPrimaryAddress,
} from "~/server/db/queries";
import { usStates } from "~/server/db/schema";

/**
 * Address Router
 * Manage delivery addresses
 */
export const addressRouter = createTRPCRouter({
  /**
   * Create a new delivery address
   */
  create: privateProcedure
    .input(
      z.object({
        street1: z.string().min(1, "Street address is required"),
        street2: z.string().optional(),
        city: z.string().min(1, "City is required"),
        state: z.enum(usStates, { errorMap: () => ({ message: "Invalid US state" }) }),
        zipCode: z.string().regex(/^\d{5}(-\d{4})?$/, "Must be a valid ZIP code"),
        isPrimary: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const address = await createUserAddress({
        userId: ctx.userId,
        ...input,
      });

      return {
        success: true,
        address,
        message: "Address created",
      };
    }),

  /**
   * Get all addresses for current user
   */
  getMyAddresses: privateProcedure.query(async ({ ctx }) => {
    const addresses = await getUserAddresses(ctx.userId);
    
    return {
      addresses,
      count: addresses.length,
    };
  }),

  /**
   * Get primary address for current user
   */
  getPrimary: privateProcedure.query(async ({ ctx }) => {
    const address = await getPrimaryAddress(ctx.userId);
    
    if (!address) {
      return null;
    }

    return address;
  }),

  /**
   * Validate a US address format
   * Client-side validation helper
   */
  validate: privateProcedure
    .input(
      z.object({
        street1: z.string(),
        city: z.string(),
        state: z.string(),
        zipCode: z.string(),
      })
    )
    .query(({ input }) => {
      const errors: string[] = [];

      if (input.street1.length < 3) {
        errors.push("Street address is too short");
      }

      if (input.city.length < 2) {
        errors.push("City name is too short");
      }

      if (!usStates.includes(input.state as any)) {
        errors.push("Invalid US state code");
      }

      if (!/^\d{5}(-\d{4})?$/.test(input.zipCode)) {
        errors.push("Invalid ZIP code format");
      }

      return {
        isValid: errors.length === 0,
        errors,
      };
    }),
});

