export type PackagedToolSchema = {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
};

export const TOOL_SCHEMAS: Record<string, PackagedToolSchema>;

export function mapFields(
  input: Record<string, unknown> | null | undefined
): Record<string, unknown> | null | undefined;

export const LEGACY_TOOL_DESCRIPTIONS: Readonly<Record<string, string>>;
