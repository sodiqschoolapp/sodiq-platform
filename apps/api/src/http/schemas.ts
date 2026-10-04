import { Body, Query } from '@nestjs/common';
import { ApiBody, ApiQuery, ApiResponse, type OpenAPIObject } from '@nestjs/swagger';
import { z } from 'zod';
import { SchemaPipe } from './validation.js';

// The package does not export its schema type by name.
type SchemaObject = Exclude<
  NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string],
  { $ref: string }
>;

/** A shared schema as OpenAPI describes it: what is sent (`input`) or what is answered (`output`). */
export function toOpenApiSchema(schema: z.ZodType, io: 'input' | 'output'): SchemaObject {
  const described: Record<string, unknown> = z.toJSONSchema(schema, { target: 'openapi-3.0', io });
  // The document states its own dialect once, at the top.
  delete described.$schema;
  return described;
}

/** Applies a method decorator from inside a parameter decorator. */
function onMethod(decorator: MethodDecorator, target: object, key: string | symbol): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor === undefined) {
    throw new Error(`${String(key)} is not a method.`);
  }
  decorator(target, key, descriptor);
}

/**
 * The JSON body of a route, checked against a shared schema and described in
 * the OpenAPI document by the same schema, so the two cannot differ.
 *
 *     create(@ValidBody(createRoomSchema) room: CreateRoom)
 */
export function ValidBody(schema: z.ZodType): ParameterDecorator {
  return (target, key, index) => {
    if (key === undefined) {
      throw new Error('ValidBody belongs on a parameter of a route method.');
    }
    Body(new SchemaPipe(schema))(target, key, index);
    onMethod(ApiBody({ schema: toOpenApiSchema(schema, 'input') }), target, key);
  };
}

/** The query string of a route, checked and described by one shared object schema. */
export function ValidQuery(schema: z.ZodObject): ParameterDecorator {
  return (target, key, index) => {
    if (key === undefined) {
      throw new Error('ValidQuery belongs on a parameter of a route method.');
    }
    Query(new SchemaPipe(schema))(target, key, index);
    const described = toOpenApiSchema(schema, 'input');
    const required = new Set(described.required ?? []);
    for (const [name, property] of Object.entries(described.properties ?? {})) {
      onMethod(
        ApiQuery({ name, required: required.has(name), schema: property as SchemaObject }),
        target,
        key,
      );
    }
  };
}

/** Describes what a route answers, from the shared schema of the answer. */
export function Returns(schema: z.ZodType, status = 200): MethodDecorator {
  return ApiResponse({ status, schema: toOpenApiSchema(schema, 'output') });
}
