import { createContext, useContext } from "react";
export const AiHintContext = createContext<Record<string, number>>({});
export function AiHint({
  entity,
  compact = false,
}: {
  entity: string;
  compact?: boolean;
}) {
  const count = useContext(AiHintContext)[entity] || 0;
  return count ? (
    <span
      className="ai-hint"
      title={`当前授权报告中 ${count} 个事件待核查`}
      aria-label={`${entity} AI 待核查 ${count}`}
    >
      ✦{compact ? "" : ` AI 待核查 ${count}`}
    </span>
  ) : null;
}
