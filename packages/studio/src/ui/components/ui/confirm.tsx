/**
 * Confirm: the question before a destructive action, in place of
 * `window.confirm`.
 *
 * The browser's dialog is unstyled, cannot say what the button does, and in
 * an embedded frame may return false without showing anything. This one is
 * an alert dialog (Base UI): the page behind is inert, focus starts on Cancel
 * so Enter never destroys, and the action button repeats the verb in the
 * title ("Delete post"), so the choice reads without the question.
 *
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     kind: "delete",
 *     title: "Delete “Launch notes”?",
 *     body: "It stays live until you publish the deletion.",
 *     action: "Delete post",
 *   });
 */
import { AlertDialog } from "@base-ui-components/react/alert-dialog";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { IconRevert, IconTrash } from "../icons";

export interface ConfirmOptions {
  /** The question, stating the consequence: "Delete “Launch notes”?" */
  title: string;
  /** What happens, and whether it can be undone. */
  body: ReactNode;
  /** The button: the title's verb and its object, "Delete post". */
  action: string;
  /** What the action does to the work: a deletion, or a discard of edits. */
  kind: "delete" | "discard";
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ask;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((answer: boolean) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const ask = useCallback<Ask>((next) => {
    // A second question settles the first as "no" rather than leaving it
    // waiting forever.
    resolver.current?.(false);
    setOptions(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = (answer: boolean): void => {
    resolver.current?.(answer);
    resolver.current = null;
    setOpen(false);
  };

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <AlertDialog.Root open={open} onOpenChange={(next) => !next && settle(false)}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="dialog-backdrop" />
          <AlertDialog.Popup className="dialog confirm" initialFocus={cancelRef}>
            {options ? (
              <>
                <div className="dialog-body">
                  <AlertDialog.Title className="dialog-title">{options.title}</AlertDialog.Title>
                  <AlertDialog.Description className="dialog-description">
                    {options.body}
                  </AlertDialog.Description>
                </div>
                <div className="dialog-footer">
                  <button
                    ref={cancelRef}
                    type="button"
                    className="btn"
                    onClick={() => settle(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn"
                    data-variant="danger"
                    onClick={() => settle(true)}
                  >
                    {options.kind === "delete" ? (
                      <IconTrash aria-hidden="true" />
                    ) : (
                      <IconRevert aria-hidden="true" />
                    )}
                    {options.action}
                  </button>
                </div>
              </>
            ) : null}
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
}
