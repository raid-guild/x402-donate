import { createFileRoute } from "@tanstack/react-router";
import { getServerEnv } from "@/env";

// x402 v2 payment requirements format
interface PaymentRequirement {
	scheme: string;
	network: string;
	amount: string; // Amount in smallest unit (e.g., 6 decimals for USDC)
	resource: string;
	description: string;
	mimeType: string;
	payTo: string;
	maxTimeoutSeconds: number;
	asset: string;
	extra?: Record<string, unknown>;
}

const NETWORK_CONFIG: Record<
	string,
	{
		chainId: number;
		chainIdCAIP: string;
		asset: string;
		name: string;
		eip712: { name: string; version: string };
	}
> = {
	"base-sepolia": {
		chainId: 84532,
		chainIdCAIP: "eip155:84532",
		asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // USDC on Base Sepolia
		name: "Base Sepolia",
		eip712: { name: "USDC", version: "2" },
	},
	base: {
		chainId: 8453,
		chainIdCAIP: "eip155:8453",
		asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
		name: "Base",
		eip712: { name: "USD Coin", version: "2" },
	},
	sepolia: {
		chainId: 11155111,
		chainIdCAIP: "eip155:11155111",
		asset: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // USDC on Sepolia
		name: "Sepolia",
		eip712: { name: "USDC", version: "2" },
	},
	mainnet: {
		chainId: 1,
		chainIdCAIP: "eip155:1",
		asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC on Ethereum
		name: "Ethereum",
		eip712: { name: "USD Coin", version: "2" },
	},
};

/**
 * Build x402 v2 payment requirements for a donation
 */
function buildPaymentRequirements(
	recipient: string,
	network: string,
	amountCents: number,
	resourceUrl: string,
): PaymentRequirement[] {
	const networkConfig = NETWORK_CONFIG[network];
	if (!networkConfig) {
		throw new Error("Unsupported network");
	}

	// Convert cents to USDC (6 decimals): $3.00 = 300 cents = 3000000 USDC units
	const amountInUsdcUnits = (amountCents * 10000).toString();
	const priceInDollars = (amountCents / 100).toFixed(2);

	return [
		{
			scheme: "exact",
			network: networkConfig.chainIdCAIP,
			amount: amountInUsdcUnits,
			resource: resourceUrl,
			description: `Donation of $${priceInDollars} to ${recipient}`,
			mimeType: "application/json",
			payTo: recipient,
			maxTimeoutSeconds: 300,
			asset: networkConfig.asset,
			extra: {
				name: networkConfig.eip712.name,
				version: networkConfig.eip712.version,
			},
		},
	];
}

/**
 * Create a 402 Payment Required response with x402 v2 format
 */
function createPaymentRequiredResponse(
	paymentRequirements: PaymentRequirement[],
): Response {
	const paymentRequired = {
		x402Version: 2 as const,
		accepts: paymentRequirements,
		error: "Payment Required",
	};

	const encodedPaymentRequired = btoa(JSON.stringify(paymentRequired));

	return new Response(JSON.stringify({ error: "Payment Required" }), {
		status: 402,
		headers: {
			"Content-Type": "application/json",
			"PAYMENT-REQUIRED": encodedPaymentRequired,
		},
	});
}

