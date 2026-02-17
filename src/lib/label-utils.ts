export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function pluralize(s: string): string {
  const lower = s.toLowerCase();
  if (lower.endsWith("s") || lower.endsWith("ch") || lower.endsWith("sh") || lower.endsWith("x") || lower.endsWith("z")) {
    return s + "es";
  }
  if (lower.endsWith("y") && !/[aeiou]y$/i.test(s)) {
    return s.slice(0, -1) + "ies";
  }
  return s + "s";
}
