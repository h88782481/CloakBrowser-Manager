/**
 * Build-time Chinese UI for CloakBrowser Manager.
 *
 * Component source stays English, which keeps upstream merges small: new or
 * changed copy shows up in English until `src/i18n/zh-CN.ts` has a line for it.
 * Vitest does not load this plugin (it has its own config, and the plugin also
 * no-ops when VITEST is set), so existing tests keep asserting English strings.
 *
 * Only dictionary hits are rewritten. Literals used as program values are left
 * alone: comparisons, union types, `from` specifiers, and non-text JSX
 * attributes (`value`, `className`, `src`, …).
 */
import type { Plugin } from "vite";
import { exact } from "./src/i18n/zh-CN.ts";

const UI_ATTRS = new Set(["placeholder", "title", "aria-label", "alt"]);
const JSX_BEFORE_KEYWORD = new Set(["return", "throw", "yield", "case", "else", "do", "void", "await"]);
const JSX_BEFORE_PUNCT = new Set([
  "(", "[", "{", "=", "=>", "?", ":", ",", ";", "&&", "||", "??", "!", "&", "|", "+", "-", "*", "%", "~",
]);

interface Edit {
  start: number;
  end: number;
  text: string;
}

interface Ctx {
  code: string;
  i: number;
  jsx: boolean;
  prevKind: "start" | "ident" | "keyword" | "num" | "str" | "punct" | "regex" | "tmpl" | "jsx";
  prevText: string;
  edits: Edit[];
  missed: string[];
  skips: number;
}

function isIdStart(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z_$]/.test(ch);
}

function isIdPart(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9_$]/.test(ch);
}

function escapeQuoted(value: string, quote: '"' | "'"): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  return quote === "'" ? escaped.replace(/'/g, "\\'") : escaped.replace(/"/g, '\\"');
}

function escapeTemplateText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function skipSpaceAndComments(ctx: Ctx): void {
  const { code } = ctx;
  while (ctx.i < code.length) {
    const ch = code[ctx.i];
    const next = code[ctx.i + 1];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      ctx.i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      ctx.i += 2;
      while (ctx.i < code.length && code[ctx.i] !== "\n") ctx.i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      ctx.i += 2;
      while (ctx.i < code.length && !(code[ctx.i] === "*" && code[ctx.i + 1] === "/")) ctx.i++;
      ctx.i = Math.min(code.length, ctx.i + 2);
      continue;
    }
    break;
  }
}

function canStartRegex(ctx: Ctx): boolean {
  if (ctx.prevKind === "ident" || ctx.prevKind === "num" || ctx.prevKind === "str" || ctx.prevKind === "tmpl" || ctx.prevKind === "regex" || ctx.prevKind === "jsx") {
    return false;
  }
  return ctx.prevText !== ")" && ctx.prevText !== "]" && ctx.prevText !== "++" && ctx.prevText !== "--";
}

function isGenericArrow(ctx: Ctx): boolean {
  const { code } = ctx;
  let j = ctx.i + 1;
  if (!isIdStart(code[j])) return false;
  let depth = 1;
  j++;
  while (j < code.length && depth > 0 && j - ctx.i < 800) {
    const ch = code[j]!;
    const next = code[j + 1];
    if (ch === "<") depth++;
    else if (ch === "=" && next === ">") j++;
    else if (ch === ">") {
      depth--;
      if (depth === 0) {
        j++;
        while (code[j] === " " || code[j] === "\n" || code[j] === "\r" || code[j] === "\t") j++;
        return code[j] === "(";
      }
    } else if (ch === '"' || ch === "'" || ch === "`") return false;
    j++;
  }
  return false;
}

