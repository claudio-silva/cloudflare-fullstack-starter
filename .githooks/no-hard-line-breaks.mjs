#!/usr/bin/env node
// no-hard-line-breaks: joins hard-wrapped prose in Markdown files, so each paragraph or list item is one line.
//
// Usage:
//   node no-hard-line-breaks.mjs [--check] <file.md>...   reformat whole files in place (--check: only list them, exit 1 if any)
//   node no-hard-line-breaks.mjs [--check] --all          every tracked Markdown file of the current git repository
//   node no-hard-line-breaks.mjs --hook                   pre-commit mode: unwrap only the paragraphs the commit changes, in the
//                                                         index (and in the working tree when it has no other unstaged changes)
//
// Only line breaks inside a paragraph are removed. Everything else keeps its lines: headings, lists (each item is joined on
// its own), tables, fenced and indented code, front matter, HTML blocks, math blocks, link definitions, hard breaks (two
// trailing spaces, a backslash or <br>), labelled fields ("Status: done" / "Owner: me", two or more in a block), and any line
// holding an HTML comment (comments are often markers that tools match line by line).
//
// Opt a path out with a git attribute, in .gitattributes:   docs/legal/** -md-unwrap
// Skipped always: .mdx files, LICENSE/COPYING/NOTICE/AUTHORS, and anything under node_modules, vendor or third_party.

