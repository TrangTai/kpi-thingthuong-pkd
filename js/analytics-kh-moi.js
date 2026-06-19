// ============================================================
// ANALYTICS-KH-MOI.JS - Theo dõi Khách hàng Mới
// ============================================================

let _khMoiReport = null; // last calculated report

// ─── Parser: DSKH.xlsx ───────────────────────────────────────
// Expected columns (flexible header detection): Mã KH, Tên KH, Mã TDV, Tên TDV, Khu vực, Miền, QLBH
function parseDSKHMoi(arrayBuffer) {
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 2) return [];

  // Find header row (first row containing recognizable columns)
  let headerIdx = 0;
  let header = rows[0].map(h => String(h).toLowerCase().trim());

  const _findCol = (keys) => {
    for (const k of keys) {
      const i = header.findIndex(h => h.includes(k));
      if (i >= 0) return i;
    }
    return -1;
  };

  const cMaKH   = _findCol(['mã kh', 'ma kh', 'makh', 'customer']);
  const cTenKH  = _findCol(['tên kh', 'ten kh', 'tenkh', 'khách hàng', 'khach hang']);
  const cMaTDV  = _findCol(['mã tdv', 'ma tdv', 'matdv', 'mã nv', 'ma nv']);
  const cTenTDV = _findCol(['tên tdv', 'ten tdv', 'tentdv', 'tên nv', 'ten nv']);
  const cKhuVuc = _findCol(['khu vực', 'khu vuc', 'khuvuc', 'kv']);
  const cMien   = _findCol(['miền', 'mien', 'vùng', 'vung']);
  const cQlbh   = _findCol(['qlbh', 'quản lý', 'quan ly']);

  if (cMaKH < 0) throw new Error('Không tìm thấy cột "Mã KH" trong DSKH.xlsx');

  const list = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const maKH = String(row[cMaKH] || '').trim();
    if (!maKH) continue;
    list.push({
      maKH,
      tenKH:    cTenKH  >= 0 ? String(row[cTenKH]  || '').trim() : '',
      maTDV:    cMaTDV  >= 0 ? String(row[cMaTDV]  || '').trim().toUpperCase() : '',
      tenTDV:   cTenTDV >= 0 ? String(row[cTenTDV] || '').trim() : '',
      khuVuc:   cKhuVuc >= 0 ? String(row[cKhuVuc] || '').trim() : '',
      mien:     cMien   >= 0 ? String(row[cMien]   || '').trim() : '',
      qlbhCode: cQlbh   >= 0 ? String(row[cQlbh]   || '').trim().toUpperCase() : '',
    });
  }
  return list;
}

// ─── Parser: DONHANG_6_THANG.xlsx ────────────────────────────
// Returns: { khMap: {maKH → ds6M}, months: ['YYYY-MM', ...] }
// Reuses same column layout as ĐƠN HÀNG (col D=maKH, col N=doanhSo, col O=ngayTao)
function parseDonHang6Thang(arrayBuffer) {
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

  // Try to detect columns from header row
  const headerRow = 1; // row index 1 = row 2 (0-based)
  const getCell = (r, c) => {
    const a = XLSX.utils.encode_cell({ r, c });
    return ws[a] ? String(ws[a].v || '').toLowerCase().trim() : '';
  };

  // Find columns by scanning header
  let cMaKH = 3, cDS = 13, cNgay = 14; // defaults: D, N, O (0-indexed)
  for (let c = 0; c <= Math.min(range.e.c, 30); c++) {
    const h = getCell(1, c);
    if (h.includes('mã kh') || h.includes('ma kh') || h === 'makh') cMaKH = c;
    if ((h.includes('doanh số') || h.includes('doanh so') || h.includes('tổng tiền') || h.includes('tong tien')) && cDS === 13) cDS = c;
    if (h.includes('ngày') && (h.includes('tạo') || h.includes('đơn') || h.includes('giao'))) cNgay = c;
  }

  const khMap = {};
  const monthSet = new Set();

  for (let r = 2; r <= range.e.r; r++) {
    const maKHCell = ws[XLSX.utils.encode_cell({ r, c: cMaKH })];
    const dsCell   = ws[XLSX.utils.encode_cell({ r, c: cDS   })];
    const ngayCell = ws[XLSX.utils.encode_cell({ r, c: cNgay })];
    if (!maKHCell || !dsCell) continue;

    const maKH = String(maKHCell.v || '').trim();
    if (!maKH) continue;
    const ds = parseFloat(dsCell.v) || 0;

    // Extract month from date
    let dt = null;
    if (ngayCell) {
      if (ngayCell.t === 'n' && ngayCell.v > 1000) {
        dt = new Date(Math.round((ngayCell.v - 25569) * 86400 * 1000));
      } else if (ngayCell.t === 'd') {
        dt = ngayCell.v;
      } else if (ngayCell.t === 's') {
        const p = String(ngayCell.v).split(/[\/\-\.]/);
        if (p.length >= 3) {
          const y = parseInt(p[2]) > 100 ? parseInt(p[2]) : parseInt(p[0]);
          const m = parseInt(p[1]) - 1;
          const d = parseInt(p[2]) > 100 ? parseInt(p[1]) : parseInt(p[2]);
          dt = new Date(y, m, d);
        }
      }
    }

    const monthKey = dt
      ? `${dt.getUTCFullYear?.() || dt.getFullYear()}-${String((dt.getUTCMonth?.() ?? dt.getMonth()) + 1).padStart(2,'0')}`
      : null;
    if (monthKey) monthSet.add(monthKey);

    if (!khMap[maKH]) khMap[maKH] = 0;
    khMap[maKH] += ds;
  }

  return { khMap, months: [...monthSet].sort() };
}

