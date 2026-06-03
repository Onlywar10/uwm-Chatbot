import { SignOutButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
	return (
		<SignOutButton signOutOptions={{ redirectUrl: "/sign-in" }}>
			<Button variant="ghost" size="sm" className="text-white hover:text-white/80">
				Log out
			</Button>
		</SignOutButton>
	);
}
