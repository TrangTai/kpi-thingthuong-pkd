// ============================================================
// RENDERER.JS - Render bảng Tính Thưởng + filter + export
// ============================================================

const fmt = {
  vnd: v => {
    if (v === null || v === undefined || isNaN(v)) return '-';
    return Math.round(v).toLocaleString('vi-VN');
  },
  // Compact: luôn dùng M (không dùng tỷ)
  vndC: v => {
    if (v === null || v === undefined || isNaN(v)) return '-';
    const n = Math.round(v), abs = Math.abs(n), s = n < 0 ? '-' : '';
    if (abs >= 1e6) return s + Math.round(abs / 1e6) + 'M';
    if (abs >= 1e3) return s + Math.round(abs / 1e3) + 'K';
    return s + abs;
  },
  pct: v => {
    if (v === null || v === undefined || isNaN(v)) return '-';
    return (v * 100).toFixed(1) + '%';
  },
  num: v => {
    if (v === null || v === undefined || isNaN(v)) return '-';
    return Math.round(v).toLocaleString('vi-VN');
  },
  hs: v => {
    if (v === null || v === undefined || isNaN(v)) return '-';
    return v.toFixed(2);
  },
};

function colorClass(ratio) {
  if (ratio === null || ratio === undefined || isNaN(ratio)) return '';
  if (ratio >= 1.15) return 'c-excellent';
  if (ratio >= 1.00) return 'c-good';
  if (ratio >= 0.60) return 'c-warn';
  return 'c-bad';
}

let _allResults = [];

