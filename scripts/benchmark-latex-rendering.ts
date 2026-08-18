import { performance } from "node:perf_hooks";
import { renderLatex } from "../src/lib/render-latex";

const PAPER_COUNT = 60;
const PASSES_PER_SAMPLE = 10;
const SAMPLE_COUNT = 5;

const scenarios = {
  "no math":
    "A practical study of reliable distributed systems and mobile interfaces.",
  "light math":
    "We minimize $L(\\theta)$ with \\(n + 1\\) observations under mild assumptions.",
  "math heavy": String.raw`For $x \in \mathbb{R}^d$, let $f(x)=Wx+b$. We study
    \(\nabla f(x)\), $p(y\mid x)$, and $O(n \log n)$ convergence, with
    $$\mathcal{L}(\theta)=\sum_{i=1}^{n}\lVert y_i-f_\theta(x_i)\rVert^2$$
    and \[\hat{\theta}=\arg\min_\theta \mathcal{L}(\theta).\]`,
} as const;

let checksum = 0;

function benchmark(text: string) {
  const papers = Array.from(
    { length: PAPER_COUNT },
    (_, index) => `${text} Paper ${index + 1}.`,
  );
  const samples: number[] = [];

  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    const startedAt = performance.now();

    for (let pass = 0; pass < PASSES_PER_SAMPLE; pass += 1) {
      for (const paper of papers) {
        checksum += renderLatex(paper).length;
      }
    }

    samples.push(performance.now() - startedAt);
  }

  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length / 2)];
}

console.log(
  `LaTeX rendering benchmark (${PAPER_COUNT} papers x ${PASSES_PER_SAMPLE} passes)`,
);

for (const [name, text] of Object.entries(scenarios)) {
  const durationMs = benchmark(text);
  console.log(`${name.padEnd(10)} ${durationMs.toFixed(2)} ms`);
}

console.log(`checksum   ${checksum}`);
