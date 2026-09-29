/**
 * The GitHub issue forms in .github/ISSUE_TEMPLATE/ are valid issue-form YAML,
 * and the ids the site prefills (shared/issueForms.ts) exist in them.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  FLAG_FIELDS,
  FLAG_REASONS,
  FLAG_TEMPLATE,
  flagIssueUrl,
  SUBMIT_FIELDS,
  SUBMIT_TEMPLATE,
  submitIssueUrl,
} from "../../shared/issueForms.js";
import { repoRoot } from "../src/static.js";

const DIR = path.join(repoRoot(), ".github", "ISSUE_TEMPLATE");
const load = (file: string) => parse(readFileSync(path.join(DIR, file), "utf8")) as Record<string, unknown>;

interface Element {
  type: string;
  id?: string;
  attributes: { label?: string; value?: string; options?: unknown[] };
  validations?: { required?: boolean };
}

const TYPES = new Set(["markdown", "input", "textarea", "dropdown", "checkboxes"]);

describe("issue forms", () => {
  const forms = readdirSync(DIR).filter((f) => f.endsWith(".yml") && f !== "config.yml");

  it("has the expected forms", () => {
    expect(forms.sort()).toEqual(["bug_report.yml", "feature_request.yml", "flag-repo.yml", "submit-repo.yml"]);
  });

  it.each(forms)("%s is a valid issue form", (file) => {
    const form = load(file);
    expect(typeof form.name, file).toBe("string");
    expect(typeof form.description, file).toBe("string");
    expect(Array.isArray(form.body), file).toBe(true);
    const body = form.body as Element[];
    const ids = new Set<string>();
    expect(
      body.some((e) => e.type !== "markdown"),
      file,
    ).toBe(true);
    for (const e of body) {
      expect(TYPES.has(e.type), `${file}: ${e.type}`).toBe(true);
      expect(e.attributes, file).toBeTypeOf("object");
      if (e.type === "markdown") {
        expect(typeof e.attributes.value, file).toBe("string");
        continue;
      }
      expect(typeof e.attributes.label, file).toBe("string");
      if (e.id !== undefined) {
        expect(e.id, file).toMatch(/^[a-zA-Z0-9_-]+$/);
        expect(ids.has(e.id), `${file}: duplicate id ${e.id}`).toBe(false);
        ids.add(e.id);
      }
      if (e.type === "dropdown" || e.type === "checkboxes") {
        expect(Array.isArray(e.attributes.options) && e.attributes.options.length > 0, file).toBe(true);
      }
    }
  });

  it("the submit form has the fields the site prefills", () => {
    const form = load(SUBMIT_TEMPLATE);
    expect(form.labels).toEqual(["submission"]);
    const body = form.body as Element[];
    const repo = body.find((e) => e.id === SUBMIT_FIELDS.repo);
    expect(repo?.type).toBe("input");
    expect(repo?.validations?.required).toBe(true);
    expect(body.map((e) => e.id).filter(Boolean)).toEqual(["repo", "why", "fields", "relation", "rules"]);
    const url = new URL(submitIssueUrl("sharkdp/bat"));
    expect(url.searchParams.get("template")).toBe(SUBMIT_TEMPLATE);
    expect(url.searchParams.get("repo")).toBe("sharkdp/bat");
    expect(url.searchParams.get("title")).toBe("Submit: sharkdp/bat");
  });

  it("the flag form's reasons match the site's", () => {
    const form = load(FLAG_TEMPLATE);
    expect(form.labels).toEqual(["flag"]);
    const body = form.body as Element[];
    expect(body.find((e) => e.id === FLAG_FIELDS.repo)?.validations?.required).toBe(true);
    expect(body.find((e) => e.id === FLAG_FIELDS.details)?.type).toBe("textarea");
    const reason = body.find((e) => e.id === FLAG_FIELDS.reason);
    expect(reason?.type).toBe("dropdown");
    expect(reason?.attributes.options).toEqual([...FLAG_REASONS]);
    const url = new URL(flagIssueUrl("a/b", "Not beginner-friendly"));
    expect(url.searchParams.get("template")).toBe(FLAG_TEMPLATE);
    expect(url.searchParams.get("repo")).toBe("a/b");
    expect(url.searchParams.get("reason")).toBe("Not beginner-friendly");
  });

  it("config.yml links the contact email", () => {
    const config = load("config.yml") as { blank_issues_enabled: boolean; contact_links: { url: string }[] };
    expect(config.blank_issues_enabled).toBe(true);
    expect(config.contact_links.map((l) => l.url)).toContain("mailto:hello@opensrc.studio");
  });
});