function renderTable(results) {
  _allResults = results || [];
  if (!_allResults.length) return '<p style="color:#888;padding:20px">Không có dữ liệu.</p>';

  const cdMaSP  = (CONFIG.SP_CHI_DINH.maSP || '').trim();
  const cdLabel = cdMaSP ? `SP CĐ: ${cdMaSP} (≥${CONFIG.SP_CHI_DINH.soLuongTarget} cái)` : 'SP chỉ định';

  // ── Header row 1 (group headers) ──────────────────────────
  const groups = [
    { text: 'Mã TDV',              rowspan: 2, sticky: 1 },
    { text: 'Tên TDV',             rowspan: 2, sticky: 2 },
    { text: 'Khu vực',             rowspan: 2, sticky: 3 },
    { text: 'Miền',                rowspan: 2 },
    { text: 'QLBH',                rowspan: 2 },
    { text: 'Đối tượng',           rowspan: 2 },
    { text: 'KẾ HOẠCH',           span: 5, cls: 'h-plan'   },
    { text: 'HOÀN THÀNH',         span: 7, cls: 'h-actual' },
    { text: 'TỶ LỆ HOÀN THÀNH',  span: 7, cls: 'h-ratio'  },
    { text: 'TỔNG HỢP KPI',       span: 5, cls: 'h-kpi'   },
    { text: cdLabel,               span: 2, cls: 'h-spcd'  },
  ];

  // ── Header row 2 + filter/data column definitions ─────────
  // nf = numfield key, ph = filter placeholder, tip = tooltip
  const cols = [
    // KẾ HOẠCH (5)
    { text: 'DS N2 Target',   cls: 'h-plan',   nf: 'dsn2t',   ph: '>=M', key: r => r.dsN2Target,   fmt: 'vndC', compact: true, tip: 'DS Tổng Target × 50%' },
    { text: 'DS N3 Target',   cls: 'h-plan',   nf: 'dsn3t',   ph: '>=M', key: r => r.dsN3Target,   fmt: 'vndC', compact: true, tip: 'DS Tổng Target × 8% (SP mới)' },
    { text: 'DS Tổng Target', cls: 'h-plan',   nf: 'dstont',  ph: '>=M', key: r => r.dsTongTarget, fmt: 'vndC', compact: true, tip: 'Kế hoạch DS tháng (từ TARGET)' },
    { text: 'ĐPKH Target',    cls: 'h-plan',   nf: 'dpkht',   ph: '>=',  key: r => r.dpkhTarget,   fmt: 'num',  compact: true, tip: 'Kế hoạch số KH phủ' },
    { text: 'ĐPMH Target',    cls: 'h-plan',   nf: 'dpmht',   ph: '>=',  key: r => r.dpmhTarget,   fmt: 'num',  compact: true, tip: 'Kế hoạch số mặt hàng phủ' },
    // HOÀN THÀNH (7)
    { text: 'DS N2',          cls: 'h-actual', nf: 'dsn2',    ph: '>=M', key: r => r.dsN2,         fmt: 'vndC', compact: true, tip: 'DS nhóm 2 (cột Q đơn hàng), không gồm KH CT' },
    { text: 'DS N3 SP Mới',   cls: 'h-actual', nf: 'dsn3',    ph: '>=M', key: r => r.dsN3,         fmt: 'vndC', compact: true, tip: 'DS nhóm PTML 3 (cột R đơn hàng), không gồm KH CT' },
    { text: 'DS Tổng',        cls: 'h-actual', nf: 'dston',   ph: '>=M', key: r => r.dsTong,       fmt: 'vndC', compact: true, tip: 'DS cột J (Tổng tiền), không gồm KH CT' },
    { text: 'DS T+CT',        cls: 'h-actual', nf: 'dstonct', ph: '>=M', key: r => r.dsTongCT,     fmt: 'vndC', compact: true, tip: 'DS Tổng + DS khách hàng công ty' },
    { text: 'DS N15',         cls: 'h-actual', nf: 'dsn15',   ph: '>=M', key: r => r.dsDay15,      fmt: 'vndC', compact: true, tip: 'DS tính đến ngày 15 (retail + CT)' },
    { text: 'ĐPKH',           cls: 'h-actual', nf: 'dpkh',    ph: '>=',  key: r => r.dpkh,         fmt: 'num',  compact: true, tip: 'Số KH có DS ≥ 500.000đ (gồm KH CT)' },
    { text: 'ĐPMH',           cls: 'h-actual', nf: 'dpmh',    ph: '>=',  key: r => r.dpmh,         fmt: 'num',  compact: true, tip: 'Số MH có DS ≥ 500.000đ × số TDV (nhóm TP026/027/030, TB011-018 gộp)' },
    // TỶ LỆ (7)
    { text: '% DS N2',         cls: 'h-ratio',  nf: 'pn2',     ph: '>=60',  key: r => r.pctDatN2,     fmt: 'pct', scale: 100, compact: true, tip: '<100%: DS N2/(DS Tổng×50%) | ≥100%: DS N2/DS N2 Target' },
    { text: '% DS N3',         cls: 'h-ratio',  nf: 'pn3',     ph: '>=60',  key: r => r.tyLeN3,       fmt: 'pct', scale: 100, compact: true, tip: 'DS N3 / DS N3 Target (8% khoán)' },
    { text: '% DS Tổng',       cls: 'h-ratio',  nf: 'pton',    ph: '>=60',  key: r => r.tyleTong,     fmt: 'pct', scale: 100, compact: true, tip: 'DS Tổng / DS Tổng Target' },
    { text: '% DS T+CT',       cls: 'h-ratio',  nf: 'ptonct',  ph: '>=60',  key: r => r.tyleTongCT,   fmt: 'pct', scale: 100, compact: true, tip: 'DS Tổng+CT / DS Tổng Target' },
    { text: '% ĐPKH',          cls: 'h-ratio',  nf: 'pdpkh',   ph: '>=60',  key: r => r.tyleDPKH,     fmt: 'pct', scale: 100, compact: true, tip: 'ĐPKH / ĐPKH Target' },
    { text: '% ĐPMH',          cls: 'h-ratio',  nf: 'pdpmh',   ph: '>=60',  key: r => r.tyleDPMH,     fmt: 'pct', scale: 100, compact: true, tip: 'ĐPMH / ĐPMH Target' },
    { text: '% DS N15',        cls: 'h-ratio',  nf: 'pn15',    ph: '>=50',  key: r => r.tyLeDay15,    fmt: 'pct', scale: 100, compact: true, tip: 'DS N15 / DS Tổng Target' },
    // TỔNG HỢP KPI (5)
    { text: 'PTML',            cls: 'h-kpi',    nf: 'ptml',    ph: '>=60',  key: r => r.ptml,         fmt: 'pct', scale: 100, compact: true, tip: '%N3×10% + %DS Tổng×0% + %DS Tổng+CT×60% + %ĐPKH×15% + %ĐPMH×15%' },
    { text: '% Đạt N2',        cls: 'h-kpi',    nf: 'datn2',   ph: '>=60',  key: r => r.pctDatN2,     fmt: 'pct', scale: 100, compact: true, tip: '= % DS N2 (dùng cho lookup Hs ảnh hưởng N1)' },
    { text: 'Hs N1',           cls: 'h-kpi',    nf: 'hn1',     ph: '>=0.8', key: r => r.hsAnhHuongN1, fmt: 'hs',  compact: true, tip: 'Hs ảnh hưởng N1: <60%→0.7 | 60%→0.8 | 80%→0.9 | ≥100%→1.0' },
    { text: 'HSHT',            cls: 'h-kpi',    nf: 'hsht',    ph: '>=1',   key: r => r.hsht,         fmt: 'hs',  compact: true, tip: 'TDV: 0%→0|60%→0.6|80%→0.8|100%→1.0|115%→1.1|125%→1.2|135%→1.3\nQLBH: 0%→0|60%→0.5|80%→0.65|90%→0.8|100%→1.0|110%→1.28|120%→1.5' },
    { text: 'Hs KH CT',        cls: 'h-kpi',    nf: 'hsct',    ph: '>=0.8', key: r => r.hsKhCT,       fmt: 'hs',  compact: true, tip: 'DS CT=0→1.0 | ≥200M→0.8 | ≥400M→0.7' },
    // SP CHỈ ĐỊNH (2)
    { text: 'SL SP CĐ',        cls: 'h-spcd',   nf: 'slspcd',  ph: '>=5',   key: r => r.soLuongSpCd || 0, fmt: 'num', compact: true, tip: `Số lượng ${cdMaSP || 'SP chỉ định'} đã bán` },
    { text: 'Đạt SP CĐ',       cls: 'h-spcd',   nf: 'datspcd', ph: '>=1',   key: r => r.datSpCd === true ? 1 : 0, fmt: '_spcd', compact: true, tip: `Đạt ≥ ${CONFIG.SP_CHI_DINH.soLuongTarget} cái ${cdMaSP || ''}` },
  ];

  let html = `
<div class="table-toolbar">
  <span style="color:#888">Zoom:</span>
  <button class="btn-zoom" onclick="kpiZoom(-10)">−</button>
  <span id="kpi-zoom-pct" style="min-width:36px;text-align:center;display:inline-block">100%</span>
  <button class="btn-zoom" onclick="kpiZoom(10)">+</button>
  <button class="btn-zoom btn-zoom-fit" onclick="kpiZoom(0)" title="Tự động thu nhỏ cho vừa màn hình">⊡ Vừa màn hình</button>
  <button class="btn-zoom" onclick="kpiZoom(null)" title="Đặt lại 100%">↺ 100%</button>
  <span style="color:#aaa;margin-left:8px">Số tiền hiển thị rút gọn · rê chuột để xem đầy đủ</span>
</div>
<div class="table-wrap"><table class="kpi-table"><thead>`;

  // Header row 1
  html += '<tr>';
  for (const g of groups) {
    const rs  = g.rowspan === 2 ? ' rowspan="2"' : '';
    const cs  = g.span > 1 ? ` colspan="${g.span}"` : '';
    const sc  = g.sticky ? ` sc-${g.sticky}` : '';
    const cls = [g.cls || '', sc].filter(Boolean).join(' ');
    const tip = g.tip ? ` title="${g.tip}"` : '';
    html += `<th${rs}${cs} class="${cls}"${tip}>${g.text}</th>`;
  }
  html += '</tr>';

  // Header row 2
  html += '<tr>';
  for (const c of cols) {
    const tip = c.tip ? ` title="${c.tip}"` : '';
    const compactCls = c.compact ? ' th-compact' : '';
    html += `<th class="${c.cls || ''}${compactCls}"${tip}>${c.text}</th>`;
  }
  html += '</tr>';

  // Filter row
  const doiTuongVals = [...new Set(_allResults.map(r => r.doiTuong).filter(Boolean))].sort();
  const mienVals     = [...new Set(_allResults.map(r => r.mien).filter(Boolean))].sort();
  const qlbhVals     = [...new Set(_allResults.map(r => r.qlbh).filter(Boolean))].sort();

  html += '<tr class="filter-row" id="filter-row">';
  html += `<td class="sc-1"><input size="1" class="filter-inp" placeholder="Mã..." oninput="filterTable()" data-field="maTDV"></td>`;
  html += `<td class="sc-2"><input size="1" class="filter-inp" placeholder="Tên..." oninput="filterTable()" data-field="tenTDV"></td>`;
  html += `<td class="sc-3"><input size="1" class="filter-inp" placeholder="KV..." oninput="filterTable()" data-field="khuVuc"></td>`;
  html += `<td><select class="filter-sel" onchange="filterTable()" data-field="mien"><option value="">—</option>${mienVals.map(v => `<option>${v}</option>`).join('')}</select></td>`;
  html += `<td><select class="filter-sel" onchange="filterTable()" data-field="qlbh"><option value="">—</option>${qlbhVals.map(v => `<option>${v}</option>`).join('')}</select></td>`;
  html += `<td style="white-space:nowrap">
    <select class="filter-sel" style="width:auto;min-width:0" onchange="filterTable()" data-field="doiTuong">
      <option value="">—</option>${doiTuongVals.map(v => `<option>${v}</option>`).join('')}
    </select>
    <button class="btn-clear-filter" onclick="clearFilters()" title="Xóa tất cả lọc">✕</button>
    <span id="filter-count" style="font-size:10px;color:#888"></span>
  </td>`;
  for (const c of cols) {
    html += `<td><input size="1" class="filter-num" placeholder="${c.ph}" oninput="filterTable()" data-numfield="${c.nf}" title=">=, <=, >, <, = | K/M/B"></td>`;
  }
  html += '</tr>';
  html += '</thead><tbody id="kpi-tbody">';

  // Data rows
  for (const r of _allResults) {
    const rowCls = r.isQLBH ? 'row-qlbh' : 'row-tdv';
    const dt = encodeURIComponent(r.doiTuong || '');
    const mn = encodeURIComponent(r.mien || '');
    const qb = encodeURIComponent(r.qlbh || '');

    // Build data-* attributes for all numeric cols
    const numAttrs = cols.map(c => {
      const raw = c.key(r);
      const stored = (c.scale || 1) === 100 ? ((raw || 0) * 100).toFixed(4) : String(raw ?? 0);
      return `data-${c.nf}="${stored}"`;
    }).join(' ');

    html += `<tr class="${rowCls}" data-matdv="${r.maTDV}" data-tentdv="${r.tenTDV}" data-khuvuc="${r.khuVuc}" data-mien="${mn}" data-qlbh="${qb}" data-doituong="${dt}" ${numAttrs}>`;

    html += `<td class="col-id sc-1">${r.maTDV}</td>`;
    html += `<td class="col-name sc-2">${r.tenTDV}</td>`;
    html += `<td class="sc-3">${r.khuVuc}</td>`;
    html += `<td>${r.mien}</td>`;
    html += `<td>${r.qlbh}</td>`;
    html += `<td class="col-type">${r.doiTuong}</td>`;

    for (const c of cols) {
      const val = c.key(r);
      let cell, tdTitle = '';
      if (c.fmt === 'vndC') {
        cell    = fmt.vndC(val);
        tdTitle = val ? ` title="${fmt.vnd(val)}"` : '';
      } else if (c.fmt === 'vnd')    cell = fmt.vnd(val);
      else if (c.fmt === 'pct')  cell = fmt.pct(val);
      else if (c.fmt === 'num')  cell = fmt.num(val);
      else if (c.fmt === 'hs')   cell = fmt.hs(val);
      else if (c.fmt === '_spcd') {
        if (r.datSpCd === null) cell = '<span style="color:#bbb">—</span>';
        else cell = r.datSpCd
          ? '<span style="color:#00A651;font-weight:700">1</span>'
          : '<span style="color:#D93B3B">0</span>';
      } else cell = val;

      const cc = (c.fmt === 'pct' || c.fmt === 'hs') ? colorClass(val) : '';
      html += `<td class="num ${c.cls} ${cc}"${tdTitle}>${cell}</td>`;
    }

    html += '</tr>';
  }

  html += '</tbody></table></div>';

  const totalRows = _allResults.length;
  const qlbhRows  = _allResults.filter(r => r.isQLBH).length;
  const datTarget = _allResults.filter(r => r.tyleTong >= 1.0).length;
  const datSpCd   = cdMaSP ? _allResults.filter(r => r.datSpCd === true).length : null;

  html += `<div class="summary-bar">
    <span>Tổng: <b>${totalRows}</b> nhân viên</span>
    <span>QLBH: <b>${qlbhRows}</b> · TDV/CTV: <b>${totalRows - qlbhRows}</b></span>
    <span class="c-good">Đạt target DS: <b>${datTarget}</b></span>
    <span class="c-bad">Chưa đạt: <b>${totalRows - datTarget}</b></span>
    ${datSpCd !== null ? `<span class="c-good">Đạt SP CĐ (<b>${cdMaSP}</b>): <b>${datSpCd}</b></span>` : ''}
  </div>`;

  return html;
}

