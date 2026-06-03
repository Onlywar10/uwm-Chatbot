import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
	return (
		<main className="flex min-h-screen items-center justify-center bg-background px-4">
			<SignIn
				// Land on the analytics dashboard by default after sign-in. Used as a
				// fallback so deep-links to a protected page (?redirect_url=...) still
				// return the user to where they were headed.
				fallbackRedirectUrl="/admin/analytics"
				appearance={{
					elements: {
						card: "shadow-none border border-border",
						rootBox: "w-full max-w-sm",
					},
				}}
			/>
		</main>
	);
}
