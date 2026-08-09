ALTER TABLE "approvals" ADD COLUMN "decided_role" text;
--> statement-breakpoint
-- Approval-gate hardening: consuming an approval (approved -> consumed) is the
-- only status flip a runtime credential ever needs, so it moves behind a
-- SECURITY DEFINER function owned by the migrating (operator/owner) role.
-- Deciding (pending -> approved/denied) stays a plain UPDATE on the table,
-- which a hardened runtime role is simply never granted — so even raw SQL with
-- the app's DATABASE_URL cannot self-approve. See @usegraft/db runtimeRoleGrantsSql.
CREATE OR REPLACE FUNCTION graft_consume_approval(
  p_id uuid,
  p_function_name text,
  p_input_canonical text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  UPDATE approvals
     SET status = 'consumed'
   WHERE id = p_id
     AND status = 'approved'
     AND function_name = p_function_name
     AND input_canonical = p_input_canonical;
  IF FOUND THEN
    RETURN 'ok';
  END IF;
  -- Refused: report why (diagnostics only; the UPDATE above is the sole
  -- authority on whether execution proceeds).
  SELECT status INTO v_status FROM approvals WHERE id = p_id;
  IF v_status IS NULL THEN RETURN 'not_found'; END IF;
  IF v_status = 'pending' THEN RETURN 'pending'; END IF;
  IF v_status = 'denied' THEN RETURN 'denied'; END IF;
  IF v_status = 'consumed' THEN RETURN 'already_consumed'; END IF;
  RETURN 'mismatch';
END;
$$;
--> statement-breakpoint
-- Consuming is safe to expose broadly: it only ever downgrades an approval a
-- human already granted, bound to the exact function + input they saw.
GRANT EXECUTE ON FUNCTION graft_consume_approval(uuid, text, text) TO PUBLIC;
