// Ctrl + drag across rows selects a rectangular range of cells.
// Ctrl + drag within a row selects whole columns; Ctrl + click toggles columns.
let selectedTableColumns = null;
let columnDrag = null;
let suppressColumnClick = false;
let tableScrollFrame = 0;

preview.addEventListener('pointerover', event => {
  const table = event.target.closest?.('table');
  if (table && !table.title) table.title = '按住 Ctrl 点击选整列，拖动可选多列或部分行；Ctrl+C 复制';
});

function clearTableColumnSelection() {
  if (selectedTableColumns) {
    selectedTableColumns.table.querySelectorAll('.mdvw-column-selected').forEach(
      cell => cell.classList.remove('mdvw-column-selected')
    );
    selectedTableColumns.table.classList.remove('mdvw-column-dragging');
  }
  selectedTableColumns = null;
  columnDrag = null;
  cancelAnimationFrame(tableScrollFrame);
  tableScrollFrame = 0;
}

function firstLogicalColumn(cell) {
  let column = 0;
  for (const sibling of cell.parentElement.cells) {
    if (sibling === cell) return column;
    column += Math.max(1, sibling.colSpan || 1);
  }
  return column;
}

function paintTableColumns() {
  if (!selectedTableColumns) return;
  const { table, columns, rows } = selectedTableColumns;
  for (const row of table.rows) {
    let column = 0;
    for (const cell of row.cells) {
      const next = column + Math.max(1, cell.colSpan || 1);
      let selected = false;
      for (let index = column; index < next; index++) {
        if (columns.has(index)) { selected = true; break; }
      }
      cell.classList.toggle('mdvw-column-selected', selected &&
        (!rows || row.rowIndex >= rows.start && row.rowIndex <= rows.end));
      column = next;
    }
  }
}

function selectedColumnsAsTsv() {
  if (!selectedTableColumns) return '';
  const { table, columns: selected, rows: selectedRows } = selectedTableColumns;
  const wantedColumns = [...selected].sort((a, b) => a - b);
  const rows = [];
  for (const row of table.rows) {
    if (selectedRows && (row.rowIndex < selectedRows.start || row.rowIndex > selectedRows.end)) continue;
    const columns = [];
    for (const wanted of wantedColumns) {
      let position = 0;
      let value = '';
      for (const cell of row.cells) {
        const next = position + Math.max(1, cell.colSpan || 1);
        if (wanted >= position && wanted < next) {
          value = (cell.innerText || cell.textContent || '').replace(/\s+/g, ' ').trim();
          break;
        }
        position = next;
      }
      columns.push(value);
    }
    rows.push(columns.join('\t'));
  }
  return rows.join('\r\n');
}

preview.addEventListener('pointerdown', event => {
  if (currentMode !== 'read' || !event.ctrlKey || event.button !== 0) return;
  const cell = event.target.closest?.('th,td');
  const table = cell?.closest('table');
  if (!table || !preview.contains(table)) return;
  event.preventDefault();
  const previous = selectedTableColumns?.table === table && !selectedTableColumns.rows
    ? new Set(selectedTableColumns.columns) : new Set();
  if (selectedTableColumns?.table !== table) clearTableColumnSelection();
  window.getSelection()?.removeAllRanges();
  const start = firstLogicalColumn(cell);
  const startRow = cell.parentElement.rowIndex;
  selectedTableColumns = { table, columns: new Set(previous), rows: null };
  selectedTableColumns.columns.add(start);
  columnDrag = { pointerId: event.pointerId, start, end: start, startRow, endRow: startRow,
    x: event.clientX, y: event.clientY,
    previous, moved: false };
  suppressColumnClick = true;
  table.classList.add('mdvw-column-dragging');
  preview.setPointerCapture(event.pointerId);
  preview.focus({ preventScroll: true });
  paintTableColumns();
  tableScrollFrame = requestAnimationFrame(scrollTableSelection);
});

