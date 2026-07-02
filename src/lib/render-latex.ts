import katex from "katex";

export function renderLatex(text: string): string {
  if (!text.includes("$")) {
    return escapeHtml(text);
  }

  const parts: string[] = [];
  let remaining = text;
  let mathDepth = 0;

  while (remaining.length > 0) {
    const dollarIdx = remaining.indexOf("$");

    if (dollarIdx === -1) {
      parts.push(escapeHtml(remaining));
      break;
    }

    if (dollarIdx > 0) {
      parts.push(escapeHtml(remaining.slice(0, dollarIdx)));
    }

    remaining = remaining.slice(dollarIdx + 1);

    if (remaining.startsWith("$")) {
      parts.push(escapeHtml("$"));
      remaining = remaining.slice(1);
      continue;
    }

    const nextDollar = remaining.indexOf("$");
    if (nextDollar === -1) {
      parts.push(escapeHtml("$" + remaining));
      break;
    }

    const math = remaining.slice(0, nextDollar);
    remaining = remaining.slice(nextDollar + 1);

    try {
      parts.push(
        katex.renderToString(math, {
          throwOnError: false,
          output: "html",
          strict: false,
        }),
      );
    } catch {
      parts.push(escapeHtml("$" + math + "$"));
    }
  }

  return parts.join("");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
