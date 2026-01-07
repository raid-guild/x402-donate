import { useAppKit } from "@reown/appkit/react";
import {
	ClientOnly,
	createFileRoute,
	Link,
	stripSearchParams,
} from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { Check, Coffee, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { erc20Abi } from "viem";
import {
	useAccount,
	useReadContract,
	useSwitchChain,
	useWalletClient,
} from "wagmi";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { clientEnv } from "@/env";
import { useDonationForm } from "@/hooks/donation-form";
import { isAddress, isEnsName, resolveEnsName } from "@/lib/ens";
import { type NetworkKey, SUPPORTED_NETWORKS } from "@/lib/wagmi-config";

// Default values for search params
const searchDefaults = {
	network: "base" as const,
	amount: 300, // $3 in cents
	message: "",
};

// Search params schema - defaults applied via .default() for proper type inference
const searchParamsSchema = z.object({
	network: z
		.enum(["base-sepolia", "base", "sepolia", "mainnet"])
		.default(searchDefaults.network)
		.catch(searchDefaults.network),
	amount: z.coerce
		.number()
		.min(1)
		.default(searchDefaults.amount)
		.catch(searchDefaults.amount),
	message: z
		.string()
		.max(100)
		.default(searchDefaults.message)
		.catch(searchDefaults.message),
});

export const Route = createFileRoute("/donate/$recipient")({
	component: DonationPage,
	validateSearch: searchParamsSchema,
	search: {
		middlewares: [stripSearchParams(searchDefaults)],
	},
	// Pass search params through loaderDeps for SSR head function access
	loaderDeps: ({ search }) => ({
		amount: search.amount,
		network: search.network,
	}),
	loader: ({ params: { recipient }, deps }) => {
		const isValidAddress = isAddress(recipient);
		const isEns = isEnsName(recipient);
		return {
			recipient,
			isValidAddress,
			isEns,
			amount: deps.amount,
			network: deps.network,
		};
	},
	head: ({ loaderData }) => {
		const { recipient, isEns, amount, network } = loaderData ?? {
			recipient: "",
			isEns: false,
			amount: searchDefaults.amount,
			network: searchDefaults.network,
		};

		const displayName = isEns
			? recipient
			: `${recipient.slice(0, 6)}...${recipient.slice(-4)}`;

		// Format amount from cents to dollars
		const amountDollars = (amount / 100).toFixed(2);
		const isDefaultAmount = amount === searchDefaults.amount;
		const isDefaultNetwork = network === searchDefaults.network;

		// Get network display name
		const networkNames: Record<string, string> = {
			base: "Base",
			"base-sepolia": "Base Sepolia",
			sepolia: "Sepolia",
			mainnet: "Ethereum",
		};
		const networkName = networkNames[network] || "Base";

		// Build dynamic title and description
		const title = isDefaultAmount
			? `Donate to ${displayName}`
			: `Donate $${amountDollars} to ${displayName}`;

		const descriptionParts = [
			`Buy ${displayName} a coffee with crypto via x402.`,
		];
		if (!isDefaultAmount) {
			descriptionParts.push(`Suggested amount: $${amountDollars}.`);
		}
		descriptionParts.push(`Fast, secure USDC donations on ${networkName}.`);
		const description = descriptionParts.join(" ");

		// Build URL with search params if non-default
		const searchParams = new URLSearchParams();
		if (!isDefaultAmount) searchParams.set("amount", String(amount));
		if (!isDefaultNetwork) searchParams.set("network", network);
		const queryString = searchParams.toString();
		const url = `/donate/${recipient}${queryString ? `?${queryString}` : ""}`;

		return {
			meta: [
				{ title },
				{ name: "description", content: description },
				// OpenGraph
				{ property: "og:title", content: title },
				{ property: "og:description", content: description },
				{ property: "og:image", content: "/og-image.svg" },
				{ property: "og:url", content: url },
				{ property: "og:type", content: "website" },
				// Twitter
				{ name: "twitter:title", content: title },
				{ name: "twitter:description", content: description },
				{ name: "twitter:image", content: "/og-image.svg" },
				{ name: "twitter:url", content: url },
			],
		};
	},
});

const donationSchema = z.object({
	amount: z.number().min(1, "Please select an amount"),
	network: z.enum(["base-sepolia", "base", "sepolia", "mainnet"]),
	message: z.string().max(100),
});

type PaymentStatus =
	| "idle"
	| "connecting"
	| "switching-network"
	| "signing"
	| "processing"
	| "success"
	| "error";

function DonationPage() {
	const { recipient, isValidAddress, isEns } = Route.useLoaderData();

	// Invalid address/ENS view
	if (!isValidAddress && !isEns) {
		return (
			<div className="min-h-screen flex items-center justify-center p-4 bg-[#1a1a2e]">
				<div className="text-center max-w-md">
					<div className="text-6xl mb-4">😕</div>
					<h1 className="text-2xl font-bold text-white mb-2">
						Invalid Address
					</h1>
					<p className="text-zinc-400">
						<code className="bg-zinc-800 px-2 py-1 rounded text-sm text-amber-400">
							{recipient}
						</code>{" "}
						doesn't look like a valid Ethereum address or ENS name.
					</p>
				</div>
			</div>
		);
	}

	// Wrap wallet-dependent content in ClientOnly
	// Pass the original recipient (could be ENS or address)
	return (
		<ClientOnly
			fallback={
				<DonationPageSkeleton
					recipient={recipient}
					ensName={isEns ? recipient : undefined}
				/>
			}
		>
			<DonationPageWithEns
				recipient={recipient}
				isEns={isEns}
				isValidAddress={isValidAddress}
			/>
		</ClientOnly>
	);
}

// Wrapper component that handles ENS resolution
function DonationPageWithEns({
	recipient,
	isEns,
	isValidAddress,
}: {
	recipient: string;
	isEns: boolean;
	isValidAddress: boolean;
}) {
	const [resolvedAddress, setResolvedAddress] = useState<`0x${string}` | null>(
		isValidAddress ? (recipient as `0x${string}`) : null,
	);
	const [ensName, setEnsName] = useState<string | undefined>(
		isEns ? recipient : undefined,
	);
	const [resolving, setResolving] = useState(isEns);
	const [resolutionError, setResolutionError] = useState<string | null>(null);

	useEffect(() => {
		if (isEns) {
			setResolving(true);
			resolveEnsName(recipient)
				.then((address) => {
					if (address) {
						setResolvedAddress(address);
						setEnsName(recipient);
					} else {
						setResolutionError(`Could not resolve ${recipient}`);
					}
				})
				.catch(() => {
					setResolutionError(`Failed to resolve ${recipient}`);
				})
				.finally(() => {
					setResolving(false);
				});
		}
	}, [recipient, isEns]);

	// Show loading while resolving ENS
	if (resolving) {
		return (
			<DonationPageSkeleton recipient={recipient} ensName={ensName} resolving />
		);
	}

	// Show error if ENS resolution failed
	if (resolutionError || !resolvedAddress) {
		return (
			<div className="min-h-screen flex items-center justify-center p-4 bg-[#1a1a2e]">
				<div className="text-center max-w-md">
					<div className="text-6xl mb-4">😕</div>
					<h1 className="text-2xl font-bold text-white mb-2">ENS Not Found</h1>
					<p className="text-zinc-400">
						Could not resolve{" "}
						<code className="bg-zinc-800 px-2 py-1 rounded text-sm text-amber-400">
							{recipient}
						</code>{" "}
						to an Ethereum address.
					</p>
				</div>
			</div>
		);
	}

	return (
		<DonationPageContent
			recipient={resolvedAddress}
			ensName={ensName}
			originalRecipient={recipient}
		/>
	);
}

// Loading skeleton for SSR
function DonationPageSkeleton({
	recipient,
	ensName,
	resolving,
}: {
	recipient: string;
	ensName?: string;
	resolving?: boolean;
}) {
	const shortAddress =
		recipient.length === 42
			? `${recipient.slice(0, 6)}...${recipient.slice(-4)}`
			: recipient;

	return (
		<div className="min-h-screen flex items-center justify-center p-4 bg-[#1a1a2e] relative overflow-hidden">
			<div className="absolute inset-0 overflow-hidden">
				<div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-amber-500/20 via-transparent to-transparent rounded-full blur-3xl animate-pulse" />
				<div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-orange-600/20 via-transparent to-transparent rounded-full blur-3xl animate-pulse" />
			</div>
			<div className="w-full max-w-md relative z-10">
				<div className="bg-gradient-to-b from-zinc-900/90 to-zinc-950/95 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-amber-500/20">
					<div className="text-center mb-8">
						<div className="relative inline-block mb-4">
							<div className="w-20 h-20 bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/30 rotate-3">
								<Coffee className="w-10 h-10 text-white" />
							</div>
							<Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-amber-400 animate-pulse" />
						</div>
						<h1 className="text-2xl font-bold text-white mb-2 tracking-tight">
							Buy me a coffee
						</h1>
						<p className="text-zinc-400 text-sm">
							Support{" "}
							<span className="text-amber-400 font-mono text-xs bg-amber-400/10 px-2 py-1 rounded">
								{ensName || shortAddress}
							</span>
						</p>
					</div>
					<div className="flex flex-col items-center justify-center py-12 gap-2">
						<Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
						{resolving && (
							<p className="text-zinc-500 text-sm">Resolving ENS name...</p>
						)}
					</div>
					<div className="text-center text-zinc-500 text-xs mt-6 space-y-1">
						<p>
							Powered by <span className="text-amber-400">x402</span>
						</p>
						<p>
							<Link
								to="/"
								className="text-amber-400/70 hover:text-amber-300 transition-colors"
							>
								Create your own donate page →
							</Link>
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}

// Client-only donation form with wallet integration
function DonationPageContent({
	recipient,
	ensName,
	originalRecipient,
}: {
	recipient: `0x${string}`;
	ensName?: string;
	originalRecipient: string;
}) {
	const messageInputId = useId();
	const navigate = Route.useNavigate();

	// Get search params from URL (always has values due to schema defaults)
	const searchParams = Route.useSearch();

	// Check if this is the creator's donation page
	const isCreatorPage =
		clientEnv.VITE_CREATOR_ADDRESS &&
		originalRecipient.toLowerCase() ===
			clientEnv.VITE_CREATOR_ADDRESS.toLowerCase();

	// Wallet state - only works on client
	const { address, isConnected, chain } = useAccount();
	const { data: walletClient } = useWalletClient();
	const { switchChainAsync } = useSwitchChain();
	const { open } = useAppKit();

	// Payment state
	const [status, setStatus] = useState<PaymentStatus>("idle");
	const [error, setError] = useState<string | null>(null);
	const [txHash, setTxHash] = useState<string | null>(null);
	const [finalAmount, setFinalAmount] = useState<number>(0);
	const [finalNetwork, setFinalNetwork] = useState<NetworkKey>("base-sepolia");

	// Reset "connecting" status when wallet connects
	useEffect(() => {
		if (isConnected && status === "connecting") {
			setStatus("idle");
		}
	}, [isConnected, status]);

	// Create x402 client with wallet signer
	const x402PaymentClient = useMemo(() => {
		if (!walletClient) return null;

		const client = new x402Client();

		const signer = {
			address: walletClient.account.address,
			signMessage: async ({ message }: { message: string }) => {
				return walletClient.signMessage({ message });
			},
			signTypedData: async (
				params: Parameters<typeof walletClient.signTypedData>[0],
			) => {
				return walletClient.signTypedData(params);
			},
		};

		registerExactEvmScheme(client, { signer });

		return client;
	}, [walletClient]);

	const handleDonation = useCallback(
		async (values: {
			amount: number;
			network: NetworkKey;
			message?: string;
		}) => {
			const { amount, network, message } = values;
			const networkInfo = SUPPORTED_NETWORKS[network];

			setError(null);
			setFinalAmount(amount);
			setFinalNetwork(network);

			try {
				// Step 1: Connect wallet if not connected
				if (!isConnected) {
					setStatus("connecting");
					open();
					return;
				}

				if (!walletClient || !x402PaymentClient) {
					setError("Wallet not ready. Please try again.");
					return;
				}

				// Step 2: Switch network if needed
				const targetChainId = networkInfo.id;
				if (chain?.id !== targetChainId) {
					setStatus("switching-network");
					await switchChainAsync({ chainId: targetChainId });
				}

				setStatus("signing");

				// Step 3: Create x402-wrapped fetch
				const fetchWithPay = wrapFetchWithPayment(fetch, x402PaymentClient);

				// Step 4: Make the payment request
				setStatus("processing");

				const apiUrl = `/api/donate/${recipient}/${network}?amount=${amount}`;

				const response = await fetchWithPay(apiUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						message: message || undefined,
					}),
				});

				if (!response.ok) {
					const errorData = await response.json().catch(() => ({}));
					throw new Error(
						errorData.error || `Payment failed: ${response.status}`,
					);
				}

				const result = await response.json();

				if (result.success) {
					setTxHash(result.txHash);
					setStatus("success");
				} else {
					throw new Error(result.error || "Payment failed");
				}
			} catch (err) {
				console.error("Payment error:", err);
				setStatus("error");
				setError(err instanceof Error ? err.message : "Payment failed");
			}
		},
		[
			recipient,
			isConnected,
			walletClient,
			x402PaymentClient,
			chain,
			open,
			switchChainAsync,
		],
	);

	// TanStack Form - initialized from URL search params (schema provides defaults)
	const form = useDonationForm({
		defaultValues: {
			amount: searchParams.amount,
			network: searchParams.network,
			message: searchParams.message,
		},
		validators: {
			onSubmit: donationSchema,
		},
		onSubmit: async ({ value }) => {
			await handleDonation(value);
		},
	});

	// Get selected network and amount reactively using useStore
	const selectedNetwork = useStore(
		form.store,
		(state) => state.values.network as NetworkKey,
	);
	const selectedAmount = useStore(
		form.store,
		(state) => state.values.amount as number,
	);
	const selectedMessage = useStore(
		form.store,
		(state) => state.values.message as string,
	);
	const selectedNetworkInfo = SUPPORTED_NETWORKS[selectedNetwork];

	// Sync form changes to URL (stripSearchParams middleware handles removing defaults)
	useEffect(() => {
		navigate({
			search: {
				network: selectedNetwork,
				amount: selectedAmount,
				message: selectedMessage,
			},
			replace: true,
		});
	}, [selectedNetwork, selectedAmount, selectedMessage, navigate]);

	// Check USDC balance on selected network
	const { data: balanceData, isLoading: isBalanceLoading } = useReadContract({
		address: selectedNetworkInfo.assetAddress,
		abi: erc20Abi,
		functionName: "balanceOf",
		args: address ? [address] : undefined,
		chainId: selectedNetworkInfo.id,
		query: {
			enabled: !!address && isConnected,
		},
	});

	// Format balance for display (USDC has 6 decimals)
	const formattedBalance = balanceData
		? (Number(balanceData) / 10 ** selectedNetworkInfo.assetDecimals).toFixed(2)
		: null;

	// Check if user has sufficient balance (amount is in cents, balance is in USDC units)
	const requiredAmount = selectedAmount / 100; // Convert cents to dollars
	const hasInsufficientBalance =
		formattedBalance !== null && Number(formattedBalance) < requiredAmount;

	const resetPayment = () => {
		setStatus("idle");
		setError(null);
		setTxHash(null);
		form.reset();
	};

	// Success view
	if (status === "success") {
		return (
			<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 p-4">
				<div
					className="text-center max-w-md animate-in fade-in zoom-in duration-500"
					style={{ animationDelay: "0ms" }}
				>
					<div
						className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 animate-in zoom-in duration-300"
						style={{ animationDelay: "200ms" }}
					>
						<Check className="w-10 h-10 text-white" />
					</div>
					<h1
						className="text-3xl font-bold text-zinc-800 mb-2 animate-in fade-in slide-in-from-bottom-2 duration-300"
						style={{ animationDelay: "300ms" }}
					>
						Thank You! ☕
					</h1>
					<p
						className="text-zinc-600 mb-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
						style={{ animationDelay: "400ms" }}
					>
						Your donation of <strong>${(finalAmount / 100).toFixed(2)}</strong>{" "}
						has been sent successfully via x402!
					</p>
					{txHash && (
						<p
							className="text-zinc-500 text-sm mb-6 animate-in fade-in duration-300"
							style={{ animationDelay: "450ms" }}
						>
							<a
								href={
									finalNetwork === "mainnet"
										? `https://etherscan.io/tx/${txHash}`
										: finalNetwork === "sepolia"
											? `https://sepolia.etherscan.io/tx/${txHash}`
											: finalNetwork === "base"
												? `https://basescan.org/tx/${txHash}`
												: `https://sepolia.basescan.org/tx/${txHash}`
								}
								target="_blank"
								rel="noopener noreferrer"
								className="text-emerald-600 hover:text-emerald-500 underline"
							>
								View transaction →
							</a>
						</p>
					)}
					<div
						className="flex flex-col gap-3 animate-in fade-in duration-300"
						style={{ animationDelay: "500ms" }}
					>
						<Button onClick={resetPayment} variant="outline">
							Send another coffee
						</Button>
						{clientEnv.VITE_CREATOR_ADDRESS && !isCreatorPage && (
							<Link
								to="/donate/$recipient"
								params={{ recipient: clientEnv.VITE_CREATOR_ADDRESS }}
							>
								<Button
									variant="ghost"
									className="w-full text-emerald-600 hover:text-emerald-500 hover:bg-emerald-50"
								>
									Support the app creator ☕
								</Button>
							</Link>
						)}
					</div>
				</div>
			</div>
		);
	}

	const networkInfo = SUPPORTED_NETWORKS[form.state.values.network];

	return (
		<div className="min-h-screen flex items-center justify-center p-4 bg-[#1a1a2e] relative overflow-hidden">
			{/* Animated background */}
			<div className="absolute inset-0 overflow-hidden">
				<div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-amber-500/20 via-transparent to-transparent rounded-full blur-3xl animate-pulse" />
				<div
					className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-orange-600/20 via-transparent to-transparent rounded-full blur-3xl animate-pulse"
					style={{ animationDelay: "1s" }}
				/>
			</div>

			<div className="w-full max-w-md relative z-10">
				{/* Card */}
				<div className="bg-gradient-to-b from-zinc-900/90 to-zinc-950/95 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-amber-500/20">
					{/* Header */}
					<div className="text-center mb-8">
						<div className="relative inline-block mb-4">
							<div className="w-20 h-20 bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/30 rotate-3 hover:rotate-0 transition-transform duration-300">
								<Coffee className="w-10 h-10 text-white" />
							</div>
							<Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-amber-400 animate-pulse" />
						</div>
						<h1 className="text-2xl font-bold text-white mb-2 tracking-tight">
							Buy me a coffee
						</h1>
						<p className="text-zinc-400 text-sm">
							Support{" "}
							{ensName ? (
								<span className="text-amber-400 font-mono text-xs bg-amber-400/10 px-2 py-1 rounded">
									{ensName}
								</span>
							) : (
								<span className="text-amber-400 font-mono text-xs bg-amber-400/10 px-2 py-1 rounded">
									{recipient.slice(0, 6)}...{recipient.slice(-4)}
								</span>
							)}
						</p>
						{ensName && (
							<p className="text-zinc-500 text-xs mt-1 font-mono">
								{recipient.slice(0, 6)}...{recipient.slice(-4)}
							</p>
						)}
					</div>

					{/* Form */}
					<form
						onSubmit={(e) => {
							e.preventDefault();
							e.stopPropagation();
							form.handleSubmit();
						}}
					>
						{/* Network Field */}
						<form.AppField name="network">
							{(field) => <field.NetworkField />}
						</form.AppField>

						{/* Amount Field */}
						<form.AppField name="amount">
							{(field) => <field.AmountField />}
						</form.AppField>

						{/* Message Field */}
						<form.AppField name="message">
							{(field) => <field.MessageField id={messageInputId} />}
						</form.AppField>

						{/* Connected wallet info */}
						{isConnected && address && (
							<div className="mb-4 p-3 bg-zinc-800/30 rounded-xl border border-zinc-700/30 space-y-2">
								<div className="flex items-center justify-between text-sm">
									<span className="text-zinc-400">Connected</span>
									<span className="text-white font-mono text-xs">
										{address.slice(0, 6)}...{address.slice(-4)}
									</span>
								</div>
								<div className="flex items-center justify-between text-sm">
									<span className="text-zinc-400">
										{selectedNetworkInfo.asset} Balance
									</span>
									<span
										className={`font-mono text-xs ${hasInsufficientBalance ? "text-red-400" : "text-white"}`}
									>
										{isBalanceLoading ? (
											<Loader2 className="w-3 h-3 animate-spin inline" />
										) : formattedBalance !== null ? (
											`$${formattedBalance}`
										) : (
											"—"
										)}
									</span>
								</div>
								{hasInsufficientBalance && (
									<p className="text-red-400 text-xs">
										Insufficient balance. You need ${requiredAmount.toFixed(2)}{" "}
										{selectedNetworkInfo.asset}.
									</p>
								)}
							</div>
						)}

						{/* Error message */}
						{error && (
							<div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
								<p className="text-red-400 text-sm text-center">{error}</p>
							</div>
						)}

						{/* Submit Button */}
						<form.AppForm>
							<form.DonateButton
								isConnected={isConnected}
								status={status}
								networkName={networkInfo.name}
							/>
						</form.AppForm>
					</form>

					{/* Footer note */}
					<div className="text-center text-zinc-500 text-xs mt-6 space-y-1">
						<p>
							Powered by{" "}
							<a
								href="https://x402.org"
								target="_blank"
								rel="noopener noreferrer"
								className="text-amber-400 hover:text-amber-300 transition-colors"
							>
								x402
							</a>{" "}
							· Payments on {networkInfo.name}
						</p>
						<p>
							<Link
								to="/"
								className="text-amber-400/70 hover:text-amber-300 transition-colors"
							>
								Create your own donate page →
							</Link>
						</p>
						{clientEnv.VITE_CREATOR_ADDRESS && !isCreatorPage && (
							<p>
								<Link
									to="/donate/$recipient"
									params={{ recipient: clientEnv.VITE_CREATOR_ADDRESS }}
									className="text-amber-400/70 hover:text-amber-300 transition-colors"
								>
									Support the app creator
								</Link>
							</p>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
