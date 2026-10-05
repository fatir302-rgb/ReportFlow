# Real template findings - ATM Link

## Weekly format

The supplied weekly workbook is a flat detailed table:

- Sheet: `Detailed Report`
- Title: `ATM LINK - Week <ISO week> - <resource>`
- Columns: Project, Description, Start Date, Start Time, End Date, End Time, Duration (h), Duration (decimal)
- Data begins at row 4
- Entries are displayed newest first
- Cross-midnight entries use separate start/end dates, so no time is lost

Renderer: `tabular`

## Monthly format

The supplied monthly `.xlsm` is a formula-driven calendar-style timesheet:

- Sheet: `Auto Timesheet`
- Resource name at `E2`
- Month anchor at `D5`; `E3` displays the month from a formula
- `Clockify Raw` is the input sheet and `Clockify Helper` transforms it for the calendar formulas
- Each calendar date begins in a 7-row block with five base detail rows
- The template macro can expand a day when it has more than five entries
- Detail columns: Start, End, Task/Description, Type, Duration
- Daily Work totals exclude Break entries; empty weekend days display `Weekend`
- `Clockify Raw` is retained as the audit/source sheet

Renderer: `clockify_helper_calendar`

The generator uses the supplied workbook as the style/layout source, then writes final values into the visible calendar cells. The visible calendar does not depend on copied formulas or spreadsheet recalculation; date labels are text so zooming out cannot turn them into `####`. Unused detail rows are cleared/hidden and extra rows are style-copied only when a day exceeds the sample capacity. Weekend work remains visible and contributes to Work Total. The original macro contains a date-detection bug and hides weekend details, so it should not be run on generated reports. Helper sheets are used during generation but are excluded from the delivered workbook.

## Generated workbook contract

All renderers use the uploaded workbook as a presentation sample: cell styles, widths, heights, merges and layout are retained for the selected output sheet; report values are written directly from Clockify; formulas copied from the template and hidden/helper sheets are excluded. A renderer may add its own formula, such as the ATM grand-total `SUM`, when that is part of the requested output behavior. The generated container follows the report configuration (`.xlsx` or `.xlsm`), not merely the template extension.

The production generator writes final visible values directly instead of depending on Excel to recalculate template formulas. This means scheduled reports can be validated before they are emailed.

## Why renderers are separate

These two real client reports already prove that a single universal cell-mapping rule is not enough. ReportFlow therefore uses:

`normalized Clockify entries -> client/report profile -> renderer -> validation -> final file`

A future client can use a different renderer/profile without changing the Clockify connector.