export const Route = createFileRoute("/api/donate/$recipient/$network")({
	server: {
		handlers: {
			// GET returns 402 with payment requirements
			GET: async ({ request, params }) => {
				const { recipient, network } = params;
				const url = new URL(request.url);
				const amountCents = Number.parseInt(
					url.searchParams.get("amount") || "100",
					10,
				);

				// Validate recipient address
				if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
					return Response.json(
						{ error: "Invalid recipient address" },
						{ status: 400 },
					);
				}

				// Validate network
				if (!NETWORK_CONFIG[network]) {
					return Response.json(
						{ error: "Unsupported network" },
						{ status: 400 },
					);
				}

				// Validate amount
				if (amountCents < 1) {
					return Response.json({ error: "Invalid amount" }, { status: 400 });
				}

				const paymentRequirements = buildPaymentRequirements(
					recipient,
					network,
					amountCents,
					request.url,
				);
				return createPaymentRequiredResponse(paymentRequirements);
			},

			// POST handles the payment verification and settlement
			POST: async ({ request, params }) => {
				const { recipient, network } = params;
				const url = new URL(request.url);
				const amountCents = Number.parseInt(
					url.searchParams.get("amount") || "100",
					10,
				);

				console.log("=== Incoming POST request ===");
				console.log("URL:", request.url);
				console.log("Params:", { recipient, network, amountCents });

				// Validate network
				if (!NETWORK_CONFIG[network]) {
					return Response.json(
						{ error: "Unsupported network" },
						{ status: 400 },
					);
				}

				// Check for payment header (x402 v2 uses PAYMENT-SIGNATURE, v1 uses X-PAYMENT)
				const paymentHeader =
					request.headers.get("PAYMENT-SIGNATURE") ||
					request.headers.get("payment-signature") ||
					request.headers.get("X-PAYMENT") ||
					request.headers.get("x-payment");

				console.log("Payment header found:", paymentHeader ? "YES" : "NO");

				if (!paymentHeader) {
					// No payment provided, return 402
					console.log("No payment header, returning 402");
					const paymentRequirements = buildPaymentRequirements(
						recipient,
						network,
						amountCents,
						request.url,
					);
					return createPaymentRequiredResponse(paymentRequirements);
				}

				try {
					// Parse the payment payload from the header (base64 encoded)
					console.log("Decoding payment header...");
					const paymentPayload = JSON.parse(atob(paymentHeader));

					console.log(
						"Received payment payload:",
						JSON.stringify(paymentPayload, null, 2),
					);

					// Build payment requirements (must match what was sent in 402)
					const paymentRequirements = buildPaymentRequirements(
						recipient,
						network,
						amountCents,
						request.url,
					);

					const { FACILITATOR_URL, FACILITATOR_API_KEY } = getServerEnv();
					console.log("Using facilitator URL:", FACILITATOR_URL);
					console.log(
						"Using facilitator API key:",
						FACILITATOR_API_KEY ? "YES" : "NO",
					);

					// Step 1: Verify the payment with the facilitator
					const verifyRequestBody = {
						x402Version: 2,
						paymentPayload,
						paymentRequirements: paymentRequirements[0],
					};
					console.log("=== Calling /verify ===");
					console.log(
						"Request body:",
						JSON.stringify(verifyRequestBody, null, 2),
					);

					const headers: HeadersInit = FACILITATOR_API_KEY
						? {
								"Content-Type": "application/json",
								"X-API-KEY": FACILITATOR_API_KEY,
							}
						: {
								"Content-Type": "application/json",
							};
					const verifyResponse = await fetch(`${FACILITATOR_URL}/verify`, {
						method: "POST",
						headers,
						body: JSON.stringify(verifyRequestBody),
					});

					console.log("Verify response status:", verifyResponse.status);

					if (!verifyResponse.ok) {
						const errorText = await verifyResponse.text();
						console.error("Facilitator verify error:", errorText);
						return Response.json(
							{ error: "Payment verification failed", details: errorText },
							{ status: 400 },
						);
					}

					const verifyResult = await verifyResponse.json();
					console.log("Verify result:", JSON.stringify(verifyResult, null, 2));

					if (!verifyResult.isValid) {
						console.error("Payment invalid:", verifyResult.invalidReason);
						return Response.json(
							{
								error: "Invalid payment",
								reason: verifyResult.invalidReason,
							},
							{ status: 400 },
						);
					}

					console.log("Payment verified! Proceeding to settle...");

					// Step 2: Settle the payment with the facilitator
					const settleRequestBody = {
						x402Version: 2,
						paymentPayload,
						paymentRequirements: paymentRequirements[0],
					};
					console.log("=== Calling /settle ===");
					console.log(
						"Request body:",
						JSON.stringify(settleRequestBody, null, 2),
					);

					const settleResponse = await fetch(`${FACILITATOR_URL}/settle`, {
						method: "POST",
						headers,
						body: JSON.stringify(settleRequestBody),
					});

					console.log("Settle response status:", settleResponse.status);

					if (!settleResponse.ok) {
						const errorText = await settleResponse.text();
						console.error("Facilitator settle error:", errorText);
						return Response.json(
							{ error: "Payment settlement failed", details: errorText },
							{ status: 500 },
						);
					}

					const settleResult = await settleResponse.json();
					console.log("Settle result:", JSON.stringify(settleResult, null, 2));

					if (!settleResult.success) {
						console.error("Settlement failed:", settleResult.errorReason);
						return Response.json(
							{
								error: "Settlement failed",
								reason: settleResult.errorReason,
							},
							{ status: 500 },
						);
					}

					console.log("=== Payment successful! ===");

					// Return success response with transaction hash
					return Response.json({
						success: true,
						message: "Thank you for your donation! ☕",
						recipient,
						network,
						txHash: settleResult.transaction,
					});
				} catch (err) {
					console.error("Payment processing error:", err);
					return Response.json(
						{ error: "Payment processing failed" },
						{ status: 500 },
					);
				}
			},
		},
	},
});
