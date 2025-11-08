"use client";

import { motion } from "framer-motion";
import { CharmIcon } from "./icons";

/**
 * Overview component shown when chat is empty
 * Matches original Charm design with brand colors
 */
export function Overview() {
  return (
    <motion.div
      key="overview"
      className="mx-auto max-w-3xl md:mt-20"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.1 }}
      transition={{ delay: 0.5 }}
    >
      <div className="mt-36 flex flex-col gap-6 rounded-xl p-6 text-center leading-relaxed font-sans">
        <div className="flex flex-row items-center justify-center gap-4">
          <CharmIcon size={80} />
        </div>
        <h1 className="text-3xl font-bold text-foreground">Essentials on Autopilot</h1>
        <p className="mx-auto max-w-xl text-xl font-normal text-muted-foreground">
          Effortlessly order & subscribe to any product 🪄
        </p>
        <div className="mx-auto mt-6 max-w-md space-y-3">
          <p className="text-sm text-muted-foreground">Try asking:</p>
          <div className="flex flex-col gap-2">
            <p className=" bg-primary/10 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/20">
              "Subscribe me to paper towels every month"
            </p>
            <p className="rounded-lg bg-primary/10 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/20">
              "Find me organic coffee beans"
            </p>
            <p className="rounded-lg bg-primary/10 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/20">
              "Show my subscriptions"
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

