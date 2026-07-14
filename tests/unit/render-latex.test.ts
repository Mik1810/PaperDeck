import assert from "node:assert/strict";
import test from "node:test";
import { renderLatex } from "../../src/lib/render-latex";

function katexFragmentCount(html: string) {
  return (html.match(/class="katex"/g) ?? []).length;
}

test("renderLatex escapes plain HTML without adding math markup", () => {
  const html = renderLatex(`<script>alert("x")</script> & 'safe'`);

  assert.equal(
    html,
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#039;safe&#039;",
  );
  assert.equal(katexFragmentCount(html), 0);
});

test("renderLatex supports dollar and parenthesis inline delimiters", () => {
  const html = renderLatex("First $x^2$ then \\(y + 1\\).");

  assert.equal(katexFragmentCount(html), 2);
  assert.doesNotMatch(html, /katex-display/);
  assert.match(html, /^First /);
  assert.match(html, / then /);
  assert.match(html, /\.$/);
});

test("renderLatex supports dollar and bracket display delimiters", () => {
  const html = renderLatex("Before $$x^2$$ middle \\[y + 1\\] after");

  assert.equal(katexFragmentCount(html), 2);
  assert.equal((html.match(/class="katex-display"/g) ?? []).length, 2);
  assert.match(html, /^Before /);
  assert.match(html, / middle /);
  assert.match(html, / after$/);
});

test("renderLatex treats escaped dollars as literal text", () => {
  const html = renderLatex("The fee is \\$5 and the model is $x$.");

  assert.equal(katexFragmentCount(html), 1);
  assert.match(html, /^The fee is \$5 and the model is /);
  assert.doesNotMatch(html, /\\\$5/);
});

test("renderLatex preserves escaped delimiter-like text", () => {
  const html = renderLatex(String.raw`Keep \\(not math\\) and render \(x\).`);

  assert.equal(katexFragmentCount(html), 1);
  assert.ok(html.startsWith(String.raw`Keep \\(not math\\) and render `));
});

test("renderLatex preserves unmatched opening delimiters", () => {
  for (const input of [
    "Value $x",
    "Value $$x",
    String.raw`Value \(x`,
    String.raw`Value \[x`,
  ]) {
    assert.equal(renderLatex(input), input);
  }
});

test("renderLatex can recover after an unmatched opener", () => {
  const html = renderLatex(String.raw`Unclosed \( text, then $x$.`);

  assert.equal(katexFragmentCount(html), 1);
  assert.ok(html.startsWith(String.raw`Unclosed \( text, then `));
});

test("renderLatex escapes HTML around mixed math fragments", () => {
  const html = renderLatex("<b>unsafe</b> $x$ & \\(y\\)");

  assert.equal(katexFragmentCount(html), 2);
  assert.match(html, /^&lt;b&gt;unsafe&lt;\/b&gt; /);
  assert.match(html, / &amp; /);
  assert.doesNotMatch(html, /<b>/);
});
