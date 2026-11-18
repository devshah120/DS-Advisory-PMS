import ExcelJS from 'exceljs';
import { applyWorkbookFont } from './excelFont';
import { marketApi, type MarketCapQuote } from './market.api';

/**
 * One position as it appears in a client's holdings export. Mirrors the
 * ClientPositionRow the drill-down table renders, kept structural so the page
 * can hand its rows straight over without a mapping step.
 */
export interface HoldingsExportRow {
  srNo: number;
  symbol: string;
  /**
   * The fully-qualified Yahoo symbol ('RELIANCE.NS', 'AIMTRON-SM.NS'), used to
   * look up market cap for the size-band table. Needed wherever `symbol` is the
   * suffix-stripped display form, which on its own can't be priced. Falls back
   * to `symbol` when absent.
   */
  ticker?: string;
  name: string;
  /** Drives the sector allocation block; already defaulted to 'Uncategorized'. */
  sector: string;
  quantity: number;
  averageCostBasis: number;
  lastPrice: number;
  /**
   * Cost, value, P&L and %PL are not written as given. The sheet works each by
   * formula from quantity, average cost and price, which is how every caller
   * already arrives at them, so a reader can trace every figure in the file.
   * They are kept on the row so callers can pass their own rows unmapped.
   */
  costBasisTotal: number;
  currentValue: number;
  pl: number;
  plPercent: number;
  /**
   * Percent (0–100) of the WHOLE portfolio, cash included. The sheet's %alloc
   * is a formula, but when the rows are only a search or selection of the book
   * these weights are how it recovers the whole portfolio's value to divide by
   * (see `portfolioDenominator`).
   */
  allocPercent: number;
  /**
   * How many of a household's accounts hold the name. Set only by the family
   * export, which adds an "Accounts" column for it; undefined on an individual
   * client's sheet, where every row would trivially read 1.
   */
  accounts?: number;
}

const FONT_NAME = 'Perpetua';
const HEADING_SIZE = 13;
const BODY_SIZE = 11;

/** Whole numbers with thousands separators — the firm reports no cents. */
const WHOLE_NUMBER = '#,##0';
/** Percent columns carry a literal % so the sheet reads as the reference does. */
const WHOLE_PERCENT = '0%';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFFFFF' },
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
};

/** Gain and loss tints for the %PL column, matching the reference workbook. */
const GAIN_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFC6EFCE' },
};
const LOSS_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFC7CE' },
};

/**
 * Swatch colours for the sector table's label cells. Ordered so adjacent rows
 * stay distinguishable, and picked to remain separable in greyscale for the
 * advisors who print these sheets. Cash always takes CASH_SLICE_COLOR instead,
 * wherever it lands in the ordering.
 */
const SECTOR_COLORS = [
  '4C72B0', 'DD8452', '55A868', 'C44E52', '8172B3',
  '937860', 'DA8BC3', '8C8C8C', 'CCB974', '64B5CD',
];
const CASH_SLICE_COLOR = 'B0B0B0';

/** One sector's share of the portfolio, as rendered in the allocation block. */
interface SectorSlice {
  label: string;
  value: number;
  /** Fraction of the portfolio, 0–1. */
  weight: number;
  /** Slice fill, 6-digit hex without the alpha prefix. */
  color: string;
}

/**
 * The label cash carries in the Sector and Market Cap columns and in both
 * allocation tables. One spelling, because each table's line is a SUMIF on it.
 */
const CASH = 'Cash';

/**
 * The sector a position is reported under, in its own column and in the sector
 * table alike: the table is a SUMIF over that column, so the two must agree.
 * Commodity funds read as Commodities on both tables, whatever sector the
 * holding carries (they were filed under Miscellaneous).
 */
function sectorOf(row: HoldingsExportRow, quote: MarketCapQuote | undefined): string {
  return isCommodityFund(row, quote) ? COMMODITIES : row.sector || 'Uncategorized';
}

/**
 * Rolls positions up by sector, largest first, with cash as its own slice.
 * Cash belongs in the mix because the table answers "where is this portfolio's
 * money", and an uninvested balance is a real answer to that.
 *
 * `portfolioValue` is the denominator every weight on the sheet shares (see
 * `portfolioDenominator`).
 */
function buildSectorSlices(
  rows: HoldingsExportRow[],
  cashBalance: number,
  portfolioValue: number,
  caps?: Record<string, MarketCapQuote>
): SectorSlice[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = sectorOf(row, caps?.[capKey(row)]);
    totals.set(key, (totals.get(key) ?? 0) + row.currentValue);
  }

  if (portfolioValue <= 0) return [];

  const slices = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({
      label,
      value,
      weight: value / portfolioValue,
      color: SECTOR_COLORS[i % SECTOR_COLORS.length],
    }));

  if (cashBalance > 0) {
    slices.push({
      label: CASH,
      value: cashBalance,
      weight: cashBalance / portfolioValue,
      color: CASH_SLICE_COLOR,
    });
  }

  return slices;
}

/** One crore, in rupees. */
const CRORE = 10_000_000;
/** The firm's Indian size bands, in INR crore: small up to 5,000; mid 5,001–50,000; large above. */
const SMALL_CAP_MAX_CR = 5_000;
const MID_CAP_MAX_CR = 50_000;

/**
 * The firm's US size bands, in USD billions, applied to the dollar cap itself
 * (not an INR conversion): small below $10bn; mid $10bn to below $50bn; large
 * $50bn and above.
 */
const BILLION = 1_000_000_000;
const US_MID_CAP_MIN_BN = 10;
const US_LARGE_CAP_MIN_BN = 50;

