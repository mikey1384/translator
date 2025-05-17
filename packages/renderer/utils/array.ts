export const sameArray = <T>(a: T[], b: T[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);
