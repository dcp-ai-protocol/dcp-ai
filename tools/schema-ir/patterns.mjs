// Compiles the anchored `pattern` expressions of the V2 schemas into deterministic programs, and matches them.
//
// The grammar is closed; anything outside it is refused at generation, never approximated:
//   pattern      = "^" body "$"
//   body         = sequence | "(" sequence ("|" sequence)+ ")"      (a top-level "|" outside the group is refused:
//                                                                     ECMAScript would read it as (^a)|(b$))
//   sequence     = item+
//   item         = (literal | class) quantifier?
//   literal      = one of A-Z a-z 0-9 : _ - =
//   class        = "[" (char | char "-" char)+ "]"                  (printable ASCII; no negation, escape or "[")
//   quantifier   = "{" n "}" | "{" m "," n "}" | "+" | "?"
// A program is the list of alternatives; an alternative is a list of items {ranges, min, max} (max null: unbounded).
// Within an alternative, an item of variable length must share no code point with any item after it, so the greedy
// left-to-right match is exact and linear, with no backtracking. Full-string match is what these sources say: they
// are anchored with ^ and $ and use no multiline flag, so ECMAScript accepts no trailing line terminator either (this
// is a property of these expressions, not a general JSON Schema rule).
export class PatternError extends Error {}

const LITERAL = /^[A-Za-z0-9:_=-]$/;
const CLASS_CHAR = (c) => c >= 0x20 && c <= 0x7e && c !== 0x5c && c !== 0x5b && c !== 0x5d;

function merge(ranges) {
  const sorted = ranges.map((r) => [...r]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push(r);
  }
  return out;
}

const overlaps = (a, b) => a.some(([lo, hi]) => b.some(([l2, h2]) => lo <= h2 && l2 <= hi));

function parseSequence(src, text) {
  const items = [];
  let i = 0;
  while (i < text.length) {
    let ranges;
    const c = text[i];
    if (c === '[') {
      const end = text.indexOf(']', i + 1);
      if (end < 0) throw new PatternError(`${src}: unclosed class`);
      const body = text.slice(i + 1, end);
      if (body === '' || body[0] === '^') throw new PatternError(`${src}: empty or negated class`);
      ranges = [];
      for (let j = 0; j < body.length; ) {
        const lo = body.charCodeAt(j);
        if (!CLASS_CHAR(lo) || body[j] === '-') throw new PatternError(`${src}: unsupported class character at ${j}`);
        if (body[j + 1] === '-' && j + 2 < body.length) {
          const hi = body.charCodeAt(j + 2);
          if (!CLASS_CHAR(hi) || body[j + 2] === '-' || hi < lo) throw new PatternError(`${src}: bad range in class`);
          ranges.push([lo, hi]);
          j += 3;
        } else {
          ranges.push([lo, lo]);
          j += 1;
        }
      }
      i = end + 1;
    } else if (LITERAL.test(c)) {
      ranges = [[c.charCodeAt(0), c.charCodeAt(0)]];
      i += 1;
    } else {
      throw new PatternError(`${src}: unsupported character ${JSON.stringify(c)}`);
    }
    let min = 1;
    let max = 1;
    if (text[i] === '+') {
      max = null;
      i += 1;
    } else if (text[i] === '?') {
      min = 0;
      i += 1;
    } else if (text[i] === '{') {
      const m = /^\{(\d{1,5})(?:,(\d{1,5}))?\}/.exec(text.slice(i));
      if (!m) throw new PatternError(`${src}: unsupported quantifier`);
      min = Number(m[1]);
      max = m[2] === undefined ? min : Number(m[2]);
      if (max < min) throw new PatternError(`${src}: quantifier {${min},${max}}`);
      i += m[0].length;
    }
    if ('+?*{'.includes(text[i] ?? '') && text[i] !== undefined) throw new PatternError(`${src}: stacked quantifiers`);
    items.push({ ranges: merge(ranges), min, max });
  }
  if (items.length === 0) throw new PatternError(`${src}: empty alternative`);
  for (let k = 0; k < items.length; k++) {
    if (items[k].min === items[k].max) continue;
    const after = items.slice(k + 1).flatMap((x) => x.ranges);
    if (overlaps(items[k].ranges, after)) throw new PatternError(`${src}: a variable item overlaps a later item (greedy matching would not be exact)`);
  }
  return items;
}

/** The program of an anchored pattern, or PatternError. */
export function compilePattern(src) {
  if (typeof src !== 'string' || src.length < 3 || src[0] !== '^' || src.at(-1) !== '$') throw new PatternError(`${JSON.stringify(src)}: not anchored with ^ and $`);
  let body = src.slice(1, -1);
  let alternatives;
  if (body.startsWith('(')) {
    if (!body.endsWith(')')) throw new PatternError(`${src}: a group must enclose the whole body`);
    body = body.slice(body.startsWith('(?:') ? 3 : 1, -1);
    if (/[()]/.test(body)) throw new PatternError(`${src}: nested groups`);
    alternatives = body.split('|');
    if (alternatives.length < 2) throw new PatternError(`${src}: a group without alternatives`);
  } else {
    if (/[()|]/.test(body)) throw new PatternError(`${src}: "|" or a group outside one enclosing group`);
    alternatives = [body];
  }
  return { source: src, alternatives: alternatives.map((a) => parseSequence(src, a)) };
}

const inRanges = (ranges, c) => ranges.some(([lo, hi]) => c >= lo && c <= hi);

/** Full-string match of a compiled program over the code points of s (a lone surrogate is its own code point). */
export function matchProgram(program, s) {
  const cps = Array.from(s, (ch) => ch.codePointAt(0));
  return program.alternatives.some((items) => {
    let i = 0;
    for (const it of items) {
      let n = 0;
      while ((it.max === null || n < it.max) && i < cps.length && inRanges(it.ranges, cps[i])) {
        i += 1;
        n += 1;
      }
      if (n < it.min) return false;
    }
    return i === cps.length;
  });
}
