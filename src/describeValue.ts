/**
 * How an error message names a value it was handed. Not exported from
 * the package.
 */

/**
 * A value as text for an error message: an Error by its message,
 * anything else through `String()`, and an object that
 * `String()` cannot convert, such as one with no prototype, by its tag.
 * Never throws, so building an error message cannot fail.
 */
export function describeValue(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