/**
 * Band colours: one blue, deepest for large, because the bands are ordered —
 * unlike sectors, which take unrelated hues. Kept light enough that the black
 * label text stays readable on the darkest of them, on screen and in print.
 */
const CAP_BANDS = [
  { label: 'Large Cap', color: '5B9BD5' },
  { label: 'Mid Cap', color: '9DC3E6' },
  { label: 'Small Cap', color: 'DEEBF7' },
] as const;
const COMMODITIES = 'Commodities';
const ETF = 'ETF';
const COMMODITY_SLICE = { label: COMMODITIES, color: 'DDB892' };
const FUND_SLICE = { label: ETF, color: 'CCB974' };
const UNCLASSIFIED_SLICE = { label: 'Unclassified', color: '8C8C8C' };

/**
 * ETF units carry no market cap, and Yahoo types Indian ETFs as EQUITY — the
 * name is the tell. iShares/SPDR catch trusts whose names say neither ("iShares
 * Gold Trust"), so the Commodities line holds even when quotes are unavailable.
 */
const FUND_NAME = /\b(ETF|ETC|BEES|FUND|iShares|SPDR)\b/i;
const FUND_QUOTE_TYPES = new Set(['ETF', 'MUTUALFUND']);

/** What a commodity fund holds: the metal, energy or basket itself. */
const COMMODITY_NAME =
  /\b(gold|silver|copper|platinum|palladium|bullion|precious metals?|crude|oil|natural gas|commodit(?:y|ies))\b/i;
/**
 * …as opposed to the companies that dig it up. "Gold Miners ETF" and "Uranium
 * Miners ETF" own equities, so they stay ETF rather than Commodities.
 */
const PRODUCER_NAME =
  /\b(miners?|mining|producers?|explorers?|exploration|royalt(?:y|ies)|equipment|services|companies)\b/i;

function isFund(row: HoldingsExportRow, quote: MarketCapQuote | undefined): boolean {
  return FUND_NAME.test(row.name) || (!!quote?.quoteType && FUND_QUOTE_TYPES.has(quote.quoteType));
}

/** A fund holding a physical commodity or commodity futures (GLD, SLV, CPER, HDFCGOLD…). */
function isCommodityFund(row: HoldingsExportRow, quote: MarketCapQuote | undefined): boolean {
  return isFund(row, quote) && COMMODITY_NAME.test(row.name) && !PRODUCER_NAME.test(row.name);
}

type CapBucket =
  | (typeof CAP_BANDS)[number]['label']
  | typeof COMMODITIES
  | typeof ETF
  | 'Unclassified';

/** Which band set a quote is measured against: dollars for US listings, crore otherwise. */
function bandBasis(quote: MarketCapQuote | undefined): 'USD' | 'INR' {
  return quote?.currency === 'USD' ? 'USD' : 'INR';
}

/**
 * Which line a position falls on. Commodity funds and other ETFs (country,
 * thematic, index) are named lines of their own, since neither has a cap.
 *
 * Equities band by listing: a USD listing on its dollar cap against the US
 * bands, anything else on its INR cap against the crore bands. The crore bands
 * meet at whole crores (5,000 is the top of small, 5,001 the bottom of mid), so
 * the cut is "at most" each ceiling; the US bands are "below $10bn" and
 * "$50bn and above", so $10bn exactly is mid and $50bn exactly is large.
 */
function capBucketOf(row: HoldingsExportRow, quote: MarketCapQuote | undefined): CapBucket {
  if (isCommodityFund(row, quote)) return COMMODITIES;
  if (isFund(row, quote)) return ETF;

  if (bandBasis(quote) === 'USD') {
    // An API build without `marketCap` leaves this unclassified rather than
    // silently banding a US name in crore.
    const bn = quote?.marketCap != null ? quote.marketCap / BILLION : null;
    if (bn == null) return 'Unclassified';
    if (bn < US_MID_CAP_MIN_BN) return 'Small Cap';
    if (bn < US_LARGE_CAP_MIN_BN) return 'Mid Cap';
    return 'Large Cap';
  }

  const crore = quote?.marketCapInr != null ? quote.marketCapInr / CRORE : null;
  if (crore == null) return 'Unclassified';
  if (crore <= SMALL_CAP_MAX_CR) return 'Small Cap';
  if (crore <= MID_CAP_MAX_CR) return 'Mid Cap';
  return 'Large Cap';
}

/** The key a row's market cap is filed under — the full Yahoo symbol, upper-cased. */
function capKey(row: HoldingsExportRow): string {
  return (row.ticker || row.symbol).trim().toUpperCase();
}

/**
 * Rolls positions into the size bands, against the same cash-inclusive
 * portfolio value the sector table uses so the two tables foot to the same
 * total. The three bands always print, even at 0% — "no small caps" is an
 * answer the reader is looking for. ETFs, unclassified names and cash print
 * only when present.
 */
function buildMarketCapSlices(
  rows: HoldingsExportRow[],
  cashBalance: number,
  portfolioValue: number,
  caps: Record<string, MarketCapQuote>
): SectorSlice[] {
  if (portfolioValue <= 0) return [];

  const totals = new Map<CapBucket, number>();
  for (const row of rows) {
    const bucket = capBucketOf(row, caps[capKey(row)]);
    totals.set(bucket, (totals.get(bucket) ?? 0) + row.currentValue);
  }

  const slice = (label: string, value: number, color: string): SectorSlice => ({
    label,
    value,
    weight: value / portfolioValue,
    color,
  });

  const slices = CAP_BANDS.map((b) => slice(b.label, totals.get(b.label) ?? 0, b.color));
  for (const extra of [FUND_SLICE, COMMODITY_SLICE, UNCLASSIFIED_SLICE]) {
    const value = totals.get(extra.label as CapBucket) ?? 0;
    if (value > 0) slices.push(slice(extra.label, value, extra.color));
  }
  if (cashBalance > 0) slices.push(slice(CASH, cashBalance, CASH_SLICE_COLOR));
  return slices;
}

