/**
 * Links into the GitHub issue forms in .github/ISSUE_TEMPLATE/. GitHub prefills
 * a form field from a query parameter named after the field's `id`, so the ids
 * and dropdown options here must match the YAML (backend/test/issueForms.test.ts
 * checks that they do).
 */

export const GITHUB_REPO = 'AaryanPuri/OpenSrc';
export const NEW_ISSUE_URL = `https://github.com/${GITHUB_REPO}/issues/new`;

export const SUBMIT_TEMPLATE = 'submit-repo.yml';
export const FLAG_TEMPLATE = 'flag-repo.yml';

/** Field ids the site prefills. */
export const SUBMIT_FIELDS = { repo: 'repo' } as const;
export const FLAG_FIELDS = { repo: 'repo', reason: 'reason', details: 'details' } as const;

/** The flag form's reason dropdown, in order. */
export const FLAG_REASONS = [
  'Archived or inactive',
  'Not welcoming or unresponsive',
  'Wrong field or language',
  'Not beginner-friendly',
  'Spam or not open source',
  'Other',
] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

const url = (params: Record<string, string>) => `${NEW_ISSUE_URL}?${new URLSearchParams(params).toString()}`;

/** A prefilled "Submit a repo" issue. */
export function submitIssueUrl(fullName: string): string {
  return url({ template: SUBMIT_TEMPLATE, [SUBMIT_FIELDS.repo]: fullName, title: `Submit: ${fullName}` });
}

/**
 * A prefilled "Flag a repo" issue. The reason also goes into the title, since
 * not every GitHub client prefills dropdowns.
 */
export function flagIssueUrl(fullName: string, reason?: FlagReason): string {
  const params: Record<string, string> = {
    template: FLAG_TEMPLATE,
    [FLAG_FIELDS.repo]: fullName,
    title: reason ? `Flag: ${fullName} (${reason.toLowerCase()})` : `Flag: ${fullName}`,
  };
  if (reason) params[FLAG_FIELDS.reason] = reason;
  return url(params);
}
