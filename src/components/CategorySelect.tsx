"use client";

import { useState, useTransition } from "react";
import { createCategoryInlineAction } from "@/lib/actions";

type Option = { id: string; label: string };

/**
 * Category dropdown with an inline "+ New" flow. Creating a category calls a
 * server action that returns the new row, which we append to the local options
 * and auto-select — no page reload, so the rest of the edit form is preserved.
 * Renders a controlled <select name={name}> so its value submits with the form.
 */
export function CategorySelect({
  name,
  initialCategories,
  defaultCategoryId,
}: {
  name: string;
  initialCategories: Option[];
  defaultCategoryId?: string;
}) {
  const [options, setOptions] = useState<Option[]>(initialCategories);
  const [selected, setSelected] = useState<string>(defaultCategoryId ?? "");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addCategory() {
    const label = newName.trim();
    if (!label) return;
    setError(null);
    startTransition(async () => {
      const res = await createCategoryInlineAction(label);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setOptions((prev) =>
        prev.some((o) => o.id === res.id)
          ? prev
          : [...prev, res].sort((a, b) => a.label.localeCompare(b.label))
      );
      setSelected(res.id);
      setNewName("");
      setAdding(false);
    });
  }

  return (
    <div>
      <div className="flex gap-2">
        <select
          id={name}
          name={name}
          required
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="input flex-1"
        >
          <option value="" disabled>
            Select…
          </option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            setAdding((v) => !v);
            setError(null);
          }}
          className="btn-secondary shrink-0"
          title="Create a new category"
        >
          {adding ? "Close" : "+ New"}
        </button>
      </div>

      {adding ? (
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCategory();
              }
            }}
            placeholder="New category name (e.g. Groceries)"
            className="input flex-1"
            maxLength={40}
            autoFocus
          />
          <button
            type="button"
            onClick={addCategory}
            disabled={pending || !newName.trim()}
            className="btn-primary shrink-0 disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? "Adding…" : "Add"}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