// ── Numeric filter helpers ────────────────────────────────────
function parseNumFilter(expr) {
  expr = (expr || '').trim().replace(/,/g, '');
  if (!expr) return null;
  let op = '>=', rest = expr;
  if      (expr.startsWith('>=')) { op = '>='; rest = expr.slice(2); }
  else if (expr.startsWith('<=')) { op = '<='; rest = expr.slice(2); }
  else if (expr.startsWith('>'))  { op = '>';  rest = expr.slice(1); }
  else if (expr.startsWith('<'))  { op = '<';  rest = expr.slice(1); }
  else if (expr.startsWith('='))  { op = '=';  rest = expr.slice(1); }
  rest = rest.trim();
  let mult = 1;
  const last = rest.slice(-1).toUpperCase();
  if      (last === 'B') { mult = 1e9; rest = rest.slice(0, -1); }
  else if (last === 'M') { mult = 1e6; rest = rest.slice(0, -1); }
  else if (last === 'K') { mult = 1e3; rest = rest.slice(0, -1); }
  const num = parseFloat(rest) * mult;
  if (isNaN(num)) return null;
  return { op, num };
}

function _applyNum(f, v) {
  switch (f.op) {
    case '>=': return v >= f.num;
    case '<=': return v <= f.num;
    case '>':  return v >  f.num;
    case '<':  return v <  f.num;
    case '=':  return Math.abs(v - f.num) < Math.max(0.5, Math.abs(f.num) * 0.0001);
  }
  return true;
}

