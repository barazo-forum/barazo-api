import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Param schemas for block/mute action endpoints
// ---------------------------------------------------------------------------

const didRegex = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;

/** Schema for validating :did route parameter. */
export const didParamSchema = z.object({
  did: z.string().regex(didRegex, "Invalid DID format"),
});

export type DidParam = z.infer<typeof didParamSchema>;
