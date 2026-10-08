import { revalidateContent, type ChangeSet } from "@usegraft/sdk-next";

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function isChangeSet(value: unknown): value is ChangeSet {
  const v = value as Partial<ChangeSet> | null;
  return (
    isStrings(v?.added) &&
    isStrings(v?.changed) &&
    isStrings(v?.removed) &&
    typeof v?.unchanged === "number"
  );
}

export async function POST(request: Request) {
  const secret = process.env.GRAFT_WEBHOOK_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const branch = body?.branch ?? "main";
  if (typeof branch !== "string" || !isChangeSet(body?.changes)) {
    return Response.json({ error: "Send { branch, changes }." }, { status: 400 });
  }

  const tags = revalidateContent(branch, body.changes);
  return Response.json({ revalidated: tags });
}