function filterTable() {
  const textInputs = document.querySelectorAll('.filter-inp[data-field]');
  const selects    = document.querySelectorAll('.filter-sel[data-field]');
  const numInputs  = document.querySelectorAll('.filter-num[data-numfield]');
  const rows       = document.querySelectorAll('#kpi-tbody tr');
  let visible = 0;

  rows.forEach(row => {
    let match = true;
    textInputs.forEach(inp => {
      if (!match) return;
      const val = inp.value.trim().toLowerCase();
      if (!val) return;
      if (!(row.dataset[inp.dataset.field.toLowerCase()] || '').toLowerCase().includes(val)) match = false;
    });
    selects.forEach(sel => {
      if (!match) return;
      const val = sel.value;
      if (!val) return;
      if (decodeURIComponent(row.dataset[sel.dataset.field.toLowerCase()] || '') !== val) match = false;
    });
    numInputs.forEach(inp => {
      if (!match) return;
      const f = parseNumFilter(inp.value);
      if (!f) return;
      if (!_applyNum(f, parseFloat(row.dataset[inp.dataset.numfield] || '0'))) match = false;
    });
    row.style.display = match ? '' : 'none';
    if (match) visible++;
  });

  const cnt = document.getElementById('filter-count');
  if (cnt) cnt.textContent = visible < rows.length ? `${visible}/${rows.length}` : '';
}

