// Fastify creates its own Pino logger instance.
// This module re-exports the logger type for use outside request context.
export type { FastifyBaseLogger as Logger } from "fastify";