/** The lines printed under the size-band table: the band definitions, then any caveat. */
function marketCapFootnotes(
  rows: HoldingsExportRow[],
  caps: Record<string, MarketCapQuote>,
  asOf?: string
): string[] {
  const US_BANDS = 'Small cap: below $10bn; Mid cap: $10bn to below $50bn; Large cap: $50bn and above.';
  const IN_BANDS = 'Small cap: up to 5,000 cr; Mid cap: 5,001-50,000 cr; Large cap: above 50,000 cr.';

  // State the band set(s) actually applied: by the equities that were banded,
  // else (an all-ETF book) by whatever the book is listed in.
  const equities = rows.filter((r) => !isFund(r, caps[capKey(r)]));
  const basis = new Set((equities.length ? equities : rows).map((r) => bandBasis(caps[capKey(r)])));
  const notes: string[] = [];
  if (basis.has('USD') && basis.has('INR')) {
    notes.push(`US-listed: ${US_BANDS}`, `India-listed: ${IN_BANDS}`);
  } else {
    notes.push(basis.has('USD') ? US_BANDS : IN_BANDS);
  }

  const buckets = new Set(rows.map((r) => capBucketOf(r, caps[capKey(r)])));
  if (buckets.has(ETF) || buckets.has(COMMODITIES)) {
    notes.push('ETF: country, thematic and index funds. Commodities: gold, silver and other commodity funds.');
  }

  // Yahoo has only today's market cap. Price moves since a past statement date
  // can carry a name across a band edge, so a dated statement says which it used.
  if (asOf) notes.push(`Bands use current market capitalisation, not as of ${formatStatementDate(asOf)}.`);
  // Only listings banded in crore from another currency were FX-converted;
  // US listings band on their dollar cap directly.
  if (equities.some((r) => { const c = caps[capKey(r)]?.currency; return !!c && c !== 'INR' && c !== 'USD'; })) {
    notes.push('Non-INR market caps converted to INR at the current exchange rate.');
  }
  return notes;
}

/**
 * What a column holds, independent of its header text (the price column reads
 * 'Last Price' or 'Closing Price') and of where it lands (the family layout
 * shifts everything after Name one place right). Formulas address columns by
 * this key, so neither can point a formula at the wrong column.
 */
type ColumnKey =
  | 'srNo'
  | 'symbol'
  | 'name'
  | 'accounts'
  | 'sector'
  | 'marketCap'
  | 'quantity'
  | 'averageCost'
  | 'costTotal'
  | 'price'
  | 'value'
  | 'pl'
  | 'plPercent'
  | 'alloc';

interface ColumnSpec {
  key: ColumnKey;
  header: string;
  width: number;
  /** Undefined for the text columns, which stay left-aligned and unformatted. */
  numFmt?: string;
  align: 'left' | 'center' | 'right';
}

/**
 * The reference sheet's columns, with Sector and Market Cap beside the name
 * they describe, before the figures start.
 *
 * Quantity, average cost and price are the inputs; every other figure is a
 * formula over them, so the sheet reconciles in Excel rather than on trust.
 * %PL and %alloc are fractions under Excel's own % format, which keeps them
 * numeric and sortable in the delivered file.
 */
const BASE_COLUMNS: ColumnSpec[] = [
  { key: 'srNo', header: 'Sr No', width: 7, align: 'center' },
  { key: 'symbol', header: 'Symbol', width: 11, align: 'left' },
  { key: 'name', header: 'Name', width: 34, align: 'left' },
  { key: 'sector', header: 'Sector', width: 22, align: 'left' },
  { key: 'marketCap', header: 'Market Cap', width: 13, align: 'left' },
  { key: 'quantity', header: 'Quantity', width: 11, align: 'right', numFmt: WHOLE_NUMBER },
  { key: 'averageCost', header: 'Average Cost Basis', width: 18, align: 'right', numFmt: WHOLE_NUMBER },
  { key: 'costTotal', header: 'Cost Basis Total', width: 16, align: 'right', numFmt: WHOLE_NUMBER },
  { key: 'price', header: 'Last Price', width: 12, align: 'right', numFmt: WHOLE_NUMBER },
  { key: 'value', header: 'Current Value', width: 14, align: 'right', numFmt: WHOLE_NUMBER },
  { key: 'pl', header: 'PL', width: 11, align: 'right', numFmt: WHOLE_NUMBER },
  { key: 'plPercent', header: '%PL', width: 9, align: 'right', numFmt: WHOLE_PERCENT },
  { key: 'alloc', header: '%alloc', width: 9, align: 'right', numFmt: WHOLE_PERCENT },
];

/**
 * The "Accounts" column, inserted only into a family sheet. It sits right after
 * Name so the household's spread across mandates reads next to the name it
 * belongs to, before the figures start.
 */
const ACCOUNTS_COLUMN: ColumnSpec = { key: 'accounts', header: 'Accounts', width: 10, align: 'center' };

const NAME_COLUMN_INDEX = 3; // 1-based position of 'Name'

/**
 * What turns the sheet into a statement AS OF a past date. Absent for the
 * live export, which keeps the reference layout untouched.
 */
