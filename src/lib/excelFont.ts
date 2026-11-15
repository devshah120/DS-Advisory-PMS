import type ExcelJS from 'exceljs';

/**
 * The firm's typeface for every generated workbook.
 *
 * Excel does not embed fonts; Perpetua ships with Microsoft Office, so a
 * recipient on Office sees it, and anyone without it gets Excel's substitute.
 */
export const EXCEL_FONT = 'Perpetua';

/** Body cells. */
export const EXCEL_BODY_SIZE = 11;
/** Panel and table headers (bold). */
export const EXCEL_HEADER_SIZE = 12;
/** Title banners (bold). */
export const EXCEL_TITLE_SIZE = 16;

/**
 * Sets Perpetua on every written cell of every worksheet, keeping each cell's
 * own size, weight, slant and colour; cells with no size get the body size.
 *
 * Run last, just before the workbook is serialised, so no builder can leave a
 * cell in Calibri by forgetting to name the font.
 */
export function applyWorkbookFont(wb: ExcelJS.Workbook): void {
  wb.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        const font = cell.font ?? {};
        cell.font = { ...font, name: EXCEL_FONT, size: font.size ?? EXCEL_BODY_SIZE };
      });
    });
  });
}
