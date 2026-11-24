import type React from 'react';

/**
 * The text of an answer (task 11.15, build plan item (6); plan decision 8): the model is told to
 * write plain text with simple lists. A line that starts with `- `, `* ` or `1. ` is an item of a
 * list, `**…**` inside a line is bold; nothing else is read as markup. Built from React text
 * nodes only, so nothing the model writes is ever shown as HTML (an answer with `<b>` shows the
 * characters).
 */
export function AnswerText({ text }: { text: string }): React.JSX.Element {
  return <div className="grid gap-1 break-words">{blocksOf(text).map(blockView)}</div>;
}

type Block =
  | { kind: 'text'; lines: string[] }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbers'; items: string[] };

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBER = /^\s*\d{1,3}[.)]\s+(.*)$/;

export function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.split(/\r?\n/)) {
    const bullet = BULLET.exec(line);
    const number = bullet === null ? NUMBER.exec(line) : null;
    const last = blocks.at(-1);
    if (bullet !== null) {
      if (last?.kind === 'bullets') last.items.push(bullet[1] ?? '');
      else blocks.push({ kind: 'bullets', items: [bullet[1] ?? ''] });
    } else if (number !== null) {
      if (last?.kind === 'numbers') last.items.push(number[1] ?? '');
      else blocks.push({ kind: 'numbers', items: [number[1] ?? ''] });
    } else if (last?.kind === 'text') {
      last.lines.push(line);
    } else {
      blocks.push({ kind: 'text', lines: [line] });
    }
  }
  return blocks.filter(
    (block) => block.kind !== 'text' || block.lines.some((line) => line.trim() !== ''),
  );
}

function blockView(block: Block, index: number): React.JSX.Element {
  switch (block.kind) {
    case 'text':
      return (
        <p key={index} className="whitespace-pre-wrap">
          {inline(block.lines.join('\n').replace(/^\n+|\n+$/g, ''))}
        </p>
      );
    case 'bullets':
      return (
        <ul key={index} className="list-disc space-y-0.5 ps-5">
          {block.items.map((item, at) => (
            <li key={at}>{inline(item)}</li>
          ))}
        </ul>
      );
    case 'numbers':
      return (
        <ol key={index} className="list-decimal space-y-0.5 ps-5">
          {block.items.map((item, at) => (
            <li key={at}>{inline(item)}</li>
          ))}
        </ol>
      );
  }
}

/** `**bold**` as `<strong>`; every other character as text. */
function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/).map((part, index) =>
    /^\*\*[^*\n]+\*\*$/.test(part) ? (
      <strong key={index} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}