export interface StatementOptions {
  /** YYYY-MM-DD the positions and prices are as of. */
  asOf?: string;
  /**
   * Lines printed under the TOTAL — chiefly the positions whose price is not a
   * verified close for the date. A client statement discloses those rather
   * than printing them as though they were market prices.
   */
  notes?: string[];
  /**
   * Market caps keyed by full Yahoo symbol (see `HoldingsExportRow.ticker`).
   * When present, a small/mid/large-cap table prints beside the sector table;
   * when absent it is left out rather than printed as all-unclassified.
   */
  marketCaps?: Record<string, MarketCapQuote>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * '2026-06-30' → '30 Jun 2026'. Built by hand rather than through
 * toLocaleDateString, which renders the date in the viewer's zone and locale —
 * a statement dated 30 June must not read 29 June on a machine west of UTC.
 */
export function formatStatementDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * The sheet's columns for a given variant. The individual-client layout is the
 * firm's reference sheet plus Sector and Market Cap; the family layout is that
 * same sheet with one column added, so both read as the same document.
 */
function columnsFor(variant: 'client' | 'family', asOf?: string): ColumnSpec[] {
  // On a dated statement the price column is that day's close, not the
  // latest quote, and the header says so.
  const base = asOf
    ? BASE_COLUMNS.map((c) => (c.key === 'price' ? { ...c, header: 'Closing Price', width: 14 } : c))
    : BASE_COLUMNS;
  if (variant === 'client') return base;
  return [...base.slice(0, NAME_COLUMN_INDEX), ACCOUNTS_COLUMN, ...base.slice(NAME_COLUMN_INDEX)];
}

/** 1 → 'A', 27 → 'AA'. */
function columnLetter(index: number): string {
  let letters = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

/** A formula cell with its cached result, which viewers that never recalculate display as-is. */
function formula(expression: string, result: number): ExcelJS.CellFormulaValue {
  return { formula: expression, result };
}

/** The value each row's cells carry, by column; a key the layout lacks is skipped. */
type RowCells = Partial<Record<ColumnKey, ExcelJS.CellValue>>;

/**
 * Where everything lands on the holdings sheet, fixed before any cell is
 * written: every position's %alloc divides by a row below it, so that row's
 * address has to be known first.
 */
interface SheetLayout {
  columns: ColumnSpec[];
  /** Column letter for a key, e.g. 'J' for Current Value on the client layout. */
  col: (key: ColumnKey) => string;
  /** 1-based column index for a key. */
  index: (key: ColumnKey) => number;
  firstPositionRow: number;
  /** Below `firstPositionRow` when there are no positions. */
  lastPositionRow: number;
  cashRow: number | null;
  /** Last row of positions-plus-cash: the range the TOTAL and both tables sum over. */
  lastBookRow: number;
  totalRow: number;
  /** The line carrying the whole portfolio's value on a selection; null for a whole book. */
  fullPortfolioRow: number | null;
  /** Absolute reference every weight on the sheet divides by. */
  denominatorRef: string;
}

function layoutFor(
  columns: ColumnSpec[],
  positionCount: number,
  hasCash: boolean,
  isSelection: boolean
): SheetLayout {
  const letters = new Map(columns.map((c, i) => [c.key, columnLetter(i + 1)]));
  const col = (key: ColumnKey) => {
    const letter = letters.get(key);
    if (!letter) throw new Error(`Holdings sheet has no '${key}' column`);
    return letter;
  };

  const firstPositionRow = 2; // under the header
  const lastPositionRow = firstPositionRow + positionCount - 1;
  const cashRow = hasCash ? lastPositionRow + 1 : null;
  const lastBookRow = cashRow ?? lastPositionRow;
  const totalRow = lastBookRow + 1;
  const fullPortfolioRow = isSelection ? totalRow + 1 : null;

  return {
    columns,
    col,
    index: (key) => columns.findIndex((c) => c.key === key) + 1,
    firstPositionRow,
    lastPositionRow,
    cashRow,
    lastBookRow,
    totalRow,
    fullPortfolioRow,
    denominatorRef: `$${col('value')}$${fullPortfolioRow ?? totalRow}`,
  };
}

/**
 * The value of the portfolio every weight on the sheet is a share of — cash
 * included, per the firm's reporting basis.
 *
 * Usually that is the sheet's own TOTAL: the rows plus cash. But the desk and
 * the client portal both export whatever the table shows, and a search or
 * selection hands over a subset whose weights are still shares of the whole
 * book. Dividing those by the subset would quietly rebase every percentage, so
 * the whole book's value is recovered from the caller's own weights (value ÷
 * weight) and the sheet prints it as a line of its own to divide by.
 *
 * Only a larger implied value counts: one at or below the sheet's own total is
 * the whole book, give or take rounding, or a caller that weighted against
 * invested value alone, which the cash-inclusive TOTAL already corrects.
 */
function portfolioDenominator(
  rows: HoldingsExportRow[],
  cashBalance: number
): { value: number; isSelection: boolean } {
  const positionsValue = rows.reduce((s, r) => s + r.currentValue, 0);
  const sheetTotal = positionsValue + cashBalance;
  const weight = rows.reduce((s, r) => s + r.allocPercent, 0) / 100;
  if (positionsValue <= 0 || weight <= 0) return { value: sheetTotal, isSelection: false };

  const implied = positionsValue / weight;
  return implied - sheetTotal > Math.max(1, sheetTotal * 1e-6)
    ? { value: implied, isSelection: true }
    : { value: sheetTotal, isSelection: false };
}

/**
 * Each row with cost, value and P&L worked exactly as the sheet's formulas
 * work them, so the cached results a non-recalculating viewer shows, the
 * gain/loss tints, the gradient and the allocation tables all agree with what
 * Excel computes on open. Callers already derive their figures this way, so
 * this changes nothing but floating-point noise.
 */
function asSheetComputes(rows: HoldingsExportRow[], portfolioValue: number): HoldingsExportRow[] {
  return rows.map((r) => {
    const costBasisTotal = r.quantity * r.averageCostBasis;
    const currentValue = r.quantity * r.lastPrice;
    const pl = currentValue - costBasisTotal;
    return {
      ...r,
      costBasisTotal,
      currentValue,
      pl,
      plPercent: costBasisTotal === 0 ? 0 : (pl / costBasisTotal) * 100,
      allocPercent: portfolioValue > 0 ? (currentValue / portfolioValue) * 100 : 0,
    };
  });
}

/**
 * A client's positions laid out as the firm's reference sheet: Perpetua
 * throughout, whole numbers, percent-formatted return and weight columns, and
 * a green gradient down the allocation column so the largest position reads
 * darkest. Rows are written in the order given — the caller sorts by current
 * value, which is the same ordering as allocation.
 *
 * Every derived figure is a live formula — cost, value, P&L, %PL and %alloc on
 * each line, the TOTAL, and both allocation tables (SUMIF over the Sector and
 * Market Cap columns) — so the reader can reconcile the sheet in Excel.
 *
 * `cashBalance` is the client's idle cash. When present it is written as its
 * own line below the positions and folded into the TOTAL, so the sheet foots to
 * the actual portfolio value and the weights sum to 100%.
 */
export function buildClientHoldingsWorkbook(
  clientName: string,
  rows: HoldingsExportRow[],
  cashBalance = 0,
  variant: 'client' | 'family' = 'client',
  options: StatementOptions = {}
): ExcelJS.Workbook {
  const denominator = portfolioDenominator(rows, cashBalance);
  const book = asSheetComputes(rows, denominator.value);
  const layout = layoutFor(
    columnsFor(variant, options.asOf),
    book.length,
    cashBalance > 0,
    denominator.isSelection
  );
  const { columns } = layout;
  const caps = options.marketCaps;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Giriraj Global Consultants';
  wb.created = new Date();
  // Have Excel recompute every formula on open rather than trust the cached
  // results written here.
  wb.calcProperties.fullCalcOnLoad = true;

  const sheetName = variant === 'family' ? 'Family Holdings' : 'Holdings';
  // Sheet names cap at 31 characters; 'Family Holdings 30 Sep 2026' is 27.
  const sheet = wb.addWorksheet(options.asOf ? `${sheetName} ${formatStatementDate(options.asOf)}` : sheetName, {
    views: [{ showGridLines: false }],
  });
  sheet.columns = columns.map((c) => ({ width: c.width }));

  const headerRow = sheet.addRow(columns.map((c) => c.header));
  headerRow.height = 20;
  headerRow.eachCell((cell, col) => {
    cell.font = { name: FONT_NAME, size: HEADING_SIZE, bold: true };
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
    cell.alignment = {
      horizontal: columns[col - 1].align === 'left' ? 'left' : 'center',
      vertical: 'middle',
    };
  });

  const c = layout.col;
  const weightOf = (r: number, result: number) => formula(`${c('value')}${r}/${layout.denominatorRef}`, result);

  book.forEach((row, i) => {
    const r = layout.firstPositionRow + i;
    const quote = caps?.[capKey(row)];
    const added = writeLine(sheet, layout, {
      srNo: row.srNo,
      symbol: row.symbol,
      name: row.name,
      accounts: row.accounts ?? 1,
      sector: sectorOf(row, quote),
      // Without quotes the band is unknown; blank says so, where 'Unclassified'
      // would claim every equity had been looked at.
      marketCap: caps ? capBucketOf(row, quote) : null,
      quantity: row.quantity,
      averageCost: row.averageCostBasis,
      costTotal: formula(`${c('quantity')}${r}*${c('averageCost')}${r}`, row.costBasisTotal),
      price: row.lastPrice,
      value: formula(`${c('quantity')}${r}*${c('price')}${r}`, row.currentValue),
      pl: formula(`${c('value')}${r}-${c('costTotal')}${r}`, row.pl),
      plPercent: formula(
        `IF(${c('costTotal')}${r}=0,0,${c('pl')}${r}/${c('costTotal')}${r})`,
        row.plPercent / 100
      ),
      alloc: weightOf(r, row.allocPercent / 100),
    });

    // %PL reads green on a gain and red on a loss, as in the reference sheet.
    added.getCell(layout.index('plPercent')).fill = row.pl >= 0 ? GAIN_FILL : LOSS_FILL;
  });

  applyAllocationGradient(sheet, layout, book);
  if (layout.cashRow !== null) addCashRow(sheet, layout, book.length, cashBalance, denominator.value);
  addTotalRow(sheet, layout, book, cashBalance, denominator.value);
  if (layout.fullPortfolioRow !== null) addFullPortfolioRow(sheet, layout, denominator.value);
  addStatementNotes(sheet, [
    ...(options.asOf ? [`Positions and closing prices as of ${formatStatementDate(options.asOf)}.`] : []),
    ...(denominator.isSelection
      ? ['Selected positions only; %alloc and % of Portfolio are shares of the full portfolio value.']
      : []),
    ...(options.notes ?? []),
  ]);

  // The two allocation tables share their top row, side by side, one blank
  // row below the positions so that table stays a clean range of its own.
  // Each line is a SUMIF over the matching column above, against the same
  // denominator as %alloc, so table and holdings reconcile cell for cell.
  const blocksTop = sheet.rowCount + 2;
  const source = (classifiedBy: ColumnKey): TableSource => ({
    classColumn: c(classifiedBy),
    valueColumn: c('value'),
    firstRow: layout.firstPositionRow,
    lastRow: layout.lastBookRow,
    denominatorRef: layout.denominatorRef,
  });
  writeAllocationTable(sheet, blocksTop, SECTOR_FIRST_COL, source('sector'), {
    title: 'Sector Allocation',
    labelHeader: 'Sector',
    slices: buildSectorSlices(book, cashBalance, denominator.value, caps),
    minWidths: [14, 13, 15],
  });
  if (caps) {
    writeAllocationTable(sheet, blocksTop, MARKET_CAP_FIRST_COL, source('marketCap'), {
      title: 'Market Cap Allocation',
      labelHeader: 'Market Cap',
      slices: buildMarketCapSlices(book, cashBalance, denominator.value, caps),
      footnotes: marketCapFootnotes(book, caps, options.asOf),
      minWidths: [14, 13, 15],
    });
  }

  return wb;
}

/**
 * Appends one bordered line to the holdings block, each cell placed by column
 * key and styled from its column's spec. Number formats apply only where a
 * cell holds something, so a blank stays blank rather than reading as 0.
 */
function writeLine(
  sheet: ExcelJS.Worksheet,
  layout: SheetLayout,
  cells: RowCells,
  style: { italic?: boolean; bold?: boolean; totalRule?: boolean } = {}
): ExcelJS.Row {
  const { columns } = layout;
  const row = sheet.addRow(columns.map((c) => cells[c.key] ?? null));
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    const spec = columns[col - 1];
    cell.font = { name: FONT_NAME, size: BODY_SIZE, italic: !!style.italic, bold: !!style.bold };
    cell.border = style.totalRule
      ? { ...THIN_BORDER, top: { style: 'medium', color: { argb: 'FF000000' } } }
      : THIN_BORDER;
    cell.alignment = { horizontal: spec.align, vertical: 'middle' };
    if (spec.numFmt && cell.value !== null) cell.numFmt = spec.numFmt;
  });
  return row;
}

