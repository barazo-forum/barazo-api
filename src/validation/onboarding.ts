import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Field type enum
// ---------------------------------------------------------------------------

export const onboardingFieldTypeSchema = z.enum([
  "age_confirmation",
  "tos_acceptance",
  "newsletter_email",
  "custom_text",
  "custom_select",
  "custom_checkbox",
]);

export type OnboardingFieldType = z.infer<typeof onboardingFieldTypeSchema>;

// ---------------------------------------------------------------------------
// Config schemas per field type
// ---------------------------------------------------------------------------

const selectConfigSchema = z.object({
  options: z.array(z.string().min(1).max(200)).min(2).max(20),
});

// ---------------------------------------------------------------------------
// Admin CRUD schemas
// ---------------------------------------------------------------------------

export const createOnboardingFieldSchema = z.object({
  fieldType: onboardingFieldTypeSchema,
  label: z.string().trim().min(1, "Label is required").max(200, "Label must be at most 200 characters"),
  description: z.string().trim().max(500).nullable().optional(),
  isMandatory: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type CreateOnboardingFieldInput = z.infer<typeof createOnboardingFieldSchema>;

export const updateOnboardingFieldSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  isMandatory: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type UpdateOnboardingFieldInput = z.infer<typeof updateOnboardingFieldSchema>;

export const reorderFieldsSchema = z.array(
  z.object({
    id: z.string().min(1),
    sortOrder: z.number().int().min(0),
  }),
).min(1);

export type ReorderFieldsInput = z.infer<typeof reorderFieldsSchema>;

// ---------------------------------------------------------------------------
// User submission schema
// ---------------------------------------------------------------------------

export const submitOnboardingSchema = z.array(
  z.object({
    fieldId: z.string().min(1),
    response: z.unknown(),
  }),
).min(1);

export type SubmitOnboardingInput = z.infer<typeof submitOnboardingSchema>;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate a user's response value against the field type and config.
 * Returns an error message if invalid, or null if valid.
 */
export function validateFieldResponse(
  fieldType: OnboardingFieldType,
  response: unknown,
  config: Record<string, unknown> | null | undefined,
): string | null {
  switch (fieldType) {
    case "age_confirmation": {
      if (typeof response !== "number") return "Age confirmation must be a number";
      const validAges = [0, 13, 14, 15, 16, 18];
      if (!validAges.includes(response)) return "Invalid age value";
      return null;
    }
    case "tos_acceptance": {
      if (response !== true) return "Terms of service must be accepted";
      return null;
    }
    case "newsletter_email": {
      if (typeof response !== "string") return "Email must be a string";
      if (response.length === 0) return null; // optional empty is fine
      const emailResult = z.email().safeParse(response);
      if (!emailResult.success) return "Invalid email format";
      return null;
    }
    case "custom_text": {
      if (typeof response !== "string") return "Response must be a string";
      if (response.length > 1000) return "Response must be at most 1000 characters";
      return null;
    }
    case "custom_select": {
      if (typeof response !== "string") return "Selection must be a string";
      if (config) {
        const parsed = selectConfigSchema.safeParse(config);
        if (parsed.success && !parsed.data.options.includes(response)) {
          return "Invalid selection";
        }
      }
      return null;
    }
    case "custom_checkbox": {
      if (typeof response !== "boolean") return "Checkbox must be true or false";
      return null;
    }
    default:
      return "Unknown field type";
  }
}
