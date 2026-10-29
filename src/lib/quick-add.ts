/**
 * "chai 20 cash" → ₹20 · Chai · Food · Cash · today.
 *
 * Rules only, run in the browser as someone types: no model, no request, no
 * cost. It has to be right about the easy 90% and honest about the rest, so
 * every field it can't settle comes back null and the form asks for it
 * instead of guessing.
 *
 * Kept free of server imports so the iOS app's copy can stay line-for-line
 * comparable with this one.
 */

export type QuickAddContext = {
  categories: { id: string; label: string }[];
  paymentModes: { value: string; label: string }[];
  /** Lowercased merchant → the category it was last filed under. */
  merchantCategories: Record<string, string>;
  today: Date;
};

export type QuickAdd = {
  amount: number | null;
  merchant: string | null;
  categoryId: string | null;
  paymentMode: string | null;
  /** YYYY-MM-DD, local. */
  date: string;
  type: "debit" | "credit";
  /** "with Riya": kept in the note, since splits live in the app. */
  withWho: string | null;
};

/** 20 · 1,200 · ₹1200 · 1.2k · 450.50 · rs.99 */
const AMOUNT = /^(?:₹|rs\.?|inr)?(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?(k)?$/i;

const MODE_ALIASES: Record<string, string> = {
  upi: "upi",
  gpay: "upi",
  googlepay: "upi",
  phonepe: "upi",
  paytm: "upi",
  bhim: "upi",
  cash: "cash",
  card: "card",
  credit: "card",
  debit: "card",
  netbanking: "bank_transfer",
  neft: "bank_transfer",
  imps: "bank_transfer",
};

/** Words that say money came in rather than went out. */
const INCOMING = new Set(["received", "got", "refund", "salary", "cashback"]);

/** Everyday words → a fragment of the category name they usually belong to. */
const HINTS: [RegExp, string][] = [
  [/^(chai|tea|coffee|lunch|dinner|breakfast|snacks?|swiggy|zomato|pizza|biryani|dosa|maggi|canteen|mess)$/, "food"],
  [/^(uber|ola|rapido|auto|cab|taxi|metro|bus|train|petrol|fuel|diesel|parking|toll)$/, "transport"],
  [/^(blinkit|zepto|instamart|bigbasket|grocery|groceries|vegetables|sabzi|milk|kirana|dmart)$/, "grocer"],
  [/^(netflix|spotify|prime|hotstar|youtube|icloud|subscription)$/, "subscription"],
  [/^(movie|movies|pvr|inox|concert|bookmyshow)$/, "entertain"],
  [/^(rent|pg|hostel)$/, "rent"],
  [/^(electricity|wifi|broadband|recharge|jio|airtel|bill)$/, "bill"],
  [/^(medicine|pharmacy|doctor|chemist|apollo)$/, "health"],
  [/^(amazon|flipkart|myntra|meesho|ajio|clothes|shoes)$/, "shop"],
  [/^(salary|stipend|cashback|refund|interest)$/, "income"],
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function titleCase(s: string): string {
  return s.replace(/(^|\s)(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

export function parseQuickAdd(text: string, ctx: QuickAddContext): QuickAdd {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let amount: number | null = null;
  let mode: string | null = null;
  let type: "debit" | "credit" = "debit";
  let withWho: string | null = null;
  const day = new Date(ctx.today);
  const rest: string[] = [];

  const modeValues = new Map(ctx.paymentModes.map((m) => [m.value.toLowerCase(), m.value]));
  const modeLabels = new Map(ctx.paymentModes.map((m) => [m.label.toLowerCase(), m.value]));

  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const w = raw.toLowerCase();
    const m = AMOUNT.exec(w);
    if (m && amount === null) {
      const whole = Number(m[1].replace(/,/g, ""));
      const n = Number(m[2] ? `${whole}.${m[2]}` : whole) * (m[3] ? 1000 : 1);
      if (n > 0) {
        amount = Math.round(n * 100) / 100;
        continue;
      }
    }
    // The person's own mode names first ("hdfc card"), then the usual words.
    const own = modeLabels.get(w) ?? modeValues.get(w);
    const alias = MODE_ALIASES[w];
    if (!mode && (own || (alias && modeValues.has(alias)))) {
      mode = own ?? modeValues.get(alias!)!;
      continue;
    }
    if (w === "today") continue;
    if (w === "yesterday") {
      day.setDate(day.getDate() - 1);
      continue;
    }
    if (INCOMING.has(w)) {
      type = "credit";
      // "salary" is the merchant as much as the direction.
      if (w !== "salary" && w !== "cashback") continue;
    }
    if ((w === "with" || w === "for") && words[i + 1]) {
      withWho = titleCase(words[i + 1].toLowerCase());
      i++;
      continue;
    }
    if (w === "from" && type === "credit" && words[i + 1]) continue;
    if (w === "on" || w === "at" || w === "via" || w === "by") continue;
    rest.push(raw);
  }

  const merchant = rest.length ? titleCase(rest.join(" ").toLowerCase()) : null;
  return {
    amount,
    merchant,
    categoryId: merchant ? guessCategory(merchant, ctx) : null,
    paymentMode: mode,
    date: ymd(day),
    type,
    withWho,
  };
}

/**
 * Their own history first: if "Chai" went under Food last time, it does now.
 * Then a category whose name is one of the words, then the everyday hints.
 */
function guessCategory(merchant: string, ctx: QuickAddContext): string | null {
  const key = merchant.toLowerCase();
  const known = ctx.merchantCategories[key];
  if (known && ctx.categories.some((c) => c.id === known)) return known;

  const words = key.split(/\s+/);
  // "Uber Auto" was filed before as just "Uber".
  for (const w of words) {
    const id = ctx.merchantCategories[w];
    if (id && ctx.categories.some((c) => c.id === id)) return id;
  }

  const labels = ctx.categories.map((c) => ({ id: c.id, label: c.label.toLowerCase() }));
  for (const w of words) {
    const hit = labels.find((c) => c.label === w || c.label.endsWith(`› ${w}`));
    if (hit) return hit.id;
  }
  for (const w of words) {
    const hint = HINTS.find(([re]) => re.test(w))?.[1];
    if (!hint) continue;
    // A top-level category beats a subcategory that merely mentions the word.
    const hit =
      labels.find((c) => !c.label.includes("›") && c.label.includes(hint)) ??
      labels.find((c) => c.label.includes(hint));
    if (hit) return hit.id;
  }
  return null;
}