/**
 * Idle cash as a line of its own. It carries a current value and a weight but
 * no cost basis or P&L — cash isn't a position that can gain or lose, so those
 * columns stay blank rather than reading as a flat 0% return. Deliberately not
 * part of the gradient above, which ranks the invested names against each other.
 *
 * Its Sector and Market Cap read 'Cash', which is what both allocation tables'
 * Cash lines SUMIF on.
 */
function addCashRow(
  sheet: ExcelJS.Worksheet,
  layout: SheetLayout,
  positionCount: number,
  cashBalance: number,
  portfolioValue: number
): void {
  const r = layout.cashRow as number;
  const row = writeLine(
    sheet,
    layout,
    {
      srNo: positionCount + 1,
      symbol: 'CASH',
      name: 'Cash & Equivalents',
      sector: CASH,
      marketCap: CASH,
      value: cashBalance,
      alloc: formula(
        `${layout.col('value')}${r}/${layout.denominatorRef}`,
        portfolioValue > 0 ? cashBalance / portfolioValue : 0
      ),
    },
    { italic: true }
  );

  // A neutral fill keeps the cash weight legible without implying it belongs on
  // the green scale used to rank the invested positions.
  row.getCell(layout.index('alloc')).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF0F0F0' },
  };
}

/**
 * Shades the %alloc column from a pale to a deep green. Written as explicit
 * per-cell fills rather than a conditional-formatting rule so the gradient
 * survives in viewers that don't evaluate colour scales (Google Sheets
 * imports, Numbers, most PDF converters). The weights come from the rows, not
 * the cells, which now hold formulas.
 */
