// ============================================================
// APP.JS - Orchestration + Preview + Formula Panel
// ============================================================

const SK = {
  config:   'kpi_config_v1',
  results:  'kpi_results_v2',
  donHang:  'kpi_static_donhang_v2',
  dhLon:    'kpi_static_dhlon_v2',
  target:   'kpi_static_target_v2',
  dskh:     'kpi_static_dskh_v2',
  bangGia:  'kpi_static_banggia_v2',
};

const uploadedFiles = {
  donHang: null, dhLon: null, target: null, dskh: null, bangGia: null,
};

const staticData = {
  donHangOrders: null,
  dhLonOrders:   null,
  targets:       null,
  companyKhMap:  null,
  bangGiaMap:    null,
};

// Raw preview data (first 200 rows) for each file
const previewData = {
  donHang:  null,   // [{...order}]
  dhLon:    null,
  targets:  null,
  dskh:     null,   // [[key, value]] pairs
  bangGia:  null,   // [[maSP, nhomTinhLuong, nhomPTML]]
};

// ─── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupFileInput('input-don-hang', 'badge-don-hang', 'label-don-hang', f => { uploadedFiles.donHang = f; });
  setupFileInput('input-dh-lon',   'badge-dh-lon',   'label-dh-lon',   f => { uploadedFiles.dhLon   = f; onStaticUpload('dhLon', f, parseDhLon, SK.dhLon, 'dhLonOrders'); }, false);
  setupFileInput('input-target',   'badge-target',   'label-target',   f => { uploadedFiles.target  = f; onStaticUpload('target', f, parseTarget, SK.target, 'targets'); }, false);
  setupFileInput('input-dskh',     'badge-dskh',     'label-dskh',     f => { uploadedFiles.dskh    = f; onStaticUpload('dskh', f, parseDSKHCongTy, SK.dskh, 'companyKhMap'); }, false);
  setupFileInput('input-bang-gia', 'badge-bang-gia', 'label-bang-gia', f => { uploadedFiles.bangGia = f; onStaticUpload('bangGia', f, parseBangGia, SK.bangGia, 'bangGiaMap'); }, false);

  document.getElementById('btn-calculate').addEventListener('click', onCalculate);
  document.getElementById('btn-export').addEventListener('click', onExport);
  document.getElementById('btn-clear').addEventListener('click', onClear);
  document.getElementById('btn-config').addEventListener('click', toggleFormulaPanel);

  loadConfigFromStorage();
  loadStaticFromStorage();
  loadResultsFromStorage();
  initFormulaPanel();
});

// ─── File input setup ────────────────────────────────────────
function setupFileInput(inputId, badgeId, labelId, onLoad, isMain = true) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    onLoad(file);
    if (isMain) setBadge(badgeId, labelId, '✓', 'badge-ok', file.name);
  });
}

function setBadge(badgeId, labelId, text, cls, label) {
  const badge = document.getElementById(badgeId);
  const lbl   = document.getElementById(labelId);
  if (badge) { badge.textContent = text; badge.className = 'badge ' + cls; }
  if (lbl)   lbl.textContent = label;
}

// ─── Static file upload ──────────────────────────────────────
async function onStaticUpload(key, file, parseFn, storageKey, dataKey) {
  const bk = key.replace(/([A-Z])/g, m => '-' + m.toLowerCase());
  setBadge('badge-' + bk, 'label-' + bk, '⏳', 'badge-loading', 'Đang đọc...');
  try {
    const data = await parseFn(file);
    staticData[dataKey] = data;
    _storePreview(key, data);
    try { localStorage.setItem(storageKey, JSON.stringify({ data, fileName: file.name, ts: Date.now() })); } catch(e) {}
    const count = Array.isArray(data) ? data.length : Object.keys(data).length;
    setBadge('badge-' + bk, 'label-' + bk, '✓', 'badge-ok', file.name + ' (' + count + ')');
    _showEyeBtn(bk, key);
  } catch(err) {
    setBadge('badge-' + bk, 'label-' + bk, '!', 'badge-err', 'Lỗi: ' + err.message);
  }
}

// ─── Preview data helpers ────────────────────────────────────
function _storePreview(key, data) {
  if (key === 'donHang')previewData.donHang = data || [];
  if (key === 'dhLon')  previewData.dhLon   = data || [];
  if (key === 'target') previewData.targets = data || [];
  if (key === 'dskh')   previewData.dskh    = Object.entries(data || {});
  if (key === 'bangGia')previewData.bangGia = Object.entries(data || {});
}

