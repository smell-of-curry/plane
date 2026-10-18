/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return entity;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body] ?? entity;
  });
}

/**
 * TipTap HTML → readable plain text. Block tags become newlines.
 * Custom atoms (mention, image, work item) have no text content, so they get a short placeholder.
 * ponytail: regex, not a DOM parser — mentions stay `@mention` (display name lives outside the HTML).
 */
export function htmlToPlainText(html: string): string {
  const prepared = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<input\b[^>]*>/gi, (tag) => {
      if (!/\btype\s*=\s*["']checkbox["']/i.test(tag)) return "";
      return /\bchecked\b/i.test(tag) ? "[x] " : "[ ] ";
    })
    .replace(/<mention-component\b[^>]*\/?>/gi, "@mention ")
    .replace(/<image-component\b[^>]*\/?>/gi, "[image]\n")
    .replace(/<issue-embed-component\b[^>]*\/?>/gi, "[work item]\n")
    .replace(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*>/gi, "$1 ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(li|tr)>/gi, "\n")
    .replace(/<\/(h[1-6]|p|div|blockquote|pre|ul|ol|table|section)>/gi, "\n\n");

  return decodeEntities(prepared.replace(/<[^>]+>/g, ""))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function assertHtmlToPlainText(): void {
  const cases: [string, string][] = [
    ["<p>Hello <strong>world</strong></p>", "Hello world"],
    ["<p>Hello</p><p>World</p>", "Hello\n\nWorld"],
    ["<h1>Title</h1><p>Body</p>", "Title\n\nBody"],
    ["<ul><li>A</li><li>B</li></ul>", "A\nB"],
    ["<p>a &amp; b</p>", "a & b"],
    ["<p>Hello&nbsp;world</p>", "Hello world"],
    ['<p>Task <input type="checkbox" checked> done</p>', "Task [x] done"],
    ['<p>Hi <mention-component entity_name="user_mention"></mention-component></p>', "Hi @mention"],
  ];
  for (const [input, expected] of cases) {
    const actual = htmlToPlainText(input);
    if (actual !== expected) {
      throw new Error(
        `htmlToPlainText\nhtml: ${input}\nexpected: ${JSON.stringify(expected)}\nactual: ${JSON.stringify(actual)}`
      );
    }
  }
}

const entry = (globalThis as { process?: { argv?: string[] } }).process?.argv?.[1];
const entryFile = entry?.split(/[/\\]/).pop();
if (entryFile === "html-to-plain-text.ts" && import.meta.url.includes(entryFile)) {
  assertHtmlToPlainText();
}
