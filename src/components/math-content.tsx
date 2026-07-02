"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    MathJax?: {
      typesetPromise?: (elements?: HTMLElement[]) => Promise<void>;
    };
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

function mustLoadMathJax(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  if (window.MathJax?.typesetPromise) {
    return false;
  }
  const existing = document.querySelector('script[src*="mathjax"]');
  return !existing;
}

function loadMathJax(): Promise<void> {
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";
    script.async = true;

    script.addEventListener("load", () => {
      let attempts = 0;
      const check = setInterval(() => {
        if (window.MathJax?.typesetPromise) {
          clearInterval(check);
          resolve();
        }
        attempts += 1;
        if (attempts > 100) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });

    document.head.appendChild(script);
  });
}

let mathJaxReady: Promise<void> | null = null;

function ensureMathJax(): Promise<void> {
  if (!mathJaxReady) {
    if (mustLoadMathJax()) {
      mathJaxReady = loadMathJax();
    } else {
      mathJaxReady = Promise.resolve();
    }
  }
  return mathJaxReady;
}

export function MathContent({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !text) {
      return;
    }

    const el = ref.current;
    el.innerHTML = escapeHtml(text);

    if (window.MathJax?.typesetPromise) {
      void window.MathJax.typesetPromise([el]);
      return;
    }

    ensureMathJax().then(() => {
      void window.MathJax?.typesetPromise?.([el]);
    });
  }, [text]);

  return <div ref={ref} />;
}