function looksLikeJsx(ctx: Ctx): boolean {
  if (!ctx.jsx || ctx.code[ctx.i] !== "<") return false;
  if (isGenericArrow(ctx)) return false;
  const next = ctx.code[ctx.i + 1];
  if (next === "=" || next === "<") return false;
  const tagLike = next === ">" || next === "/" || isIdStart(next);
  if (!tagLike) return false;
  if (ctx.prevKind === "keyword" && JSX_BEFORE_KEYWORD.has(ctx.prevText)) return true;
  if ((ctx.prevKind === "punct" || ctx.prevKind === "start") && (ctx.prevText === "" || JSX_BEFORE_PUNCT.has(ctx.prevText))) {
    return true;
  }
  return ctx.prevKind === "start";
}

function peekForbid(ctx: Ctx): boolean {
  const saved = ctx.i;
  skipSpaceAndComments(ctx);
  const a = ctx.code[ctx.i] ?? "";
  const b = ctx.code[ctx.i + 1] ?? "";
  const c = ctx.code[ctx.i + 2] ?? "";
  ctx.i = saved;
  const three = a + b + c;
  if (three === "===" || three === "!==") return true;
  if (a + b === "==" || a + b === "!=") return true;
  return a === "|" && b !== "|";
}

function prevForbids(ctx: Ctx): boolean {
  const text = ctx.prevText;
  return text === "===" || text === "!==" || text === "==" || text === "!=" || text === "|" || text === "from";
}

function setPrev(ctx: Ctx, kind: Ctx["prevKind"], text: string): void {
  ctx.prevKind = kind;
  ctx.prevText = text;
}

function readString(ctx: Ctx, allow: boolean): void {
  const { code } = ctx;
  const quote = code[ctx.i] as '"' | "'";
  const start = ctx.i;
  const forbidden = prevForbids(ctx);
  ctx.i++;
  let value = "";
  while (ctx.i < code.length) {
    const ch = code[ctx.i]!;
    if (ch === "\\") {
      const esc = code[ctx.i + 1] ?? "";
      value += esc === "n" ? "\n" : esc === "r" ? "\r" : esc === "t" ? "\t" : esc;
      ctx.i += 2;
      continue;
    }
    if (ch === quote) {
      ctx.i++;
      break;
    }
    if (ch === "\n") break;
    value += ch;
    ctx.i++;
  }
  const translatable = allow && !forbidden && !peekForbid(ctx);
  const translated = translatable ? exact[value] : undefined;
  if (translated && translated !== value) {
    ctx.edits.push({ start, end: ctx.i, text: quote + escapeQuoted(translated, quote) + quote });
  } else if (translatable && exact[value] === undefined && /[A-Za-z]/.test(value) && (/\s/.test(value) || value.includes("…"))) {
    ctx.missed.push("str " + value);
  }
  setPrev(ctx, "str", value);
}

function renderTemplate(translation: string, exprs: string[]): string | null {
  const parts = translation.split(/\{(\d+)\}/);
  for (let i = 1; i < parts.length; i += 2) {
    const index = Number(parts[i]);
    if (!Number.isInteger(index) || index < 0 || index >= exprs.length) return null;
  }
  let out = "`";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    if (i % 2 === 0) out += escapeTemplateText(part);
    else out += `\${${exprs[Number(part)]}}`;
  }
  return out + "`";
}

interface Hole {
  start: number;
  end: number;
  edits: Edit[];
}

function holeSource(code: string, hole: Hole): string {
  const relative = hole.edits.map((edit) => ({
    start: edit.start - hole.start,
    end: edit.end - hole.start,
    text: edit.text,
  }));
  return applyEdits(code.slice(hole.start, hole.end), relative);
}

