/** Plain-English error text with the raw internal code tucked into a collapsed technical-details disclosure (Phase 2 / Task P2-7). */
import { humanize } from "./humanize.js";

export function ErrorNote({ code }: { code: string }) {
  return (
    <p style={{ color: "#9f1239" }}>
      {humanize(code)}
      <details style={{ display: "inline", marginLeft: 8 }}>
        <summary style={{ display: "inline", cursor: "pointer", fontSize: 12, color: "#6b6b6b" }}>Technical details</summary>
        <code style={{ marginLeft: 6, fontSize: 12, color: "#6b6b6b" }}>{code}</code>
      </details>
    </p>
  );
}
