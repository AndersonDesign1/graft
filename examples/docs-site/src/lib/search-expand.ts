/**
 * Search-as-you-type for the docs search box.
 *
 * The index matches whole words: FTS5 with the porter stemmer, the same as
 * Postgres' english config. That is the right call for an agent passing a
 * finished query, and the wrong one for a person typing into a box, who sees
 * nothing at "conf" and only gets results once "config" is spelled out.
 *
 * FTS5 has prefix queries, but they run against stemmed tokens, so they fail
 * partway through a word: "deploym" is not a prefix of the stored "deploy".
 * So the last word is completed from the words the docs actually contain
 * instead, and the query asks for any of the completions. Every completion is
 * a real word, which the stemmer handles like any other.
 *
 * The docs search IS the product's search; this only rewrites the query a
 * person typed into one the index already understands.
 */

/** Words seen in the docs, most frequent first. */
export type Vocabulary = readonly string[];

/** How many completions of the last word go into the query. */
const MAX_COMPLETIONS = 8;

/** Shorter words are mostly noise in a completion list. */
const MIN_WORD = 3;

/**
 * Every word in the given texts, most frequent first, lowercased. Split the
 * way FTS5's unicode61 tokenizer splits, on anything that is not a letter or
 * a digit, so a completion is always a token the index holds.
 */
export function buildVocabulary(texts: Iterable<string>): Vocabulary {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (word.length < MIN_WORD) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word);
}

/**
 * The query with its last word widened to the words it could become.
 *
 * "migr" becomes `migr or migration or migrations or …`, and the words before
 * it ride along with every alternative, so "run migr" still needs "run". The
 * typed word stays first, so a finished word still finds itself.
 *
 * Left alone: a quoted phrase or -exclusion at the end (the reader was
 * precise on purpose), a query that already uses `or` (repeating its groups
 * would change what it means), and a last word with no completions.
 */
export function expandQuery(query: string, vocabulary: Vocabulary): string {
  const tokens = query.trim().match(/"[^"]*"?|\S+/g) ?? [];
  if (tokens.length === 0) return query;
  if (tokens.some((token) => /^or$/i.test(token))) return query;

  const last = tokens[tokens.length - 1];
  const head = tokens.slice(0, -1);
  if (!/^[\p{L}\p{N}]+$/u.test(last)) return query;

  const typed = last.toLowerCase();
  const completions: string[] = [];
  for (const word of vocabulary) {
    if (word !== typed && word.startsWith(typed)) completions.push(word);
    if (completions.length === MAX_COMPLETIONS) break;
  }
  if (completions.length === 0) return query;

  return [typed, ...completions].map((word) => [...head, word].join(" ")).join(" or ");
}
