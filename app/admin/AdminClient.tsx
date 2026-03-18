"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addDistrict, purgeDistrict } from "@/lib/actions/districts";
import { getDistricts } from "@/lib/actions/admin";

type District = {
	id: string;
	name: string;
	schoolCount: number;
};

export default function AdminClient({ allDistricts }: { allDistricts: District[] }) {
	const router = useRouter();

	const [districts, setDistricts] = useState<District[]>(allDistricts);
	const [newDistrict, setNewDistrict] = useState<string>("");
	const [searchQuery, setSearchQuery] = useState<string>("");

	const [open, setOpen] = useState<boolean>(false);
	const [status, setStatus] = useState<string | null>();
	const [message, setMessage] = useState<string | null>();

	const onAddNewDistrict = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!newDistrict) {
			setStatus("Please enter a district name.");
			return;
		}

		setStatus("Adding district...");

		try {
			const district = await addDistrict({ name: newDistrict });

			if (district.ok) {
				setDistricts(await getDistricts());
				setMessage(`Added: ${district.name}`);
			} else {
				setMessage(district.error);
			}

			setNewDistrict("");
			setOpen(false);

			router.refresh();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to add District";
			setStatus(message);
		}
	};

	const onPurgeDistrict = async (id: string, name: string) => {
		const purgeResult = await purgeDistrict(id, name);
		setMessage(purgeResult.message);
		setDistricts(await getDistricts());
		router.refresh();
	};

	const onSearchDistrictName = async (query: string) => {
		setSearchQuery(query);
		if (query.length > 0) {
			const searchResults = allDistricts.filter((d) =>
				d.name.toLowerCase().includes(query.toLowerCase()),
			);
			setDistricts(searchResults);
		} else {
			setDistricts(allDistricts);
		}
	};

	const onClearSearch = () => {
		setSearchQuery("");
		setDistricts(allDistricts);
	};

	return (
		<main className="min-h-screen flex flex-col dark:bg-neutral-900 p-10 text-neutral-600 dark:text-neutral-300">
			<div className="flex flex-row justify-between items-start">
				<div>
					<h1 className="text-2xl font-semibold mb-2">Districts</h1>

					<p className="mb-6">
						Admin view that displays all scraped and embedded school districts.
					</p>
				</div>

				<div className="flex items-center gap-3">
					<a
						href="/admin/feedback"
						className="text-sm underline text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
					>
						Feedback
					</a>
					<Button variant="secondary" onClick={() => setOpen(true)}>
						Add District +
					</Button>
				</div>
			</div>

			<Dialog
				open={open}
				onOpenChange={() => {
					setOpen(!open);
					setNewDistrict("");
					setStatus(null);
				}}
			>
				<DialogContent className="dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300 border">
					<form className="flex flex-col gap-5" onSubmit={onAddNewDistrict}>
						<DialogHeader>
							<DialogTitle className="text-2xl">Add District</DialogTitle>
							<DialogDescription>
								Add a new school district. When created click on the district to add more schools.
							</DialogDescription>
						</DialogHeader>

						<Input
							type="text"
							placeholder="Enter school district name..."
							value={newDistrict}
							onChange={(event) => setNewDistrict(event.target.value)}
						/>

						{status && <p>{status}</p>}

						<DialogFooter>
							<Button variant="secondary" type="submit">
								Add District
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{message && <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">{message}</p>}

			<div className="flex flex-col items-center">
				<div className="w-xl flex flex-row gap-4 mb-4">
					<Input
						value={searchQuery}
						onChange={(event) => onSearchDistrictName(event.target.value)}
						placeholder="Search for district..."
					/>

					<Button variant="destructive" onClick={onClearSearch}>
						Clear
					</Button>
				</div>

				<table className="text-sm w-xl">
					<thead className="text-left">
						<tr>
							<th className="py-2 pr-4">District Name</th>
							<th className="py-2 pr-4">Schools</th>
						</tr>
					</thead>
					<tbody className="text-neutral-800 dark:text-neutral-200">
						{districts.map((district) => (
							<tr key={district.id} className="border-t border-neutral-200 dark:border-neutral-800">
								<td className="py-2 pr-4">
									<a className="underline" href={`/admin/${district.id}`}>
										{district.name}
									</a>
								</td>
								<td className="py-2 pr-4">{district.schoolCount}</td>
								<td>
									<button
										type="button"
										className="underline"
										onClick={() => onPurgeDistrict(district.id, district.name)}
									>
										Remove
									</button>
								</td>
							</tr>
						))}

						{districts.length === 0 && (
							<tr>
								<td colSpan={4} className="py-3 text-neutral-500 dark:text-neutral-400">
									No districts added yet.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</main>
	);
}
