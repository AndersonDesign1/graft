# Patterns that read as generated

Scan any draft for these and rewrite. Write clean as you go; a cleanup pass after drafting misses
most of them.

## Words

- **Inflated vocabulary:** additionally, crucial, delve, enhance, foster,
  garner, intricate, landscape, pivotal, robust, seamless, showcase,
  testament, underscore, vibrant, leverage, utilize, facilitate. Use the
  plain word: also, important, look at, improve, use, help.
- **Fancy "is":** serves as, stands as, boasts, features. Say "is" or "has".
- **Metaphor nouns:** substrate, vector, surface (as in "API surface"),
  primitive as a casual noun, harness as a metaphor, north star, flywheel,
  paradigm, bedrock. Name the concrete thing. (Graft's "owned
  primitives" is a product name and stays.)
- **Adverbs propping up weak verbs:** "runs quickly", "significantly
  improves". Use the number or a stronger verb.

## Sentences

- **"Not just X, but Y"** and **"not X, it's Y"** reveals. State Y.
- **Forced threes.** Use the number of items there really are.
- **Synonym cycling.** Pick one name for a thing and repeat it.
- **Trailing -ing clauses:** "..., ensuring consistency", "..., highlighting
  the need". Delete, or make it its own sentence with a subject.
- **Vague attribution:** "experts say", "it is widely known". Name the source
  or cut it.
- **Colon as a connector** in the middle of a sentence. Colons introduce a
  list or an example; otherwise, write two sentences.
- **Passive voice** that hides the actor: "queries are validated" becomes
  "the compiler validates queries".
- **Over-compression:** dropped articles, arrows, symbol-speak. "Parser
  rejects bad date → exit 2" becomes "The parser rejects a bad date and exits
  with code 2."
- **Dense sentences** a reader has to reread. Split them.

## Shape

- **Bold label plus colon** that repeats the line ("**Performance:**
  Performance improved..."). Write the sentence. A bold lead-in that ends in
  a period and introduces new detail is fine.
- **Bold everywhere.** Bold a term once, where it is defined.
- **Title Case Headings.** Sentence case.
- **Emoji** in headings, bullets or UI.
- **Generic endings:** "The future looks bright", "In summary". End on the
  last useful fact or the next step.

## Tone

- **Chatbot phrases:** "Great question", "I hope this helps", "Let me know
  if", "Certainly!". Delete.
- **Hedging stacks:** "could potentially possibly". Pick one, or state it.
- **Feelings instead of mechanisms:** "types that follow your schema" says
  how it feels; "a renamed field fails `graft compile`" says what happens.
  If the sentence could appear unchanged in another project's docs, it says
  nothing about Graft.

## Graft's exceptions

- Parentheses are allowed. The docs use them to define a term inline:
  "MDX (Markdown that can include components)".
- Quotes are straight in source files (MDX, code, commit messages).
