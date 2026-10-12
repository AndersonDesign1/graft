/**
 * People: who can sign in to Studio, and as what. Mounted in api.ts's route
 * table under the `studio:people` scope, which only admins carry, so the same
 * origin and scope checks guard it as every other write.
 */
import { GraftError } from "@usegraft/contracts";
import {
  createInvite,
  createPasswordReset,
  disableAccount,
  listAccounts,
  openInvites,
  revokeInvite,
  setAccountRole,
  type AccessChange,
} from "@usegraft/db";
import type { Route, RouteContext } from "../api";
import { newToken, normaliseEmail } from "../accounts";
import type { InviteDto, PeopleDto, PersonDto } from "../editor-types";
import { INVITE_TTL_MS, isStudioRole, STUDIO_ROLES } from "../session";

const V1 = "/api/studio/v1";

function accountsOn(ctx: RouteContext): NonNullable<RouteContext["options"]["accounts"]> {
  const accounts = ctx.options.accounts;
  if (!accounts) {
    throw new GraftError({
      code: "ROUTE_NOT_FOUND",
      message: "This Studio has no accounts, so there are no people to manage.",
      fix: "Set GRAFT_STUDIO_SECRET where Studio runs (graft serve --studio) to turn on sign-in with accounts.",
    });
  }
  return accounts;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: "The request body must be a JSON object.",
      fix: 'Send a JSON object, such as { "role": "editor" }.',
    });
  }
  return parsed as Record<string, unknown>;
}

function role(value: unknown) {
  if (!isStudioRole(value)) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `"${String(value)}" is not a Studio role.`,
      fix: `Choose one of ${STUDIO_ROLES.join(", ")}.`,
    });
  }
  return value;
}

/** A person or invitation id, which is a UUID: anything else names nobody. */
function idOf(ctx: RouteContext): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ctx.id)) {
    throw new GraftError({
      code: "ROUTE_NOT_FOUND",
      message: `"${ctx.id}" names no person or invitation.`,
      fix: "Use an id from GET /api/studio/v1/people.",
    });
  }
  return ctx.id;
}

/** The refusal for a change that would leave nobody able to manage people. */
function refused(result: AccessChange | { ok: false; reason: "not-found" }, id: string): void {
  if (result.ok) return;
  if (result.reason === "not-found") {
    throw new GraftError({
      code: "ROUTE_NOT_FOUND",
      message: "That person has no access to remove or change.",
      fix: "Reload the list of people: someone may have changed it.",
      details: { id },
    });
  }
  throw new GraftError({
    code: "INPUT_VALIDATION_FAILED",
    message: "This is the only admin, and someone has to be able to invite people.",
    fix: "Make someone else an admin first.",
    details: { id },
  });
}

/** Where a link opens Studio: its public address, the UI's mount, and the token. */
function inviteUrl(
  ctx: RouteContext,
  accounts: NonNullable<RouteContext["options"]["accounts"]>,
  token: string,
): string {
  const origin = accounts.publicUrl ?? ctx.url.origin;
  const ui = accounts.uiBasePath.replace(/\/$/, "");
  return `${origin}${ui}/?invite=${encodeURIComponent(token)}`;
}

/** The caller's own account, when they signed in with one. */
async function callerAccountId(ctx: RouteContext): Promise<string | null> {
  const email = ctx.principal?.email?.toLowerCase();
  if (!email) return null;
  const found = (await listAccounts(ctx.options.db)).find((a) => a.email.toLowerCase() === email);
  return found?.id ?? null;
}

function inviteDto(invite: Awaited<ReturnType<typeof openInvites>>[number]): InviteDto {
  return {
    id: invite.id,
    email: invite.email,
    name: invite.name,
    role: invite.role,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
  };
}

