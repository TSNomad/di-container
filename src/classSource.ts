/**
 * Reads a class's source to tell whether the class declares a
 * constructor of its own, for the container's autowiring.
 *
 * JavaScript reports a constructor's parameters only through `length`,
 * and a class with no constructor of its own reports 0 even when the
 * one it inherits takes parameters. The container walks up the chain in
 * that case, so it has to know whether a class with `length` 0 wrote a
 * constructor or left it out. Only the source says.
 *
 * Internal to the container. Not exported from the package.
 */

/**
 * What a class's own constructor looks like in its source.
 * - `none`: the class body declares no constructor.
 * - `pass-through`: the constructor only forwards its arguments,
 *   `constructor() { super(...arguments); ... }` or
 *   `constructor(...args) { super(...args); ... }`. Compilers write this
 *   shape when they move class fields into a constructor for an older
 *   target, so it stands for the inherited constructor.
 * - `declared`: any other constructor.
 */
export type OwnConstructor = 'none' | 'pass-through' | 'declared';

/**
 * Reads the constructor a class declares at the top level of its body.
 *
 * Comments, string literals, template literals and regular expression
 * literals are skipped, so text inside them never counts. A
 * `constructor` inside a nested class, object or method body does not
 * count, and neither does a static method named `constructor`.
 */
export function ownConstructor(source: string): OwnConstructor {
  const code = codeOf(source);

  let parens = 0;
  let body = -1;
  for (let i = 0; i < code.length; i += 1) {
    const char = code[i];
    if (char === '(') {
      parens += 1;
    } else if (char === ')') {
      parens -= 1;
    } else if (char === '{' && parens === 0) {
      body = i;
      break;
    }
  }
  if (body === -1) {
    return 'none';
  }

  let depth = 0;
  for (let i = body; i < code.length; i += 1) {
    const char = code[i];
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      continue;
    }
    if (depth !== 1 || !code.startsWith('constructor', i) || /[\w$.]/.test(code[i - 1] ?? '')) {
      continue;
    }
    const rest = code.slice(i);
    if (!/^constructor\s*\(/.test(rest) || /(^|[^\w$])static\s+$/.test(code.slice(Math.max(0, i - 16), i))) {
      continue;
    }
    // A parameter list with parentheses of its own, such as a default
    // value that calls a function, is never a pass-through.
    const declaration = /^constructor\s*\(([^()]*)\)\s*\{\s*([^;}]*)/.exec(rest);
    return declaration && isPassThrough(declaration[1], declaration[2]) ? 'pass-through' : 'declared';
  }
  return 'none';
}

/**
 * Whether a constructor with these parameters, whose body starts with
 * this statement, only forwards its arguments to `super`.
 */
function isPassThrough(parameters: string, first: string): boolean {
  const params = parameters.trim();
  const call = /^super\s*\(\s*\.\.\.\s*([\w$]+)\s*\)\s*$/.exec(first.trim());
  if (!call) {
    return false;
  }
  if (params === '') {
    return call[1] === 'arguments';
  }
  const rest = /^\.\.\.\s*([\w$]+)$/.exec(params);
  return rest !== null && rest[1] === call[1];
}

/**
 * Keywords after which a `/` starts a regular expression literal rather
 * than a division.
 */
const REGEX_AFTER_WORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
]);

/**
 * The source with every comment, string literal, template literal and
 * regular expression literal replaced by one space, so only code is
 * left. A template literal goes whole, its `${}` parts included.
 */
export function codeOf(source: string): string {
  let code = '';
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      code += ' ';
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      code += ' ';
    } else if (char === "'" || char === '"') {
      i = endOfQuoted(source, i);
      code += ' ';
    } else if (char === '`') {
      i = endOfTemplate(source, i);
      code += ' ';
    } else if (char === '/' && startsRegex(code)) {
      i = endOfRegex(source, i);
      code += ' ';
    } else {
      code += char;
      i += 1;
    }
  }
  return code;
}

/** The index just past a quoted string that opens at `start`. */
function endOfQuoted(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length && source[i] !== quote) {
    i += source[i] === '\\' ? 2 : 1;
  }
  return i + 1;
}

/**
 * The index just past a template literal that opens at `start`. Each
 * `${}` part is code, which may hold strings, comments and templates of
 * its own, so it is read with the same rules until its braces close.
 */
function endOfTemplate(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === '\\') {
      i += 2;
    } else if (char === '`') {
      return i + 1;
    } else if (char === '$' && source[i + 1] === '{') {
      i = endOfCode(source, i + 2);
    } else {
      i += 1;
    }
  }
  return i;
}

/**
 * The index just past the `}` that closes a `${}` part whose code
 * starts at `start`.
 */
function endOfCode(source: string, start: number): number {
  let depth = 0;
  let read = '';
  let i = start;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (char === "'" || char === '"') {
      i = endOfQuoted(source, i);
      read += ' ';
    } else if (char === '`') {
      i = endOfTemplate(source, i);
      read += ' ';
    } else if (char === '/' && startsRegex(read)) {
      i = endOfRegex(source, i);
      read += ' ';
    } else if (char === '}' && depth === 0) {
      return i + 1;
    } else {
      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
      }
      read += char;
      i += 1;
    }
  }
  return i;
}

/**
 * Whether a `/` that follows this code starts a regular expression
 * literal: at the start, after an operator or opening punctuation, or
 * after a keyword such as `return`.
 */
function startsRegex(code: string): boolean {
  const before = code.trimEnd();
  if (before === '') {
    return true;
  }
  const last = before[before.length - 1];
  if ('(,=:[!&|?{};+-*%<>~^'.includes(last)) {
    return true;
  }
  const word = /([\w$]+)$/.exec(before);
  return word !== null && REGEX_AFTER_WORD.has(word[1]);
}

/**
 * The index just past a regular expression literal that opens at
 * `start`, its flags included. A `/` inside a character class does not
 * close it.
 */
function endOfRegex(source: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const char = source[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === '\n') {
      return i;
    }
    if (inClass) {
      if (char === ']') {
        inClass = false;
      }
    } else if (char === '[') {
      inClass = true;
    } else if (char === '/') {
      i += 1;
      while (i < source.length && /[a-z]/i.test(source[i])) {
        i += 1;
      }
      return i;
    }
    i += 1;
  }
  return i;
}
