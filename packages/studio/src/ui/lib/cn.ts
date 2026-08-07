/**
 * Class helpers.
 *
 * shadcn's `cn` is clsx + tailwind-merge; there is no Tailwind here (styling
 * is the CSS token layers), so conflict-merging has nothing to resolve and
 * joining is the whole job.
 */
export type ClassValue = string | number | false | null | undefined | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (value: ClassValue): void => {
    if (!value && value !== 0) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    out.push(String(value));
  };
  for (const input of inputs) walk(input);
  return out.join(" ");
}

/**
 * Base UI lets `className` be a function of the part's state, e.g.
 * `({ open }) => open ? "is-open" : ""`. That is a genuinely useful API, so
 * compose with it rather than flattening it to a string: when a caller passes
 * a function, this returns a function that still receives the state.
 */
export type StateClass<TState> = string | ((state: TState) => string | undefined) | undefined;

export function cx<TState>(base: ClassValue, className: StateClass<TState>): StateClass<TState> {
  if (typeof className === "function") {
    return (state: TState) => cn(base, className(state));
  }
  return cn(base, className);
}
