// ============================================================
// ANALYTICS-CHECKIN.JS - Check-in daily report
// ============================================================

const DAY_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

let _ciReportData = null;
let _ciZoom = 1.0;

// ─── Parser ─────────────────────────────────────────────────
function parseCheckInFile(arrayBuffer) {
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

  const records = [];
  let year = 0, month = 0;

  for (let r = 1; r <= range.e.r; r++) {
    const maTDV = getCellStr(ws, r, 1); // col B
    const maKH  = getCellStr(ws, r, 2); // col C
    if (!maTDV) continue;

    const cell = ws[XLSX.utils.encode_cell({ r, c: 5 })]; // col F: Giờ check-in
    if (!cell || cell.v === undefined) continue;

    let dt = null;
    if (cell.t === 'n' && cell.v > 1000) {
      dt = new Date(Math.round((cell.v - 25569) * 86400 * 1000));
    } else if (cell.t === 'd') {
      dt = cell.v;
    }
    if (!dt) continue;

    if (!year) { year = dt.getUTCFullYear(); month = dt.getUTCMonth() + 1; }

    records.push({
      maTDV: maTDV.trim().toUpperCase(),
      maKH:  maKH.trim(),
      day:   dt.getUTCDate(),
    });
  }

  return { records, year, month };
}

// ─── Calculator ─────────────────────────────────────────────
function calculateCheckInReport(ciData, orderRecords, targets) {
  const { records, year, month } = ciData;

  const allDaysSet = new Set(records.map(r => r.day));
  const allDays = [...allDaysSet].sort((a, b) => a - b);

  // Target map: maTDV → { tenTDV, khuVuc, mien, qlbhCode }
  const targetMap = {};
  if (targets) targets.forEach(t => { targetMap[(t.maTDV || '').toUpperCase()] = t; });

  // QLBH set (to exclude their own rows)
  const qlbhSet = new Set((targets || [])
    .filter(t => (t.doiTuong || '').toUpperCase() === 'QLBH')
    .map(t => (t.maTDV || '').toUpperCase()));

  // ciMap[maTDV][day] = Set<maKH>
  const ciMap = {};
  records.forEach(r => {
    if (!ciMap[r.maTDV]) ciMap[r.maTDV] = {};
    if (!ciMap[r.maTDV][r.day]) ciMap[r.maTDV][r.day] = new Set();
    ciMap[r.maTDV][r.day].add(r.maKH);
  });

  // dsMap[maTDV][day] = { ds, khSet }
  const dsMap = {};
  if (orderRecords) {
    orderRecords.forEach(o => {
      const tdv = (o.maNV || '').trim().toUpperCase();
      if (!tdv || !o.ngayDay) return;
      if (!dsMap[tdv]) dsMap[tdv] = {};
      if (!dsMap[tdv][o.ngayDay]) dsMap[tdv][o.ngayDay] = { ds: 0, khSet: new Set() };
      dsMap[tdv][o.ngayDay].ds += o.doanhSo || 0;
      if (o.maKH) dsMap[tdv][o.ngayDay].khSet.add(o.maKH.trim());
    });
  }

  const rows = Object.keys(ciMap)
    .filter(tdv => !qlbhSet.has(tdv))   // exclude QLBH's own rows
    .map(tdv => {
    const info = targetMap[tdv] || {};
    const totalDS = Object.values(dsMap[tdv] || {}).reduce((s, v) => s + v.ds, 0);
    const totalCI = Object.values(ciMap[tdv] || {}).reduce((s, v) => s + v.size, 0);

    const daily = {};
    allDays.forEach(day => {
      const khCI   = ciMap[tdv]?.[day] || new Set();
      const dsInfo = (dsMap[tdv] || {})[day] || { ds: 0, khSet: new Set() };
      daily[day] = { ciKH: khCI.size, ds: dsInfo.ds, khDS: dsInfo.khSet.size };
    });

    return {
      maTDV:    tdv,
      tenTDV:   info.tenTDV   || tdv,
      khuVuc:   info.khuVuc   || '',
      mien:     info.mien     || '',
      qlbhCode: info.qlbhCode || '',
      totalDS, totalCI, daily,
    };
  });

  rows.sort((a, b) => {
    const qa = a.qlbhCode || a.maTDV, qb = b.qlbhCode || b.maTDV;
    return qa !== qb ? qa.localeCompare(qb) : a.maTDV.localeCompare(b.maTDV);
  });

  // Build QLBH group summary rows
  const qlbhGroups = {};
  rows.forEach(r => {
    const key = r.qlbhCode || '__nogroup';
    if (!qlbhGroups[key]) qlbhGroups[key] = { rows: [], qlbhCode: key, khuVuc: r.khuVuc, mien: r.mien };
    qlbhGroups[key].rows.push(r);
  });

  const finalRows = [];
  Object.values(qlbhGroups).forEach(grp => {
    // No group summary rows — just show individual TDV rows
    grp.rows.forEach(r => finalRows.push(r));
  });

  return { rows: finalRows, allDays, year, month };
}

