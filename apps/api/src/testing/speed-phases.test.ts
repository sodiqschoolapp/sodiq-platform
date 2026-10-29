import { describe, expect, it } from 'vitest';
import { Deadline, OutOfTime, speedPhaseOf } from './speed-phases.js';

describe('the phases and the deadline of the speed run (task 10.1b)', () => {
  it('runs both phases unless the workflow names one', () => {
    expect(speedPhaseOf(undefined)).toBe('both');
    expect(speedPhaseOf('build')).toBe('build');
    expect(speedPhaseOf('measure')).toBe('measure');
    expect(speedPhaseOf('other')).toBe('both');
  });

  it('lets a step run before the deadline', () => {
    const deadline = new Deadline(1000, () => 999);
    expect(() => {
      deadline.check('search');
    }).not.toThrow();
  });

  it('fails a run given too little time, naming the step not measured', () => {
    let now = 0;
    const deadline = new Deadline(1000, () => now);
    now = 1000;
    expect(() => {
      deadline.check('Branch 3: search students');
    }).toThrow(OutOfTime);
    expect(() => {
      deadline.check('Branch 3: search students');
    }).toThrow(
      'Not measured: time. The run reached its deadline before "Branch 3: search students"',
    );
  });

  it('fails a step of a known length that would end past the deadline', () => {
    const deadline = new Deadline(1000, () => 500);
    expect(() => {
      deadline.checkFor('the load', 499);
    }).not.toThrow();
    expect(() => {
      deadline.checkFor('the load', 500);
    }).toThrow(OutOfTime);
  });
});
