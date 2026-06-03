import { z } from "zod";

/**
 * Exact source-CSV column names, centralized so the long header strings live
 * in one place. `MASTER` = master_file (calls); `REFERRAL` = unmet & met
 * (needs + referrals).
 */
export const MASTER = {
	callReportNum: "CallReportNum",
	reportVersion: "ReportVersion",
	callLength: "CallLength",
	city: "CityName",
	county: "CountyName",
	postalCode: "PostalCode",
	enteredOn: "EnteredOn",
	language: "Call Information - Language of Call",
	teleInterp: "Call Information - Tele-interpretation used",
	ethnicity: "Demographics - Caller Ethnicity up to date",
	gender: "Demographics - Caller Gender up to date",
	age: "Demographics - Callers Age",
	healthInsurance: "Demographics - Health Insurance",
	children0to5: "Person In Need Issues - Are there any children 0-5 years old in the household?",
	childrenCount:
		"Person in Need Issues - Children 5 or under - Total # of children that are 5 years or younger",
	seniors: "Person In Need Issues - Number of Seniors (ages 60+) in the Household:",
} as const;

export const REFERRAL = {
	dateOfCall: "DateOfCall",
	callReportNum: "CallReportNum",
	resourceAgencyNum: "ResourceAgencyNum",
	agencyNamePublic: "AgencyNamePublic",
	taxonomyCode: "TaxonomyCode",
	taxonomyName: "TaxonomyName",
	needWasUnmet: "NeedWasUnmet",
	reasonIfUnmet: "ReasonIfUnmetOrPartial",
	level1Name: "Level1Name",
	level2Code: "Level2Code",
	level2Name: "Level2Name",
	level3Code: "Level3Code",
	level3Name: "Level3Name",
	level4Code: "Level4Code",
	level4Name: "Level4Name",
	level5Code: "Level5Code",
	level5Name: "Level5Name",
	airsNeedCategory: "AIRSNeedCategory",
	reportNeedNum: "ReportNeedNum",
	parentResourceNum: "ParentResourceNum",
	parentAgencyName: "ParentAgencyName",
} as const;

export type RawRow = Record<string, string>;

/** Required-key validation; a row failing this is skipped to the reject report. */
export const masterRowSchema = z.object({
	CallReportNum: z.string().trim().min(1),
	EnteredOn: z.string().trim().min(1),
});

export const referralRowSchema = z.object({
	CallReportNum: z.string().trim().min(1),
	ReportNeedNum: z.string().trim().min(1),
	DateOfCall: z.string().trim().min(1),
	NeedWasUnmet: z.string().trim().min(1),
});