function readTemplate(ctx: Ctx): void {
  const { code } = ctx;
  const start = ctx.i;
  const forbidden = prevForbids(ctx);
  const editsBefore = ctx.edits.length;
  ctx.i++;
  let pattern = "";
  let literal = "";
  const holes: Hole[] = [];
  while (ctx.i < code.length) {
    const ch = code[ctx.i]!;
    if (ch === "\\") {
      const esc = code[ctx.i + 1] ?? "";
      literal += esc === "n" ? "\n" : esc === "r" ? "\r" : esc === "t" ? "\t" : esc;
      ctx.i += 2;
      continue;
    }
    if (ch === "`") {
      ctx.i++;
      break;
    }
    if (ch === "$" && code[ctx.i + 1] === "{") {
      pattern += literal + `{${holes.length}}`;
      literal = "";
      ctx.i += 2;
      const exprStart = ctx.i;
      const editMark = ctx.edits.length;
      scanCode(ctx, "}");
      holes.push({ start: exprStart, end: ctx.i, edits: ctx.edits.slice(editMark) });
      if (code[ctx.i] === "}") ctx.i++;
      continue;
    }
    literal += ch;
    ctx.i++;
  }
  pattern += literal;
  const translated = !forbidden && translatedDiffers(exact[pattern], pattern) ? exact[pattern] : undefined;
  if (translated) {
    const rendered = renderTemplate(
      translated,
      holes.map((hole) => holeSource(code, hole)),
    );
    if (rendered) {
      ctx.edits.length = editsBefore;
      ctx.edits.push({ start, end: ctx.i, text: rendered });
      setPrev(ctx, "tmpl", pattern);
      return;
    }
  }
  if (/[A-Za-z]/.test(pattern) && exact[pattern] === undefined && (/\s/.test(pattern) || pattern.includes("{0}"))) {
    ctx.missed.push("tpl " + pattern);
  }
  setPrev(ctx, "tmpl", pattern);
}

function translatedDiffers(translated: string | undefined, pattern: string): translated is string {
  return translated !== undefined && translated !== pattern;
}

function readRegex(ctx: Ctx): void {
  const { code } = ctx;
  ctx.i++;
  let inClass = false;
  while (ctx.i < code.length) {
    const ch = code[ctx.i]!;
    if (ch === "\\") {
      ctx.i += 2;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "]" && inClass) inClass = false;
    else if (ch === "/" && !inClass) {
      ctx.i++;
      break;
    } else if (ch === "\n") break;
    ctx.i++;
  }
  while (/[dgimsuy]/.test(code[ctx.i] ?? "")) ctx.i++;
  setPrev(ctx, "regex", "");
}

function readNumber(ctx: Ctx): void {
  const { code } = ctx;
  if (code[ctx.i] === "0" && (code[ctx.i + 1] === "x" || code[ctx.i + 1] === "b" || code[ctx.i + 1] === "o")) {
    ctx.i += 2;
  }
  while (/[0-9a-fA-F_]/.test(code[ctx.i] ?? "")) ctx.i++;
  if (code[ctx.i] === ".") {
    ctx.i++;
    while (/[0-9_]/.test(code[ctx.i] ?? "")) ctx.i++;
  }
  if (code[ctx.i] === "n") ctx.i++;
  setPrev(ctx, "num", "");
}

function readIdentifier(ctx: Ctx): void {
  const { code } = ctx;
  const start = ctx.i;
  ctx.i++;
  while (isIdPart(code[ctx.i])) ctx.i++;
  const text = code.slice(start, ctx.i);
  const kind = JSX_BEFORE_KEYWORD.has(text) || text === "from" || text === "import" ? "keyword" : "ident";
  setPrev(ctx, kind, text);
}

function readOperator(ctx: Ctx): void {
  const { code } = ctx;
  const three = code.slice(ctx.i, ctx.i + 3);
  if (three === "===" || three === "!==" || three === "..." || three === "**=") {
    ctx.i += 3;
    setPrev(ctx, "punct", three);
    return;
  }
  const two = code.slice(ctx.i, ctx.i + 2);
  if (
    two === "=>" || two === "==" || two === "!=" || two === "<=" || two === ">=" ||
    two === "&&" || two === "||" || two === "??" || two === "?." || two === "++" ||
    two === "--" || two === "**" || two === "+=" || two === "-=" || two === "*=" ||
    two === "/=" || two === "%=" || two === "&=" || two === "|=" || two === "^=" ||
    two === "<<" || two === ">>"
  ) {
    ctx.i += 2;
    setPrev(ctx, "punct", two);
    return;
  }
  const ch = code[ctx.i] ?? "";
  ctx.i++;
  setPrev(ctx, "punct", ch);
}

