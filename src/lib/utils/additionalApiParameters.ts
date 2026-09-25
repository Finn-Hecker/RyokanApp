export const PROTECTED_API_PARAMETER_KEYS = ["messages", "model", "stream"] as const;

export type AdditionalApiParametersValidation =
  | { valid: true; value: Record<string, unknown> | null }
  | { valid: false; error: "invalidJson" | "rootMustBeObject" | "protectedFields"; fields?: string[] };

/**
 * Validates the power-user JSON without changing its values. An empty input is
 * equivalent to having no additional parameters configured.
 */
export function validateAdditionalApiParameters(input: string): AdditionalApiParametersValidation {
  if (!input.trim()) return { valid: true, value: null };

  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return { valid: false, error: "invalidJson" };
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, error: "rootMustBeObject" };
  }

  const fields = PROTECTED_API_PARAMETER_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
  if (fields.length > 0) return { valid: false, error: "protectedFields", fields: [...fields] };

  return { valid: true, value: value as Record<string, unknown> };
}