// ─── Zoom helpers ────────────────────────────────────────────
function setCiZoom(delta) {
  _ciZoom = Math.round(Math.max(0.3, Math.min(2.0, _ciZoom + delta)) * 10) / 10;
  _applyCiZoom();
}

function setCiZoomFit() {
  _ciZoom = 1; _applyCiZoom();
  const section = document.getElementById('checkin-section');
  const wrap = document.querySelector('.ci-table-wrap');
  if (!section || !wrap) return;
  const avail = section.clientWidth - 24;
  const natural = wrap.scrollWidth;
  if (natural > avail) _ciZoom = Math.max(0.3, Math.round(avail / natural * 10) / 10);
  _applyCiZoom();
}

function _applyCiZoom() {
  const wrap = document.querySelector('.ci-table-wrap');
  if (wrap) wrap.style.zoom = String(_ciZoom);
  const lbl = document.getElementById('ci-zoom-label');
  if (lbl) lbl.textContent = Math.round(_ciZoom * 100) + '%';
}

// ─── Filter helpers ──────────────────────────────────────────
function _getCheckInFilters() {
  const mien  = document.getElementById('ci-filter-mien')?.value  || '';
  const qlbh  = document.getElementById('ci-filter-qlbh')?.value  || '';
  return { mien, qlbh };
}

function applyCheckInFilter() {
  if (!_ciReportData) return;
  const { mien, qlbh } = _getCheckInFilters();
  const { rows, allDays, year, month } = _ciReportData;

  const filtered = rows.filter(r => {
    if (mien && r.mien !== mien) return false;
    if (qlbh && !r.isGroup && r.qlbhCode !== qlbh) return false;
    if (qlbh &&  r.isGroup && r.maTDV   !== qlbh) return false;
    return true;
  });

  document.getElementById('ci-table-body').innerHTML = _buildCiTableBody(filtered, allDays);
}

// ─── Renderer ────────────────────────────────────────────────
function _fmtDS(v) {
  if (!v) return '';
  return Math.round(v / 1e6) + 'M';
}

function _buildCiTableBody(rows, allDays) {
  let stt = 0;
  return rows.filter(r => !r.isGroup).map(row => {
    stt++;
    const trCls = '';
    const totalFmt = row.totalCI ? String(row.totalCI) : '—';

    const dayCells = allDays.map(day => {
      const d = row.daily[day] || { ciKH: 0, ds: 0 };
      const ciStr = d.ciKH || '';
      const dsStr = _fmtDS(d.ds);
      // Red CI: checked in but < 15 KH
      const ciLow  = d.ciKH > 0 && d.ciKH < 15;
      // Orange DS: no revenue that day (includes days with CI but no DS)
      const dsNone = d.ds === 0;
      const ciCls  = 'ci-ci' + (ciLow ? ' ci-low-ci' : '');
      const dsCls  = 'ci-ds' + (d.ds > 0 ? ' ci-ds-val' : '') + (dsNone ? ' ci-no-ds-day' : '');
      return `<td class="${ciCls}">${ciStr}</td><td class="${dsCls}">${dsStr}</td>`;
    }).join('');

    return `<tr${trCls}>
      <td class="ci-stt">${stt}</td>
      <td class="ci-name">${row.tenTDV}</td>
      <td class="ci-area">${row.khuVuc}</td>
      <td class="ci-mien">${row.mien || ''}</td>
      <td class="ci-total">${totalFmt}</td>
      ${dayCells}
    </tr>`;
  }).join('');
}

