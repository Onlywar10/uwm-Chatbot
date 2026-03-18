"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { login } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError("");
		setLoading(true);

		const result = await login({ email, password });

		if (result.error) {
			setError(result.error);
			setLoading(false);
			return;
		}

		router.push("/");
	}

	return (
		<main className="flex min-h-screen items-center justify-center bg-background px-4">
			<div className="w-full max-w-sm space-y-6 rounded-lg border border-border p-6">
				<h1 className="text-center text-2xl font-semibold text-foreground">
					Sign in
				</h1>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-1.5">
						<label htmlFor="email" className="text-sm text-muted-foreground">
							Email
						</label>
						<Input
							id="email"
							type="email"
							required
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							disabled={loading}
						/>
					</div>

					<div className="space-y-1.5">
						<label
							htmlFor="password"
							className="text-sm text-muted-foreground"
						>
							Password
						</label>
						<Input
							id="password"
							type="password"
							required
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							disabled={loading}
						/>
					</div>

					{error && (
						<p className="text-sm text-destructive">{error}</p>
					)}

					<Button type="submit" className="w-full" disabled={loading}>
						{loading ? "Signing in..." : "Sign in"}
					</Button>
				</form>
			</div>
		</main>
	);
}
