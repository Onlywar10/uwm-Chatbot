import { readFileSync } from "node:fs";

import { parse } from "csv-parse/sync";

import type { NewCall } from "@/lib/db/schema/calls";
import type { NewNeed } from "@/lib/db/schema/needs";
import type { NewReferral } from "@/lib/db/schema/referrals";
import { Canonicalizer } from "./canonicalize";
import {
	nullify,
	parseAge,
	parseBool,
	parseIntOrNull,
	parseMasterDate,
	parseReferralDate,
} from "./normalize";
import { MASTER, masterRowSchema, type RawRow, REFERRAL, referralRowSchema } from "./schemas";

export type RejectRow = { file: "calls" | "referrals"; row: number; reason: string };

export type ParsedData = {
	calls: NewCall[];
	needs: NewNeed[];
	referrals: NewReferral[];
	rejects: RejectRow[];
	canonicalizer: Canonicalizer;
};

function readCsv(path: string): RawRow[] {
	return parse(readFileSync(path), {
		columns: true,
		bom: true,
		skip_empty_lines: true,
		relax_quotes: true,
		relax_column_count: true,
	});
}

/**
 * Parses both source CSVs into normalized, deduped entities.
 * - calls: from master_file (skip rows missing CallReportNum / unparseable EnteredOn).
 * - needs: from unmet & met, one per ReportNeedNum (need-level fields are constant per need).
 * - referrals: from unmet & met, one per agency row, fully-identical rows deduped.
 * Rows whose call is absent from master are rejected (FK safety; expected to be zero).
 */
export function parseSources(callsPath: string, referralsPath: string): ParsedData {
	const canon = new Canonicalizer();
	const rejects: RejectRow[] = [];

	const callsMap = new Map<string, NewCall>();
	readCsv(callsPath).forEach((row, i) => {
		if (!masterRowSchema.safeParse(row).success) {
			rejects.push({ file: "calls", row: i + 2, reason: "missing CallReportNum/EnteredOn" });
			return;
		}
		const enteredOn = parseMasterDate(row[MASTER.enteredOn]);
		if (!enteredOn) {
			rejects.push({
				file: "calls",
				row: i + 2,
				reason: `unparseable EnteredOn: ${row[MASTER.enteredOn]}`,
			});
			return;
		}
		const age = parseAge(row[MASTER.age]);
		const language = nullify(row[MASTER.language]);
		const ethnicity = nullify(row[MASTER.ethnicity]);
		const gender = nullify(row[MASTER.gender]);
		callsMap.set(row[MASTER.callReportNum].trim(), {
			callReportNum: row[MASTER.callReportNum].trim(),
			reportVersion: nullify(row[MASTER.reportVersion]),
			callLength: parseIntOrNull(row[MASTER.callLength]),
			enteredOn,
			city: nullify(row[MASTER.city]),
			county: nullify(row[MASTER.county]),
			postalCode: nullify(row[MASTER.postalCode]),
			languageRaw: language,
			languageCanonical: canon.canonicalize("language", language),
			teleInterpretationUsed: parseBool(row[MASTER.teleInterp]),
			ethnicityRaw: ethnicity,
			ethnicityCanonical: canon.canonicalize("ethnicity", ethnicity),
			genderRaw: gender,
			genderCanonical: canon.canonicalize("gender", gender),
			ageRaw: age.raw,
			ageNumeric: age.numeric,
			healthInsurance: nullify(row[MASTER.healthInsurance]),
			hasChildren0to5: parseBool(row[MASTER.children0to5]),
			childrenUnder5Count: parseIntOrNull(row[MASTER.childrenCount]),
			seniors60PlusCount: parseIntOrNull(row[MASTER.seniors]),
		});
	});
	const callIds = new Set(callsMap.keys());

	const needsMap = new Map<string, NewNeed>();
	const referrals: NewReferral[] = [];
	const referralSeen = new Set<string>();
	readCsv(referralsPath).forEach((row, i) => {
		if (!referralRowSchema.safeParse(row).success) {
			rejects.push({ file: "referrals", row: i + 2, reason: "missing key/date field" });
			return;
		}
		const callId = row[REFERRAL.callReportNum].trim();
		const needId = row[REFERRAL.reportNeedNum].trim();
		if (!callIds.has(callId)) {
			rejects.push({
				file: "referrals",
				row: i + 2,
				reason: `orphan: call ${callId} not in master`,
			});
			return;
		}
		const dateOfCall = parseReferralDate(row[REFERRAL.dateOfCall]);
		if (!dateOfCall) {
			rejects.push({
				file: "referrals",
				row: i + 2,
				reason: `unparseable DateOfCall: ${row[REFERRAL.dateOfCall]}`,
			});
			return;
		}

		if (!needsMap.has(needId)) {
			needsMap.set(needId, {
				reportNeedNum: needId,
				callReportNum: callId,
				dateOfCall,
				taxonomyCode: nullify(row[REFERRAL.taxonomyCode]),
				taxonomyName: nullify(row[REFERRAL.taxonomyName]),
				level1Name: nullify(row[REFERRAL.level1Name]),
				level2Code: nullify(row[REFERRAL.level2Code]),
				level2Name: nullify(row[REFERRAL.level2Name]),
				level3Code: nullify(row[REFERRAL.level3Code]),
				level3Name: nullify(row[REFERRAL.level3Name]),
				level4Code: nullify(row[REFERRAL.level4Code]),
				level4Name: nullify(row[REFERRAL.level4Name]),
				level5Code: nullify(row[REFERRAL.level5Code]),
				level5Name: nullify(row[REFERRAL.level5Name]),
				airsNeedCategory: nullify(row[REFERRAL.airsNeedCategory]),
				needWasUnmet: parseBool(row[REFERRAL.needWasUnmet]) ?? false,
				reasonIfUnmet: nullify(row[REFERRAL.reasonIfUnmet]),
			});
		}

		const agency = nullify(row[REFERRAL.agencyNamePublic]);
		const resourceAgencyNum = nullify(row[REFERRAL.resourceAgencyNum]);
		const parentAgencyName = nullify(row[REFERRAL.parentAgencyName]);
		const sig = `${needId}|${resourceAgencyNum}|${agency}|${parentAgencyName}`;
		if (referralSeen.has(sig)) return;
		referralSeen.add(sig);
		referrals.push({
			reportNeedNum: needId,
			resourceAgencyNum,
			agencyNamePublic: agency,
			parentResourceNum: nullify(row[REFERRAL.parentResourceNum]),
			parentAgencyName,
		});
	});

	return {
		calls: [...callsMap.values()],
		needs: [...needsMap.values()],
		referrals,
		rejects,
		canonicalizer: canon,
	};
}
