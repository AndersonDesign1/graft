import { describe, expect, it } from "vitest";
import { pgOptions } from "./client";

describe("pgOptions", () => {
  it("Neon URLs require TLS and disable prepared statements (PgBouncer pooler)", () => {
    const o = pgOptions(
      "postgresql://u:p@ep-small-truth-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require",
    );
    expect(o.ssl).toBe("require");
    expect(o.prepare).toBe(false);
  });

  it("local docker Postgres needs no TLS and can use prepared statements", () => {
    const o = pgOptions("postgres://graft:graft@localhost:5432/graft");
    expect(o.ssl).toBe(false);
    expect(o.prepare).toBe(true);
  });

  it("respects sslmode=require on non-Neon hosts", () => {
    const o = pgOptions("postgres://u:p@db.example.com:5432/app?sslmode=require");
    expect(o.ssl).toBe("require");
    expect(o.prepare).toBe(true);
  });
});
