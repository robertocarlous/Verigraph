// Test-only fixtures shaped exactly like the documented `agent feedback-list`
// wire fields (see skills/okx-ai/references/identity-reputation.md in the
// research clone). Never imported by production code — detection modules
// only ever see real API responses outside of tests.
import type { ReviewRecord } from "../../src/types.js";

function review(
  reviewerId: string,
  score: number,
  date: string,
  description = "",
  taskHash = `0xtask${reviewerId}${date.replace(/\D/g, "")}`,
): ReviewRecord {
  return { reviewerId, score, date, description, taskHash, reviewerRole: "User", reviewerName: `Agent${reviewerId}` };
}

/** Many distinct reviewers, varied scores/dates/text, no reciprocity — organic. */
export const organicReviews: ReviewRecord[] = [
  review("11", 4.5, "2026-01-05T10:00:00Z", "Delivered on time, accurate data"),
  review("22", 5.0, "2026-01-12T14:30:00Z", "Great communication throughout"),
  review("33", 3.5, "2026-01-20T09:15:00Z", "Took a bit longer than expected but fine"),
  review("44", 4.0, "2026-02-01T18:45:00Z", "Solid work, would hire again"),
  review("55", 4.8, "2026-02-14T11:00:00Z", ""),
  review("66", 4.2, "2026-03-02T20:10:00Z", "Reasonable price for the quality"),
];

export const organicReviewerOwnReviews = new Map<string, ReviewRecord[]>();
// None of the reviewers above have received a review from the target back — no reciprocity.

const TARGET_ID = "1001";
const COLLUDER_ID = "2002";

/** Two agents (1001, 2002) rapidly swapping 5.0 reviews with near-identical text — manufactured. */
export const collusiveReviews: ReviewRecord[] = [
  review(COLLUDER_ID, 5.0, "2026-04-01T09:00:00Z", "Excellent service, highly recommend!"),
  review(COLLUDER_ID, 5.0, "2026-04-01T09:20:00Z", "Excellent service, highly recommended!"),
  review(COLLUDER_ID, 5.0, "2026-04-01T09:35:00Z", "Excellent service, would recommend!"),
  review(COLLUDER_ID, 5.0, "2026-04-01T09:50:00Z", "Great excellent service, recommend it"),
  review("9", 4.0, "2026-01-15T08:00:00Z", "decent"),
];

/** The colluder's own received reviews include one FROM the target, close in time -> reciprocity. */
export const collusiveReviewerOwnReviews = new Map<string, ReviewRecord[]>([
  [
    COLLUDER_ID,
    [review(TARGET_ID, 5.0, "2026-04-01T09:10:00Z", "Fast turnaround, perfect execution!")],
  ],
]);

export { TARGET_ID, COLLUDER_ID };