function applyAllocationGradient(
  sheet: ExcelJS.Worksheet,
  layout: SheetLayout,
  book: HoldingsExportRow[]
): void {
  if (book.length === 0) return;

  const values = book.map((r) => r.allocPercent);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min;
  const allocColumn = layout.index('alloc');

  values.forEach((value, i) => {
    // A single position (or an all-equal book) has no spread to shade across,
    // so it takes the full-strength green rather than dividing by zero.
    const t = span > 0 ? (value - min) / span : 1;
    sheet.getRow(layout.firstPositionRow + i).getCell(allocColumn).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: greenAt(t) },
    };
  });
}

/**
 * Interpolates between the lightest and darkest green of the scale. `t` runs
 * 0 (smallest weight) to 1 (largest).
 */
function greenAt(t: number): string {
  const light = { r: 0xe8, g: 0xf5, b: 0xe9 };
  const dark = { r: 0x4c, g: 0xaf, b: 0x50 };
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  const hex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  return `FF${hex(mix(light.r, dark.r))}${hex(mix(light.g, dark.g))}${hex(mix(light.b, dark.b))}`;
}

/**
 * Bold TOTAL line summing the money columns, ruled off from the positions.
 * Current value includes cash so the sheet foots to the portfolio value the
 * client sees; cost basis and P&L stay invested-only, which keeps the return
 * percentage a statement about the portfolio's performance rather than one
 * diluted by an uninvested balance.
 */
