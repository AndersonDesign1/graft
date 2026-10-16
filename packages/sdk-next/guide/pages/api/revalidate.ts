import type { NextApiRequest, NextApiResponse } from "next";

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

// The page that shows each changed document. A key is "collection/slug".
function pathFor(key: string): string | null {
  const [collection, slug] = key.split("/");
  return collection === "pages" && slug ? `/${slug}` : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const secret = process.env.GRAFT_WEBHOOK_SECRET;
  if (req.method !== "POST" || !secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const changes = req.body?.changes;
  const keys = [changes?.added, changes?.changed, changes?.removed];
  if (!keys.every(isStrings)) {
    return res.status(400).json({ error: "Send { branch, changes }." });
  }

  const paths = keys.flat().flatMap((key) => pathFor(key) ?? []);
  await Promise.all(paths.map((path) => res.revalidate(path)));
  return res.json({ revalidated: paths });
}
