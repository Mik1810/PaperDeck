import katex from "katex";

type MathDelimiter = {
  close: string;
  displayMode: boolean;
  open: string;
};

const mathDelimiters: MathDelimiter[] = [
  { open: "$$", close: "$$", displayMode: true },
  { open: "\\[", close: "\\]", displayMode: true },
  { open: "\\(", close: "\\)", displayMode: false },
  { open: "$", close: "$", displayMode: false },
];

export function renderLatex(text: string): string {
  const parts: string[] = [];
  let plainText = "";
  let cursor = 0;

  function flushPlainText() {
    if (!plainText) return;
    parts.push(escapeHtml(plainText));
    plainText = "";
  }

  while (cursor < text.length) {
    if (
      text[cursor] === "\\" &&
      text[cursor + 1] === "$" &&
      !isEscaped(text, cursor)
    ) {
      plainText += "$";
      cursor += 2;
      continue;
    }

    const delimiter = mathDelimiters.find(
      ({ open }) =>
        text.startsWith(open, cursor) && !isEscaped(text, cursor),
    );

    if (!delimiter) {
      plainText += text[cursor];
      cursor += 1;
      continue;
    }

    const mathStart = cursor + delimiter.open.length;
    const mathEnd = findUnescapedDelimiter(text, delimiter.close, mathStart);

    if (mathEnd === -1) {
      plainText += delimiter.open;
      cursor = mathStart;
      continue;
    }

    flushPlainText();
    parts.push(
      renderMath(
        text.slice(mathStart, mathEnd),
        delimiter.displayMode,
        delimiter.open,
        delimiter.close,
      ),
    );
    cursor = mathEnd + delimiter.close.length;
  }

  flushPlainText();
  return parts.join("");
}

function findUnescapedDelimiter(
  text: string,
  delimiter: string,
  start: number,
) {
  let cursor = start;

  while (cursor < text.length) {
    const delimiterIndex = text.indexOf(delimiter, cursor);

    if (delimiterIndex === -1) return -1;
    if (!isEscaped(text, delimiterIndex)) return delimiterIndex;

    cursor = delimiterIndex + delimiter.length;
  }

  return -1;
}

function isEscaped(text: string, index: number) {
  let backslashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}

function renderMath(
  math: string,
  displayMode: boolean,
  open: string,
  close: string,
) {
  try {
    return katex.renderToString(math, {
      throwOnError: false,
      output: "html",
      displayMode,
      strict: false,
    });
  } catch {
    return escapeHtml(`${open}${math}${close}`);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
