import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Coffee } from "lucide-react";
import { clientEnv } from "@/env";
import { useHomeForm } from "@/hooks/home-form";

export const Route = createFileRoute("/")({
	component: HomePage,
	head: () => ({
		meta: [
			{ title: "x402 Donate - Buy Someone a Coffee with Crypto" },
			{
				name: "description",
				content:
					"Create donation links for any Ethereum address or ENS name. Fast, secure USDC payments powered by x402.",
			},
			// OpenGraph
			{
				property: "og:title",
				content: "x402 Donate - Buy Someone a Coffee with Crypto",
			},
			{
				property: "og:description",
				content:
					"Create donation links for any Ethereum address or ENS name. Fast, secure USDC payments powered by x402.",
			},
			{ property: "og:image", content: "/og-image.svg" },
			{ property: "og:url", content: "/" },
			{ property: "og:type", content: "website" },
			// Twitter
			{
				name: "twitter:title",
				content: "x402 Donate - Buy Someone a Coffee with Crypto",
			},
			{
				name: "twitter:description",
				content:
					"Create donation links for any Ethereum address or ENS name. Fast, secure USDC payments powered by x402.",
			},
			{ name: "twitter:image", content: "/og-image.svg" },
			{ name: "twitter:url", content: "/" },
		],
	}),
});

function HomePage() {
	const navigate = useNavigate();

	const form = useHomeForm({
		defaultValues: {
			recipient: "",
		},
		onSubmit: async ({ value }) => {
			if (value.recipient) {
				navigate({
					to: "/donate/$recipient",
					params: { recipient: value.recipient },
				});
			}
		},
	});

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

			<div className="w-full max-w-lg relative z-10">
				{/* Card */}
				<div className="bg-gradient-to-b from-zinc-900/90 to-zinc-950/95 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-amber-500/20">
					{/* Header */}
					<div className="text-center mb-8">
						<div className="relative inline-block mb-4">
							<div className="w-20 h-20 bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/30 rotate-3 hover:rotate-0 transition-transform duration-300">
								<Coffee className="w-10 h-10 text-white" />
							</div>
						</div>
						<h1 className="text-2xl font-bold text-white mb-2 tracking-tight">
							x402 Donate
						</h1>
						<p className="text-zinc-400 text-sm">
							Create a payment link for any Ethereum address
						</p>
					</div>

					{/* Form */}
					<form
						onSubmit={(e) => {
							e.preventDefault();
							e.stopPropagation();
							form.handleSubmit();
						}}
						className="space-y-4"
					>
						{/* Recipient Field */}
						<form.AppField name="recipient">
							{(field) => <field.RecipientField />}
						</form.AppField>

						{/* Link preview and actions */}
						<form.AppForm>
							<div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
								<form.LinkPreview />
								<form.GoToButton />
							</div>
						</form.AppForm>

						{/* Validation hint */}
						<form.AppForm>
							<form.ValidationHint />
						</form.AppForm>
					</form>

					{/* Footer */}
					<div className="text-center text-zinc-500 text-xs mt-8 space-y-2">
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
							· Payments on Base
						</p>
						{clientEnv.VITE_CREATOR_ADDRESS && (
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