function _showEyeBtn(badgeKey, dataKey) {
  const labelEl = document.getElementById('label-' + badgeKey);
  if (!labelEl) return;
  let btn = labelEl.parentElement.querySelector('.btn-file-export');
  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'btn-file-export';
    btn.title = 'Xuất dữ liệu đã import ra Excel';
    btn.textContent = '⬇ Excel';
    btn.onclick = e => { e.stopPropagation(); e.preventDefault(); exportFileData(dataKey); };
    labelEl.parentElement.appendChild(btn);
  }
}

// ─── Xuất dữ liệu từng file ra Excel ─────────────────────────
function exportFileData(key) {
  const wb = XLSX.utils.book_new();
  let fname = 'export';

  if (key === 'donHang' || key === 'dhLon') {
    const data = key === 'donHang' ? previewData.donHang : previewData.dhLon;
    if (!data || !data.length) { alert('Chưa có dữ liệu.'); return; }
    fname = key === 'donHang' ? 'DonHang' : 'DHLon';
    const hdrs = ['Mã ĐH','Mã KH','Tên KH','Mã SP','Tên SP','Mã NV','Tổng tiền','DS ĐPMH','SL','Ngày (ngày)','Nhóm TL','Nhóm PTML','KH CT?'];
    const rows = data.map(o => [
      o.maDH, o.maKH, o.tenKH, o.maSP, o.tenSP, o.maNV,
      Math.round(o.doanhSo), Math.round(o.doanhSoDPMH),
      o.soLuong || 0, o.ngayDay || 0,
      o.nhomTinhLuong, o.nhomPTML, o.isCompanyKH ? 'Có' : '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([hdrs, ...rows]);
    ws['!cols'] = [8,10,20,8,20,8,14,14,6,8,10,10,6].map(w => ({ wch: w }));
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };
    XLSX.utils.book_append_sheet(wb, ws, 'Dữ liệu');
  } else if (key === 'target') {
    const data = previewData.targets;
    if (!data || !data.length) { alert('Chưa có dữ liệu.'); return; }
    fname = 'Target';
    const hdrs = ['Mã TDV','Tên TDV','Khu vực','Miền','QLBH','Đối tượng','DS Tổng Target','ĐPKH Target','ĐPMH Target'];
    const rows = data.map(t => [t.maTDV, t.tenTDV, t.khuVuc, t.mien, t.qlbh, t.doiTuong, t.dsTongTarget, t.dpkhTarget, t.dpmhTarget]);
    const ws = XLSX.utils.aoa_to_sheet([hdrs, ...rows]);
    ws['!cols'] = [8,20,14,8,18,8,15,8,8].map(w => ({ wch: w }));
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };
    XLSX.utils.book_append_sheet(wb, ws, 'Target');
  } else if (key === 'dskh') {
    const data = previewData.dskh;
    if (!data || !data.length) { alert('Chưa có dữ liệu.'); return; }
    fname = 'DSKH_CongTy';
    const ws = XLSX.utils.aoa_to_sheet([['Mã KH','Mã TDV (chấm)'], ...data.map(([k,v]) => [k, v])]);
    ws['!cols'] = [12,14].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, 'DSKH CT');
  } else if (key === 'bangGia') {
    const data = previewData.bangGia;
    if (!data || !data.length) { alert('Chưa có dữ liệu.'); return; }
    fname = 'BangGia';
    const ws = XLSX.utils.aoa_to_sheet([['Mã SP','Nhóm TL','Nhóm PTML'], ...data.map(([k,v]) => [k, v.nhomTinhLuong, v.nhomPTML])]);
    ws['!cols'] = [10,14,12].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, 'Bảng giá');
  } else {
    return;
  }

  XLSX.writeFile(wb, fname + '_export.xlsx');
}

