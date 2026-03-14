export const AGE_GROUPS = ["U11", "U13", "U15", "U19"] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];
