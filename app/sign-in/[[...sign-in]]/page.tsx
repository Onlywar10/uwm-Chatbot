import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
	return (
		<main className="flex min-h-screen items-center justify-center bg-background px-4">
			<SignIn
				// Every successful sign-in lands on the analytics dashboard,
				// unconditionally — this overrides any ?redirect_url deep-link.
				forceRedirectUrl="/admin/analytics"
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
