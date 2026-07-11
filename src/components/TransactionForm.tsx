import { type CategoryOption } from "@/lib/categories";
import { toDateInput } from "@/lib/format";
import { CategorySelect } from "@/components/CategorySelect";

export type PaymentModeChoice = { value: string; label: string };

type Initial = {
  merchant?: string;
  amount?: string | number;
  occurredAt?: Date;
  paymentMode?: string;
  categoryId?: string;
  note?: string | null;
  type?: "debit" | "credit";
};

export function TransactionForm({
  action,
  categories,
  paymentModes,
  initial,
  submitLabel,
  cancelHref,
  showSaveRule = true,
}: {
  action: (form: FormData) => void | Promise<void>;
  categories: CategoryOption[];
  paymentModes: PaymentModeChoice[];
  initial?: Initial;
  submitLabel: string;
  cancelHref: string;
  showSaveRule?: boolean;
}) {
  const now = initial?.occurredAt ?? new Date();
  const dateValue = toDateInput(now);
  const amountValue =
    initial?.amount !== undefined ? String(initial.amount) : "";
  const initialType = initial?.type ?? "debit";

  return (
    <form action={action} className="space-y-4">
      <fieldset className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-200 p-1 dark:border-zinc-800">
        <legend className="sr-only">Transaction type</legend>
        <TypeRadio
          name="type"
          value="debit"
          label="Spent"
          subtitle="Money out"
          variant="debit"
          defaultChecked={initialType === "debit"}
        />
        <TypeRadio
          name="type"
          value="credit"
          label="Received"
          subtitle="Money in"
          variant="credit"
          defaultChecked={initialType === "credit"}
        />
      </fieldset>

      <Field label="Amount (₹)" htmlFor="amount">
        <input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          required
          defaultValue={amountValue}
          className="input"
          placeholder="0.00"
          inputMode="decimal"
          autoFocus
        />
      </Field>

      <Field label="Merchant / person / description" htmlFor="merchant">
        <input
          id="merchant"
          name="merchant"
          type="text"
          required
          defaultValue={initial?.merchant ?? ""}
          className="input"
          placeholder="Zomato, Joshika Reddy, Auto to college…"
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date" htmlFor="occurredAt">
          <input
            id="occurredAt"
            name="occurredAt"
            type="date"
            required
            defaultValue={dateValue}
            className="input"
          />
        </Field>

        <Field label="Via" htmlFor="paymentMode">
          <select
            id="paymentMode"
            name="paymentMode"
            required
            defaultValue={initial?.paymentMode ?? ""}
            className="input"
          >
            <option value="" disabled>
              Select…
            </option>
            {paymentModes.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Category" htmlFor="categoryId">
        <CategorySelect
          name="categoryId"
          initialCategories={categories}
          defaultCategoryId={initial?.categoryId}
        />
      </Field>

      <Field label="Note (optional)" htmlFor="note">
        <input
          id="note"
          name="note"
          type="text"
          defaultValue={initial?.note ?? ""}
          className="input"
          placeholder="Anything to remember about this"
        />
      </Field>

      {showSaveRule ? (
        <label className="flex items-start gap-2.5 rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
          <input
            id="saveRule"
            name="saveRule"
            type="checkbox"
            value="on"
            className="mt-0.5 h-4 w-4 accent-zinc-900 dark:accent-zinc-50"
          />
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            <span className="font-medium">Remember this categorization.</span>{" "}
            Future expenses from the same merchant will be auto-categorized into
            the selected category.
          </span>
        </label>
      ) : null}

      <div className="flex gap-2 pt-2">
        <button type="submit" className="btn-primary">
          {submitLabel}
        </button>
        <a href={cancelHref} className="btn-secondary">
          Cancel
        </a>
      </div>
    </form>
  );
}

function TypeRadio({
  name,
  value,
  label,
  subtitle,
  variant,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  subtitle: string;
  variant: "debit" | "credit";
  defaultChecked: boolean;
}) {
  // Literal Tailwind classes so the JIT picks them up at build time.
  const activeClass =
    variant === "credit"
      ? "peer-checked:bg-green-700 peer-checked:text-white dark:peer-checked:bg-green-600"
      : "peer-checked:bg-zinc-900 peer-checked:text-white dark:peer-checked:bg-zinc-50 dark:peer-checked:text-zinc-900";
  return (
    <label className="relative cursor-pointer">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <div
        className={
          "flex flex-col items-center justify-center rounded-md py-2 text-center text-zinc-700 transition-colors dark:text-zinc-300 " +
          activeClass
        }
      >
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-[10px] uppercase tracking-wide opacity-70">
          {subtitle}
        </span>
      </div>
    </label>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      {children}
    </label>
  );
}
