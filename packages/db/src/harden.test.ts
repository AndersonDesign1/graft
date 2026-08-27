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

  it("grants approvals INSERT column-scoped, and the SECURITY DEFINER consume", () => {
    const approvalGrants = runtimeRoleGrantsSql("graft_runtime").filter((s) =>
      /\bapprovals\b/.test(s),
    );
    expect(approvalGrants).toEqual([
      "GRANT SELECT ON TABLE content_index, compilations, data_records, audit_log, approvals, migrations_applied, branches TO graft_runtime",
      "GRANT INSERT (branch_id, function_name, input, input_canonical, requested_by_kind, requested_by_id, correlation_id) ON TABLE approvals TO graft_runtime",
    ]);
    expect(grants()).toContain(
      "GRANT EXECUTE ON FUNCTION graft_consume_approval(uuid, text, text) TO graft_runtime",
    );
  });

  it("never lets the runtime name status, so it cannot file an approved approval", () => {
    // Withholding UPDATE is not enough on its own. A table-level INSERT lets
    // the grantee supply every column, and `status` is plain text with a
    // DEFAULT rather than a CHECK, so the runtime would mint a row that is
    // already 'approved' instead of flipping a pending one. decideApproval
    // never runs on that path, so its separation-of-duties predicate never
    // runs either. Proven against live Postgres in audit.integration.test.ts.
    const insert = runtimeRoleGrantsSql("graft_runtime").find(
      (s) => /^GRANT INSERT \(/.test(s) && /ON TABLE approvals/.test(s),
    );
    expect(insert, "the approvals INSERT grant must be column-scoped").toBeDefined();
    for (const forbidden of ["status", "decided_by", "decided_at", "decided_role"]) {
      expect(insert).not.toContain(forbidden);
    }
    expect(grants()).not.toMatch(/GRANT INSERT ON TABLE approvals\b/);
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

  it("needs no DELETE on content_index, since removal is an UPDATE of deleted", () => {
    // Asserted because nothing needs the privilege, NOT because withholding it
    // protects removals. It does not: removal is the UPDATE granted above. See
    // the comment on that grant for what content-write access actually costs.
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