// ─── Load static from localStorage ──────────────────────────
function loadStaticFromStorage() {
  const defs = [
    { key: SK.donHang, dataKey: 'donHangOrders', previewKey: 'donHang', badgeKey: 'don-hang', label: 'ĐƠN HÀNG' },
    { key: SK.dhLon,   dataKey: 'dhLonOrders',   previewKey: 'dhLon',   badgeKey: 'dh-lon',   label: 'ĐH lộn' },
    { key: SK.target,  dataKey: 'targets',        previewKey: 'target',  badgeKey: 'target',   label: 'Target' },
    { key: SK.dskh,    dataKey: 'companyKhMap',   previewKey: 'dskh',    badgeKey: 'dskh',     label: 'DSKH CT' },
    { key: SK.bangGia, dataKey: 'bangGiaMap',     previewKey: 'bangGia', badgeKey: 'bang-gia', label: 'Bảng giá' },
  ];
  for (const def of defs) {
    try {
      const raw = localStorage.getItem(def.key);
      if (!raw) continue;
      const saved = JSON.parse(raw);
      staticData[def.dataKey] = saved.data;
      _storePreview(def.previewKey, saved.data);
      const count = Array.isArray(saved.data) ? saved.data.length : Object.keys(saved.data).length;
      const ts = new Date(saved.ts).toLocaleDateString('vi-VN');
      setBadge('badge-' + def.badgeKey, 'label-' + def.badgeKey, '💾', 'badge-cached',
               (saved.fileName || def.label) + ' · ' + ts + ' (' + count + ')');
      _showEyeBtn(def.badgeKey, def.previewKey);
    } catch(e) {}
  }
}

// ─── Tính Thưởng ─────────────────────────────────────────────
let lastCalcData = null;

async function onCalculate() {
  const btn    = document.getElementById('btn-calculate');
  const output = document.getElementById('output');

  if (!uploadedFiles.donHang && !staticData.donHangOrders) { showError('Vui lòng upload file ĐƠN HÀNG.'); return; }
  if (!staticData.targets) { showError('Chưa có dữ liệu TARGET. Vui lòng upload file Target.'); return; }

  btn.disabled = true; btn.textContent = 'Đang tính...';
  output.innerHTML = '<div class="loading">Đang xử lý dữ liệu, vui lòng đợi...</div>';

  try {
    let donHangOrders;
    if (uploadedFiles.donHang) {
      const dhSource = (document.querySelector('input[name="dh-source"]:checked') || {}).value || 'qtsl';
      const parseFn  = dhSource === 'kinhdoanh' ? parseDonHangKinhDoanh : parseDonHang;
      donHangOrders = await parseFn(uploadedFiles.donHang);
      staticData.donHangOrders = donHangOrders;
      _storePreview('donHang', donHangOrders);
      _showEyeBtn('don-hang', 'donHang');
      try {
        localStorage.setItem(SK.donHang, JSON.stringify({ data: donHangOrders, fileName: uploadedFiles.donHang.name, ts: Date.now() }));
      } catch(e) {}
    } else {
      donHangOrders = staticData.donHangOrders;
    }

    const dhLonOrders  = staticData.dhLonOrders  || [];
    const targets      = staticData.targets;
    const companyKhMap = staticData.companyKhMap || {};
    const bangGiaMap   = staticData.bangGiaMap   || {};

    let allOrders = [...donHangOrders, ...dhLonOrders];
    enrichOrdersWithBangGia(allOrders, bangGiaMap);
    enrichOrders(allOrders, companyKhMap);

    const totalOrders   = allOrders.length;
    const companyOrders = allOrders.filter(o => o.isCompanyKH).length;

    const { results, dpkhDetail, dpmhDetail } = calculateKPI(allOrders, targets);
    lastCalcData = { results, dpkhDetail, dpmhDetail };

    const statsText = 'Đã xử lý <b>' + totalOrders.toLocaleString('vi-VN') + '</b> đơn · ' +
                      '<b>' + companyOrders.toLocaleString('vi-VN') + '</b> KH công ty · ' +
                      '<b>' + targets.length + '</b> TDV/QLBH';

    saveResults(results, dpkhDetail, dpmhDetail, statsText);
    renderOutput(results, statsText, new Date());
    document.getElementById('btn-export').style.display = 'inline-block';
    if (document.getElementById('tab-btn-bao-cao').classList.contains('tab-active')) {
      renderAnalytics(results);
    }

  } catch (err) {
    showError('Lỗi: ' + err.message);
    console.error(err);
  } finally {
    btn.disabled = false; btn.textContent = 'Tính Thưởng';
  }
}

