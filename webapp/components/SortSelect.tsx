"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { listHref, type ListParams, type SortDir } from "@/lib/query";

export interface SortChoice {
  /** `<column>:<dir>` - one entry per order a user would actually ask for. */
  value: string;
  label: string;
}

/**
 * Sort control for views without a table to hang sortable headers on (the
 * card lists). Column and direction are one choice here rather than two,
 * because "company, ascending" is a single idea to the person picking it.
 */
export default function SortSelect({
  basePath,
  params,
  defaults,
  choices,
}: {
  basePath: string;
  params: ListParams;
  defaults: { defaultSort: string; defaultDir?: SortDir; defaultPageSize?: number };
  choices: SortChoice[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const current = `${params.sort}:${params.dir}`;

  return (
    <label className={`toolbar-field${isPending ? " is-pending" : ""}`}>
      <span>מיון</span>
      <select
        value={choices.some((c) => c.value === current) ? current : choices[0]?.value}
        onChange={(e) => {
          const [sort, dir] = e.target.value.split(":");
          startTransition(() =>
            router.push(
              listHref(basePath, params, { sort, dir: dir as SortDir }, defaults),
              { scroll: false },
            ),
          );
        }}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}
