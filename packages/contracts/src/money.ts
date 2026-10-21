const usd = (digits: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const whole = usd(0);
const cents = usd(2);

/** Formats USD minor units, showing cents only when the amount has them: $165,000, $165,250.50. */
export const formatUsd = (minor: number) => (minor % 100 ? cents : whole).format(minor / 100);
