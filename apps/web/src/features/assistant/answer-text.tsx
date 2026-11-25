import type React from 'react';

/**
 * The text of an answer (task 11.15, build plan item (6); plan decision 8): the model is told to
 * write plain text with simple lists. A line that starts with `- `, `* ` or `1. ` is an item of a
 * list, `**…**` inside a line is bold; nothing else is read as markup. Built from React text
 * nodes only, so nothing the model writes is ever shown as HTML (an answer with `<b>` shows the
 * characters). Task 11.21 (`02`, Answers: "Lists and comparisons come as small tables"): lines
 * that begin and end with `|`, the second a row of dashes, are a table of at most 8 columns.
 */
export function AnswerText({ text }: { text: string }): React.JSX.Element {
  return <div className="grid gap-1 break-words">{blocksOf(text).map(blockView)}</div>;
}

type Block =
  | { kind: 'text'; lines: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbers'; items: string[] };

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBER = /^\s*\d{1,3}[.)]\s+(.*)$/;

/** The most columns a table of an answer has (plan decision 13). */
export const TABLE_MAX_COLUMNS = 8;

const ROW = /^\s*\|(.*)\|\s*$/;
const SEPARATOR = /^\s*:?-{3,}:?\s*$/;

/** The cells of a table line, or `null` when it is not one. */
function cellsOf(line: string): string[] | null {
  const row = ROW.exec(line);
  return row === null ? null : (row[1] ?? '').split('|').map((cell) => cell.trim());
}

/** A table at the start of these lines: a header, a separator of as many cells, its rows. */
function tableAt(lines: readonly string[], at: number): { block: Block; end: number } | null {
  const header = cellsOf(lines[at] ?? '');
  const separator = cellsOf(lines[at + 1] ?? '');
  if (
    header === null ||
    separator === null ||
    header.length > TABLE_MAX_COLUMNS ||
    separator.length !== header.length ||
    !separator.every((cell) => SEPARATOR.test(cell))
  ) {
    return null;
  }
  const rows: string[][] = [];
  let end = at + 2;
  for (; end < lines.length; end += 1) {
    const cells = cellsOf(lines[end] ?? '');
    if (cells === null) break;
    // A row of more cells keeps the columns of the header; one of fewer is filled with blanks.
    rows.push(header.map((_, index) => cells[index] ?? ''));
  }
  return { block: { kind: 'table', header, rows }, end };
}

export function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const table = tableAt(lines, index);
    if (table !== null) {
      blocks.push(table.block);
      index = table.end - 1;
      continue;
    }
    const line = lines[index] ?? '';
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
    case 'table':
      return (
        <div key={index} className="overflow-x-auto" data-assistant-table="">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {block.header.map((cell, at) => (
                  <th key={at} scope="col" className="border-b px-2 py-1 text-start font-semibold">
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, at) => (
                <tr key={at} className="border-b last:border-b-0">
                  {row.map((cell, column) => (
                    <td key={column} className="px-2 py-1 align-top">
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
