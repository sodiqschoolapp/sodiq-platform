import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  Monitoring,
  MONITORING_FETCH,
  MONITORING_SERVICE,
  type MonitoredService,
} from './monitoring.service.js';
import { MonitoringCounts } from './counts.job.js';
import { RequestMetrics, RequestMetricsInterceptor } from './request-metrics.js';

/** The numbers and logs to Grafana (task 10.2a): `api` in the API, `worker` in the worker. */
@Global()
@Module({})
export class MonitoringModule {
  static forRoot(service: MonitoredService): DynamicModule {
    return {
      module: MonitoringModule,
      providers: [
        { provide: MONITORING_SERVICE, useValue: service },
        // Replaced in the tests; `undefined`: the network.
        { provide: MONITORING_FETCH, useValue: undefined },
        RequestMetrics,
        Monitoring,
        MonitoringCounts,
        ...(service === 'api'
          ? [{ provide: APP_INTERCEPTOR, useClass: RequestMetricsInterceptor }]
          : []),
      ],
      exports: [Monitoring, RequestMetrics],
    };
  }
}
