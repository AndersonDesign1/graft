/**
 * Ask for a secret on the terminal without echoing it: what `graft login`
 * does when the token is not piped in. Never used without a terminal.
 */
import { UsageError } from "../args";

export function readHidden(question: string): Promise<string> {
  const input = process.stdin;
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (settle: () => void): void => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stderr.write("\n");
      settle();
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return finish(() => resolve(value.trim()));
        if (ch === "\u0003") {
          return finish(() =>
            reject(new UsageError("cancelled.", "Nothing was saved.", { command: "login" })),
          );
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    process.stderr.write(question);
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

/** Everything on stdin, for a token piped in. */
export async function readStdin(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) text += String(chunk);
  return text.trim();
}