// ─── Calculator ──────────────────────────────────────────────
const KH_MOI_MIN_DS = 500000; // 500k ngưỡng tính KH mới

function calculateKhMoi(dskhList, donHang6Data, currentOrders) {
  const khMap6M = donHang6Data?.khMap || {};
  const months6 = donHang6Data?.months || [];

  // current month DS: {maKH → ds}
  const currentDsMap = {};
  (currentOrders || []).forEach(o => {
    const k = (o.maKH || '').trim();
    if (!k) return;
    if (!currentDsMap[k]) currentDsMap[k] = 0;
    currentDsMap[k] += o.doanhSo || 0;
  });

  // Determine month labels for display
  const now = new Date();
  const currentMonthLabel = `T${now.getMonth() + 1}/${now.getFullYear()}`;
  const historyLabel = months6.length >= 2
    ? `T${parseInt(months6[0].split('-')[1])}/${months6[0].split('-')[0]} - T${parseInt(months6[months6.length-1].split('-')[1])}/${months6[months6.length-1].split('-')[0]}`
    : 'DS 6 tháng';

  // Group KH by TDV
  const tdvMap = {};
  dskhList.forEach(kh => {
    const key = kh.maTDV || '__none';
    if (!tdvMap[key]) {
      tdvMap[key] = {
        maTDV:  kh.maTDV,
        tenTDV: kh.tenTDV || kh.maTDV,
        khuVuc: kh.khuVuc,
        mien:   kh.mien,
        qlbhCode: kh.qlbhCode,
        khList: [],
      };
    }
    const ds6M      = khMap6M[kh.maKH] || 0;
    const dsCurrentM = currentDsMap[kh.maKH] || 0;

    // KH mới candidate: no DS in previous 6 months
    if (ds6M === 0) {
      tdvMap[key].khList.push({
        maKH:     kh.maKH,
        tenKH:    kh.tenKH,
        ds6M,
        dsCurrentM,
        isTinhKhMoi: dsCurrentM >= KH_MOI_MIN_DS,
      });
    }
  });

  const tdvRows = Object.values(tdvMap)
    .filter(t => t.khList.length > 0)
    .sort((a, b) => (a.mien || '').localeCompare(b.mien || '') || a.tenTDV.localeCompare(b.tenTDV));

  return { tdvRows, currentMonthLabel, historyLabel, dskhTotal: dskhList.length };
}

// ─── Renderer ────────────────────────────────────────────────
function renderKhMoiTab(data) {
  _khMoiReport = data;
  const { tdvRows, currentMonthLabel, historyLabel, dskhTotal } = data;

  if (!tdvRows.length) {
    return '<p style="padding:20px;color:#888">Không có KH mới (tất cả đều đã có DS 6 tháng).</p>';
  }

  const mienSet = new Set(tdvRows.map(t => t.mien).filter(Boolean));
  const mienOpts = ['<option value="">Tất cả Miền</option>',
    ...[...mienSet].sort().map(m => `<option value="${m}">${m}</option>`)].join('');
  const tdvOpts = ['<option value="">Tất cả TDV</option>',
    ...tdvRows.map(t => `<option value="${t.maTDV}">${t.tenTDV}</option>`)].join('');

  const totalKhMoi  = tdvRows.reduce((s, t) => s + t.khList.length, 0);
  const totalDaMua  = tdvRows.reduce((s, t) => s + t.khList.filter(k => k.isTinhKhMoi).length, 0);

  const accordionHtml = tdvRows.map(t => _buildTdvRow(t, historyLabel, currentMonthLabel)).join('');

  return `
<div class="km-toolbar">
  <div class="km-info">
    <b>DANH SÁCH KH MỚI · ${currentMonthLabel}</b>
    <span class="km-sub">KH chưa lấy hàng 6 tháng (${historyLabel}) và DS ${currentMonthLabel} ≥ ${(KH_MOI_MIN_DS/1000).toFixed(0)}k</span>
  </div>
  <div class="km-summary">
    <span class="km-badge km-badge-total">${totalKhMoi} KH mới</span>
    <span class="km-badge km-badge-ok">${totalDaMua} đã mua</span>
    <span class="km-badge km-badge-gray">${totalKhMoi - totalDaMua} chưa mua</span>
  </div>
</div>
<div class="km-filters">
  <select id="km-filter-mien" class="ci-select" onchange="applyKhMoiFilter()">${mienOpts}</select>
  <select id="km-filter-tdv"  class="ci-select" onchange="applyKhMoiFilter()">${tdvOpts}</select>
  <button class="ci-screenshot-btn" onclick="captureKhMoiReport()">📷 Chụp ảnh</button>
</div>
<div id="km-capture-area">
  <div id="km-accordion">${accordionHtml}</div>
</div>`;
}

