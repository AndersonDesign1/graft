/**
 * Unit: the runtime-role grant list. These assertions exist because the list is
 * the security boundary itself — a widening typo here is not a failing feature,
 * it is a runtime credential that can approve its own destructive operation.
 * (The live proof that Postgres enforces it is in audit.integration.test.ts.)
 */
import { GraftError } from "@usegraft/contracts";
import { describe, expect, it } from "vitest";
import { runtimeRoleGrantsSql } from "./harden";

const grants = (role = "graft_runtime"): string => runtimeRoleGrantsSql(role).join("\n");

describe("runtimeRoleGrantsSql — what the runtime may never do", () => {
  it("never grants UPDATE on approvals, the one denial the split exists for", () => {
    // Matches `UPDATE ... approvals` in any statement that is not column-scoped
    // to another table. Deciding an approval is a plain UPDATE of `status`.
    for (const statement of runtimeRoleGrantsSql("graft_runtime")) {
      if (!/\bUPDATE\b/.test(statement)) continue;
      expect(statement).not.toMatch(/\bON TABLE\b[^;]*\bapprovals\b/);
    }
  });

  it("grants approvals INSERT and the SECURITY DEFINER consume, and nothing else", () => {
    const approvalGrants = runtimeRoleGrantsSql("graft_runtime").filter((s) =>
      /\bapprovals\b/.test(s),
    );
    expect(approvalGrants).toEqual([
      "GRANT SELECT ON TABLE content_index, compilations, data_records, audit_log, approvals, migrations_applied, branches TO graft_runtime",
      "GRANT INSERT ON TABLE approvals TO graft_runtime",
    ]);
    expect(grants()).toContain(
      "GRANT EXECUTE ON FUNCTION graft_consume_approval(uuid, text, text) TO graft_runtime",
    );
  });

  it("grants no DDL, no schema ownership, and no migrations_applied write", () => {
    expect(grants()).not.toMatch(/\bGRANT (CREATE|ALL|USAGE, CREATE)\b/);
    expect(grants()).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b[^\n]*\bmigrations_applied\b/);
  });

  it("stamps how a call ended without letting it rewrite who made it", () => {
    // Column-scoped on purpose: actor, function name and correlation are the
    // audit trail, and the audited party does not get to edit them.
    expect(grants()).toContain(
      "GRANT UPDATE (status, duration_ms) ON TABLE audit_log TO graft_runtime",
    );
    expect(grants()).not.toMatch(/GRANT UPDATE ON TABLE audit_log\b/);
  });
});

describe("runtimeRoleGrantsSql — what the runtime must be able to do", () => {
  it("projects authored content, so hardening does not cost MCP write_content", () => {
    expect(grants()).toContain("GRANT INSERT, UPDATE ON TABLE content_index TO graft_runtime");
    expect(grants()).toContain("GRANT INSERT ON TABLE compilations TO graft_runtime");
  });

  it("soft-deletes content rather than removing rows, so DELETE stays ungranted", () => {
    expect(grants()).not.toMatch(/\bDELETE\b[^\n]*\bcontent_index\b/);
  });

  it("mutates operational data for typed functions", () => {
    expect(grants()).toContain(
      "GRANT INSERT, UPDATE, DELETE ON TABLE data_records TO graft_runtime",
    );
  });
});

describe("runtimeRoleGrantsSql — role name is spliced into DDL", () => {
  it("refuses anything that is not a plain unquoted identifier", () => {
    for (const bad of ['runtime"; DROP TABLE approvals; --', "runtime role", "1runtime", ""]) {
      const err = (() => {
        try {
          runtimeRoleGrantsSql(bad);
        } catch (e) {
          return e;
        }
      })();
      expect(err, `expected ${JSON.stringify(bad)} to be refused`).toBeInstanceOf(GraftError);
      // SAFETY: the assertion on the line above fails the test unless `err` is a
      // GraftError, so the narrowing holds for every path that reaches here.
      expect((err as GraftError).code).toBe("INPUT_VALIDATION_FAILED");
    }
  });

  it("accepts the identifiers Postgres accepts unquoted", () => {
    expect(() => runtimeRoleGrantsSql("graft_runtime")).not.toThrow();
    expect(() => runtimeRoleGrantsSql("_r$1")).not.toThrow();
  });
});
