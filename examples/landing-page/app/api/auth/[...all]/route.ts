/**
 * Better Auth over HTTP — sign-in, token minting (GET /api/auth/token), and
 * the JWKS the functions route verifies against (GET /api/auth/jwks).
 */
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const { GET, POST } = toNextJsHandler(auth.handler);
