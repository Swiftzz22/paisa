"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button that reflects the parent <form>'s pending state, so a slow
 * server action (e.g. recategorize, which calls Gemini) shows immediate
 * feedback and disables instead of looking frozen. Must be rendered inside the
 * <form> whose action it submits.
 */
export function SubmitButton({
  children,
  pendingText,
  className,
  title,
}: {
  children: React.ReactNode;
  pendingText: string;
  className?: string;
  title?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={className}
      title={title}
    >
      {pending ? (
        <>
          <span
            aria-hidden
            className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          {pendingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}
