"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
} from "recharts";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { formatINR } from "@/lib/format";
import type {
  CategorySlice,
  PaymentSlice,
  MonthlyBar,
} from "@/lib/spending";

const CATEGORY_COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#a855f7", // purple
  "#06b6d4", // cyan
  "#f97316", // orange
  "#ec4899", // pink
  "#14b8a6", // teal
  "#84cc16", // lime
  "#eab308", // yellow
  "#6366f1", // indigo
  "#71717a", // zinc — fallback for overflow
];

const PAYMENT_COLORS: Record<string, string> = {
  card: "#3b82f6",
  upi: "#22c55e",
  cash: "#f59e0b",
  bank_transfer: "#a855f7",
};

function PieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    payload?: { txCount?: number };
  }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const name = p.name ?? "—";
  const amount = typeof p.value === "number" ? p.value : 0;
  const count = p.payload?.txCount ?? 0;
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-900">
      <div className="font-medium text-zinc-900 dark:text-zinc-50">{name}</div>
      <div className="text-zinc-600 dark:text-zinc-300">
        {formatINR(amount)} · {count} tx{count === 1 ? "" : "s"}
      </div>
    </div>
  );
}

/** Update a single URL param while preserving the others. Toggles off if same value. */
function useToggleParam(): (key: string, value: string) => void {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  return (key, value) => {
    const next = new URLSearchParams(params.toString());
    if (next.get(key) === value) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
}

export function CategoryPie({
  data,
  activeCategory,
}: {
  data: CategorySlice[];
  activeCategory: string | null;
}) {
  const toggle = useToggleParam();
  if (data.length === 0) return <EmptyChart label="No spending" />;
  return (
    <div>
      <div className="h-56 w-full">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="amount"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={90}
              paddingAngle={1}
              isAnimationActive={false}
              onClick={(payload: unknown) => {
                const p = payload as { name?: string; payload?: { name?: string } };
                const name = p?.name ?? p?.payload?.name;
                if (name) toggle("category", name);
              }}
              cursor="pointer"
            >
              {data.map((entry, i) => {
                const isActive = activeCategory === entry.name;
                const dim = activeCategory && !isActive;
                return (
                  <Cell
                    key={entry.name}
                    fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
                    fillOpacity={dim ? 0.25 : 1}
                    stroke={isActive ? "#000" : "transparent"}
                    strokeWidth={isActive ? 2 : 0}
                  />
                );
              })}
            </Pie>
            <Tooltip content={<PieTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ClickableLegend
        items={data.map((d, i) => ({
          key: d.name,
          label: d.name,
          color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
          active: activeCategory === d.name,
        }))}
        anyActive={Boolean(activeCategory)}
        onToggle={(key) => toggle("category", key)}
      />
    </div>
  );
}

export function PaymentPie({
  data,
  activeMode,
}: {
  data: PaymentSlice[];
  activeMode: string | null;
}) {
  const toggle = useToggleParam();
  if (data.length === 0) return <EmptyChart label="No spending" />;
  return (
    <div>
      <div className="h-56 w-full">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="amount"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={90}
              paddingAngle={1}
              isAnimationActive={false}
              onClick={(payload: unknown) => {
                const p = payload as { mode?: string; payload?: { mode?: string } };
                const mode = p?.mode ?? p?.payload?.mode;
                if (mode) toggle("paymentMode", mode);
              }}
              cursor="pointer"
            >
              {data.map((entry) => {
                const isActive = activeMode === entry.mode;
                const dim = activeMode && !isActive;
                return (
                  <Cell
                    key={entry.mode}
                    fill={PAYMENT_COLORS[entry.mode] ?? "#71717a"}
                    fillOpacity={dim ? 0.25 : 1}
                    stroke={isActive ? "#000" : "transparent"}
                    strokeWidth={isActive ? 2 : 0}
                  />
                );
              })}
            </Pie>
            <Tooltip content={<PieTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ClickableLegend
        items={data.map((d) => ({
          key: d.mode,
          label: d.label,
          color: PAYMENT_COLORS[d.mode] ?? "#71717a",
          active: activeMode === d.mode,
        }))}
        anyActive={Boolean(activeMode)}
        onToggle={(key) => toggle("paymentMode", key)}
      />
    </div>
  );
}

function BarTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const v = typeof payload[0].value === "number" ? payload[0].value : 0;
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-900">
      <div className="font-medium text-zinc-900 dark:text-zinc-50">{label}</div>
      <div className="text-zinc-600 dark:text-zinc-300">{formatINR(v)}</div>
    </div>
  );
}

export function MonthlyTrendBar({ data }: { data: MonthlyBar[] }) {
  if (data.every((d) => d.total === 0))
    return <EmptyChart label="No spending in the last 12 months" />;
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
          <XAxis
            dataKey="label"
            stroke="currentColor"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={(v) =>
              v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`
            }
            stroke="currentColor"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <Tooltip content={<BarTooltip />} cursor={{ fill: "rgba(120,120,120,0.08)" }} />
          <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * A tappable legend that doubles as the filter control. Recharts v3's slice
 * onClick is unreliable, so these plain buttons are the source of truth for
 * "click a category/mode to filter" — and they're far easier to hit on mobile
 * than a thin donut slice.
 */
function ClickableLegend({
  items,
  anyActive,
  onToggle,
}: {
  items: Array<{ key: string; label: string; color: string; active: boolean }>;
  anyActive: boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-1.5">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onToggle(it.key)}
          aria-pressed={it.active}
          title={it.active ? `Clear ${it.label} filter` : `Filter to ${it.label}`}
          className={
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors " +
            (it.active
              ? "border-zinc-400 bg-zinc-100 text-zinc-900 dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-50"
              : anyActive
                ? "border-zinc-200 text-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-300"
                : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800")
          }
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: it.color }}
            aria-hidden
          />
          {it.label}
        </button>
      ))}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-zinc-300 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
      {label}
    </div>
  );
}
