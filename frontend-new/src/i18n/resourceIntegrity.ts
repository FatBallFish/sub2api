export const PLURAL_SUFFIXES = ["one", "other"] as const;

export function findIncompletePluralFamilies(resources: ReadonlyMap<string, string>): string[] {
  const families = new Set<string>();
  for (const key of resources.keys()) {
    for (const suffix of PLURAL_SUFFIXES) {
      const marker = `_${suffix}`;
      if (key.endsWith(marker)) families.add(key.slice(0, -marker.length));
    }
  }

  return [...families].sort().flatMap((family) => PLURAL_SUFFIXES.flatMap((suffix) => (
    resources.has(`${family}_${suffix}`) ? [] : [`${family}: missing _${suffix}`]
  )));
}
