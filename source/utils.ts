import * as core from "@actions/core";
import { GitHub } from "@actions/github/lib/utils.js";
import { GetResponseDataTypeFromEndpointMethod } from "@octokit/types";
import { CommitMeta, CommitNote, CommitReference } from "conventional-commits-parser";
import { CommitsSinceRelease } from "./AutomaticReleases.js";

export const getShortSHA = (sha: string): string => {
  const coreAbbrev = 7;
  return sha.substring(0, coreAbbrev);
};

export type CompareComittsItem = GetResponseDataTypeFromEndpointMethod<
  InstanceType<typeof GitHub>["rest"]["repos"]["compareCommits"]
>["commits"][number];
export type ParsedCommitsExtraCommit = CompareComittsItem & {
  author: {
    email: string;
    name: string;
    username: string;
  } | null;
  committer: {
    email: string;
    name: string;
    username: string;
  };
  distinct: boolean;
  id: string;
  message: string;
  timestamp: string;
  tree_id: string;
  url: string;
};

export interface ParsedCommitsExtra {
  commit: CommitsSinceRelease[number];
  pullRequests: Array<{
    number: number;
    url: string;
  }>;
  breakingChange: boolean;
}

export enum ConventionalCommitTypes {
  feat = "Features",
  fix = "Bug Fixes",
  docs = "Documentation",
  style = "Styles",
  refactor = "Code Refactoring",
  perf = "Performance Improvements",
  test = "Tests",
  build = "Builds",
  ci = "Continuous Integration",
  chore = "Chores",
  revert = "Reverts",
}

export interface ParsedCommits {
  type: ConventionalCommitTypes;
  scope: string;
  subject: string;
  merge: string;
  header: string;
  body: string;
  footer: string;
  notes: Array<CommitNote>;
  extra: ParsedCommitsExtra;
  references: Array<CommitReference>;
  mentions: Array<string>;
  revert: CommitMeta | null;
}

const getFormattedChangelogEntry = (parsedCommit: ParsedCommits): string => {
  let entry = "";

  const url = parsedCommit.extra.commit.html_url;
  const sha = getShortSHA(parsedCommit.extra.commit.sha);
  const author = parsedCommit.extra.commit.commit.author?.name ?? "<unknown author>";

  let prString = "";
  prString = parsedCommit.extra.pullRequests.reduce((acc, pr) => {
    // e.g. #1
    // e.g. #1,#2
    // e.g. ''
    if (acc) {
      acc += ",";
    }
    return `${acc}[#${pr.number.toString()}](${pr.url})`;
  }, "");
  if (prString) {
    prString = " " + prString;
  }

  entry = `- ${sha}: ${parsedCommit.header} (${author})${prString}`;

  const scopeStr = parsedCommit.scope ? `**${parsedCommit.scope}**: ` : "";
  entry = `- ${scopeStr}${parsedCommit.subject}${prString} ([${author}](${url}))`;

  return entry;
};

export const generateChangelogFromParsedCommits = (parsedCommits: Array<ParsedCommits>): string => {
  let changelog = "";

  // Breaking Changes
  const breaking = parsedCommits
    .filter(val => val.extra.breakingChange)
    .map(val => getFormattedChangelogEntry(val))
    .reduce((acc, line) => `${acc}\n${line}`, "");
  if (breaking) {
    changelog += "## Breaking Changes\n";
    changelog += breaking.trim();
  }

  for (const key of Object.keys(ConventionalCommitTypes) as Array<
    keyof typeof ConventionalCommitTypes
  >) {
    const clBlock = parsedCommits
      .filter(val => val.type === (key as ConventionalCommitTypes))
      .map(val => getFormattedChangelogEntry(val))
      .reduce((acc, line) => `${acc}\n${line}`, "");
    if (clBlock) {
      changelog += `\n\n## ${ConventionalCommitTypes[key]}\n`;
      changelog += clBlock.trim();
    }
  }

  // Commits
  const commits = parsedCommits
    .filter(val => !Object.keys(ConventionalCommitTypes).includes(val.type))
    .map(val => getFormattedChangelogEntry(val))
    .reduce((acc, line) => `${acc}\n${line}`, "");
  if (commits) {
    changelog += "\n\n## Commits\n";
    changelog += commits.trim();
  }

  return changelog.trim();
};

export const isBreakingChange = ({ body, footer }: { body: string; footer: string }): boolean => {
  const re = /^BREAKING\s+CHANGES?:\s+/;
  return re.test(body || "") || re.test(footer || "");
};

export const parseGitTag = (inputRef: string): string => {
  const re = /^(refs\/)?tags\/(.*)$/;
  const resMatch = inputRef.match(re);
  if (!resMatch?.[2]) {
    core.debug(`Input "${inputRef}" does not appear to be a tag`);
    return "";
  }
  return resMatch[2];
};

export const getChangelogOptions = () => {
  const defaultOpts = {
    headerPattern: /^(\w*)(?:\((.*)\))?: (.*)$/,
    headerCorrespondence: ["type", "scope", "subject"],
    noteKeywords: ["BREAKING CHANGE"],
    mergePattern: /^Merge pull request #(.*) from (.*)$/,
    mergeCorrespondence: ["issueId", "source"],
    revertPattern: /^(?:Revert|revert:)\s"?([\s\S]+?)"?\s*This reverts commit (\w{7,40})\b/i,
    revertCorrespondence: ["header", "hash"],
  };
  core.debug(`Changelog options: ${JSON.stringify(defaultOpts)}`);
  return defaultOpts;
};

// istanbul ignore next
export const octokitLogger = (
  ...args: Array<string | Record<string, unknown> | undefined>
): string => {
  return args
    .filter(arg => arg !== undefined)
    .map(arg => {
      if (typeof arg === "string") {
        return arg;
      }

      const argCopy = { ...arg };

      // Do not log file buffers
      if (argCopy.file) {
        argCopy.file = "== raw file buffer info removed ==";
      }
      if (argCopy.data) {
        argCopy.data = "== raw file buffer info removed ==";
      }

      return JSON.stringify(argCopy);
    })
    .reduce((acc, val) => `${acc} ${val}`, "");
};