function noteJsxText(ctx: Ctx, start: number, end: number): void {
  const raw = ctx.code.slice(start, end);
  const core = raw.replace(/\s+/g, " ").trim();
  if (!core || !/[A-Za-z]/.test(core)) return;
  const translated = exact[core];
  if (translated && translated !== core) {
    const glue = /^[。，、」』）】]$/.test(translated);
    const lead = glue ? "" : (raw.match(/^\s*/)?.[0] ?? "");
    const trail = glue ? "" : (raw.match(/\s*$/)?.[0] ?? "");
    ctx.edits.push({ start, end, text: lead + translated + trail });
  } else if (!translated) {
    ctx.missed.push("jsx " + core);
  }
}

function readJsxName(ctx: Ctx): void {
  const { code } = ctx;
  skipSpaceAndComments(ctx);
  while (isIdPart(code[ctx.i]) || code[ctx.i] === "." || code[ctx.i] === "-") ctx.i++;
}

function readAttrName(ctx: Ctx): string {
  const { code } = ctx;
  const start = ctx.i;
  while (isIdPart(code[ctx.i]) || code[ctx.i] === "-" || code[ctx.i] === ":") ctx.i++;
  return code.slice(start, ctx.i);
}

function readJsxChildren(ctx: Ctx): void {
  const { code } = ctx;
  while (ctx.i < code.length) {
    if (code[ctx.i] === "{") {
      ctx.i++;
      scanCode(ctx, "}");
      if (code[ctx.i] === "}") ctx.i++;
      continue;
    }
    if (code[ctx.i] === "<") {
      const closing = code[ctx.i + 1] === "/";
      readJsxElement(ctx);
      if (closing) return;
      continue;
    }
    const start = ctx.i;
    while (ctx.i < code.length && code[ctx.i] !== "<" && code[ctx.i] !== "{") ctx.i++;
    noteJsxText(ctx, start, ctx.i);
  }
}

function readJsxElement(ctx: Ctx): void {
  const { code } = ctx;
  const start = ctx.i;
  if (code[ctx.i] !== "<") return;
  ctx.i++;
  if (code[ctx.i] === "/") {
    ctx.i++;
    readJsxName(ctx);
    skipSpaceAndComments(ctx);
    if (code[ctx.i] === ">") ctx.i++;
    setPrev(ctx, "jsx", "jsx");
    return;
  }
  if (code[ctx.i] === ">") {
    ctx.i++;
    readJsxChildren(ctx);
    setPrev(ctx, "jsx", "jsx");
    return;
  }
  readJsxName(ctx);
  for (;;) {
    const mark = ctx.i;
    skipSpaceAndComments(ctx);
    if (ctx.i >= code.length) break;
    if (code[ctx.i] === "/" && code[ctx.i + 1] === ">") {
      ctx.i += 2;
      break;
    }
    if (code[ctx.i] === ">") {
      ctx.i++;
      readJsxChildren(ctx);
      break;
    }
    if (code[ctx.i] === "{") {
      ctx.i++;
      scanCode(ctx, "}");
      if (code[ctx.i] === "}") ctx.i++;
      continue;
    }
    if (!isIdStart(code[ctx.i])) {
      if (ctx.i === mark) {
        ctx.skips++;
        ctx.i++;
      }
      continue;
    }
    const name = readAttrName(ctx);
    skipSpaceAndComments(ctx);
    if (code[ctx.i] !== "=") continue;
    ctx.i++;
    skipSpaceAndComments(ctx);
    if (code[ctx.i] === '"' || code[ctx.i] === "'") {
      setPrev(ctx, "punct", "=");
      readString(ctx, UI_ATTRS.has(name));
    } else if (code[ctx.i] === "`") {
      setPrev(ctx, "punct", "=");
      readTemplate(ctx);
    } else if (code[ctx.i] === "{") {
      ctx.i++;
      scanCode(ctx, "}");
      if (code[ctx.i] === "}") ctx.i++;
    } else if (code[ctx.i] === "<") {
      readJsxElement(ctx);
    }
  }
  if (ctx.i === start) {
    ctx.skips++;
    ctx.i++;
  }
  setPrev(ctx, "jsx", "jsx");
}

