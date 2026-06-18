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

function renderTable(results, quyMap) {
  _allResults = results || [];
  if (!_allResults.length) return '<p style="color:#888;padding:20px">Không có dữ liệu.</p>';

  const cdMaSPStr = (CONFIG.SP_CHI_DINH.maSP || '').trim();
  const cdLabel = cdMaSPStr
    ? `SP CĐ: ${cdMaSPStr} (≥${CONFIG.SP_CHI_DINH.soLuongTarget} hộp · ≥${CONFIG.SP_CHI_DINH.dpkhSpCdTarget} KH)`
    : 'SP chỉ định';

  const qc  = CONFIG.QUY_CONFIG;
  const _qd = r => (quyMap && quyMap[r.maTDV]) || { t1Target:0, t2Target:0, t1Thuc:0, t2Thuc:0 };
  const _qt = r => { const d=_qd(r); return d.t1Target + d.t2Target + r.dsTongTarget; };
  const _qh = r => { const d=_qd(r); return d.t1Thuc   + d.t2Thuc   + r.dsTongCT;     };

  // ── Header row 1 (group headers) ──────────────────────────
  const groups = [
    { text: 'Mã TDV',              rowspan: 2, sticky: 1, cls: 'col-matdv' },
    { text: 'Tên TDV',             rowspan: 2, sticky: 2 },
    { text: 'Khu vực',             rowspan: 2, sticky: 3, cls: 'col-kv'   },
    { text: 'Miền',                rowspan: 2,             cls: 'col-mien' },
    { text: 'Tên QLBH',            rowspan: 2,             cls: 'col-qlbh' },
    { text: 'Đối tượng',           rowspan: 2,             cls: 'col-type' },
    { text: 'KẾ HOẠCH',           span: 5, cls: 'h-plan'   },
    { text: 'HOÀN THÀNH',         span: 7, cls: 'h-actual' },
    { text: 'TỶ LỆ HOÀN THÀNH',  span: 7, cls: 'h-ratio'  },
    { text: 'TỔNG HỢP KPI',       span: 4, cls: 'h-kpi'   },
    { text: cdLabel,               span: 3, cls: 'h-spcd'      },
    { text: 'DS CÒN LẠI THÁNG',  span: 4, cls: 'h-con-thang' },
    ...(quyMap ? [
      { text: `TARGET ${qc.quyLabel}`,     span: 4, cls: 'h-quy-target' },
      { text: `HOÀN THÀNH ${qc.quyLabel}`, span: 4, cls: 'h-quy-actual' },
      { text: `% ĐẠT ${qc.quyLabel}`,      span: 1, cls: 'h-quy-pct'   },
      { text: 'DS CÒN LẠI ĐỂ ĐẠT MỨC',   span: 4, cls: 'h-quy-con'   },
    ] : []),
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
    { text: '% DS N2',         cls: 'h-ratio',  nf: 'pn2',     ph: '>=60',  key: r => r.pctDatN2,     fmt: 'pct', scale: 100, compact: true, tip: 'DS Tổng<100%: DS N2/(DS Tổng×50%) | DS Tổng≥100%: DS N2/DS N2 Target' },
    { text: '% DS N3',         cls: 'h-ratio',  nf: 'pn3',     ph: '>=60',  key: r => r.tyLeN3,       fmt: 'pct', scale: 100, compact: true, tip: 'DS N3 / DS N3 Target (8% khoán)' },
    { text: '% DS Tổng',       cls: 'h-ratio',  nf: 'pton',    ph: '>=60',  key: r => r.tyleTong,     fmt: 'pct', scale: 100, compact: true, tip: 'DS Tổng / DS Tổng Target' },
    { text: '% DS T+CT',       cls: 'h-ratio',  nf: 'ptonct',  ph: '>=60',  key: r => r.tyleTongCT,   fmt: 'pct', scale: 100, compact: true, tip: 'DS Tổng+CT / DS Tổng Target' },
    { text: '% ĐPKH',          cls: 'h-ratio',  nf: 'pdpkh',   ph: '>=60',  key: r => r.tyleDPKH,     fmt: 'pct', scale: 100, compact: true, tip: 'ĐPKH / ĐPKH Target' },
    { text: '% ĐPMH',          cls: 'h-ratio',  nf: 'pdpmh',   ph: '>=60',  key: r => r.tyleDPMH,     fmt: 'pct', scale: 100, compact: true, tip: 'ĐPMH / ĐPMH Target' },
    { text: '% DS N15',        cls: 'h-ratio',  nf: 'pn15',    ph: '>=50',  key: r => r.tyLeDay15,    fmt: 'pct', scale: 100, compact: true, tip: 'DS N15 / DS Tổng Target' },
    // TỔNG HỢP KPI (4)
    { text: 'PTML',            cls: 'h-kpi',    nf: 'ptml',    ph: '>=60',  key: r => r.ptml,         fmt: 'pct', scale: 100, compact: true, tip: '%N3×10% + %DS Tổng×0% + %DS Tổng+CT×60% + %ĐPKH×15% + %ĐPMH×15%' },
    { text: 'Hs N1',           cls: 'h-kpi',    nf: 'hn1',     ph: '>=0.8', key: r => r.hsAnhHuongN1, fmt: 'hs',  compact: true, tip: 'Hs ảnh hưởng N1: <60%→0.7 | 60%→0.8 | 80%→0.9 | ≥100%→1.0 (lookup theo % DS N2)' },
    { text: 'HSHT',            cls: 'h-kpi',    nf: 'hsht',    ph: '>=1',   key: r => r.hsht,         fmt: 'hs',  compact: true, tip: 'Lookup theo % DS T+CT\nTDV: 0%→0|60%→0.6|80%→0.8|100%→1.0|115%→1.1|125%→1.2|135%→1.3\nQLBH: 0%→0|60%→0.5|80%→0.65|90%→0.8|100%→1.0|110%→1.28|120%→1.5' },
    { text: 'Hs KH CT',        cls: 'h-kpi',    nf: 'hsct',    ph: '>=0.8', key: r => r.hsKhCT,       fmt: 'hs',  compact: true, tip: 'HSHT < 1 → Hs KH CT = HSHT\nHSHT ≥ 1 → lookup DS công ty: =0→1.0 | ≥200M→0.8 | ≥400M→0.7' },
    // SP CHỈ ĐỊNH (3)
    { text: 'SL SP CĐ',        cls: 'h-spcd',   nf: 'slspcd',  ph: '>=5',   key: r => r.soLuongSpCd || 0, fmt: 'num', compact: true, tip: `Tổng số hộp ${cdMaSPStr || 'SP chỉ định'} đã bán` },
    { text: 'KH phủ SP CĐ',    cls: 'h-spcd',   nf: 'khspcd',  ph: '>=5',   key: r => r.dpkhSpCd || 0, fmt: 'num', compact: true, tip: `Số KH mua ít nhất 1 trong các mã ${cdMaSPStr || 'SP chỉ định'}` },
    { text: 'Đạt SP CĐ',       cls: 'h-spcd',      nf: 'datspcd', ph: '>=1',   key: r => r.datSpCd === true ? 1 : 0, fmt: '_spcd', compact: true, tip: `Đạt khi ≥${CONFIG.SP_CHI_DINH.soLuongTarget} hộp VÀ ≥${CONFIG.SP_CHI_DINH.dpkhSpCdTarget} KH phủ` },
    // DS CÒN LẠI THÁNG (4)
    { text: 'Mức 100%', cls: 'h-con-thang', nf: 'con100', ph: '>=M', key: r => Math.max(0, r.dsTongTarget * 1.00 - r.dsTongCT), fmt: 'vndC', compact: true, tip: 'Còn thiếu để đạt 100% DS tháng (T+CT)' },
    { text: 'Mức 115%', cls: 'h-con-thang', nf: 'con115', ph: '>=M', key: r => Math.max(0, r.dsTongTarget * 1.15 - r.dsTongCT), fmt: 'vndC', compact: true, tip: 'Còn thiếu để đạt 115% DS tháng (T+CT)' },
    { text: 'Mức 125%', cls: 'h-con-thang', nf: 'con125', ph: '>=M', key: r => Math.max(0, r.dsTongTarget * 1.25 - r.dsTongCT), fmt: 'vndC', compact: true, tip: 'Còn thiếu để đạt 125% DS tháng (T+CT)' },
    { text: 'Mức 135%', cls: 'h-con-thang', nf: 'con135', ph: '>=M', key: r => Math.max(0, r.dsTongTarget * 1.35 - r.dsTongCT), fmt: 'vndC', compact: true, tip: 'Còn thiếu để đạt 135% DS tháng (T+CT)' },
    ...(quyMap ? [
      // TARGET Quý (4)
      { text: qc.thang1+' Target', cls:'h-quy-target', nf:'qt1t',  ph:'>=M', key:r=>{const d=_qd(r);return d.t1Target;},                          fmt:'vndC', compact:true, tip:'Target '+qc.thang1+' (import)' },
      { text: qc.thang2+' Target', cls:'h-quy-target', nf:'qt2t',  ph:'>=M', key:r=>{const d=_qd(r);return d.t2Target;},                          fmt:'vndC', compact:true, tip:'Target '+qc.thang2+' (import)' },
      { text: qc.thang3+' Target', cls:'h-quy-target', nf:'qt3t',  ph:'>=M', key:r=>r.dsTongTarget,                                               fmt:'vndC', compact:true, tip:'Target '+qc.thang3+' (từ TARGET tháng này)' },
      { text: 'Tổng Target',       cls:'h-quy-target', nf:'qtott', ph:'>=M', key:r=>_qt(r),                                                       fmt:'vndC', compact:true, tip:'Tổng Target '+qc.quyLabel },
      // HOÀN THÀNH Quý (4)
      { text: qc.thang1,           cls:'h-quy-actual', nf:'qt1',   ph:'>=M', key:r=>{const d=_qd(r);return d.t1Thuc;},                            fmt:'vndC', compact:true, tip:'DS T+CT '+qc.thang1+' (import)' },
      { text: qc.thang2,           cls:'h-quy-actual', nf:'qt2',   ph:'>=M', key:r=>{const d=_qd(r);return d.t2Thuc;},                            fmt:'vndC', compact:true, tip:'DS T+CT '+qc.thang2+' (import)' },
      { text: qc.thang3,           cls:'h-quy-actual', nf:'qt3',   ph:'>=M', key:r=>r.dsTongCT,                                                   fmt:'vndC', compact:true, tip:'DS T+CT '+qc.thang3+' (tháng này)' },
      { text: 'Tổng',              cls:'h-quy-actual', nf:'qtot',  ph:'>=M', key:r=>_qh(r),                                                       fmt:'vndC', compact:true, tip:'Tổng DS T+CT '+qc.quyLabel },
      // % ĐẠT Quý (1)
      { text: '% Đạt',             cls:'h-quy-pct',    nf:'qpct',  ph:'>=60',key:r=>{const tT=_qt(r);return tT>0?_qh(r)/tT:0;},                  fmt:'pct',  scale:100, compact:true, tip:'Tổng HT / Tổng Target '+qc.quyLabel },
      // DS CÒN LẠI (4)
      { text: 'Mức 100%',          cls:'h-quy-con',    nf:'qc100', ph:'>=M', key:r=>Math.max(0,_qt(r)*1.0-_qh(r)),                               fmt:'vndC', compact:true, tip:'Còn thiếu để đạt 100% '+qc.quyLabel },
      { text: 'Mức 110%',          cls:'h-quy-con',    nf:'qc110', ph:'>=M', key:r=>Math.max(0,_qt(r)*1.1-_qh(r)),                               fmt:'vndC', compact:true, tip:'Còn thiếu để đạt 110% '+qc.quyLabel },
      { text: 'Mức 120%',          cls:'h-quy-con',    nf:'qc120', ph:'>=M', key:r=>Math.max(0,_qt(r)*1.2-_qh(r)),                               fmt:'vndC', compact:true, tip:'Còn thiếu để đạt 120% '+qc.quyLabel },
      { text: 'Mức 130%',          cls:'h-quy-con',    nf:'qc130', ph:'>=M', key:r=>Math.max(0,_qt(r)*1.3-_qh(r)),                               fmt:'vndC', compact:true, tip:'Còn thiếu để đạt 130% '+qc.quyLabel },
    ] : []),
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
  <span style="margin-left:auto;display:flex;gap:4px">
    <button class="btn-zoom" id="btn-col-toggle" onclick="toggleColPanel()" title="Ẩn/hiện nhóm cột">👁 Cột</button>
    <button class="btn-zoom btn-screenshot" id="btn-screenshot" onclick="captureTable()" title="Chụp toàn bộ bảng thành ảnh PNG">📷 Chụp ảnh</button>
  </span>
</div>
<div id="col-toggle-panel" class="col-toggle-panel" style="display:none">
  <span class="ctg-label">Hiển thị cột:</span>
  <label class="ctg-item"><input type="checkbox" data-col-group="plan" checked onchange="applyColToggle()"> KẾ HOẠCH</label>
  <label class="ctg-item"><input type="checkbox" data-col-group="actual" checked onchange="applyColToggle()"> HOÀN THÀNH</label>
  <label class="ctg-item"><input type="checkbox" data-col-group="ratio" checked onchange="applyColToggle()"> TỶ LỆ %</label>
  <label class="ctg-item"><input type="checkbox" data-col-group="kpi" checked onchange="applyColToggle()"> TỔNG HỢP KPI</label>
  <label class="ctg-item"><input type="checkbox" data-col-group="spcd" checked onchange="applyColToggle()"> SP CHỈ ĐỊNH</label>
  <label class="ctg-item"><input type="checkbox" data-col-group="con-thang" checked onchange="applyColToggle()"> DS CÒN LẠI</label>
  ${quyMap ? `<label class="ctg-item"><input type="checkbox" data-col-group="quy" checked onchange="applyColToggle()"> ${qc.quyLabel}</label>` : ''}
  ${quyMap ? `<label class="ctg-item"><input type="checkbox" data-col-group="quy-target" checked onchange="applyColToggle()"> Target ${qc.quyLabel}</label>` : ''}
  <span class="ctg-sep"></span>
  <label class="ctg-item"><input type="checkbox" data-col-group="kv" checked onchange="applyColToggle()"> Khu vực</label>
  <label class="ctg-item"><input type="checkbox" data-col-group="mien" checked onchange="applyColToggle()"> Miền</label>
  <label class="ctg-item"><input type="checkbox" data-col-group="qlbh" checked onchange="applyColToggle()"> Tên QLBH</label>
  <label class="ctg-item"><input type="checkbox" data-col-group="matdv" checked onchange="applyColToggle()"> Mã TDV</label>
  <label class="ctg-item"><input type="checkbox" data-col-group="type" checked onchange="applyColToggle()"> Đối tượng</label>
  <span class="ctg-sep"></span>
  <label class="ctg-item ctg-row-toggle"><input type="checkbox" data-col-group="qlbh-rows" checked onchange="applyColToggle()"> Hiện dòng QLBH</label>
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
  html += `<td class="sc-1 col-matdv"><input size="1" class="filter-inp" placeholder="Mã..." oninput="filterTable()" data-field="maTDV"></td>`;
  html += `<td class="sc-2"><input size="1" class="filter-inp" placeholder="Tên..." oninput="filterTable()" data-field="tenTDV"></td>`;
  html += `<td class="sc-3 col-kv"><input size="1" class="filter-inp" placeholder="KV..." oninput="filterTable()" data-field="khuVuc"></td>`;
  html += `<td class="col-mien"><select class="filter-sel" onchange="filterTable()" data-field="mien"><option value="">—</option>${mienVals.map(v => `<option>${v}</option>`).join('')}</select></td>`;
  html += `<td class="col-qlbh"><select class="filter-sel" onchange="filterTable()" data-field="qlbh"><option value="">—</option>${qlbhVals.map(v => `<option>${v}</option>`).join('')}</select></td>`;
  html += `<td class="col-type" style="white-space:nowrap">
    <select class="filter-sel" style="width:auto;min-width:0" onchange="filterTable()" data-field="doiTuong">
      <option value="">—</option>${doiTuongVals.map(v => `<option>${v}</option>`).join('')}
    </select>
    <button class="btn-clear-filter" onclick="clearFilters()" title="Xóa tất cả lọc">✕</button>
    <span id="filter-count" style="font-size:10px;color:#888"></span>
  </td>`;
  for (const c of cols) {
    html += `<td class="${c.cls || ''}"><input size="1" class="filter-num" placeholder="${c.ph}" oninput="filterTable()" data-numfield="${c.nf}" title=">=, <=, >, <, = | K/M/B"></td>`;
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

    html += `<td class="col-id col-matdv sc-1">${r.maTDV}</td>`;
    html += `<td class="col-name sc-2 kc-clickable" onclick="showKpiCard('${r.maTDV}')">${r.tenTDV}</td>`;
    html += `<td class="sc-3 col-kv">${r.khuVuc}</td>`;
    html += `<td class="col-mien">${r.mien}</td>`;
    html += `<td class="col-qlbh">${r.qlbh}</td>`;
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
  const datSpCd   = cdMaSPStr ? _allResults.filter(r => r.datSpCd === true).length : null;

  html += `<div class="summary-bar">
    <span>Tổng: <b>${totalRows}</b> nhân viên</span>
    <span>QLBH: <b>${qlbhRows}</b> · TDV/CTV: <b>${totalRows - qlbhRows}</b></span>
    <span class="c-good">Đạt target DS: <b>${datTarget}</b></span>
    <span class="c-bad">Chưa đạt: <b>${totalRows - datTarget}</b></span>
    ${datSpCd !== null ? `<span class="c-good">Đạt SP CĐ (<b>${cdMaSPStr}</b>): <b>${datSpCd}</b></span>` : ''}
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

function exportToExcel(results, dpkhDetail, dpmhDetail, quyMap) {
  const wb   = XLSX.utils.book_new();
  const date = new Date().toLocaleDateString('vi-VN').replace(/\//g, '-');
  const cdMaSPStr = (CONFIG.SP_CHI_DINH.maSP || '').trim();

  // ── Sheet 1: Tính Thưởng ─────────────────────────────────
  const hdrs = [
    'Mã TDV','Tên TDV','Khu vực','Miền','Tên QLBH','Đối tượng',
    'DS N2 Target','DS N3 Target','DS Tổng Target','ĐPKH Target','ĐPMH Target',
    'DS N2 Thực','DS N3 Thực','DS Tổng Thực','DS Tổng+CT','DS Công ty',
    'DS N15','ĐPKH Thực','ĐPMH Thực',
    '% DS N2','% DS N3','% DS Tổng','% DS Tổng+CT','% ĐPKH','% ĐPMH','% DS N15',
    'PTML','Hs ảnh hưởng N1','HSHT','Hs KH CT',
    ...(cdMaSPStr ? [`SL ${cdMaSPStr}`, `KH phủ ${cdMaSPStr}`, `Đạt ${cdMaSPStr}`] : []),
    'Còn 100% tháng', 'Còn 115% tháng', 'Còn 125% tháng', 'Còn 135% tháng',
  ];
  const rows1 = [hdrs, ...results.map(r => [
    r.maTDV, r.tenTDV, r.khuVuc, r.mien, r.qlbh, r.doiTuong,
    r.dsN2Target, r.dsN3Target, r.dsTongTarget, r.dpkhTarget, r.dpmhTarget,
    r.dsN2, r.dsN3, r.dsTong, r.dsTongCT, r.dsCongTy,
    r.dsDay15, r.dpkh, r.dpmh,
    r.pctDatN2, r.tyLeN3, r.tyleTong, r.tyleTongCT, r.tyleDPKH, r.tyleDPMH, r.tyLeDay15,
    r.ptml, r.hsAnhHuongN1, r.hsht, r.hsKhCT,
    ...(cdMaSPStr ? [r.soLuongSpCd || 0, r.dpkhSpCd || 0, r.datSpCd ? 'Đạt' : 'Chưa đạt'] : []),
    Math.max(0, r.dsTongTarget * 1.00 - r.dsTongCT),
    Math.max(0, r.dsTongTarget * 1.15 - r.dsTongCT),
    Math.max(0, r.dsTongTarget * 1.25 - r.dsTongCT),
    Math.max(0, r.dsTongTarget * 1.35 - r.dsTongCT),
  ])];

  const ws1 = XLSX.utils.aoa_to_sheet(rows1);
  _setColWidths(ws1, rows1[0].length);
  _applyPctFormat(ws1, [19,20,21,22,23,24,25,26], rows1.length);
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

  // ── Sheet 5: Quý ─────────────────────────────────────────
  if (quyMap) {
    const qc = CONFIG.QUY_CONFIG;
    const _qd = r => (quyMap[r.maTDV]) || { t1Target:0, t2Target:0, t1Thuc:0, t2Thuc:0 };
    const hdrsQ = ['Mã TDV','Tên TDV',
      qc.thang1+' Target', qc.thang2+' Target', qc.thang3+' Target', 'Tổng Target',
      qc.thang1+' Thực',   qc.thang2+' Thực',   qc.thang3+' Thực',  'Tổng Thực',
      '% Đạt '+qc.quyLabel, 'Còn 100%','Còn 110%','Còn 120%','Còn 130%',
    ];
    const rowsQ = [hdrsQ, ...results.map(r => {
      const d = _qd(r);
      const tT = d.t1Target + d.t2Target + r.dsTongTarget;
      const tH = d.t1Thuc   + d.t2Thuc   + r.dsTongCT;
      return [
        r.maTDV, r.tenTDV,
        d.t1Target, d.t2Target, r.dsTongTarget, tT,
        d.t1Thuc,   d.t2Thuc,   r.dsTongCT,     tH,
        tT > 0 ? tH/tT : 0,
        Math.max(0,tT*1.0-tH), Math.max(0,tT*1.1-tH),
        Math.max(0,tT*1.2-tH), Math.max(0,tT*1.3-tH),
      ];
    })];
    const wsQ = XLSX.utils.aoa_to_sheet(rowsQ);
    wsQ['!cols'] = [8,20,14,14,14,14, 14,14,14,14, 10,14,14,14,14].map(w=>({wch:w}));
    _applyPctFormat(wsQ, [10], rowsQ.length);
    XLSX.utils.book_append_sheet(wb, wsQ, ('Quý '+qc.quyLabel).replace(/[/\\?*[\]:]/g, '-'));
  }

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

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const dlUrl = URL.createObjectURL(blob);
  const dlA = document.createElement('a');
  dlA.href = dlUrl; dlA.download = 'KPI_Tinh_Thuong_' + date + '.xlsx';
  document.body.appendChild(dlA); dlA.click(); document.body.removeChild(dlA);
  setTimeout(() => URL.revokeObjectURL(dlUrl), 1000);
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
// THUYẾT TRÌNH — Cảnh báo theo Miền, gom theo chỉ tiêu
// ============================================================

const _METRICS = [
  { key:'tyleTongCT', label:'Doanh số T+CT',   icon:'💰', unit:'',
    detail: r => `${_p(r.tyleTongCT)} · còn thiếu ${_m(Math.max(0, r.dsTongTarget - r.dsTongCT))}` },
  { key:'pctDatN2',  label:'DS Nhóm 2',        icon:'📦', unit:'',
    detail: r => `${_p(r.pctDatN2)} · còn thiếu N2 ${_m(Math.max(0, r.dsN2Target - r.dsN2))}` },
  { key:'tyleDPKH',  label:'ĐPKH',             icon:'👥', unit:'KH',
    detail: r => `${_p(r.tyleDPKH)} · thiếu ${Math.max(0, r.dpkhTarget - r.dpkh)} KH` },
  { key:'tyleDPMH',  label:'ĐPMH',             icon:'🏪', unit:'MH',
    detail: r => `${_p(r.tyleDPMH)} · thiếu ${Math.max(0, r.dpmhTarget - r.dpmh)} MH` },
  { key:'ptml',      label:'PTML tổng hợp',    icon:'📊', unit:'',
    detail: r => `${_p(r.ptml)}` },
];

function _m(v) {
  const a = Math.abs(v||0), s = v < 0 ? '-' : '';
  if (a >= 1e9) return s + (a/1e9).toFixed(1) + ' tỷ';
  if (a >= 1e6) return s + Math.round(a/1e6) + 'M';
  return s + Math.round(a/1e3) + 'K';
}
function _p(v) { return (+(v*100)).toFixed(1) + '%'; }

function _buildMotivation(grp) {
  const totalDS     = grp.reduce((s, r) => s + (r.dsTongCT || 0), 0);
  const totalTarget = grp.reduce((s, r) => s + (r.dsTongTarget || 0), 0);
  const gap         = Math.max(0, totalTarget - totalDS);
  const pct         = totalTarget > 0 ? totalDS / totalTarget : 0;
  const tdvN        = grp.length;
  const failN       = grp.filter(r => _METRICS.some(mt => r[mt.key] < 0.6)).length;
  const topMetric   = _METRICS.map(mt => ({ mt, n: grp.filter(r => r[mt.key] < 0.6).length }))
                               .sort((a, b) => b.n - a.n)[0];

  if (pct >= 0.9)
    return `🏆 Đội đang đạt <b>${_p(pct)}</b> kế hoạch — rất xuất sắc! Chỉ còn <b>${_m(gap)}</b> nữa là về đích, hãy duy trì đà và bứt phá những ngày cuối tháng!`;
  if (pct >= 0.75)
    return `🚀 Đội đạt <b>${_p(pct)}</b>, còn thiếu <b>${_m(gap)}</b> để hoàn thành kế hoạch. <b>${failN}/${tdvN}</b> TDV cần cải thiện — nếu mỗi người thêm <b>${_m(gap / Math.max(failN,1))}</b>, đội sẽ về đích!`;
  if (pct >= 0.6)
    return `💪 Còn <b>${_m(gap)}</b> DS cần bổ sung. Ưu tiên tập trung vào <b>${topMetric.mt.icon} ${topMetric.mt.label}</b> — đây là chỉ tiêu có nhiều anh/chị chưa đạt nhất (<b>${topMetric.n} TDV</b>). Hãy đẩy mạnh tiếp cận khách hàng ngay hôm nay!`;
  return `⚡ Kế hoạch còn nhiều thách thức (đạt <b>${_p(pct)}</b>), cần <b>${_m(gap)}</b> để hoàn thành. Tập trung ưu tiên <b>${topMetric.mt.icon} ${topMetric.mt.label}</b> và tăng cường ghé thăm khách hàng. Mỗi đơn hàng đều có giá trị — hãy hành động ngay!`;
}

function _buildMotivationText(grp) {
  const totalDS     = grp.reduce((s, r) => s + (r.dsTongCT || 0), 0);
  const totalTarget = grp.reduce((s, r) => s + (r.dsTongTarget || 0), 0);
  const gap         = Math.max(0, totalTarget - totalDS);
  const pct         = totalTarget > 0 ? totalDS / totalTarget : 0;
  const tdvN        = grp.length;
  const failN       = grp.filter(r => _METRICS.some(mt => r[mt.key] < 0.6)).length;
  const topMetric   = _METRICS.map(mt => ({ mt, n: grp.filter(r => r[mt.key] < 0.6).length }))
                               .sort((a, b) => b.n - a.n)[0];

  if (pct >= 0.9)
    return `🏆 Đội đang đạt ${_p(pct)} kế hoạch — rất xuất sắc! Chỉ còn ${_m(gap)} nữa là về đích, hãy duy trì đà và bứt phá những ngày cuối tháng!`;
  if (pct >= 0.75)
    return `🚀 Đội đạt ${_p(pct)}, còn thiếu ${_m(gap)} để hoàn thành kế hoạch. ${failN}/${tdvN} TDV cần cải thiện — nếu mỗi người thêm ${_m(gap / Math.max(failN,1))}, đội sẽ về đích!`;
  if (pct >= 0.6)
    return `💪 Còn ${_m(gap)} DS cần bổ sung. Ưu tiên tập trung vào ${topMetric.mt.label} — đây là chỉ tiêu có nhiều anh/chị chưa đạt nhất (${topMetric.n} TDV). Hãy đẩy mạnh tiếp cận khách hàng ngay hôm nay!`;
  return `⚡ Kế hoạch còn nhiều thách thức (đạt ${_p(pct)}), cần ${_m(gap)} để hoàn thành. Tập trung ưu tiên ${topMetric.mt.label} và tăng cường ghé thăm khách hàng. Mỗi đơn hàng đều có giá trị — hãy hành động ngay!`;
}

function renderPresentation(results) {
  const el = document.getElementById('presentation-section');
  if (!el) return;

  const tdvOnly = results.filter(r => !r.isQLBH);
  const miens   = [...new Set(tdvOnly.map(r => r.mien).filter(Boolean))].sort();

  let totalWarn = 0;
  miens.forEach(m => {
    const g = tdvOnly.filter(r => r.mien === m);
    _METRICS.forEach(mt => { totalWarn += g.filter(r => r[mt.key] < 0.6).length; });
  });

  if (!totalWarn) {
    el.innerHTML = `<div class="pres-empty">✅ Tất cả TDV đều đạt trên 60% mọi chỉ tiêu!</div>`;
    return;
  }

  const blocks = miens.map(mien => {
    const grp    = tdvOnly.filter(r => r.mien === mien);
    const mienId = 'pm-' + mien.replace(/\W/g,'');

    const metricRows = _METRICS.map((mt, idx) => {
      const failing = grp.filter(r => r[mt.key] < 0.6).sort((a, b) => a[mt.key] - b[mt.key]);
      if (!failing.length) return '';
      const chips = failing.map(r => {
        const pv  = r[mt.key];
        const cls = pv < 0.4 ? 'chip-danger' : 'chip-warn';
        return `<span class="pres-chip ${cls}">
          <b>${r.tenTDV}</b><em>${_p(pv)}</em>
          <small>${mt.detail(r).split('·')[1]?.trim() || ''}</small>
        </span>`;
      }).join('');
      return `<div class="pres-metric">
        <div class="pres-metric-label">
          <span class="pm-num">${idx+1}</span><span class="pm-icon">${mt.icon}</span>
          <span class="pm-title">${mt.label} chưa đạt</span>
          <span class="pm-badge">${failing.length} TDV</span>
        </div>
        <div class="pres-chips">${chips}</div>
      </div>`;
    }).join('');

    if (!metricRows.trim()) return '';

    const warnCount  = _METRICS.reduce((s, mt) => s + grp.filter(r => r[mt.key] < 0.6).length, 0);
    const motivation = _buildMotivation(grp);

    return `<div class="pres-mien-block">
      <div class="pres-mien-hd">
        <span class="pm-loc">📍</span>
        <span class="pm-mien-name">${mien}</span>
        <span class="pm-mien-count">${warnCount} trường hợp chưa đạt</span>
        <button class="btn-copy-mien" onclick="copyMien('${mienId}')">📋 Copy</button>
      </div>
      <div class="pres-mien-body">${metricRows}</div>
      <div class="pres-motivation">${motivation}</div>
      <textarea id="${mienId}" class="pres-hidden-txt" readonly>${_buildMienText(mien, grp)}</textarea>
    </div>`;
  }).filter(Boolean).join('');

  el.innerHTML = `
<div class="pres-greeting">
  👋 <b>Chào các anh/chị,</b><br>
  <span>Dưới đây là báo cáo tổng hợp các chỉ tiêu kinh doanh chưa đạt theo từng Miền. Đề nghị các anh/chị xem xét và có kế hoạch cải thiện kịp thời.</span>
</div>
<div class="pres-toolbar">
  <span class="pres-count">⚠&nbsp; <b>${miens.length}</b> miền · <b>${totalWarn}</b> trường hợp chưa đạt 60%</span>
  <button class="btn-copy-mien" style="margin-left:auto" onclick="copyAllPres()">📋 Copy tất cả</button>
</div>
${blocks}
<div class="pres-closing">
  🌟 <b>Chúc các anh/chị may mắn và đạt kết quả tốt!</b>
</div>`;
}

function _buildMienText(mien, grp) {
  const lines = [
    `Chào các anh/chị ${mien},\n`,
    `📍 ${mien.toUpperCase()}\n`,
  ];
  _METRICS.forEach((mt, i) => {
    const failing = grp.filter(r => r[mt.key] < 0.6).sort((a, b) => a[mt.key] - b[mt.key]);
    if (!failing.length) return;
    const list = failing.map(r => `${r.tenTDV} (${mt.detail(r)})`).join(', ');
    lines.push(`${i+1}. ${mt.icon} ${mt.label} chưa đạt: ${list}`);
  });
  lines.push(`\n${_buildMotivationText(grp)}`);
  lines.push(`\nChúc các anh/chị may mắn và đạt kết quả tốt! 🌟`);
  return lines.join('\n');
}

function copyMien(id) {
  const ta = document.getElementById(id);
  if (!ta) return;
  navigator.clipboard.writeText(ta.value).then(() => {
    const btn = ta.closest('.pres-mien-block').querySelector('.btn-copy-mien');
    const orig = btn.textContent;
    btn.textContent = '✓ Đã copy!'; btn.style.background = '#00A651'; btn.style.color = '#fff';
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; btn.style.color = ''; }, 2200);
  });
}

function copyAllPres() {
  const all = [...document.querySelectorAll('.pres-hidden-txt')].map(t => t.value).join('\n\n─────────────────\n\n');
  navigator.clipboard.writeText(all).then(() => {
    const btn = document.querySelector('.pres-toolbar .btn-copy-mien');
    const orig = btn.textContent;
    btn.textContent = '✓ Đã copy!'; btn.style.background = '#00A651'; btn.style.color = '#fff';
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; btn.style.color = ''; }, 2200);
  });
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

// ============================================================
// COLUMN TOGGLE + SCREENSHOT
// ============================================================

function toggleColPanel() {
  const p = document.getElementById('col-toggle-panel');
  if (p) p.style.display = p.style.display === 'none' ? '' : 'none';
}

function applyColToggle() {
  const table = document.querySelector('.kpi-table');
  if (!table) return;
  ['plan','actual','ratio','kpi','spcd','con-thang','quy','quy-target','kv','mien','qlbh','matdv','type','qlbh-rows']
    .forEach(g => table.classList.remove('hide-' + g));
  document.querySelectorAll('[data-col-group]').forEach(cb => {
    if (!cb.checked) table.classList.add('hide-' + cb.dataset.colGroup);
  });
}

async function captureTable() {
  if (typeof html2canvas === 'undefined') {
    alert('Thư viện chụp ảnh chưa tải. Vui lòng tải lại trang.');
    return;
  }
  const table = document.querySelector('.kpi-table');
  if (!table) { alert('Không tìm thấy bảng dữ liệu.'); return; }

  const btn = document.getElementById('btn-screenshot');
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang chụp...'; }

  table.classList.add('capturing');
  try {
    const canvas = await html2canvas(table, {
      scale: 1.5,
      backgroundColor: '#ffffff',
      useCORS: true,
      allowTaint: true,
      scrollX: 0, scrollY: 0,
    });
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'KPI_Bang_Tinh_Thuong_' + new Date().toLocaleDateString('vi-VN').replace(/\//g, '-') + '.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  } catch(err) {
    alert('Lỗi chụp ảnh: ' + err.message);
    console.error(err);
  } finally {
    table.classList.remove('capturing');
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}