import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------------------------------------------- engine

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const MATH_FENCE = /^ {0,3}\$\$\s*$/;
const ATX = /^ {0,3}#{1,6}(\s|$)/;
const THEMATIC = /^ {0,3}((\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const HTML_START = /^ {0,3}<(?![a-zA-Z][a-zA-Z0-9+.-]*:|[^\s@>]+@)[!?/a-zA-Z]/; // a tag, not an autolink
const HTML_RAW = /^ {0,3}<(pre|script|style|textarea)(\s|>|$)/i;
const HTML_BLOCK_TAG =
  /^ {0,3}<\/?(address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(\s|\/?>|$)/i;
const LINK_DEF = /^ {0,3}\[[^\]]+\]:/;
const OTHER_BLOCK = /^[ \t]*(:::|\{%|\{\{|:[ \t])/; // containers, template tags, definition lists
const COMMENT = /<!--|-->/;
// A labelled field ("Status: done", "**Owner:** x"): a capitalised key of up to three words, or a bold one, then a colon.
// Where a block of lines holds two or more, they are structure ("Observed: ... / Evidence: ...") and keep their lines.
const LABEL = /^[ \t]*(?:(?:\*\*|__)[^*_]{1,40}?(?::(?:\*\*|__)|(?:\*\*|__):)|\p{Lu}[\p{L}\p{N}_/()'-]*(?: [\p{L}\p{N}_/()'-]+){0,2}:)(?:[ \t]|$)/u;
const HARD_BREAK = /( {2,}|\\|<br\s*\/?>)$/i;

function indentWidth(s) {
  let w = 0;
  for (const ch of s) {
    if (ch === " ") w++;
    else if (ch === "\t") w += 4 - (w % 4);
    else break;
  }
  return w;
}

function splitQuote(line) {
  const m = line.match(/^((?: {0,3}>[ \t]?)+)/);
  if (!m) return { depth: 0, prefix: "", inner: line };
  return { depth: (m[1].match(/>/g) || []).length, prefix: m[1], inner: line.slice(m[1].length) };
}

function isDelimiterRow(s) {
  if (!s.includes("|") || !s.includes("-")) return false;
  let t = s.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").every((cell) => /^\s*:?-+:?\s*$/.test(cell));
}

const isBlank = (s) => /^[ \t]*$/.test(s);

/** Removes up to `n` columns of leading whitespace (block syntax inside a list item is relative to its content column). */
function dedent(s, n) {
  let w = 0;
  let k = 0;
  while (k < s.length && w < n && (s[k] === " " || s[k] === "\t")) {
    w += s[k] === "\t" ? 4 - (w % 4) : 1;
    k++;
  }
  return " ".repeat(Math.max(0, w - n)) + s.slice(k);
}

/**
 * Classifies each line: "raw" (never touched), "blank", "start" (first line of a paragraph or list item), or "cont"
 * (a paragraph continuation that may be joined to the line before it).
 */
function classify(lines) {
  const kinds = new Array(lines.length).fill("raw");
  const parts = lines.map(splitQuote);

  // Labelled fields: label lines in a block of non-blank lines that holds two or more of them.
  const field = new Set();
  for (let i = 0; i < lines.length; ) {
    if (isBlank(parts[i].inner)) {
      i++;
      continue;
    }
    let j = i;
    const labels = [];
    for (; j < lines.length && !isBlank(parts[j].inner); j++) if (LABEL.test(parts[j].inner.replace(LIST, ""))) labels.push(j);
    if (labels.length >= 2) for (const k of labels) field.add(k);
    i = j;
  }

  // Tables: the header row, the delimiter row and every row up to a blank line.
  const table = new Set();
  for (let i = 1; i < lines.length; i++) {
    const { inner } = parts[i];
    if (!isDelimiterRow(inner) || isBlank(parts[i - 1].inner) || !parts[i - 1].inner.includes("|")) continue;
    table.add(i - 1);
    for (let j = i; j < lines.length && !isBlank(parts[j].inner); j++) table.add(j);
  }

  let i = 0;
  // Front matter (YAML or TOML) at the very top.
  if (/^(---|\+\+\+)\s*$/.test(lines[0] ?? "")) {
    const close = lines[0].trim() === "+++" ? /^\+\+\+\s*$/ : /^(---|\.\.\.)\s*$/;
    let j = 1;
    while (j < lines.length && !close.test(lines[j])) j++;
    if (j < lines.length) i = j + 1;
  }

  let depth = 0;
  let fence = null; // { char, len, base }
  let math = false;
  let comment = false;
  let html = null; // "blank" (ends at a blank line) or a closing tag regexp
  let codeBase = -1; // indented code: base column, or -1
  let inPara = false;
  let listStack = []; // content columns of open list items
  let prevBlank = true;

  for (; i < lines.length; i++) {
    const { depth: d, inner } = parts[i];
    if (d !== depth) {
      depth = d;
      fence = null;
      math = false;
      html = null;
      codeBase = -1;
      inPara = false;
      listStack = [];
      prevBlank = true;
    }

    if (fence && !isBlank(inner) && indentWidth(inner) < fence.base) fence = null; // its list item ended
    if (fence) {
      const m = dedent(inner, fence.base).match(FENCE);
      if (m && m[1][0] === fence.char && m[1].length >= fence.len && m[2].trim() === "") fence = null;
      continue;
    }
    if (math) {
      if (MATH_FENCE.test(inner)) math = false;
      continue;
    }
    if (comment) {
      if (inner.includes("-->")) comment = false;
      continue;
    }
    if (html) {
      if (html === "blank") {
        if (isBlank(inner)) {
          html = null;
          kinds[i] = "blank";
          prevBlank = true;
        }
      } else if (html.test(inner)) html = null;
      continue;
    }
    if (isBlank(inner)) {
      kinds[i] = "blank";
      inPara = false;
      prevBlank = true;
      continue;
    }

    const indent = indentWidth(inner);
    if (codeBase >= 0 && indent >= codeBase + 4) continue;
    codeBase = -1;

    const listMatch = inner.match(LIST);
    if (prevBlank || listMatch) {
      const limit = listMatch ? indentWidth(listMatch[1]) : indent;
      while (listStack.length && listStack[listStack.length - 1] > limit) listStack.pop();
    }
    const base = listStack.length ? listStack[listStack.length - 1] : 0;
    const wasPrevBlank = prevBlank;
    prevBlank = false;
    const rel = dedent(inner, base);

    if (!inPara && indent >= base + 4) {
      codeBase = base;
      continue;
    }
    if (table.has(i)) {
      inPara = false;
      continue;
    }

    const fm = rel.match(FENCE);
    if (fm && !(fm[1][0] === "`" && fm[2].includes("`"))) {
      fence = { char: fm[1][0], len: fm[1].length, base };
      inPara = false;
      continue;
    }
    if (MATH_FENCE.test(rel)) {
      math = true;
      inPara = false;
      continue;
    }
    if (COMMENT.test(inner)) {
      const open = inner.lastIndexOf("<!--");
      if (open >= 0 && !inner.slice(open).includes("-->")) comment = true;
      inPara = false;
      continue;
    }
    if (HTML_START.test(rel) && (!inPara || HTML_BLOCK_TAG.test(rel) || HTML_RAW.test(rel))) {
      const raw = rel.match(HTML_RAW);
      if (raw) {
        const close = new RegExp(`</${raw[1]}>`, "i");
        if (!close.test(inner)) html = close;
      } else html = "blank";
      inPara = false;
      continue;
    }
    if (ATX.test(rel) || THEMATIC.test(rel) || SETEXT.test(rel) || LINK_DEF.test(rel) || OTHER_BLOCK.test(rel)) {
      inPara = false;
      continue;
    }
    if (listMatch) {
      const markerEnd = listMatch[0].length;
      const spaces = indentWidth(listMatch[1] + listMatch[2] + listMatch[3]) - indentWidth(listMatch[1] + listMatch[2]);
      const col = indentWidth(listMatch[1]) + listMatch[2].length + (spaces >= 1 && spaces <= 4 ? spaces : 1);
      listStack.push(col);
      kinds[i] = "start";
      inPara = isBlank(inner.slice(markerEnd)) ? false : true;
      continue;
    }
    kinds[i] = inPara && !wasPrevBlank && !field.has(i) ? "cont" : "start";
    inPara = true;
  }
  return { kinds, parts };
}

/**
 * Joins hard-wrapped paragraphs. With `touched` (a Set of 1-based line numbers), only paragraphs holding a touched line
 * are joined. Returns the new text.
 */
export function unwrap(text, touched = null) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const endsWithEol = text.endsWith(eol);
  const lines = (endsWithEol ? text.slice(0, -eol.length) : text).split(eol);
  const { kinds, parts } = classify(lines);

  // Group each paragraph line with the continuations that can be joined to it.
  const groups = [];
  for (let i = 0; i < lines.length; i++) {
    const prev = groups[groups.length - 1];
    const joinable =
      kinds[i] === "cont" &&
      prev &&
      prev.end === i - 1 &&
      parts[i].depth === parts[prev.end].depth &&
      !HARD_BREAK.test(lines[i - 1]) &&
      (kinds[i - 1] === "start" || kinds[i - 1] === "cont");
    if (joinable) prev.end = i;
    else groups.push({ start: i, end: i });
  }

  const out = [];
  for (const g of groups) {
    let hit = !touched;
    for (let i = g.start; !hit && i <= g.end; i++) hit = touched.has(i + 1);
    if (!hit || g.start === g.end) {
      for (let i = g.start; i <= g.end; i++) out.push(lines[i]);
      continue;
    }
    let line = lines[g.start].replace(/[ \t]+$/, "");
    for (let i = g.start + 1; i <= g.end; i++) line += " " + parts[i].inner.trim();
    out.push(line);
  }
  return out.join(eol) + (endsWithEol ? eol : "");
}

// --------------------------------------------------------------------------------------------------------------- git glue

const git = (args, opts = {}) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });

const SKIP_NAME = /(^|\/)(LICEN[CS]E|COPYING|NOTICE|AUTHORS)(\.[^/]*)?$/i;
const SKIP_DIR = /(^|\/)(node_modules|vendor|third_party|\.git)\//;
const isMarkdown = (p) => /\.(md|markdown)$/i.test(p) && !SKIP_NAME.test(p) && !SKIP_DIR.test(p);

function optedOut(paths) {
  if (!paths.length) return new Set();
  const out = git(["check-attr", "-z", "md-unwrap", "--", ...paths]).split("\0");
  const skip = new Set();
  for (let k = 0; k + 2 < out.length; k += 3) if (out[k + 2] === "unset" || out[k + 2] === "false") skip.add(out[k]);
  return skip;
}

function sameWords(a, b) {
  // Joined blockquote lines lose their own ">" prefixes, so prefixes are left out of the comparison.
  const words = (s) => s.split(/\r?\n/).map((l) => splitQuote(l).inner).join(" ").split(/\s+/).filter(Boolean).join(" ");
  return words(a) === words(b);
}

function touchedLines(path) {
  const diff = git(["diff", "--cached", "-U0", "--no-color", "--no-ext-diff", "--", path]);
  const touched = new Set();
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (count === 0) {
      touched.add(start);
      touched.add(start + 1);
    } else for (let n = start; n < start + count; n++) touched.add(n);
  }
  return touched;
}

