"use client";

import { useState } from "react";

/** Copy a value to the clipboard, saying so briefly afterwards. */
export function CopyButton({
  value,
  label = "Copy",
  className = "btn-secondary",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Blocked, or an insecure origin. The value is on screen to select.
    }
  }

  return (
    <button type="button" onClick={copy} className={className}>
      {copied ? "Copied" : label}
    </button>
  );
}
