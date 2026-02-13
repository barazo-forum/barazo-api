import {
  topicPostSchema,
  topicReplySchema,
  reactionSchema,
} from "@barazo-forum/lexicons";
import type { SupportedCollection } from "./types.js";
import { SUPPORTED_COLLECTIONS } from "./types.js";

const MAX_RECORD_SIZE = 64 * 1024; // 64KB

type ValidationResult =
  | { success: true; data: Record<string, unknown> }
  | { success: false; error: string };

const schemaMap: Record<
  SupportedCollection,
  { safeParse: (data: unknown) => { success: boolean; error?: unknown } }
> = {
  "forum.barazo.topic.post": topicPostSchema,
  "forum.barazo.topic.reply": topicReplySchema,
  "forum.barazo.interaction.reaction": reactionSchema,
};

function isSupportedCollection(
  collection: string,
): collection is SupportedCollection {
  return (SUPPORTED_COLLECTIONS as readonly string[]).includes(collection);
}

export function validateRecord(
  collection: string,
  record: unknown,
): ValidationResult {
  if (!isSupportedCollection(collection)) {
    return { success: false, error: `Unsupported collection: ${collection}` };
  }

  // Size check: rough estimate using JSON serialization
  const serialized = JSON.stringify(record);
  if (serialized.length > MAX_RECORD_SIZE) {
    return {
      success: false,
      error: `Record exceeds maximum size of ${String(MAX_RECORD_SIZE)} bytes`,
    };
  }

  const schema = schemaMap[collection];
  const result = schema.safeParse(record);
  if (!result.success) {
    return { success: false, error: `Validation failed for ${collection}` };
  }

  return { success: true, data: record as Record<string, unknown> };
}
