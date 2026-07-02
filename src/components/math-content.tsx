import { renderLatex } from "@/lib/render-latex";

export function MathContent({ text }: { text: string }) {
  const html = renderLatex(text);

  return (
    <span
      className="katex-container"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
