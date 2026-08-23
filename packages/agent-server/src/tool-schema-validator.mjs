function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function valueType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(expected, value) {
  switch (expected) {
    case 'object':
      return isObject(value);
    case 'array':
      return Array.isArray(value);
    case 'integer':
      return Number.isSafeInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
    case 'boolean':
      return typeof value === expected;
    default:
      return false;
  }
}

function sameJsonScalar(left, right) {
  return Object.is(left, right);
}

function propertyPath(path, key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

/**
 * Validate the deliberately small JSON-Schema subset used by the dependency-
 * free packaged MCP. Returns the first deterministic error, or null.
 */
export function validateJsonSchema(schema, value, path = '$') {
  if (schema.type && !matchesType(schema.type, value)) {
    return `${path} must be ${schema.type}; received ${valueType(value)}`;
  }

  if (Object.hasOwn(schema, 'const') && !sameJsonScalar(value, schema.const)) {
    return `${path} must equal ${JSON.stringify(schema.const)}`;
  }

  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some(candidate => sameJsonScalar(candidate, value))
  ) {
    return `${path} must be one of ${schema.enum.map(JSON.stringify).join(', ')}`;
  }

  if (Array.isArray(schema.allOf)) {
    for (const childSchema of schema.allOf) {
      const error = validateJsonSchema(childSchema, value, path);
      if (error) return error;
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const matched = schema.anyOf.some(
      childSchema => validateJsonSchema(childSchema, value, path) === null
    );
    if (!matched) return `${path} does not satisfy any allowed shape`;
  }

  if (schema.not && validateJsonSchema(schema.not, value, path) === null) {
    return `${path} matches a forbidden shape`;
  }

  if (
    schema.if &&
    validateJsonSchema(schema.if, value, path) === null &&
    schema.then
  ) {
    const error = validateJsonSchema(schema.then, value, path);
    if (error) return error;
  }

  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) {
      return `${path} must contain at least ${schema.minLength} characters`;
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      return `${path} must contain at most ${schema.maxLength} characters`;
    }
    if (schema.format === 'uri') {
      try {
        new URL(value);
      } catch {
        return `${path} must be an absolute URI`;
      }
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return `${path} must be at least ${schema.minimum}`;
    }
    if (
      schema.exclusiveMinimum !== undefined &&
      value <= schema.exclusiveMinimum
    ) {
      return `${path} must be greater than ${schema.exclusiveMinimum}`;
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return `${path} must be at most ${schema.maximum}`;
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return `${path} must contain at least ${schema.minItems} items`;
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return `${path} must contain at most ${schema.maxItems} items`;
    }
    if (schema.items) {
      for (let index = 0; index < value.length; index += 1) {
        const error = validateJsonSchema(
          schema.items,
          value[index],
          `${path}[${index}]`
        );
        if (error) return error;
      }
    }
  }

  if (isObject(value)) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.hasOwn(value, key)) {
          return `${propertyPath(path, key)} is required`;
        }
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) {
          return `${propertyPath(path, key)} is not allowed`;
        }
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (!Object.hasOwn(value, key)) continue;
      const error = validateJsonSchema(
        childSchema,
        value[key],
        propertyPath(path, key)
      );
      if (error) return error;
    }
  }

  return null;
}

/** Validate one tool call and materialize its advertised top-level defaults. */
export function parseToolArguments(schema, input) {
  const value = input ?? {};
  const error = validateJsonSchema(schema, value);
  if (error) throw new TypeError(error);

  const parsed = { ...value };
  const properties = isObject(schema.properties) ? schema.properties : {};
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (
      !Object.hasOwn(parsed, key) &&
      isObject(propertySchema) &&
      Object.hasOwn(propertySchema, 'default')
    ) {
      parsed[key] = propertySchema.default;
    }
  }
  return parsed;
}
