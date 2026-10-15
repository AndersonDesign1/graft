/**
 * The first `limit` characters of an error body, read without buffering the
 * rest: a misconfigured route can answer with an arbitrarily large page, and
 * only the start of it goes into the message. Never throws.
 */
export async function readStart(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // A body that fails mid-read still leaves whatever arrived.
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text.slice(0, limit);
}
