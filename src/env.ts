import { createServerOnlyFn } from "@tanstack/react-start";

/**
 * Server environment variables - only accessible in server functions.
 * Uses createServerOnlyFn to throw an error if accessed from client.
 */
export const getServerEnv = createServerOnlyFn(() => ({
	FACILITATOR_URL:
		process.env.FACILITATOR_URL ?? "https://x402.org/facilitator",
}));

/**
 * Client environment variables - safe to use anywhere.
 * Must be prefixed with VITE_ to be bundled for client access.
 */
export const clientEnv = {
	VITE_CREATOR_ADDRESS: import.meta.env.VITE_CREATOR_ADDRESS as
		| string
		| undefined,
} as const;
