import { revalidateContent, type ChangeSet } from "@usegraft/sdk-next";

function isChangeSet(value: unknown): value is ChangeSet {
  const v = value as Partial<ChangeSet> | null;
  return Array.isArray(v?.added) && Array.isArray(v?.changed) && Array.isArray(v?.removed);
}

export async function POST(request: Request) {
  const secret = process.env.GRAFT_WEBHOOK_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!isChangeSet(body?.changes)) {
    return Response.json({ error: "Send { branch, changes }." }, { status: 400 });
  }

  const tags = revalidateContent(body.branch ?? "main", body.changes);
  return Response.json({ revalidated: tags });
}
