import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

@Injectable()
class Dependency {}

@Injectable()
class Consumer {
  constructor(readonly dependency: Dependency) {}
}

// NestJS finds constructor dependencies through decorator metadata that the compiler
// emits. This fails if the test runner's transform stops emitting it, which would
// otherwise show up as `undefined` services in every later API test.
describe('test runner', () => {
  it('injects a constructor dependency by its class', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [Dependency, Consumer],
    }).compile();

    expect(moduleRef.get(Consumer).dependency).toBeInstanceOf(Dependency);
  });
});
