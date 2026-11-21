import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { owedStepsAllowedOn } from '../auth/session.guard.js';
import { declarationsOf } from './access.decorators.js';
import { keyRouteFault, keyRouteOf } from './key-routes.js';

/**
 * The application does not start with a route whose mark opens it to keys
 * against `02` (an export, a student's record, a group transfer, the own
 * account, a public or a portal route): `keyRouteFault`. Checked once at the
 * start, not on each request (review finding 15 of the plan of #369).
 */
@Injectable()
export class KeyRoutesCheck implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
  ) {}

  onApplicationBootstrap(): void {
    const faults: string[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const instance: unknown = wrapper.instance;
      if (instance === null || typeof instance !== 'object') {
        continue;
      }
      const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== 'function') {
          continue;
        }
        const fault = keyRouteFault({
          name: `${wrapper.name}.${name}`,
          mark: keyRouteOf(handler),
          declarations: declarationsOf(handler),
          owedSteps: owedStepsAllowedOn(handler),
        });
        if (fault !== undefined) {
          faults.push(`${wrapper.name}.${name} ${fault}`);
        }
      }
    }
    if (faults.length > 0) {
      throw new Error(`Routes open to integration keys against 02: ${faults.join('; ')}.`);
    }
  }
}
