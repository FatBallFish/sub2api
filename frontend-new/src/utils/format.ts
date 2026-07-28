export function formatCredits(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  }).format(Number.isFinite(value) ? value : 0);
}
