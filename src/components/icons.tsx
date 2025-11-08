/**
 * Icon components using lucide-react
 */

import { Sparkles, ArrowUp, Paperclip, StopCircle, Loader2 } from "lucide-react";

export const SparklesIcon = Sparkles;
export const ArrowUpIcon = ArrowUp;
export const PaperclipIcon = Paperclip;
export const StopIcon = StopCircle;
export const LoaderIcon = Loader2;

/**
 * Charm logo icon
 * Primary brand color: #00FF84
 */
export function CharmIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle 
        cx="12" 
        cy="12" 
        r="10" 
        stroke="#00FF84" 
        strokeWidth="2" 
        fill="none"
      />
      <path
        d="M12 6v6l4 2"
        stroke="#00FF84"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

