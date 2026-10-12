import { useId, type ReactNode } from 'react';
import { cn } from 'cn';
import { PANEL } from '@/components/ui/control';

interface SectionProps {
  title: string;
  text: string;
  children: ReactNode;
}

/** One part of the account page, with its own heading for a screen reader. */
export function AccountSection({ title, text, children }: SectionProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn(PANEL, 'grid max-w-3xl gap-3')}>
      <div className="grid gap-1">
        <h2 id={id} className="text-[1.0625rem]/6 font-bold">
          {title}
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">{text}</p>
      </div>
      {children}
    </section>
  );
}
