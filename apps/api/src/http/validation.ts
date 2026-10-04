import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ErrorDetail } from '@sodiq/shared';
import type { z } from 'zod';

/** Thrown when an input does not match its schema. The error filter answers 400 `validation_failed`. */
export class ValidationFailedException extends BadRequestException {
  constructor(readonly details: ErrorDetail[]) {
    super('The input is not valid.');
  }
}

/**
 * Our own text per kind of problem. The messages of the library are not used:
 * some of them repeat what was sent.
 */
const MESSAGE: Record<string, string> = {
  invalid_type: 'Missing or of the wrong type.',
  too_small: 'Too small or too short.',
  too_big: 'Too large or too long.',
  invalid_format: 'Not in the expected format.',
  invalid_value: 'Not one of the allowed values.',
  not_multiple_of: 'Not a multiple of the required step.',
  unrecognized_keys: 'Holds a field that is not allowed.',
};
const OTHER_MESSAGE = 'Not valid.';

/** A field name as a schema writes it. Anything else in a path could be text the caller sent. */
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function pathSegment(segment: PropertyKey): string {
  if (typeof segment === 'number') {
    return String(segment);
  }
  return typeof segment === 'string' && FIELD_NAME.test(segment) ? segment : '*';
}

/** Where and what kind, never the value: an answer must not repeat personal data that was typed. */
export function toErrorDetails(error: z.ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(pathSegment).join('.'),
    code: issue.code,
    message: MESSAGE[issue.code] ?? OTHER_MESSAGE,
  }));
}

/** Checks one input of a route (body or query) against a shared schema. */
export class SchemaPipe<Schema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<Schema>
> {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown): z.output<Schema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ValidationFailedException(toErrorDetails(result.error));
    }
    return result.data;
  }
}
