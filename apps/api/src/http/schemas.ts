import {
  applyDecorators,
  Body,
  createParamDecorator,
  HttpCode,
  Param,
  Query,
  SetMetadata,
  UseInterceptors,
  type ExecutionContext,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiParam,
  ApiQuery,
  ApiResponse,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { PHOTO_TYPES, REQUEST_KEY_HEADER, requestKeySchema } from '@sodiq/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { UploadedFile, type FileRoute } from './file-routes.js';
import { PhotoFileInterceptor } from './photo-file.js';
import { RESPONSE_SCHEMA } from './response-schema.interceptor.js';
import { HeaderPipe, SchemaPipe } from './validation.js';
import { XLSX_MEDIA_TYPE, XlsxFileInterceptor } from './xlsx.js';

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

/**
 * The parameters in the path of a route (`:roomId`), checked and described by
 * one shared object schema with one field per parameter.
 *
 *     read(@ValidParams(roomParamsSchema) params: RoomParams)
 */
export function ValidParams(schema: z.ZodObject): ParameterDecorator {
  return (target, key, index) => {
    if (key === undefined) {
      throw new Error('ValidParams belongs on a parameter of a route method.');
    }
    Param(new SchemaPipe(schema))(target, key, index);
    const described = toOpenApiSchema(schema, 'input');
    for (const [name, property] of Object.entries(described.properties ?? {})) {
      onMethod(ApiParam({ name, required: true, schema: property as SchemaObject }), target, key);
    }
  };
}

/** Metadata key under which `ValidFile` names the declared file route of a handler. */
export const TAKES_FILE = Symbol('TAKES_FILE');

/**
 * The file of a declared file route (`FILE_ROUTES` in `file-routes.ts`, task
 * 2.2c-2), as `fileBodyMiddleware` read it, or `null` when the body is
 * anything else (JSON, nothing at all). The handler refuses `null` with 415
 * after its own checks of the record (correction 3 of the review of pull
 * request #59: the record's 404 comes first). A route that takes a file reads
 * its body only through this decorator, with its entry of `FILE_ROUTES`.
 *
 *     setPhoto(@ValidFile(STAFF_PHOTO_ROUTE) file: UploadedFile)
 */
export function ValidFile(route: FileRoute): ParameterDecorator {
  return (target, key, index) => {
    if (key === undefined) {
      throw new Error('ValidFile belongs on a parameter of a route method.');
    }
    Body({
      transform: (value: unknown): UploadedFile | null =>
        value instanceof UploadedFile && route.types.includes(value.type) ? value : null,
    })(target, key, index);
    onMethod(SetMetadata(TAKES_FILE, route), target, key);
    onMethod(ApiConsumes(...route.types), target, key);
    onMethod(ApiBody({ schema: { type: 'string', format: 'binary' } }), target, key);
  };
}

/** One header of the request, by its name in lower case. */
const HeaderValue = createParamDecorator(
  (name: string, context: ExecutionContext): unknown =>
    context.switchToHttp().getRequest<Request>().headers[name],
);

/**
 * The key of a repeat-safe action (docs/spec/edge-cases/developer-rules.md,
 * "Repeat-safe actions"): the `Idempotency-Key` header, a uuid that the caller
 * makes once per action and sends again on a retry. Give it to
 * `RequestKeys.runOnce`.
 *
 *     publish(@RequestKey() key: string)
 */
export function RequestKey(): ParameterDecorator {
  return (target, key, index) => {
    if (key === undefined) {
      throw new Error('RequestKey belongs on a parameter of a route method.');
    }
    HeaderValue(
      REQUEST_KEY_HEADER.toLowerCase(),
      new HeaderPipe(REQUEST_KEY_HEADER, requestKeySchema),
    )(target, key, index);
    onMethod(
      ApiHeader({
        name: REQUEST_KEY_HEADER,
        required: true,
        schema: toOpenApiSchema(requestKeySchema, 'input'),
      }),
      target,
      key,
    );
  };
}

/**
 * What a route answers. The same shared schema describes the answer in the
 * OpenAPI document and is applied to it before it is sent
 * (`ResponseSchemaInterceptor`), so the two cannot differ.
 */
export function Returns(schema: z.ZodType, status = 200): MethodDecorator {
  return applyDecorators(
    ApiResponse({ status, schema: toOpenApiSchema(schema, 'output') }),
    SetMetadata(RESPONSE_SCHEMA, schema),
  );
}

/** For a route that answers with no body: status 204, in the document too. */
export function ReturnsNothing(): MethodDecorator {
  return applyDecorators(HttpCode(204), ApiResponse({ status: 204 }));
}

/** Metadata key under which `@ReturnsFile` marks a route that answers a file. */
export const RETURNS_FILE = Symbol('RETURNS_FILE');

/**
 * For a route that answers an Excel file (an export, task 2.2c-1): status 200
 * with the file, described in the document as a binary answer of that type.
 * The handler returns an `XlsxFile`; `XlsxFileInterceptor` sends it.
 */
export function ReturnsFile(): MethodDecorator {
  return applyDecorators(
    HttpCode(200),
    ApiResponse({
      status: 200,
      content: { [XLSX_MEDIA_TYPE]: { schema: { type: 'string', format: 'binary' } } },
    }),
    SetMetadata(RETURNS_FILE, true),
    UseInterceptors(XlsxFileInterceptor),
  );
}

/**
 * For a route that answers a photo (task 2.2c-2): status 200 with the image,
 * described in the document as a binary answer of each photo type. The
 * handler returns a `PhotoFile`; `PhotoFileInterceptor` sends it.
 */
export function ReturnsPhoto(): MethodDecorator {
  const binary = { schema: { type: 'string', format: 'binary' } } as const;
  return applyDecorators(
    HttpCode(200),
    ApiResponse({
      status: 200,
      content: Object.fromEntries(PHOTO_TYPES.map((type) => [type, binary])),
    }),
    SetMetadata(RETURNS_FILE, true),
    UseInterceptors(PhotoFileInterceptor),
  );
}