export const PEOPLE_ROUTES: readonly Route[] = [
  {
    method: "GET",
    path: `${V1}/people`,
    scope: "studio:people",
    handle: async (ctx) => {
      accountsOn(ctx);
      const [people, invites] = await Promise.all([
        listAccounts(ctx.options.db),
        openInvites(ctx.options.db),
      ]);
      const you = ctx.principal?.email?.toLowerCase();
      const body: PeopleDto = {
        people: people.map(
          (person): PersonDto => ({
            id: person.id,
            email: person.email,
            name: person.name,
            role: person.role,
            owner: person.owner,
            you: person.email.toLowerCase() === you,
            createdAt: person.createdAt.toISOString(),
          }),
        ),
        invites: invites.map(inviteDto),
      };
      return Response.json(body);
    },
  },
  {
    // Answers with the link once: only its hash is stored, so it can't be
    // shown again. Inviting the same address again replaces the old link.
    method: "POST",
    path: `${V1}/people/invites`,
    scope: "studio:people",
    handle: async (ctx) => {
      const accounts = accountsOn(ctx);
      const input = await body(ctx.request);
      const email = normaliseEmail(input.email);
      const name = typeof input.name === "string" ? input.name.trim().slice(0, 200) : "";
      const { token, hash } = newToken();
      const result = await createInvite(ctx.options.db, {
        email,
        ...(name ? { name } : {}),
        role: role(input.role ?? "editor"),
        tokenHash: hash,
        invitedById: await callerAccountId(ctx),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      });
      if (!result.ok) {
        throw new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: `${email} can already sign in.`,
          fix: "Change their role in the list of people instead.",
          details: { email },
        });
      }
      return Response.json(
        { invite: inviteDto(result.invite), url: inviteUrl(ctx, accounts, token) },
        { status: 201 },
      );
    },
  },
  {
    method: "DELETE",
    path: /^\/api\/studio\/v1\/people\/invites\/([^/]+)$/,
    scope: "studio:people",
    handle: async (ctx) => {
      accountsOn(ctx);
      if (!(await revokeInvite(ctx.options.db, idOf(ctx)))) {
        throw new GraftError({
          code: "ROUTE_NOT_FOUND",
          message: "That invitation was already used, revoked or expired.",
          fix: "Reload the list of people.",
          details: { id: ctx.id },
        });
      }
      return new Response(null, { status: 204 });
    },
  },
  {
    // For someone who has forgotten their password: a link that sets a new
    // one, keeps their role and signs out their other browsers. Shown once.
    method: "POST",
    path: /^\/api\/studio\/v1\/people\/([^/]+)\/reset$/,
    scope: "studio:people",
    handle: async (ctx) => {
      const accounts = accountsOn(ctx);
      const id = idOf(ctx);
      const { token, hash } = newToken();
      const result = await createPasswordReset(ctx.options.db, {
        accountId: id,
        tokenHash: hash,
        invitedById: await callerAccountId(ctx),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      });
      if (!result.ok) refused(result, id);
      return Response.json({ url: inviteUrl(ctx, accounts, token) }, { status: 201 });
    },
  },
  {
    method: "PUT",
    path: /^\/api\/studio\/v1\/people\/([^/]+)$/,
    scope: "studio:people",
    handle: async (ctx) => {
      accountsOn(ctx);
      const input = await body(ctx.request);
      const id = idOf(ctx);
      refused(await setAccountRole(ctx.options.db, id, role(input.role)), id);
      return new Response(null, { status: 204 });
    },
  },
  {
    method: "DELETE",
    path: /^\/api\/studio\/v1\/people\/([^/]+)$/,
    scope: "studio:people",
    handle: async (ctx) => {
      accountsOn(ctx);
      const id = idOf(ctx);
      if ((await callerAccountId(ctx)) === id) {
        throw new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: "You can't remove your own access.",
          fix: "Ask another admin to remove you.",
        });
      }
      refused(await disableAccount(ctx.options.db, id), id);
      return new Response(null, { status: 204 });
    },
  },
];