function _buildTdvRow(t, historyLabel, currentMonthLabel) {
  const daMua   = t.khList.filter(k => k.isTinhKhMoi).length;
  const chuaMua = t.khList.length - daMua;
  const id = 'km-' + t.maTDV.replace(/\W/g, '_');

  const tableRows = t.khList.map((kh, i) => {
    const hasCurrent = kh.dsCurrentM > 0;
    const tinhMoi    = kh.isTinhKhMoi;
    const rowCls     = tinhMoi ? 'km-row-ok' : 'km-row-miss';
    const dsFmt      = v => v > 0 ? Math.round(v).toLocaleString('vi-VN') : '-';
    return `<tr class="${rowCls}">
      <td class="km-td-stt">${i + 1}</td>
      <td class="km-td-makn">${kh.maKH}</td>
      <td class="km-td-name">${kh.tenKH}</td>
      <td class="km-td-ds6m">${dsFmt(kh.ds6M)}</td>
      <td class="km-td-dscur ${hasCurrent ? 'km-cur-ok' : ''}">${dsFmt(kh.dsCurrentM)}</td>
      <td class="km-td-tinh ${tinhMoi ? 'km-tinh-ok' : ''}">${tinhMoi ? '1' : ''}</td>
    </tr>`;
  }).join('');

  return `
<div class="km-tdv-block" data-mien="${t.mien || ''}" data-matdv="${t.maTDV}">
  <div class="km-tdv-header" onclick="toggleKhMoiTDV('${id}')">
    <span class="km-toggle-icon" id="icon-${id}">▶</span>
    <span class="km-tdv-name">${t.tenTDV}</span>
    <span class="km-tdv-area">${t.khuVuc || ''}</span>
    <span class="km-tdv-mien">${t.mien || ''}</span>
    <span class="km-badge km-badge-total">${t.khList.length} KH</span>
    <span class="km-badge km-badge-ok">${daMua} đã mua</span>
    ${chuaMua > 0 ? `<span class="km-badge km-badge-miss">${chuaMua} chưa</span>` : ''}
  </div>
  <div class="km-tdv-body" id="${id}" style="display:none">
    <table class="km-table">
      <thead>
        <tr>
          <th>STT</th><th>Mã KH</th><th>Tên KH</th>
          <th>DS ${historyLabel}</th><th>DS ${currentMonthLabel}</th><th>Tính KH mới</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>
</div>`;
}

function toggleKhMoiTDV(id) {
  const body = document.getElementById(id);
  const icon = document.getElementById('icon-' + id);
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (icon) icon.textContent = open ? '▶' : '▼';
}

function applyKhMoiFilter() {
  if (!_khMoiReport) return;
  const mien = document.getElementById('km-filter-mien')?.value || '';
  const matdv = document.getElementById('km-filter-tdv')?.value || '';
  document.querySelectorAll('.km-tdv-block').forEach(el => {
    const show = (!mien || el.dataset.mien === mien) && (!matdv || el.dataset.matdv === matdv);
    el.style.display = show ? '' : 'none';
  });
}

function captureKhMoiReport() {
  const el = document.getElementById('km-capture-area');
  if (!el) return;
  if (typeof html2canvas === 'undefined') { alert('html2canvas chưa tải.'); return; }
  const btn = document.querySelector('.ci-screenshot-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang chụp...'; }

  // Temporarily expand all rows for capture
  const bodies = el.querySelectorAll('.km-tdv-body');
  const prevDisplay = [...bodies].map(b => b.style.display);
  bodies.forEach(b => { b.style.display = ''; });

  html2canvas(el, {
    backgroundColor: '#fff', scale: 2, useCORS: true, allowTaint: true,
    scrollX: 0, scrollY: 0, windowWidth: el.scrollWidth,
    width: el.scrollWidth, height: el.scrollHeight,
  }).then(canvas => {
    const link = document.createElement('a');
    const now  = new Date().toLocaleDateString('vi-VN').replace(/\//g, '-');
    link.download = `KH_Moi_${now}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }).catch(e => alert('Lỗi: ' + e.message))
  .finally(() => {
    bodies.forEach((b, i) => { b.style.display = prevDisplay[i]; });
    if (btn) { btn.disabled = false; btn.textContent = '📷 Chụp ảnh'; }
  });
}
