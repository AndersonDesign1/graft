/**
 * How a command's answer and its failures reach the terminal.
 *
 * The rule: with --json, stdout carries one JSON object and nothing else, and
 * a failure is one JSON line on stderr. Without it, people get text. Either
 * way the exit code says what kind of outcome it was (topics.ts EXIT_CODES).
 */
import { EXIT_FOR_ERROR } from "./topics";

/** An error that crossed into the CLI with a code and a fix: GraftError or UsageError. */
export interface ReportableError {
  code: string;
  message: string;
  fix?: string;
  details?: Record<string, unknown>;
}

/** Indented for a person at a terminal, one line for a pipe or a file. */
export function formatJson(value: unknown, pretty = Boolean(process.stdout.isTTY)): string {
  return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

const TOKEN = /graft_at_[A-Za-z0-9_-]+/g;

/** Hide every Studio agent token in text about to be printed. */
export function redact(text: string): string {
  return text.replace(TOKEN, (token) => `${token.slice(0, 13)}…`);
}

export function exitCodeFor(code: string): number {
  return EXIT_FOR_ERROR.get(code) ?? 1;
}

/** Print an error the way the caller asked for output, and return the exit code. */
export function reportError(error: ReportableError, json: boolean): number {
  if (json) {
    // JSON.stringify leaves out a missing fix or details: GraftErrorJSON's shape.
    const line = {
      error: error.code,
      message: error.message,
      fix: error.fix,
      details: error.details,
    };
    console.error(redact(JSON.stringify(line)));
  } else if (error.code === "USAGE_INVALID") {
    console.error(redact(`graft: ${error.message}`));
    if (error.fix) console.error(redact(error.fix));
  } else {
    console.error(redact(`error ${error.code}: ${error.message}`));
    if (error.fix) console.error(redact(`  fix: ${error.fix}`));
    if (error.details) console.error(redact(`  details: ${JSON.stringify(error.details)}`));
  }
  return exitCodeFor(error.code);
}

/**
 * Run `fn` with stdout held for the JSON alone. Anything can write there
 * mid-command: postgres-js prints server notices with console.log, and a
 * config or helper may call console.info, console.debug or
 * process.stdout.write. So the stream itself points at stderr while it runs,
 * and the console methods that print to stdout are swapped too, for a console
 * that does not write through the stream (a test runner's, or one an app
 * replaced).
 */
export async function withStdoutReserved<T>(fn: () => Promise<T>): Promise<T> {
  const { log, info, debug } = console;
  const write = process.stdout.write;
  console.log = console.info = console.debug = console.error;
  process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
  try {
    return await fn();
  } finally {
    process.stdout.write = write;
    Object.assign(console, { log, info, debug });
  }
}