function addTotalRow(
  sheet: ExcelJS.Worksheet,
  layout: SheetLayout,
  book: HoldingsExportRow[],
  cashBalance: number,
  portfolioValue: number
): void {
  const totals = book.reduce(
    (acc, r) => ({
      costBasisTotal: acc.costBasisTotal + r.costBasisTotal,
      currentValue: acc.currentValue + r.currentValue,
      pl: acc.pl + r.pl,
    }),
    { costBasisTotal: 0, currentValue: 0, pl: 0 }
  );
  const bookValue = totals.currentValue + cashBalance;

  const { col, firstPositionRow: first, totalRow: t } = layout;
  // A SUM down the column through `last`; a plain figure when that range is
  // empty (a cash-only sheet has no positions to sum cost or P&L over).
  const sum = (key: ColumnKey, last: number, result: number) =>
    last >= first ? formula(`SUM(${col(key)}${first}:${col(key)}${last})`, result) : result;

  writeLine(
    sheet,
    layout,
    {
      name: 'TOTAL',
      costTotal: sum('costTotal', layout.lastPositionRow, totals.costBasisTotal),
      value: sum('value', layout.lastBookRow, bookValue),
      pl: sum('pl', layout.lastPositionRow, totals.pl),
      // Book-level return, computed off the totals rather than averaging the
      // per-row percentages, which would weight a tiny position like a large one.
      plPercent: formula(
        `IF(${col('costTotal')}${t}=0,0,${col('pl')}${t}/${col('costTotal')}${t})`,
        totals.costBasisTotal ? totals.pl / totals.costBasisTotal : 0
      ),
      alloc: sum('alloc', layout.lastBookRow, portfolioValue > 0 ? bookValue / portfolioValue : 0),
    },
    { bold: true, totalRule: true }
  );
}

/**
 * On a selection, the whole portfolio's value as a line of its own under the
 * TOTAL: the figure every %alloc and every table weight divides by. It is the
 * one hard-coded value in the derived figures, because the positions it
 * covers beyond the selection are not on the sheet.
 */
function addFullPortfolioRow(sheet: ExcelJS.Worksheet, layout: SheetLayout, portfolioValue: number): void {
  writeLine(sheet, layout, { name: 'Full Portfolio Value', value: portfolioValue }, { italic: true });
}

/**
 * Plain italic lines under the TOTAL: the statement date, then any disclosure.
 * Written in the Name column, which is wide enough to read and sits beside the
 * figures they qualify.
 */
function addStatementNotes(sheet: ExcelJS.Worksheet, notes: string[]): void {
  for (const note of notes) {
    const leading: null[] = Array(NAME_COLUMN_INDEX - 1).fill(null);
    const row = sheet.addRow([...leading, note]);
    const cell = row.getCell(NAME_COLUMN_INDEX);
    cell.font = { name: FONT_NAME, size: BODY_SIZE, italic: true };
    cell.alignment = { horizontal: 'left', vertical: 'middle' };
  }
}

/**
 * The allocation tables below the TOTAL. Deliberately table-only — a pie
 * beside them repeated the same numbers.
 *
 * The sector table starts at column C rather than A: the narrow 'Sr No' and
 * 'Symbol' widths above clipped the sector names, whereas column C carries the
 * wide 'Name' width and gives every label room to read in full. The market-cap
 * table sits to its right after one blank column, on the same rows, so both
 * read as one panel.
 */
const SECTOR_FIRST_COL = 3;
const MARKET_CAP_FIRST_COL = SECTOR_FIRST_COL + 4;

/**
 * Where an allocation table's lines read from on the holdings block above:
 * each line's value is a SUMIF of `valueColumn` over the rows whose
 * `classColumn` matches the line's label.
 */
interface TableSource {
  /** Holdings column the table classifies by: Sector or Market Cap. */
  classColumn: string;
  valueColumn: string;
  firstRow: number;
  /** Includes the cash line, whose classification reads 'Cash'. */
  lastRow: number;
  /** The same absolute reference the %alloc column divides by. */
  denominatorRef: string;
}

interface AllocationTable {
  title: string;
  /** Header over the label column ('Sector', 'Market Cap'). */
  labelHeader: string;
  slices: SectorSlice[];
  /** Italic lines under the table's TOTAL. */
  footnotes?: string[];
  /**
   * Minimum widths for the label, value and weight columns. The table borrows
   * columns sized for the positions above; where those are narrower than its
   * own headers, they are widened rather than letting '% of Portfolio' clip.
   */
  minWidths?: [number, number, number];
}

/**
 * Writes one allocation table — heading, column headers, a row per slice with
 * a colour swatch on its label, and a ruled TOTAL — with its top-left corner at
 * (`topRow`, `firstCol`). Written cell by cell rather than appended, so two
 * tables can share the same rows.
 *
 * Every figure is a formula: each line's value a SUMIF over the holdings
 * block on its own label cell, its weight that value over the portfolio
 * denominator, and the TOTAL a SUM of the lines. A TOTAL that foots to the
 * holdings' Current Value proves every position landed on some line.
 */
