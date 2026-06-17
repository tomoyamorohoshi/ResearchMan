import casesData from "../../data/cases.json";

export type Case = {
  id: string;
  title: string;
  summary: string;
  client: string;
  agency: string;
  categories: string[];
  award: string;
  year: string;
  regions: string[];
  link: string;
  thumbnail: string;
  overview: string;
  mechanism: string;
  impact: string;
  evaluation: string;
};

export const cases: Case[] = casesData as Case[];

export const allCategories = Array.from(
  new Set(cases.flatMap((c) => c.categories))
).sort();

export const allYears = Array.from(new Set(cases.map((c) => c.year))).sort(
  (a, b) => Number(b) - Number(a)
);

export const allRegions = Array.from(
  new Set(cases.flatMap((c) => c.regions))
).sort();

export function getCaseById(id: string): Case | undefined {
  return cases.find((c) => c.id === id);
}
