import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { Priority, StoryStatus } from "@spm/shared";
import { priorityLabels, storyStatusLabels } from "@spm/shared";

const paths: Record<string, string> = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  layers: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
  list: "M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1",
  calendar: "M3 5h18v16H3zM7 3v4M17 3v4M3 10h18",
  briefcase: "M3 7h18v14H3zM8 7V3h8v4M3 12h18",
  split: "M3 4h18v16H3zM12 4v16",
  file: "M7 3h7l5 5v13H5V3zM14 3v6h5M9 13h6M9 17h6",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-4M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8",
  user: "M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8M4 21a8 8 0 0 1 16 0",
  panel: "M3 4h18v16H3zM9 4v16",
  plus: "M12 5v14M5 12h14",
  refresh: "M20 11a8 8 0 1 0-2 6M20 4v7h-7",
  search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14M16 16l5 5",
  chevron: "m6 9 6 6 6-6",
  "chevron-right": "m9 6 6 6-6 6",
  target:
    "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  check: "m5 12 4 4L19 6",
  columns: "M3 4h7v16H3zM14 4h7v16h-7z",
  network: "M2 2h7v7H2zM15 2h7v7h-7zM8 15h8v7H8zM5 9v4h7v2M18 9v4h-6",
  workflow: "M3 3h7v7H3zM14 14h7v7h-7zM10 6h8v8M6 10v9h8",
  gantt: "M3 5h18M3 10h9M6 15h15M3 20h11",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2",
};
export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.65}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "more" ? (
        <>
          {[5, 12, 19].map((cx) => (
            <circle
              key={cx}
              cx={cx}
              cy={12}
              r={1.4}
              fill="currentColor"
              stroke="none"
            />
          ))}
        </>
      ) : (
        <path d={paths[name] ?? paths.layers} />
      )}
    </svg>
  );
}
export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-sub">{description}</p>}
      </div>
      <div className="page-action">{actions}</div>
    </div>
  );
}
export function Status({ value }: { value: StoryStatus }) {
  return (
    <span
      className={`chip ${value === "DONE" ? "green" : value === "IN_PROGRESS" ? "blue" : "gray"}`}
    >
      {storyStatusLabels[value]}
    </span>
  );
}
export function PriorityTag({ value }: { value: Priority }) {
  return (
    <span className={`priority-mark ${value}`}>{priorityLabels[value]}</span>
  );
}
export function ProgressBar({
  value,
  status,
}: {
  value: number;
  status: StoryStatus;
}) {
  return (
    <div className="progress-display">
      <div className="microbar">
        <span
          className={status === "DONE" ? "complete" : ""}
          style={{ width: `${value}%` }}
        />
      </div>
      <b>{value}%</b>
    </div>
  );
}
export function useProjectRefresh(projectId: number, reload: () => void) {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    const event = (e: Event) => {
      if ((e as CustomEvent<number>).detail === projectId) latest.current();
    };
    window.addEventListener("spm-project-change", event);
    return () => window.removeEventListener("spm-project-change", event);
  }, [projectId]);
}
export function announceProject(projectId: number) {
  window.dispatchEvent(
    new CustomEvent("spm-project-change", { detail: projectId }),
  );
}
