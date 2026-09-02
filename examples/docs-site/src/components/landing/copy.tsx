"use client";

/**
 * Copy-to-clipboard, shared by the hero button and the closing CTA.
 *
 * It lived inside cta.tsx until the hero needed it too. Both surfaces offer the
 * same command, and a second implementation of "did it copy" would be a second
 * place for the reset timing and the failure path to drift.
 *
 * Presentation deliberately stays with each caller: the hero's is a filled
 * primary button, the CTA's is a bordered row inside a bento cell. Only the
 * behaviour and the icon are shared.
 */
import { useCallback, useState } from "react";

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard denied — the command is still on screen to select by hand */
    }
  }, []);
  return { copied, copy };
}

export function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="5.5"
        y="5.5"
        width="8"
        height="8"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  );
}

/**
 * The accessible name for a copy control.
 *
 * Kept here because getting it wrong is a WCAG 2.5.3 failure and it already
 * happened once: a button reading "$ pnpm dlx @usegraft/cli init" was named
 * "Copy init command", so a speech-input user had no way to say it. The name
 * has to contain the visible command, which means deriving it from the command.
 */
export const copyLabel = (copied: boolean, command: string): string =>
  copied ? "Copied" : `Copy ${command}`;