function renderOutput(results, statsText, timestamp) {
  document.getElementById('output').innerHTML = renderTable(results);

  const statsEl = document.getElementById('stats');
  if (statsEl) { statsEl.innerHTML = statsText; statsEl.style.display = 'inline'; }

  const savedEl = document.getElementById('saved-info');
  if (savedEl && timestamp) {
    const fmtDt = new Intl.DateTimeFormat('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    savedEl.innerHTML = '💾 Lần cuối: <b>' + fmtDt.format(timestamp) + '</b>';
    savedEl.style.display = 'inline';
  }
  document.getElementById('btn-clear').style.display = 'inline-block';
}

// ─── localStorage: kết quả ───────────────────────────────────
function saveResults(results, dpkhDetail, dpmhDetail, statsText) {
  try {
    localStorage.setItem(SK.results, JSON.stringify({ results, dpkhDetail, dpmhDetail, statsText, ts: Date.now() }));
  } catch(e) { console.warn('localStorage full?', e); }
}

function loadResultsFromStorage() {
  try {
    const raw = localStorage.getItem(SK.results);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (!p || !p.results || !p.results.length) return;
    lastCalcData = { results: p.results, dpkhDetail: p.dpkhDetail || [], dpmhDetail: p.dpmhDetail || [] };
    renderOutput(p.results, p.statsText, new Date(p.ts));
    document.getElementById('btn-export').style.display = 'inline-block';
  } catch(e) {}
}

function onExport() {
  if (!lastCalcData) { alert('Chưa có kết quả để xuất.'); return; }
  exportToExcel(lastCalcData.results, lastCalcData.dpkhDetail, lastCalcData.dpmhDetail);
}

function onClear() {
  if (!confirm('Xóa toàn bộ dữ liệu đã lưu (kết quả + các file tĩnh)?')) return;
  Object.values(SK).forEach(k => localStorage.removeItem(k));
  Object.keys(staticData).forEach(k => { staticData[k] = null; });
  Object.keys(previewData).forEach(k => { previewData[k] = null; });
  lastCalcData = null;

  document.getElementById('output').innerHTML =
    '<div class="loading" style="color:#bbb">Upload file và nhấn <b>Tính Thưởng</b> để bắt đầu.</div>';

  ['stats','saved-info'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  });
  ['btn-export','btn-clear'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  [
    { badge:'badge-don-hang', label:'label-don-hang', text:'!', cls:'badge-pending', lbl:'Chưa chọn file...' },
    { badge:'badge-dh-lon',   label:'label-dh-lon',   text:'○', cls:'badge-pending', lbl:'Không bắt buộc' },
    { badge:'badge-target',   label:'label-target',   text:'!', cls:'badge-pending', lbl:'Chưa chọn file...' },
    { badge:'badge-dskh',     label:'label-dskh',     text:'○', cls:'badge-pending', lbl:'Không bắt buộc' },
    { badge:'badge-bang-gia', label:'label-bang-gia', text:'○', cls:'badge-pending', lbl:'Không bắt buộc' },
  ].forEach(d => setBadge(d.badge, d.label, d.text, d.cls, d.lbl));
  switchTab('tinh-thuong');

  document.querySelectorAll('.btn-file-export, .btn-eye').forEach(b => b.remove());
}

function showError(msg) {
  document.getElementById('output').innerHTML = '<div class="error-msg">⚠️ ' + msg + '</div>';
}

// ─── Preview — mở tab mới với toàn bộ dữ liệu ───────────────
function showPreview(key) {
  let rows = [], headers = [], titleText = '';

  if (key === 'donHang' || key === 'dhLon') {
    const data = key === 'donHang' ? previewData.donHang : previewData.dhLon;
    if (!data || !data.length) { alert('Chưa có dữ liệu.'); return; }
    titleText = key === 'donHang' ? 'Đơn hàng' : 'ĐH Lộn';
    headers = ['Mã ĐH','Mã KH','Tên KH','Mã SP','Tên SP','Mã NV','Tổng tiền','DS ĐPMH','Nhóm TL','Nhóm PTML','KH CT?'];
    rows = data.map(o => [o.maDH, o.maKH, o.tenKH, o.maSP, o.tenSP, o.maNV,
      Math.round(o.doanhSo).toLocaleString('vi-VN'),
      Math.round(o.doanhSoDPMH).toLocaleString('vi-VN'),
      o.nhomTinhLuong, o.nhomPTML, o.isCompanyKH ? '✓' : '']);
  } else if (key === 'target') {
    const data = previewData.targets;
    if (!data || !data.length) { alert('Chưa có dữ liệu.'); return; }
    titleText = 'Target';
    headers = ['Mã TDV','Tên TDV','Khu vực','Miền','QLBH','Đối tượng','DS Tổng Target','ĐPKH Target','ĐPMH Target'];
    rows = data.map(t => [t.maTDV, t.tenTDV, t.khuVuc, t.mien, t.qlbh, t.doiTuong,
      Math.round(t.dsTongTarget).toLocaleString('vi-VN'), t.dpkhTarget, t.dpmhTarget]);
  } else if (key === 'dskh') {
    const data = previewData.dskh;
    if (!data || !data.length) { alert('Chưa có dữ liệu.'); return; }
    titleText = 'DSKH Công ty';
    headers = ['Mã KH','Mã TDV (có dấu chấm)'];
    rows = data.map(([k, v]) => [k, v]);
  } else if (key === 'bangGia') {
    const data = previewData.bangGia;
    if (!data || !data.length) { alert('Chưa có dữ liệu.'); return; }
    titleText = 'Bảng giá';
    headers = ['Mã SP','Nhóm Tính Lương','Nhóm PTML'];
    rows = data.map(([k, v]) => [k, v.nhomTinhLuong, v.nhomPTML]);
  } else {
    return;
  }

  const win = window.open('', '_blank');
  if (!win) { alert('Trình duyệt chặn cửa sổ mới. Vui lòng cho phép popup.'); return; }

  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const thHtml  = headers.map(h => `<th>${esc(h)}</th>`).join('');
  const bodyHtml = rows.map(row =>
    '<tr>' + row.map(cell => `<td>${esc(cell)}</td>`).join('') + '</tr>'
  ).join('');

  win.document.write(`<!DOCTYPE html>
<html lang="vi"><head><meta charset="UTF-8"><title>${esc(titleText)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;background:#f5f7fa;color:#222}
h2{padding:10px 16px;background:#1a5276;color:#fff;font-size:14px}
.info{padding:5px 16px;background:#e8f4fb;font-size:11px;color:#555;border-bottom:1px solid #cce}
.wrap{overflow:auto;height:calc(100vh - 62px)}
table{border-collapse:collapse;width:max-content;min-width:100%}
thead{position:sticky;top:0;z-index:10}
th{background:#1a5276;color:#fff;padding:6px 10px;border:1px solid #2c6e9e;white-space:nowrap;font-size:11px}
td{padding:4px 8px;border:1px solid #e0e5ea;white-space:nowrap}
tr:nth-child(even) td{background:#f0f4f8}
tr:hover td{background:#fdf2cc}
</style></head><body>
<h2>${esc(titleText)}</h2>
<div class="info">Tổng: <b>${rows.length.toLocaleString('vi-VN')}</b> dòng</div>
<div class="wrap"><table>
<thead><tr>${thHtml}</tr></thead>
<tbody>${bodyHtml}</tbody>
</table></div></body></html>`);
  win.document.close();
}

function closePreview() {} // kept for compatibility with any remaining references

// ─── Formula / Config Panel ──────────────────────────────────
function toggleFormulaPanel() {
  const panel = document.getElementById('formula-panel');
  panel.classList.toggle('open');
}

function initFormulaPanel() {
  const ids = ['w-n3','w-tong','w-tongct','w-dpkh','w-dpmh'];
  ids.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.value = (CONFIG.PTML_WEIGHTS[i] * 100).toFixed(0);
  });

  const minEl = document.getElementById('min-ds-phu');
  if (minEl) minEl.value = CONFIG.MIN_DS_PHU.toLocaleString('vi-VN');

  const n2El = document.getElementById('ds-n2-ratio');
  if (n2El) n2El.value = (CONFIG.DS_N2_RATIO * 100).toFixed(0);
  const n3El = document.getElementById('ds-n3-ratio');
  if (n3El) n3El.value = (CONFIG.DS_N3_RATIO * 100).toFixed(0);

  const groupEl = document.getElementById('dpmh-groups-display');
  if (groupEl) {
    const grouped = {};
    for (const [sub, canon] of Object.entries(CONFIG.DPMH_GROUPS)) {
      if (!grouped[canon]) grouped[canon] = [canon];
      grouped[canon].push(sub);
    }
    groupEl.innerHTML = Object.entries(grouped).map(([canon, list]) =>
      `<li>${list.join(', ')} → tính chung</li>`
    ).join('');
  }

  // SP chỉ định
  const spMaSP = document.getElementById('spcd-masp');
  if (spMaSP) spMaSP.value = CONFIG.SP_CHI_DINH.maSP || '';
  const spSL = document.getElementById('spcd-soluong');
  if (spSL) spSL.value = CONFIG.SP_CHI_DINH.soLuongTarget || 0;
}

