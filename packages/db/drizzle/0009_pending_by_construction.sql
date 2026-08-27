-- An approval is filed pending. That is now a property of the table, not of a
-- grant list.
--
-- The runtime role's INSERT grant was table-level until this migration's
-- sibling change, and Postgres lets a table-level grantee name every column.
-- `status` was plain text with a DEFAULT and no CHECK, so a runtime credential
-- never needed to flip a pending row: it filed one already 'approved' and
-- consumed it, and `decideApproval` (with its separation-of-duties predicate)
-- never ran. Column-scoping the grant closes that door. This closes it again
-- one layer down, where no future grant change can reopen it.
--
-- Deciding is an UPDATE, and stays one. Nothing legitimate inserts a decision.

ALTER TABLE "approvals"
  ADD CONSTRAINT "approvals_status_known"
  CHECK ("status" IN ('pending', 'approved', 'denied', 'consumed'));
--> statement-breakpoint

-- Raise rather than silently coerce. A caller that tried to file a decision
-- has a bug or is an attacker, and quietly rewriting the row to 'pending'
-- would hide both.
CREATE OR REPLACE FUNCTION graft_approvals_filed_pending()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION
      'an approval is filed pending, not %; decide it with an UPDATE', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.decided_by IS NOT NULL
     OR NEW.decided_at IS NOT NULL
     OR NEW.decided_role IS NOT NULL
     OR NEW.decided_by_kind IS NOT NULL THEN
    RAISE EXCEPTION
      'an approval cannot be filed with a decision already recorded'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER graft_approvals_filed_pending
  BEFORE INSERT ON "approvals"
  FOR EACH ROW EXECUTE FUNCTION graft_approvals_filed_pending();