function writeAllocationTable(
  sheet: ExcelJS.Worksheet,
  topRow: number,
  firstCol: number,
  source: TableSource,
  table: AllocationTable
): void {
  const { slices } = table;
  if (slices.length === 0) return;

  const [labelCol, valueCol, weightCol] = [firstCol, firstCol + 1, firstCol + 2];
  const [labelLetter, valueLetter, weightLetter] = [labelCol, valueCol, weightCol].map(columnLetter);
  const classRange = `$${source.classColumn}$${source.firstRow}:$${source.classColumn}$${source.lastRow}`;
  const valueRange = `$${source.valueColumn}$${source.firstRow}:$${source.valueColumn}$${source.lastRow}`;

  if (table.minWidths) {
    table.minWidths.forEach((min, i) => {
      const column = sheet.getColumn(firstCol + i);
      column.width = Math.max(column.width ?? 0, min);
    });
  }

  /** Writes [label, value, weight] across the table's three columns on `rowNumber`. */
  const writeRow = (
    rowNumber: number,
    values: [string, ExcelJS.CellValue, ExcelJS.CellValue],
    style: { bold?: boolean; header?: boolean; totalRule?: boolean }
  ) => {
    const row = sheet.getRow(rowNumber);
    values.forEach((value, i) => {
      const col = firstCol + i;
      const cell = row.getCell(col);
      cell.value = value;
      cell.font = { name: FONT_NAME, size: BODY_SIZE, bold: !!style.bold };
      cell.border = style.totalRule
        ? { ...THIN_BORDER, top: { style: 'medium', color: { argb: 'FF000000' } } }
        : THIN_BORDER;
      cell.alignment = {
        horizontal: col === labelCol ? 'left' : style.header ? 'center' : 'right',
        vertical: 'middle',
      };
      if (!style.header && col === valueCol) cell.numFmt = WHOLE_NUMBER;
      if (!style.header && col === weightCol) cell.numFmt = WHOLE_PERCENT;
    });
    return row;
  };

  const headingRow = sheet.getRow(topRow);
  const headingCell = headingRow.getCell(labelCol);
  headingCell.value = table.title;
  headingCell.font = { name: FONT_NAME, size: HEADING_SIZE, bold: true };
  headingRow.height = 20;

  writeRow(topRow + 1, [table.labelHeader, 'Value', '% of Portfolio'], { bold: true, header: true });

  const firstSliceRow = topRow + 2;
  slices.forEach((slice, i) => {
    const r = firstSliceRow + i;
    const row = writeRow(
      r,
      [
        slice.label,
        formula(`SUMIF(${classRange},${labelLetter}${r},${valueRange})`, slice.value),
        formula(`${valueLetter}${r}/${source.denominatorRef}`, slice.weight),
      ],
      {}
    );
    // A colour swatch on the label cell so each slice reads at a glance.
    row.getCell(labelCol).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${slice.color}` },
    };
  });

  const lastSliceRow = firstSliceRow + slices.length - 1;
  const totalRowNumber = lastSliceRow + 1;
  writeRow(
    totalRowNumber,
    [
      'TOTAL',
      formula(
        `SUM(${valueLetter}${firstSliceRow}:${valueLetter}${lastSliceRow})`,
        slices.reduce((s, x) => s + x.value, 0)
      ),
      formula(
        `SUM(${weightLetter}${firstSliceRow}:${weightLetter}${lastSliceRow})`,
        slices.reduce((s, x) => s + x.weight, 0)
      ),
    ],
    { bold: true, totalRule: true }
  );

  (table.footnotes ?? []).forEach((note, i) => {
    const cell = sheet.getRow(totalRowNumber + 1 + i).getCell(labelCol);
    cell.value = note;
    cell.font = { name: FONT_NAME, size: BODY_SIZE - 1, italic: true };
    cell.alignment = { horizontal: 'left', vertical: 'middle' };
  });
}

/** Builds the workbook and hands it to the browser as an .xlsx download. */
export async function downloadClientHoldingsWorkbook(
  clientName: string,
  rows: HoldingsExportRow[],
  cashBalance = 0,
  options: StatementOptions = {}
): Promise<void> {
  const withCaps = await withMarketCaps(rows, options);
  const wb = buildClientHoldingsWorkbook(clientName, rows, cashBalance, 'client', withCaps);
  await saveWorkbook(wb, `${slugify(clientName)}-holdings${asOfSuffix(options)}.xlsx`);
}

/**
 * `options` with market caps for every row filled in, unless the caller
 * already supplied them. A failed lookup leaves them out and the workbook
 * drops the size-band table: the holdings are what the advisor came for, and
 * an outage at the quote source shouldn't block the export — nor should it
 * print a table claiming the whole book is unclassified.
 */
async function withMarketCaps(
  rows: HoldingsExportRow[],
  options: StatementOptions
): Promise<StatementOptions> {
  if (options.marketCaps || rows.length === 0) return options;
  try {
    const marketCaps = await marketApi.marketCaps([...new Set(rows.map(capKey))]);
    return { ...options, marketCaps };
  } catch (err) {
    console.warn('Market caps unavailable; exporting without the market-cap table', err);
    return options;
  }
}

/**
 * The merged household portfolio in the firm's reference format — the same
 * sheet an individual client gets (borders, Perpetua, whole numbers, the %PL
 * gain/loss tints, the allocation gradient and the sector and market-cap tables),
 * plus an "Accounts" column showing how many of the household's
 * mandates hold each name.
 *
 * `cashBalance` is the household's combined cash across every member account,
 * so the sheet foots to the same portfolio value the family drawer reports.
 */
export async function downloadFamilyHoldingsWorkbook(
  familyName: string,
  rows: HoldingsExportRow[],
  cashBalance = 0,
  options: StatementOptions = {}
): Promise<void> {
  const withCaps = await withMarketCaps(rows, options);
  const wb = buildClientHoldingsWorkbook(familyName, rows, cashBalance, 'family', withCaps);
  await saveWorkbook(wb, `${slugify(familyName)}-family-holdings${asOfSuffix(options)}.xlsx`);
}

function asOfSuffix(options: StatementOptions): string {
  return options.asOf ? `-as-of-${options.asOf}` : '';
}

function slugify(name: string): string {
  return name.replace(/\s+/g, '_').toLowerCase();
}

async function saveWorkbook(wb: ExcelJS.Workbook, filename: string): Promise<void> {
  applyWorkbookFont(wb);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
