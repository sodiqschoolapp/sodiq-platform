import { CheckCircleIcon, InfoIcon, RadioButtonUncheckedIcon } from '@/components/icons';

/**
 * Done, missing or neither, in words beside the icon: never by colour or
 * shape alone (`12`, Accessibility; issue #39, hand test of 13 October 2026,
 * finding 17). The setup checklist and the draft builder's checklist (task
 * 5.3a) draw the same marks.
 */
export function StatusMark({ done, text }: { done: boolean | null; text?: string }) {
  if (done === null) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <InfoIcon aria-hidden className="size-4" />
        {text}
      </span>
    );
  }
  return done ? (
    <span className="inline-flex items-center gap-1 text-success">
      <CheckCircleIcon aria-hidden className="size-4" />
      {text}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <RadioButtonUncheckedIcon aria-hidden className="size-4" />
      {text}
    </span>
  );
}