function runHook() {
  const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]).split("\0").filter(isMarkdown);
  const skip = optedOut(staged);
  for (const path of staged) {
    if (skip.has(path)) continue;
    const entry = git(["ls-files", "--stage", "-z", "--", path]).split("\0")[0];
    const mode = entry.split(" ")[0];
    if (mode === "120000" || mode === "160000") continue; // symlink or submodule
    const before = git(["show", `:${path}`]);
    const touched = touchedLines(path);
    if (!touched.size) continue;
    const after = unwrap(before, touched);
    if (after === before) continue;
    if (!sameWords(before, after)) {
      process.stderr.write(`no-hard-line-breaks: skipped ${path} (internal check failed: the words changed)\n`);
      continue;
    }
    const sha = git(["hash-object", "-w", "--stdin", "--path", path], { input: after }).trim();
    git(["update-index", "--cacheinfo", `${mode},${sha},${path}`]);
    let note = "";
    if (existsSync(path) && readFileSync(path, "utf8") === before) writeFileSync(path, after);
    else note = " (in the commit only: the working tree has other changes to this file, so it still has the wrapped lines)";
    process.stderr.write(`no-hard-line-breaks: joined hard-wrapped lines in ${path}${note}\n`);
  }
}

function runFiles(paths, check) {
  const changed = [];
  for (const path of paths) {
    const before = readFileSync(path, "utf8");
    const after = unwrap(before);
    if (after === before) continue;
    if (!sameWords(before, after)) {
      process.stderr.write(`no-hard-line-breaks: skipped ${path} (internal check failed: the words changed)\n`);
      continue;
    }
    changed.push(path);
    if (!check) writeFileSync(path, after);
  }
  for (const p of changed) console.log(check ? `would reformat ${p}` : `reformatted ${p}`);
  return changed;
}

let isMain = false;
try {
  isMain = import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
} catch {
  /* imported, or no script path */
}
if (isMain) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  try {
    if (args.includes("--hook")) runHook();
    else {
      let files = args.filter((a) => !a.startsWith("--"));
      if (args.includes("--all")) {
        // Regular files only: a symlink's target is reformatted under its own name.
        const tracked = git(["ls-files", "--stage", "-z"])
          .split("\0")
          .filter((e) => e.startsWith("100"))
          .map((e) => e.slice(e.indexOf("\t") + 1))
          .filter(isMarkdown)
          .filter((p) => existsSync(p));
        const skip = optedOut(tracked);
        files = tracked.filter((p) => !skip.has(p));
      }
      if (!files.length) {
        console.error("usage: no-hard-line-breaks [--check] (--all | <file.md>...)   |   no-hard-line-breaks --hook");
        process.exit(2);
      }
      const changed = runFiles(files, check);
      if (check && changed.length) process.exit(1);
    }
  } catch (err) {
    // A failing formatter must never block a commit.
    process.stderr.write(`no-hard-line-breaks: ${err.message}\n`);
    if (!args.includes("--hook")) process.exit(2);
  }
}
