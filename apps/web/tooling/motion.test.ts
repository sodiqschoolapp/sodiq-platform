import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.join(import.meta.dirname, '../src/index.css'), 'utf8');
const source = (file: string) =>
  readFileSync(path.join(import.meta.dirname, '../src', file), 'utf8');

// docs/design-system.md, Motion: "nothing moves on its own, with one exception: the 'Open the
// journal' button of the lesson happening now on a teacher's home page pulses gently ...
// People who ask the system for reduced motion get none" (task 10.7).
describe('the one thing that moves on its own', () => {
  it('is the now-pulse animation of index.css, and the global reduced-motion rule stays', () => {
    expect(css).toMatch(/--animate-now-pulse:\s*now-pulse\s/);
    expect(css).toMatch(/@keyframes now-pulse\s*\{/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms/,
    );
  });

  it('is used only as the motion-safe variant, only on the teacher home page', () => {
    const home = source('features/timetable/teaching-home.tsx');
    expect(home).toContain("'motion-safe:animate-now-pulse'");
    // A plain class would run under prefers-reduced-motion as well.
    expect(home.replaceAll('motion-safe:animate-now-pulse', '')).not.toMatch(/animate-now-pulse/);
  });
});