function scanCode(ctx: Ctx, stop: string | null): void {
  const { code } = ctx;
  let depth = 0;
  while (ctx.i < code.length) {
    const mark = ctx.i;
    skipSpaceAndComments(ctx);
    if (ctx.i >= code.length) return;
    const ch = code[ctx.i]!;
    if (depth === 0 && stop && ch === stop) return;
    if (ch === '"' || ch === "'") {
      readString(ctx, true);
    } else if (ch === "`") {
      readTemplate(ctx);
    } else if (ch === "<" && looksLikeJsx(ctx)) {
      readJsxElement(ctx);
    } else if (ch === "/" && canStartRegex(ctx)) {
      readRegex(ctx);
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      ctx.i++;
      setPrev(ctx, "punct", ch);
    } else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0 && stop && ch === stop) return;
      if (depth > 0) depth--;
      ctx.i++;
      setPrev(ctx, "punct", ch);
    } else if (isIdStart(ch)) {
      readIdentifier(ctx);
    } else if (ch >= "0" && ch <= "9") {
      readNumber(ctx);
    } else if (ch === "." && code[ctx.i + 1] >= "0" && code[ctx.i + 1] <= "9") {
      readNumber(ctx);
    } else {
      readOperator(ctx);
    }
    if (ctx.i === mark) {
      ctx.skips++;
      ctx.i++;
    }
  }
}

function applyEdits(code: string, edits: Edit[]): string {
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  let out = code;
  let cursor = code.length;
  for (const edit of ordered) {
    if (edit.end > cursor || edit.start < 0 || edit.end > code.length) continue;
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    cursor = edit.start;
  }
  return out;
}

function scan(code: string, jsx: boolean): { edits: Edit[]; missed: string[]; complete: boolean; skips: number } {
  const ctx: Ctx = {
    code,
    i: 0,
    jsx,
    prevKind: "start",
    prevText: "",
    edits: [],
    missed: [],
    skips: 0,
  };
  try {
    scanCode(ctx, null);
  } catch {
    return { edits: [], missed: [], complete: false, skips: 1 };
  }
  return { edits: ctx.edits, missed: ctx.missed, complete: ctx.i >= code.length, skips: ctx.skips };
}

export function transformSource(code: string, filename: string): string {
  const result = scan(code, filename.endsWith(".tsx"));
  if (!result.complete || result.skips > 0) return code;
  return applyEdits(code, result.edits);
}

export function untranslatedSurface(code: string, filename: string): string[] {
  const result = scan(code, filename.endsWith(".tsx"));
  if (!result.complete || result.skips > 0) return [`SCAN incomplete=${!result.complete} skips=${result.skips}`];
  return result.missed;
}

export function zhPlugin(): Plugin {
  return {
    name: "cloak-zh",
    enforce: "pre",
    transform(code, id) {
      if (process.env.VITEST) return null;
      const filename = id.split("?", 1)[0] ?? id;
      if (filename.includes("node_modules")) return null;
      if (/[/\\]i18n[/\\]/.test(filename)) return null;
      if (filename.endsWith(".d.ts") || filename.includes(".test.")) return null;
      if (!filename.endsWith(".ts") && !filename.endsWith(".tsx")) return null;
      const next = transformSource(code, filename);
      if (next === code) return null;
      return { code: next, map: null };
    },
  };
}