function applyFormulaConfig() {
  // PTML weights
  const ids = ['w-n3','w-tong','w-tongct','w-dpkh','w-dpmh'];
  const newWeights = ids.map(id => {
    const el = document.getElementById(id);
    return el ? parseFloat(el.value) / 100 : 0;
  });
  const sum = newWeights.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.001) {
    alert('Tổng các trọng số phải = 100%. Hiện tại: ' + (sum * 100).toFixed(1) + '%');
    return;
  }
  CONFIG.PTML_WEIGHTS = newWeights;

  // DS ratios
  const n2El = document.getElementById('ds-n2-ratio');
  if (n2El) CONFIG.DS_N2_RATIO = parseFloat(n2El.value) / 100;
  const n3El = document.getElementById('ds-n3-ratio');
  if (n3El) CONFIG.DS_N3_RATIO = parseFloat(n3El.value) / 100;

  // MIN_DS_PHU
  const minEl = document.getElementById('min-ds-phu');
  if (minEl) {
    const v = parseFloat(minEl.value.replace(/[,.\s]/g, ''));
    if (!isNaN(v)) CONFIG.MIN_DS_PHU = v;
  }

  // SP chỉ định
  const spMaSP = document.getElementById('spcd-masp');
  if (spMaSP) CONFIG.SP_CHI_DINH.maSP = spMaSP.value.trim();
  const spSL = document.getElementById('spcd-soluong');
  if (spSL) CONFIG.SP_CHI_DINH.soLuongTarget = parseInt(spSL.value) || 0;

  try {
    localStorage.setItem(SK.config, JSON.stringify({
      PTML_WEIGHTS: CONFIG.PTML_WEIGHTS,
      DS_N2_RATIO:  CONFIG.DS_N2_RATIO,
      DS_N3_RATIO:  CONFIG.DS_N3_RATIO,
      MIN_DS_PHU:   CONFIG.MIN_DS_PHU,
      SP_CHI_DINH:  { maSP: CONFIG.SP_CHI_DINH.maSP, soLuongTarget: CONFIG.SP_CHI_DINH.soLuongTarget },
    }));
  } catch(e) {}

  alert('Đã lưu cấu hình. Nhấn Tính Thưởng để áp dụng.');
}

