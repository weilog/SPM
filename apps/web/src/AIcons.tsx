import { createElement } from "react";
import data from "./a-icons.json";
interface Shape {
  tag: string;
  attrs: Record<string, string | undefined>;
  children: Shape[];
}
const icons = data as Record<string, Shape[]>;
// Only whitelisted static vector shapes extracted from the approved A prototypes.
export function AIcon({ name, size = 16 }: { name: string; size?: number }) {
  const alias: Record<string, string> = {
    list: "menu",
    more: "ellipsis",
    arrow: "chevron",
    grid: "grid",
    file: "doc",
  };
  const shapes = icons[name] || icons[alias[name]] || icons.file || icons.doc;
  const shape = (s: Shape, i: number): React.ReactNode =>
    createElement(s.tag, { ...s.attrs, key: i }, ...s.children.map(shape));
  return (
    <svg
      className="ico"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes.map(shape)}
    </svg>
  );
}
