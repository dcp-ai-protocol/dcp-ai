// The `date-time` format as the reference validator asserts it today: ajv-formats 3.0.1, full mode,
// fullFormats["date-time"] (dist/formats.js: getDateTime(true)), which lib/verify.js installs with addFormats. It is
// written out with explicit character sets, so the SDK ports can follow it line by line, and is tested against the
// upstream function itself (tools/schema-ir/schema-ir.test.mjs). It is a compatibility boundary for the schema layer,
// quirks included, NOT a reading of RFC 3339: it accepts any ECMAScript white space or "t"/"T" as the separator, "z",
// "+hh", "+hhmm" and "+hh:mm" offsets, and a second 60 (with or without a fraction below 61) when the time, moved by
// its offset, is 23:59 or -1:-1 (including minutes 60 to 99 that the offset brings back to 59). The seconds are read
// as a binary64 number, as `+"59.99999999999999999"` is 60 in JavaScript. The temporal parsers of V2-4, V2-13 and
// V2-14 are a different, later layer and are not this function.
//
// Ported from ajv-formats (https://github.com/ajv-validator/ajv-formats), under its license:
//
// MIT License
//
// Copyright (c) 2020 Evgeny Poberezkin
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

export const FORMAT_ID = 'ajv-formats 3.0.1 fullFormats["date-time"] (strict time zone)';

// The separator of DATE_TIME_SEPARATOR = /t|\s/i: "t", "T" and ECMAScript \s (WhiteSpace and LineTerminator).
export const SEPARATORS = new Set([
  0x74, 0x54, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
]);
const DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isDigit = (s, i) => s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39;
const digits = (s, i, n) => { for (let k = 0; k < n; k++) if (!isDigit(s, i + k)) return false; return true; };
const leap = (y) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);

// DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/ and the calendar check of date().
function isDate(s) {
  if (s.length !== 10 || !digits(s, 0, 4) || s[4] !== '-' || !digits(s, 5, 2) || s[7] !== '-' || !digits(s, 8, 2)) return false;
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(5, 7));
  const day = Number(s.slice(8, 10));
  return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && leap(year) ? 29 : DAYS[month]);
}

// TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i with getTime(true).
function isTime(s) {
  if (!digits(s, 0, 2) || s[2] !== ':' || !digits(s, 3, 2) || s[5] !== ':' || !digits(s, 6, 2)) return false;
  let i = 8;
  if (s[i] === '.') {
    let j = i + 1;
    while (isDigit(s, j)) j += 1;
    if (j === i + 1) return false;
    i = j;
  }
  const secText = s.slice(6, i);
  let tz = false;
  let sign = 1;
  let tzH = 0;
  let tzM = 0;
  if (s[i] === 'z' || s[i] === 'Z') {
    tz = true;
    i += 1;
  } else if (s[i] === '+' || s[i] === '-') {
    if (!digits(s, i + 1, 2)) return false;
    tz = true;
    sign = s[i] === '-' ? -1 : 1;
    tzH = Number(s.slice(i + 1, i + 3));
    i += 3;
    if (s[i] === ':' && digits(s, i + 1, 2)) {
      tzM = Number(s.slice(i + 1, i + 3));
      i += 3;
    } else if (digits(s, i, 2)) {
      tzM = Number(s.slice(i, i + 2));
      i += 2;
    }
  }
  if (i !== s.length) return false;
  const hr = Number(s.slice(0, 2));
  const min = Number(s.slice(3, 5));
  const sec = Number(secText);
  if (tzH > 23 || tzM > 59 || !tz) return false;
  if (hr <= 23 && min <= 59 && sec < 60) return true;
  const utcMin = min - tzM * sign;
  const utcHr = hr - tzH * sign - (utcMin < 0 ? 1 : 0);
  return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
}

/** True when the string is a date-time as ajv-formats 3.0.1 (full mode) accepts it. */
export function isDateTime(s) {
  let at = -1;
  for (let i = 0; i < s.length; i++) {
    if (!SEPARATORS.has(s.charCodeAt(i))) continue;
    if (at >= 0) return false; // split() gives more than two parts
    at = i;
  }
  return at >= 0 && isDate(s.slice(0, at)) && isTime(s.slice(at + 1));
}