// ─── Tab switching ───────────────────────────────────────────
function switchTab(tab) {
  ['tinh-thuong', 'bao-cao'].forEach(t => {
    document.getElementById('tab-btn-' + t).classList.toggle('tab-active', t === tab);
  });
  const outputEl    = document.querySelector('.output-section');
  const analyticsEl = document.getElementById('analytics-section');
  if (outputEl)    outputEl.style.display    = tab === 'tinh-thuong' ? '' : 'none';
  if (analyticsEl) analyticsEl.style.display = tab === 'bao-cao'     ? '' : 'none';
  if (tab === 'bao-cao' && lastCalcData) renderAnalytics(lastCalcData.results);
}

function loadConfigFromStorage() {
  try {
    const raw = localStorage.getItem(SK.config);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (Array.isArray(s.PTML_WEIGHTS) && s.PTML_WEIGHTS.length === CONFIG.PTML_WEIGHTS.length)
      CONFIG.PTML_WEIGHTS = s.PTML_WEIGHTS;
    if (s.DS_N2_RATIO  !== undefined) CONFIG.DS_N2_RATIO  = s.DS_N2_RATIO;
    if (s.DS_N3_RATIO  !== undefined) CONFIG.DS_N3_RATIO  = s.DS_N3_RATIO;
    if (s.MIN_DS_PHU   !== undefined) CONFIG.MIN_DS_PHU   = s.MIN_DS_PHU;
    if (s.SP_CHI_DINH) {
      if (s.SP_CHI_DINH.maSP          !== undefined) CONFIG.SP_CHI_DINH.maSP          = s.SP_CHI_DINH.maSP;
      if (s.SP_CHI_DINH.soLuongTarget !== undefined) CONFIG.SP_CHI_DINH.soLuongTarget = s.SP_CHI_DINH.soLuongTarget;
    }
  } catch(e) {}
}
