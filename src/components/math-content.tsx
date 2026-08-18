import { memo } from "react";
import { renderLatex } from "@/lib/render-latex";

export const MathContent = memo(function MathContent({
  text,
}: {
  text: string;
}) {
  const html = renderLatex(text);

  return (
    <span
      className="katex-container"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
