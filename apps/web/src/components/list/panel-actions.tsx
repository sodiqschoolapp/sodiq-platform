import {
  Children,
  Fragment,
  isValidElement,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { SavedSign } from '@/components/form/saved-sign';
import { MoreHorizIcon } from '@/components/icons';
import { usePanelActionsSlot } from '@/components/side-panel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface PanelActionsProps {
  /** The record's one primary action: "Edit", or the action that stands for it. */
  primary?: ReactNode;
  /** Its other actions on the whole record ("Start year", "New length from a date", "Restore"). */
  secondary?: ReactNode;
  /** The danger actions: "Archive", "Delete". */
  danger?: ReactNode;
  /** A short line under the buttons, such as why an action is off. */
  note?: ReactNode;
  /** The failure of one of these actions. */
  error?: unknown;
  /** What the panel says of that failure, when it names it in its own words. */
  errorText?: string | undefined;
  /** A form of the panel was saved and closed: "Saved." under the buttons. */
  saved?: boolean;
}

/** How many secondary actions stand in the header beside the primary one (owner, 17 November 2026). */
export const SECONDARY_SHOWN = 2;

interface ButtonProps {
  children?: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  variant?: string | null;
  'data-opens'?: string;
}

/** The buttons a part holds, out of their fragments and without the parts that draw nothing. */
function buttonsOf(part: ReactNode): ReactNode[] {
  return Children.toArray(part).flatMap((one) =>
    isValidElement<{ children?: ReactNode }>(one) && one.type === Fragment
      ? buttonsOf(one.props.children)
      : [one],
  );
}

/** A button the menu can hold as an item: a `Button` with an action of its own. */
const isMenuButton = (one: ReactNode): one is ReactElement<ButtonProps> =>
  isValidElement<ButtonProps>(one) && one.type === Button && one.props.onClick !== undefined;

/**
 * The actions of a record (docs/design-system.md, Layout shell, Lists; owner,
 * 17 November 2026): in the header of its side panel, under the title, so they
 * are in view without scrolling. The primary action ("Edit"), at most two
 * secondary actions, and the rest in a quiet "More" menu whose last items are
 * the danger ones. A part the menu cannot hold as an item (not a `Button` with
 * an action) stays in the header, so no action is ever lost. Outside a side
 * panel (a page of its own) the actions stay where the page draws them. What
 * the panel says about its actions (a note, a failure, "Saved.") is under them.
 */
export function PanelActions({
  primary,
  secondary,
  danger,
  note,
  error,
  errorText,
  saved,
}: PanelActionsProps) {
  const { t } = useTranslation();
  const slot = usePanelActionsSlot();
  const has = (part: ReactNode) => part !== undefined && part !== null && part !== false;
  if (!has(primary) && !has(secondary) && !has(danger) && !has(note) && saved !== true) {
    return null;
  }
  const seconds = buttonsOf(secondary);
  const dangers = buttonsOf(danger);
  const later = [...seconds.slice(SECONDARY_SHOWN), ...dangers];
  // In the menu: what it can hold as an item, the danger ones last; the rest stays in the header.
  const items = later.filter(isMenuButton);
  const kept = later.filter((one) => !isMenuButton(one));
  const firstDanger = items.findIndex((one) => dangers.includes(one));
  // Where the focus goes back after a form opened from the menu closes (`usePanelEditing`).
  const holds = items
    .map((one) => one.props['data-opens'])
    .filter((key): key is string => key !== undefined)
    .join(' ');

  const actions = (
    <div
      data-slot="panel-actions"
      className={slot === null ? 'grid gap-3 border-t pt-4' : 'grid gap-3 border-b pb-4'}
    >
      {(has(primary) || seconds.length > 0 || dangers.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {primary}
          {seconds.slice(0, SECONDARY_SHOWN)}
          {kept}
          {items.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    aria-label={t('list.moreActions')}
                    data-holds={holds === '' ? undefined : holds}
                  />
                }
              >
                <MoreHorizIcon aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-56">
                {items.map((one, index) => (
                  <Fragment key={one.key ?? index}>
                    {index === firstDanger && index > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      variant={one.props.variant === 'destructive' ? 'destructive' : 'default'}
                      disabled={one.props.disabled === true}
                      data-opens={one.props['data-opens']}
                      onClick={(event) => {
                        // The item stands for the button: the click is the same act. No panel reads
                        // the event of these buttons beyond calling them (their actions take none).
                        one.props.onClick?.(event as unknown as MouseEvent<HTMLButtonElement>);
                      }}
                    >
                      {one.props.children}
                    </DropdownMenuItem>
                  </Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      {has(note) && <p className="text-sm text-muted-foreground">{note}</p>}
      {errorText !== undefined && error !== null && error !== undefined ? (
        <Alert variant="destructive">
          <AlertDescription>{errorText}</AlertDescription>
        </Alert>
      ) : (
        <FailureAlert error={error ?? null} />
      )}
      <SavedSign saved={saved === true} />
    </div>
  );
  // In a side panel: in its header, under the title.
  return slot === null ? actions : createPortal(actions, slot);
}
