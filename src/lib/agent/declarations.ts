import { Type } from "@google/genai";

/**
 * Gemini function declarations for the agent loop. Mirror the Zod schemas in
 * tools.ts but in the form Gemini's tool-use API wants. Kept in a separate
 * file so the LLM-facing surface stays scannable.
 */
export const FUNCTION_DECLARATIONS = [
  {
    name: "queryTransactions",
    description:
      "Look up individual transactions matching filters. Use this when the user asks 'show me' or 'list', or wants to see specific rows. Returns up to `limit` transactions, newest first.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        from: {
          type: Type.STRING,
          description:
            "Earliest transaction date to include, YYYY-MM-DD (inclusive). Optional.",
        },
        to: {
          type: Type.STRING,
          description:
            "Latest transaction date to include, YYYY-MM-DD (inclusive). Optional.",
        },
        category: {
          type: Type.STRING,
          description:
            "Top-level rolled-up category name (substring, case-insensitive). E.g. 'Food'.",
        },
        paymentMode: {
          type: Type.STRING,
          description:
            "Payment mode value: 'upi', 'card', 'cash', 'bank_transfer', or a user-added mode value.",
        },
        merchantContains: {
          type: Type.STRING,
          description:
            "Case-insensitive substring search on the merchant name. E.g. 'Swiggy'.",
        },
        type: {
          type: Type.STRING,
          enum: ["debit", "credit"],
          description: "'debit' for spending or 'credit' for money received.",
        },
        limit: {
          type: Type.INTEGER,
          description: "Max rows to return (default 20, hard cap 100).",
        },
      },
    },
  },
  {
    name: "aggregateByCategory",
    description:
      "Sum spending grouped by top-level category over a date range. Use for 'how much on X', 'category breakdown', 'where did my money go'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        from: {
          type: Type.STRING,
          description: "Range start, YYYY-MM-DD (inclusive).",
        },
        to: {
          type: Type.STRING,
          description: "Range end, YYYY-MM-DD (inclusive).",
        },
        type: {
          type: Type.STRING,
          enum: ["debit", "credit"],
          description: "Default 'debit'. Use 'credit' for income breakdown.",
        },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "aggregateByMerchant",
    description:
      "Top N merchants by total spend over a date range. Use for 'top merchants', 'who am I paying the most', 'biggest expenses by vendor'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        from: {
          type: Type.STRING,
          description: "Range start, YYYY-MM-DD (inclusive).",
        },
        to: {
          type: Type.STRING,
          description: "Range end, YYYY-MM-DD (inclusive).",
        },
        type: {
          type: Type.STRING,
          enum: ["debit", "credit"],
          description: "Default 'debit'.",
        },
        limit: {
          type: Type.INTEGER,
          description: "Top N by total. Default 10. Max 100.",
        },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "monthlyTotals",
    description:
      "Spending totals per month across a span. Use for trend questions: 'has X gone up?', 'compare months', 'last 6 months of food spending'. Returns ALL months in the range (zeros included) so trends are easy to read.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        fromMonth: {
          type: Type.STRING,
          description: "First month to include (YYYY-MM, inclusive).",
        },
        toMonth: {
          type: Type.STRING,
          description: "Last month to include (YYYY-MM, inclusive).",
        },
        category: {
          type: Type.STRING,
          description:
            "Optional top-level category filter (substring match on rolled-up name).",
        },
        type: {
          type: Type.STRING,
          enum: ["debit", "credit"],
          description: "Default 'debit'.",
        },
      },
      required: ["fromMonth", "toMonth"],
    },
  },
  {
    name: "getContext",
    description:
      "Get fresh state: today's date, the user's available top-level category names, and available payment-mode values. Normally you DO NOT need to call this — the system prompt already includes the context. Use it only if the user mentions a category or mode you don't recognize.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
] as const;

export type FunctionDeclarationName = (typeof FUNCTION_DECLARATIONS)[number]["name"];
