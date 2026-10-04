import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { apiErrorSchema } from '@sodiq/shared';
import { toOpenApiSchema } from '../http/schemas.js';

const ERROR_SCHEMA_NAME = 'ApiError';
const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head'] as const;

/**
 * The OpenAPI document of the routes of the application. `pnpm api:client`
 * writes it to `openapi.generated.json`; it is not served over HTTP.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Sodiq School platform API').setVersion('1').build(),
  );

  // Every route answers its errors in the one shape.
  document.components = {
    ...document.components,
    schemas: {
      ...document.components?.schemas,
      [ERROR_SCHEMA_NAME]: toOpenApiSchema(apiErrorSchema, 'output'),
    },
  };
  for (const path of Object.values(document.paths)) {
    for (const method of METHODS) {
      const operation = path[method];
      if (operation !== undefined) {
        operation.responses.default = {
          description: 'Any error',
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${ERROR_SCHEMA_NAME}` },
            },
          },
        };
      }
    }
  }
  return document;
}

/** The text of `openapi.generated.json`. */
export function serializeOpenApiDocument(document: OpenAPIObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
