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
      <div className="mt-48 flex flex-col gap-6 rounded-xl p-4 text-center leading-relaxed">
        <div className="flex flex-row items-center justify-center gap-4">
          <CharmIcon size={80} />
        </div>
        <h1 className="text-3xl font-bold text-white">Essentials on Autopilot</h1>
        <p className="mx-auto max-w-xl text-xl text-white/70">
          Effortlessly order & subscribe to any product 🪄
        </p>
        <p className="mx-auto mt-4 max-w-md text-sm text-white/50">
          Try: "Subscribe me to paper towels from Amazon every month"
        </p>
      </div>
    </motion.div>
  );
}

