"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    MathJax?: {
      typesetPromise?: (elements?: HTMLElement[]) => Promise<void>;
    };
  }
}

export function MathContent({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !text) {
      return;
    }

    const el = ref.current;
    el.innerHTML = text;

    if (window.MathJax?.typesetPromise) {
      void window.MathJax.typesetPromise([el]);
      return;
    }

    const existingScript = document.querySelector(
      'script[src*="mathjax"]',
    ) as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener("load", () => {
        void window.MathJax?.typesetPromise?.([el]);
      });
      return;
    }

    const script = document.createElement("script");
    script.src =
      "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";
    script.async = true;

    script.addEventListener("load", () => {
      void window.MathJax?.typesetPromise?.([el]);
    });

    document.head.appendChild(script);
  }, [text]);

  return <div ref={ref} />;
}
