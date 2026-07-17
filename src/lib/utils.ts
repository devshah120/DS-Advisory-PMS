import clsx, { type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatCurrency(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency === 'USD' ? 'USD' : currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number, decimals = 2): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/** Percent where the input is already a percentage value (e.g. 14.2 -> "14.2%"). */
export function formatPct(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/** Signed percent for deltas (e.g. 1.8 -> "+1.80%", -2 -> "-2.00%"). */
export function formatSignedPct(value: number, decimals = 2): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

/** Compact currency for large AUM figures (e.g. 1875000 -> "$1.88M"). */
export function formatCompactCurrency(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value);
}

/** Signed currency for P&L (e.g. -1200 -> "-$1,200.00"). */
export function formatSignedCurrency(value: number, currency = 'USD'): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatCurrency(value, currency)}`;
}

export function formatNumber(value: number, decimals = 2): string {
  return parseFloat(value.toFixed(decimals)).toLocaleString('en-US');
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDatetime(date: Date | string): string {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function calculateXIRR(
  cashFlows: { date: Date; amount: number }[]
): number {
  if (cashFlows.length < 2) return 0;

  const sorted = cashFlows.sort((a, b) => a.date.getTime() - b.date.getTime());
  const firstDate = sorted[0].date;
  const lastDate = sorted[sorted.length - 1].date;
  const days = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
  const years = days / 365.25;

  let xirr = 0.1;
  for (let i = 0; i < 100; i++) {
    let pv = 0;
    let derivative = 0;

    for (const flow of sorted) {
      const daysFromStart =
        (flow.date.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
      const yearsFromStart = daysFromStart / 365.25;
      const power = Math.pow(1 + xirr, yearsFromStart);

      pv += flow.amount / power;
      derivative -=
        (yearsFromStart * flow.amount) / Math.pow(power, 2) / (1 + xirr);
    }

    if (Math.abs(pv) < 0.01) break;
    xirr = xirr - pv / derivative;
  }

  return xirr;
}

export function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

export function truncateText(text: string, length: number): string {
  return text.length > length ? `${text.substring(0, length)}...` : text;
}

export function calculatePnL(
  currentPrice: number,
  averageCost: number,
  quantity: number
): number {
  return (currentPrice - averageCost) * quantity;
}

export function calculateAllocation(
  position: number,
  portfolio: number
): number {
  if (portfolio === 0) return 0;
  return position / portfolio;
}
