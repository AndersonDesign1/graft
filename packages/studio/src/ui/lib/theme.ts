import { useCallback, useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

const KEY = "graft-studio-theme";

/** Reads the same key index.html stamps before first paint. */
export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function apply(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    /* private mode — the class still applies for this session */
  }
}

/**
 * Tri-state theme. `system` is the default and stays live: tokens.css is built
 * on light-dark(), so removing data-theme hands control back to the OS.
 */
export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(storedTheme);

  useEffect(() => {
    apply(theme);
  }, [theme]);

  return [theme, useCallback((next: Theme) => setTheme(next), [])];
}
