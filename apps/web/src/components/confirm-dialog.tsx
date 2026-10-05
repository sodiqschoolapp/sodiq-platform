import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** How many names of what is affected are written out; the rest is counted. */
export const NAMES_SHOWN = 10;

export interface Confirmation {
  /** The question, for example "Archive 20 students?". */
  title: string;
  /** What the action does, and what happens to what it touches. */
  text?: string;
  /** What will be affected, by the names a person knows them by. */
  names?: readonly string[];
  /** The button that goes on: it names the action, never "OK". */
  action: string;
  /** The button that does not, when "Cancel" does not say it well. */
  cancel?: string;
  /** The action removes or ends something. */
  destructive?: boolean;
}

type Confirm = (question: Confirmation) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

const DismissContext = createContext<() => void>(() => undefined);

/**
 * Answers a question that is still open "no" when the pages that could have
 * asked it go away (the layout, when the session has ended): a dialog must not
 * outlive its page and then run that page's action.
 */
export function useDismissQuestionsOnLeave(): void {
  const dismiss = useContext(DismissContext);
  useEffect(() => dismiss, [dismiss]);
}

/**
 * Asks before an action, and answers whether the person went on.
 *
 *     if (await confirm({ title, names, action })) { ... }
 */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  return (
    confirm ??
    // A piece drawn alone in a test has no dialog; nothing may go on unasked.
    (() => Promise.reject(new Error('A confirmation needs the ConfirmProvider of the app.')))
  );
}

/**
 * The one confirmation dialog of the app (docs/spec/12-ux-standards.md, No
 * lost work: "Actions that cannot be undone ask for confirmation and name what
 * will be affected"). The focus starts on the button that changes nothing;
 * Escape answers "no"; a click beside the dialog does nothing. When it closes,
 * the focus goes back to where it was.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const [question, setQuestion] = useState<Confirmation | null>(null);
  const [open, setOpen] = useState(false);
  const answerTo = useRef<((went: boolean) => void) | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const before = useRef<HTMLElement | null>(null);

  const confirm = useCallback<Confirm>(
    (next) =>
      new Promise<boolean>((resolve) => {
        // A question that is still open is answered "no" by the next one.
        answerTo.current?.(false);
        answerTo.current = resolve;
        // An item of a menu goes away with its menu: the focus then returns to
        // the button the menu was opened with.
        const active =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        before.current =
          active?.closest('[role="menu"]') == null
            ? active
            : document.querySelector<HTMLElement>('[aria-haspopup="menu"][aria-expanded="true"]');
        setQuestion(next);
        setOpen(true);
      }),
    [],
  );

  const answer = (went: boolean): void => {
    answerTo.current?.(went);
    answerTo.current = null;
    // The question stays drawn while the dialog closes.
    setOpen(false);
  };

  const dismiss = useCallback((): void => {
    answerTo.current?.(false);
    answerTo.current = null;
    setOpen(false);
  }, []);

  const names = question?.names ?? [];
  const more = names.length - NAMES_SHOWN;

  return (
    <ConfirmContext.Provider value={confirm}>
      <DismissContext.Provider value={dismiss}>{children}</DismissContext.Provider>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            answer(false);
          }
        }}
      >
        {question !== null && (
          <AlertDialogContent initialFocus={cancel} finalFocus={before}>
            <AlertDialogHeader>
              <AlertDialogTitle>{question.title}</AlertDialogTitle>
              {question.text !== undefined && (
                <AlertDialogDescription>{question.text}</AlertDialogDescription>
              )}
            </AlertDialogHeader>
            {names.length > 0 && (
              <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm">
                {names.slice(0, NAMES_SHOWN).map((name, index) => (
                  // Two records can have the same name; the list does not change while it is shown.
                  <li key={`${String(index)} ${name}`}>{name}</li>
                ))}
                {more > 0 && (
                  <li className="list-none text-muted-foreground">
                    {t('confirm.more', { n: new Intl.NumberFormat(i18n.language).format(more) })}
                  </li>
                )}
              </ul>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel ref={cancel}>
                {question.cancel ?? t('confirm.cancel')}
              </AlertDialogCancel>
              <AlertDialogAction
                variant={question.destructive === true ? 'destructive' : 'default'}
                onClick={() => {
                  answer(true);
                }}
              >
                {question.action}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