function updateTableSelection(x, y) {
  if (!columnDrag || !selectedTableColumns) return;
  const tableRect = selectedTableColumns.table.getBoundingClientRect();
  const previewRect = preview.getBoundingClientRect();
  const cell = document.elementFromPoint(
    Math.max(tableRect.left + 1, Math.min(x, tableRect.right - 1)),
    Math.max(Math.max(tableRect.top, previewRect.top) + 1,
      Math.min(y, Math.min(tableRect.bottom, previewRect.bottom) - 1))
  )?.closest?.('th,td');
  if (!cell || cell.closest('table') !== selectedTableColumns.table) return;
  const next = firstLogicalColumn(cell);
  const nextRow = cell.parentElement.rowIndex;
  if (next === columnDrag.end && nextRow === columnDrag.endRow) return;
  columnDrag.end = next;
  columnDrag.endRow = nextRow;
  columnDrag.moved = true;
  selectedTableColumns.rows = nextRow === columnDrag.startRow ? null :
    { start: Math.min(columnDrag.startRow, nextRow), end: Math.max(columnDrag.startRow, nextRow) };
  selectedTableColumns.columns = selectedTableColumns.rows ? new Set() : new Set(columnDrag.previous);
  for (let index = Math.min(columnDrag.start, next); index <= Math.max(columnDrag.start, next); index++) {
    selectedTableColumns.columns.add(index);
  }
  paintTableColumns();
}

function scrollTableSelection() {
  if (!columnDrag) { tableScrollFrame = 0; return; }
  const rect = preview.getBoundingClientRect();
  const edge = 48;
  const tableRect = selectedTableColumns.table.getBoundingClientRect();
  const dy = columnDrag.y < rect.top + edge && tableRect.top < rect.top ? -14 :
    columnDrag.y > rect.bottom - edge && tableRect.bottom > rect.bottom ? 14 : 0;
  if (dy) {
    preview.scrollTop += dy;
    updateTableSelection(columnDrag.x, columnDrag.y);
  }
  tableScrollFrame = requestAnimationFrame(scrollTableSelection);
}

preview.addEventListener('pointermove', event => {
  if (columnDrag?.pointerId !== event.pointerId) return;
  columnDrag.x = event.clientX;
  columnDrag.y = event.clientY;
  updateTableSelection(event.clientX, event.clientY);
});

function finishTableColumnDrag(event) {
  if (columnDrag?.pointerId !== event.pointerId) return;
  if (!columnDrag.moved && selectedTableColumns) {
    selectedTableColumns.columns = new Set(columnDrag.previous);
    selectedTableColumns.rows = null;
    if (selectedTableColumns.columns.has(columnDrag.start))
      selectedTableColumns.columns.delete(columnDrag.start);
    else selectedTableColumns.columns.add(columnDrag.start);
  }
  columnDrag = null;
  cancelAnimationFrame(tableScrollFrame);
  tableScrollFrame = 0;
  if (selectedTableColumns) {
    selectedTableColumns.table.classList.remove('mdvw-column-dragging');
    if (selectedTableColumns.columns.size) {
      paintTableColumns();
      flash(selectedTableColumns.rows ? 'Cells selected · Ctrl+C to copy' :
        'Columns selected · Ctrl+C to copy');
    } else clearTableColumnSelection();
  }
  if (preview.hasPointerCapture(event.pointerId)) preview.releasePointerCapture(event.pointerId);
  setTimeout(() => { suppressColumnClick = false; }, 0);
}
preview.addEventListener('pointerup', finishTableColumnDrag);
preview.addEventListener('pointercancel', finishTableColumnDrag);

preview.addEventListener('click', event => {
  if (!suppressColumnClick) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  suppressColumnClick = false;
}, true);

document.addEventListener('pointerdown', event => {
  if (!selectedTableColumns || event.ctrlKey && selectedTableColumns.table.contains(event.target)) return;
  clearTableColumnSelection();
}, true);

document.addEventListener('copy', event => {
  if (!selectedTableColumns || !event.clipboardData) return;
  if (document.activeElement !== preview && !preview.contains(document.activeElement)) return;
  event.clipboardData.setData('text/plain', selectedColumnsAsTsv());
  event.preventDefault();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && selectedTableColumns) clearTableColumnSelection();
});
