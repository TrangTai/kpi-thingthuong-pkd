// ============================================================
// ANALYTICS-KH-MOI.JS - Theo dõi Khách hàng Mới
// ============================================================

let _khMoiReport = null; // last calculated report

// Public accessor used by renderer.js to populate KH Mới column
function getKhMoiCount(maTDV) {
  if (!_khMoiReport?.tdvRows) return null;
  const t = _khMoiReport.tdvRows.find(t => t.maTDV === (maTDV || '').trim().toUpperCase());
  return t ? t.khList.length : 0;
}

// ─── Parser helper: remove Vietnamese diacritics for flexible matching ───────
function _normVI(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd').trim();
}

// ─── Parser: DSKH.xlsx ───────────────────────────────────────
// Actual format: Mã KH | Tên KH | Địa chỉ | Mã TDV  (4 columns, no Miền/TDV info)
// Miền + TDV info is looked up from staticData.targets later in calculateKhMoi
function parseDSKHMoi(arrayBuffer) {
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 2) return [];

  const header = rows[0].map(h => _normVI(h));

  const _findCol = (...keys) => {
    for (const k of keys) {
      const i = header.findIndex(h => h.includes(_normVI(k)));
      if (i >= 0) return i;
    }
    return -1;
  };

  const cMaKH   = _findCol('ma kh', 'makh', 'customer code', 'ma kh');
  const cTenKH  = _findCol('ten kh', 'tenkh', 'khach hang');
  const cMaTDV  = _findCol('ma tdv', 'matdv', 'ma nv', 'manv');
  const cTenTDV = _findCol('ten tdv', 'tentdv', 'ten nv');
  const cKhuVuc = _findCol('khu vuc', 'khuvuc');
  const cMien   = _findCol('mien', 'vung');
  const cQlbh   = _findCol('qlbh', 'quan ly ban hang');

  if (cMaKH < 0) throw new Error('Không tìm thấy cột "Mã KH" trong DSKH.xlsx. Hàng đầu tiên phải là header.');

  const list = [];
  for (let i = 1; i < rows.length; i++) {
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
// Actual format: Mã ĐH | Ngày ĐH | Mã KH | Tên KH | Mã SP | Tên SP | SL | Giá | Tổng Tiền | Mã TDV | Tên TDV | Năm | Tháng
// Returns: { khMap: {maKH → ds6M}, months: ['YYYY-MM', ...] }
function parseDonHang6Thang(arrayBuffer) {
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 2) return { khMap: {}, months: [] };

  // Detect columns from header row (row 0)
  const header = rows[0].map(h => _normVI(h));
  const _fc = (...keys) => {
    for (const k of keys) {
      const i = header.findIndex(h => h.includes(_normVI(k)));
      if (i >= 0) return i;
    }
    return -1;
  };

  const cMaKH  = _fc('ma kh', 'makh');
  const cDS     = _fc('tong tien', 'doanh so', 'thanh tien', 'so tien');
  const cNam    = _fc('nam');
  const cThang  = _fc('thang');

  if (cMaKH < 0) throw new Error('Không tìm thấy cột "Mã KH" trong DONHANG_6_THANG.xlsx');
  if (cDS    < 0) throw new Error('Không tìm thấy cột "Tổng Tiền" trong DONHANG_6_THANG.xlsx');

  const khMap   = {};
  const monthSet = new Set();

  for (let i = 1; i < rows.length; i++) {
    const row  = rows[i];
    const maKH = String(row[cMaKH] || '').trim();
    if (!maKH) continue;
    const ds = parseFloat(row[cDS]) || 0;

    // Extract month key
    let monthKey = null;
    if (cNam >= 0 && cThang >= 0 && row[cNam] && row[cThang]) {
      const y = parseInt(row[cNam]);
      const m = parseInt(row[cThang]);
      if (y > 2000 && m >= 1 && m <= 12) {
        monthKey = `${y}-${String(m).padStart(2, '0')}`;
      }
    }
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

  // Look up TDV info from staticData.targets (mien, khuVuc, tenTDV, qlbhCode)
  const targetMap = {};
  if (typeof staticData !== 'undefined' && staticData.targets) {
    staticData.targets.forEach(t => {
      targetMap[(t.maTDV || '').toUpperCase()] = t;
    });
  }

  // Determine month labels for display
  const now = new Date();
  const currentMonthLabel = `T${now.getMonth() + 1}/${now.getFullYear()}`;
  const historyLabel = months6.length >= 2
    ? `T${parseInt(months6[0].split('-')[1])}/${months6[0].split('-')[0]} - T${parseInt(months6[months6.length-1].split('-')[1])}/${months6[months6.length-1].split('-')[0]}`
    : (months6.length === 1 ? `T${parseInt(months6[0].split('-')[1])}/${months6[0].split('-')[0]}` : 'DS 6 tháng');

  // Group KH by TDV
  const tdvMap = {};
  dskhList.forEach(kh => {
    const tdvKey = (kh.maTDV || '').toUpperCase() || '__none';
    const tInfo  = targetMap[tdvKey] || {};
    if (!tdvMap[tdvKey]) {
      tdvMap[tdvKey] = {
        maTDV:    tdvKey,
        tenTDV:   kh.tenTDV || tInfo.tenTDV || tdvKey,
        khuVuc:   kh.khuVuc || tInfo.khuVuc || '',
        mien:     kh.mien   || tInfo.mien   || '',
        qlbhCode: kh.qlbhCode || tInfo.qlbhCode || tInfo.qlbh || '',
        khList:   [],
      };
    }
    const ds6M       = khMap6M[kh.maKH] || 0;
    const dsCurrentM = currentDsMap[kh.maKH] || 0;

    // KH mới candidate: no DS in previous 6 months
    if (ds6M === 0) {
      tdvMap[tdvKey].khList.push({
        maKH:        kh.maKH,
        tenKH:       kh.tenKH,
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
  <select id="km-filter-mien" class="ci-select" onchange="onKhMoiMienChange()">${mienOpts}</select>
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
    <span class="km-badge km-badge-total">Tổng ${t.khList.length} KH</span>
    <span class="km-badge km-badge-ok">${daMua} đã mua ${currentMonthLabel}</span>
    <span class="km-badge km-badge-gray">${chuaMua} KH chưa mua</span>
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

function onKhMoiMienChange() {
  if (!_khMoiReport) return;
  const mien = document.getElementById('km-filter-mien')?.value || '';
  const tdvSel = document.getElementById('km-filter-tdv');
  if (tdvSel) {
    const visible = mien
      ? _khMoiReport.tdvRows.filter(t => t.mien === mien)
      : _khMoiReport.tdvRows;
    tdvSel.innerHTML = ['<option value="">Tất cả TDV</option>',
      ...visible.map(t => `<option value="${t.maTDV}">${t.tenTDV}</option>`)
    ].join('');
  }
  applyKhMoiFilter();
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