function clearFilters() {
  document.querySelectorAll('.filter-inp,.filter-num').forEach(i => { i.value = ''; });
  document.querySelectorAll('.filter-sel').forEach(s => { s.value = ''; });
  filterTable();
}

// ============================================================
// EXPORT EXCEL
// ============================================================

function exportToExcel(results, dpkhDetail, dpmhDetail) {
  const wb   = XLSX.utils.book_new();
  const date = new Date().toLocaleDateString('vi-VN').replace(/\//g, '-');
  const cdMaSP = (CONFIG.SP_CHI_DINH.maSP || '').trim();

  // ── Sheet 1: Tính Thưởng ─────────────────────────────────
  const hdrs = [
    'Mã TDV','Tên TDV','Khu vực','Miền','QLBH','Đối tượng',
    'DS N2 Target','DS N3 Target','DS Tổng Target','ĐPKH Target','ĐPMH Target',
    'DS N2 Thực','DS N3 Thực','DS Tổng Thực','DS Tổng+CT','DS Công ty',
    'DS N15','ĐPKH Thực','ĐPMH Thực',
    '% DS N2','% DS N3','% DS Tổng','% DS Tổng+CT','% ĐPKH','% ĐPMH','% DS N15',
    'PTML','% Đạt N2','Hs ảnh hưởng N1','HSHT','Hs KH CT',
    ...(cdMaSP ? [`SL ${cdMaSP}`, `Đạt ${cdMaSP}`] : []),
  ];
  const rows1 = [hdrs, ...results.map(r => [
    r.maTDV, r.tenTDV, r.khuVuc, r.mien, r.qlbh, r.doiTuong,
    r.dsN2Target, r.dsN3Target, r.dsTongTarget, r.dpkhTarget, r.dpmhTarget,
    r.dsN2, r.dsN3, r.dsTong, r.dsTongCT, r.dsCongTy,
    r.dsDay15, r.dpkh, r.dpmh,
    r.pctDatN2, r.tyLeN3, r.tyleTong, r.tyleTongCT, r.tyleDPKH, r.tyleDPMH, r.tyLeDay15,
    r.ptml, r.pctDatN2, r.hsAnhHuongN1, r.hsht, r.hsKhCT,
    ...(cdMaSP ? [r.soLuongSpCd || 0, r.datSpCd ? 'Đạt' : 'Chưa đạt'] : []),
  ])];

  const ws1 = XLSX.utils.aoa_to_sheet(rows1);
  _setColWidths(ws1, rows1[0].length);
  _applyPctFormat(ws1, [19,20,21,22,23,24,25,26,27], rows1.length);
  XLSX.utils.book_append_sheet(wb, ws1, 'Tính Thưởng');

  // ── Sheet 2: ĐPKH Chi tiết ───────────────────────────────
  const ws2 = XLSX.utils.aoa_to_sheet([
    ['Mã TDV','Tên TDV','Mã KH','Tên KH','Doanh số','Phủ KH'],
    ...(dpkhDetail || []).map(d => [d.maTDV, d.tenTDV, d.maKH, d.tenKH, Math.round(d.ds), d.isPhu ? 'Có' : 'Không']),
  ]);
  _setColWidths(ws2, 6);
  XLSX.utils.book_append_sheet(wb, ws2, 'ĐPKH Chi tiết');

  // ── Sheet 3: ĐPMH Chi tiết ───────────────────────────────
  const ws3 = XLSX.utils.aoa_to_sheet([
    ['Mã TDV','Tên TDV','Mã SP','Tên SP','Doanh số','Phủ MH'],
    ...(dpmhDetail || []).map(d => [d.maTDV, d.tenTDV, d.maSP, d.tenSP, Math.round(d.ds), d.isPhu ? 'Có' : 'Không']),
  ]);
  _setColWidths(ws3, 6);
  XLSX.utils.book_append_sheet(wb, ws3, 'ĐPMH Chi tiết');

  // ── Sheet 4: Tổng DS ─────────────────────────────────────
  const ws4 = XLSX.utils.aoa_to_sheet([
    ['Mã TDV','Tên TDV','Đối tượng','DS Nhóm 1','DS Nhóm 2','DS Nhóm 3','DS Công ty','DS Tổng','DS Tổng+CT','DS N15','ĐPKH','ĐPMH'],
    ...results.map(r => [
      r.maTDV, r.tenTDV, r.doiTuong,
      Math.round(r.dsN1||0), Math.round(r.dsN2), Math.round(r.dsN3),
      Math.round(r.dsCongTy), Math.round(r.dsTong), Math.round(r.dsTongCT),
      Math.round(r.dsDay15), r.dpkh, r.dpmh,
    ]),
  ]);
  _setColWidths(ws4, 12);
  XLSX.utils.book_append_sheet(wb, ws4, 'Tổng DS');

  XLSX.writeFile(wb, 'KPI_Tinh_Thuong_' + date + '.xlsx');
}

function _setColWidths(ws, count) {
  // Width per column type (based on position/content)
  const widths = [6,18,14,8,16,8, 14,12,15,7,7, 14,14,14,14,14, 14,7,7, 9,9,9,11,8,8,9, 8,8,9,8,8, 8,8];
  ws['!cols'] = Array.from({ length: count }, (_, i) => ({ wch: widths[i] || 12 }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };
}

function _applyPctFormat(ws, colIndices, rowCount) {
  for (const ci of colIndices) {
    const col = XLSX.utils.encode_col(ci);
    for (let ri = 1; ri < rowCount; ri++) {
      const addr = col + (ri + 1);
      if (ws[addr]) ws[addr].z = '0.00%';
    }
  }
}

// ============================================================
// ZOOM (CSS zoom property — adjusts layout, not just visual)
// ============================================================

let _kpiZoomLevel = 100;

function kpiZoom(delta) {
  const output = document.getElementById('output');
  if (!output) return;

  if (delta === null) {
    _kpiZoomLevel = 100;
  } else if (delta === 0) {
    // Auto-fit: measure real table width at zoom=1 then compute ratio
    output.style.zoom = 1;
    const wrap  = output.querySelector('.table-wrap');
    const table = wrap && wrap.querySelector('.kpi-table');
    if (table) {
      const avail  = output.clientWidth;
      const tableW = table.scrollWidth;
      _kpiZoomLevel = Math.max(30, Math.min(100, Math.floor(avail / tableW * 100)));
    }
  } else {
    _kpiZoomLevel = Math.max(30, Math.min(100, _kpiZoomLevel + delta));
  }

  output.style.zoom = _kpiZoomLevel / 100;
  const el = document.getElementById('kpi-zoom-pct');
  if (el) el.textContent = _kpiZoomLevel + '%';
}