function renderCheckInTable(data) {
  _ciReportData = data;
  const { rows, allDays, year, month } = data;
  if (!rows.length) return '<p style="padding:20px;color:#888">Không có dữ liệu check-in.</p>';

  // Collect unique Miền and QLBH for filters
  const mienSet  = new Set(rows.filter(r => !r.isGroup && r.mien).map(r => r.mien));
  const qlbhSet  = new Set(rows.filter(r => !r.isGroup && r.qlbhCode).map(r => r.qlbhCode));

  const mienOpts = ['<option value="">Tất cả Miền</option>',
    ...[...mienSet].sort().map(m => `<option value="${m}">${m}</option>`)].join('');
  const qlbhOpts = ['<option value="">Tất cả QLBH</option>',
    ...[...qlbhSet].sort().map(q => `<option value="${q}">${q}</option>`)].join('');

  // Day headers
  const dayHeaders = allDays.map(day => {
    const dow = new Date(year, month - 1, day).getDay();
    const isSun = dow === 0;
    return `<th colspan="2" class="ci-day-hdr${isSun ? ' ci-sun' : ''}">Day ${day}<br><span class="ci-dow">${DAY_VI[dow]}</span></th>`;
  }).join('');

  const daySubHdrs = allDays.map(day => {
    const isSun = new Date(year, month - 1, day).getDay() === 0;
    const cls = isSun ? ' ci-sun' : '';
    return `<th class="ci-sub${cls}">CI</th><th class="ci-sub ci-sub-ds${cls}">DS</th>`;
  }).join('');

  const bodyHtml = _buildCiTableBody(rows, allDays);
  const tdvCount = rows.filter(r => !r.isGroup).length;

  return `
    <div class="ci-toolbar">
      <div class="ci-info">
        <b>Tháng ${month}/${year}</b> &nbsp;·&nbsp;
        ${tdvCount} TDV &nbsp;·&nbsp; ${allDays.length} ngày check-in
      </div>
      <div class="ci-filters">
        <select id="ci-filter-mien" class="ci-select" onchange="applyCheckInFilter()">${mienOpts}</select>
        <select id="ci-filter-qlbh" class="ci-select" onchange="applyCheckInFilter()">${qlbhOpts}</select>
      </div>
      <div class="ci-zoom-controls">
        <button class="ci-zoom-btn" onclick="setCiZoom(-0.1)">−</button>
        <span id="ci-zoom-label" class="ci-zoom-label">100%</span>
        <button class="ci-zoom-btn" onclick="setCiZoom(+0.1)">+</button>
        <button class="ci-zoom-btn" onclick="setCiZoomFit()" title="Vừa màn hình" style="padding:2px 7px;font-size:12px">↔</button>
      </div>
      <button class="ci-screenshot-btn" onclick="captureCheckInReport()">📷 Chụp ảnh</button>
    </div>
    <div id="ci-capture-area">
      <div class="ci-print-hdr">BÁO CÁO CHECK-IN &nbsp;·&nbsp; Tháng ${month}/${year} &nbsp;·&nbsp; ${tdvCount} TDV &nbsp;·&nbsp; ${allDays.length} ngày</div>
      <div class="ci-table-wrap">
        <table class="ci-table">
          <thead>
            <tr>
              <th rowspan="2" class="ci-hdr">STT</th>
              <th rowspan="2" class="ci-hdr">Tên TDV</th>
              <th rowspan="2" class="ci-hdr">Khu vực</th>
              <th rowspan="2" class="ci-hdr">Miền</th>
              <th rowspan="2" class="ci-hdr">Tổng KH CI</th>
              ${dayHeaders}
            </tr>
            <tr>${daySubHdrs}</tr>
          </thead>
          <tbody id="ci-table-body">${bodyHtml}</tbody>
        </table>
      </div>
    </div>`;
}

// ─── Screenshot ──────────────────────────────────────────────
async function captureCheckInReport() {
  const el = document.getElementById('ci-capture-area');
  if (!el) return;
  if (typeof html2canvas === 'undefined') {
    alert('html2canvas chưa tải. Cần kết nối internet.');
    return;
  }
  const btn = document.querySelector('.ci-screenshot-btn');
  const wrap = document.querySelector('.ci-table-wrap');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang chụp...'; }

  // Reset zoom and remove overflow so html2canvas captures the FULL table width
  const prevZoom = _ciZoom;
  const prevWrapOverflow = wrap ? wrap.style.overflow : '';
  const prevWrapWidth    = wrap ? wrap.style.width    : '';
  const prevElWidth      = el.style.width;
  const prevElOverflow   = el.style.overflow;

  _ciZoom = 1;
  if (wrap) { wrap.style.zoom = '1'; wrap.style.overflow = 'visible'; wrap.style.width = 'max-content'; }
  el.style.overflow = 'visible';
  el.style.width    = 'max-content';

  await new Promise(r => setTimeout(r, 80));

  try {
    const fullW = el.scrollWidth;
    const fullH = el.scrollHeight;
    const canvas = await html2canvas(el, {
      backgroundColor: '#fff',
      scale: 2,
      useCORS: true,
      allowTaint: true,
      scrollX: 0, scrollY: 0,
      windowWidth: fullW,
      width: fullW,
      height: fullH,
    });
    const link = document.createElement('a');
    const d = _ciReportData;
    link.download = `CheckIn_T${d?.month || ''}_${d?.year || ''}_${new Date().toLocaleDateString('vi-VN').replace(/\//g,'-')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch(err) {
    alert('Lỗi chụp ảnh: ' + err.message);
  } finally {
    // Restore all styles
    if (wrap) { wrap.style.overflow = prevWrapOverflow; wrap.style.width = prevWrapWidth; wrap.style.zoom = String(prevZoom); }
    el.style.overflow = prevElOverflow;
    el.style.width    = prevElWidth;
    _ciZoom = prevZoom;
    if (btn) { btn.disabled = false; btn.textContent = '📷 Chụp ảnh'; }
  }
}
