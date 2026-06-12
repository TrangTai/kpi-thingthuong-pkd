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
  quy:      'kpi_static_quy_v1',
};

const uploadedFiles = {
  donHang: null, dhLon: null, target: null, dskh: null, bangGia: null, quy: null, donHangQLBH: null,
};

const staticData = {
  donHangOrders: null,
  dhLonOrders:   null,
  targets:       null,
  companyKhMap:  null,
  bangGiaMap:    null,
  quyMap:        null,
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
  // Login keyboard shortcuts
  document.getElementById('login-pass')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('login-user')?.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('login-pass')?.focus(); });

  // Firebase auth observer — drives entire app startup
  fbOnAuthChange(async user => {
    if (user) {
      try {
        const userDoc = await fbGetUserDoc(user.uid);
        if (!userDoc) { await fbLogout(); showLoginError('Tài khoản chưa được cấp quyền. Liên hệ admin.'); return; }
        showApp(userDoc);
      } catch(e) { showLoginError('Lỗi kết nối: ' + e.message); }
    } else {
      showLoginScreen();
    }
  });
});

function showLoginScreen() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-main').style.display = 'none';
}

function showApp(userDoc) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-main').style.display = '';
  document.getElementById('user-bar-name').textContent = userDoc.tenTDV || userDoc.maTDV;
  document.getElementById('user-bar-role').textContent =
    userDoc.role === 'admin' ? 'Admin' :
    userDoc.role === 'tpkd' ? 'Trưởng phòng KD' : 'Quản lý BH';
  if (userDoc.role === 'admin') initAdminApp();
  else if (userDoc.role === 'tpkd') initTPKDApp(userDoc);
  else initQLBHApp(userDoc);
}

function initAdminApp() {
  document.getElementById('btn-save-cloud').style.display    = 'inline-block';
  document.getElementById('btn-create-accounts').style.display = 'inline-block';
  document.getElementById('btn-create-tpkd').style.display   = 'inline-block';

  setupFileInput('input-don-hang', 'badge-don-hang', 'label-don-hang', f => { uploadedFiles.donHang = f; });
  setupFileInput('input-dh-lon',   'badge-dh-lon',   'label-dh-lon',   f => { uploadedFiles.dhLon   = f; onStaticUpload('dhLon',   f, parseDhLon,        SK.dhLon,   'dhLonOrders');   }, false);
  setupFileInput('input-target',   'badge-target',   'label-target',   f => { uploadedFiles.target  = f; onStaticUpload('target',  f, parseTarget,       SK.target,  'targets');       }, false);
  setupFileInput('input-dskh',     'badge-dskh',     'label-dskh',     f => { uploadedFiles.dskh    = f; onStaticUpload('dskh',    f, parseDSKHCongTy,   SK.dskh,    'companyKhMap'); }, false);
  setupFileInput('input-bang-gia', 'badge-bang-gia', 'label-bang-gia', f => { uploadedFiles.bangGia = f; onStaticUpload('bangGia', f, parseBangGia,      SK.bangGia, 'bangGiaMap');   }, false);
  setupFileInput('input-quy',      'badge-quy',      'label-quy',      f => { uploadedFiles.quy     = f; onStaticUpload('quy',     f, parseQuyData,      SK.quy,     'quyMap');        }, false);

  document.getElementById('btn-calculate').addEventListener('click', onCalculate);
  document.getElementById('btn-export').addEventListener('click', onExport);
  document.getElementById('btn-clear').addEventListener('click', onClear);
  document.getElementById('btn-config').addEventListener('click', toggleFormulaPanel);

  loadConfigFromStorage();
  loadStaticFromStorage();
  loadResultsFromStorage();
  initFormulaPanel();

  fbLoadConfig().then(cfg => { if (cfg) applyConfigFromFirestore(cfg); }).catch(() => {});
}

async function initQLBHApp(userDoc) {
  document.getElementById('upload-section').style.display  = 'none';
  document.getElementById('action-bar').style.display      = 'none';
  document.getElementById('formula-panel').style.display   = 'none';
  document.getElementById('cloud-status-bar').style.display = '';
  document.getElementById('qlbh-upload-section').style.display = '';
  // Tab nav stays visible so QLBH can access Báo cáo and Theo Miền tabs
  switchTab('tinh-thuong');

  setupFileInput('input-don-hang-qlbh', 'badge-don-hang-qlbh', 'label-don-hang-qlbh', f => { uploadedFiles.donHangQLBH = f; });
  document.getElementById('btn-qlbh-calculate')?.addEventListener('click', () => onQLBHCalculate(userDoc));

  const statusEl = document.getElementById('cloud-status');
  try {
    const [meta, results, quyMap] = await Promise.all([fbLoadMeta(), fbLoadResults(userDoc.maTDV), fbLoadQuyMap()]);

    if (meta) {
      const ts = meta.savedAt?.toDate?.() || new Date();
      const fmtDt = new Intl.DateTimeFormat('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      if (statusEl) statusEl.innerHTML = `Dữ liệu từ Cloud · Cập nhật lần cuối: <b>${fmtDt.format(ts)}</b> · <b>${meta.label || ''}</b>`;
    }

    if (!results.length) {
      document.getElementById('output').innerHTML = '<div style="padding:32px;text-align:center;color:#888;font-size:14px">Chưa có kết quả. Admin cần Tính Thưởng và nhấn Lưu Cloud.</div>';
      return;
    }

    results.sort((a, b) => (b.isQLBH ? 1 : 0) - (a.isQLBH ? 1 : 0));
    lastCalcData = { results, dpkhDetail: [], dpmhDetail: [] };
    staticData.quyMap = quyMap;

    renderOutput(results, `Nhóm: <b>${userDoc.tenTDV}</b> · <b>${results.length}</b> thành viên`, null);
    renderPresentation(results);
    document.getElementById('presentation-wrap').style.display = '';
    switchTab('tinh-thuong');
  } catch(err) {
    if (statusEl) statusEl.textContent = 'Lỗi tải dữ liệu: ' + err.message;
    console.error(err);
  }
}

async function onQLBHCalculate(userDoc) {
  if (!uploadedFiles.donHangQLBH) { alert('Vui lòng chọn file ĐƠN HÀNG trước.'); return; }
  const btn = document.getElementById('btn-qlbh-calculate');
  if (btn) { btn.disabled = true; btn.textContent = 'Đang tính...'; }
  try {
    const support      = await fbLoadSupportingData();
    const targets      = support.targets      || staticData.targets;
    const companyKhMap = support.companyKhMap || staticData.companyKhMap || {};
    const bangGiaMap   = support.bangGiaMap   || staticData.bangGiaMap   || {};
    if (!targets) { alert('Chưa có TARGET từ Cloud. Liên hệ admin.'); return; }

    const donHangOrders = await parseDonHangKinhDoanh(uploadedFiles.donHangQLBH);
    let allOrders = [...donHangOrders];
    enrichOrdersWithBangGia(allOrders, bangGiaMap);
    enrichOrders(allOrders, companyKhMap);
    const { results } = calculateKPI(allOrders, targets);
    const filtered = results.filter(r => r.qlbhCode === userDoc.maTDV);
    filtered.sort((a, b) => (b.isQLBH ? 1 : 0) - (a.isQLBH ? 1 : 0));
    lastCalcData = { results: filtered, dpkhDetail: [], dpmhDetail: [] };
    staticData.quyMap = await fbLoadQuyMap();
    renderOutput(filtered, `Nhóm: <b>${userDoc.tenTDV}</b> · Tính thử từ file ĐƠN HÀNG`, new Date());
    renderPresentation(filtered);
    switchTab('tinh-thuong');
  } catch(err) {
    alert('Lỗi: ' + err.message); console.error(err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Tính thử'; }
  }
}

// ─── TPKD: xem tất cả, không lọc theo nhóm ─────────────────
async function initTPKDApp(userDoc) {
  document.getElementById('upload-section').style.display   = 'none';
  document.getElementById('action-bar').style.display       = 'none';
  document.getElementById('formula-panel').style.display    = 'none';
  document.getElementById('cloud-status-bar').style.display = '';
  document.getElementById('qlbh-upload-section').style.display = '';
  switchTab('tinh-thuong');

  setupFileInput('input-don-hang-qlbh', 'badge-don-hang-qlbh', 'label-don-hang-qlbh', f => { uploadedFiles.donHangQLBH = f; });
  document.getElementById('btn-qlbh-calculate')?.addEventListener('click', () => onTPKDCalculate());

  const statusEl = document.getElementById('cloud-status');
  try {
    const [meta, results, quyMap] = await Promise.all([fbLoadMeta(), fbLoadResults(null), fbLoadQuyMap()]);

    if (meta) {
      const ts = meta.savedAt?.toDate?.() || new Date();
      const fmtDt = new Intl.DateTimeFormat('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      if (statusEl) statusEl.innerHTML = `Dữ liệu từ Cloud · Cập nhật lần cuối: <b>${fmtDt.format(ts)}</b> · <b>${meta.label || ''}</b>`;
    }

    if (!results.length) {
      document.getElementById('output').innerHTML = '<div style="padding:32px;text-align:center;color:#888;font-size:14px">Chưa có kết quả. Admin cần Tính Thưởng và nhấn Lưu Cloud.</div>';
      return;
    }

    results.sort((a, b) => (b.isQLBH ? 1 : 0) - (a.isQLBH ? 1 : 0));
    lastCalcData = { results, dpkhDetail: [], dpmhDetail: [] };
    staticData.quyMap = quyMap;

    renderOutput(results, `Toàn bộ PKD · <b>${results.length}</b> nhân viên`, null);
    renderPresentation(results);
    document.getElementById('presentation-wrap').style.display = '';
    switchTab('tinh-thuong');
  } catch(err) {
    if (statusEl) statusEl.textContent = 'Lỗi tải dữ liệu: ' + err.message;
    console.error(err);
  }
}

async function onTPKDCalculate() {
  if (!uploadedFiles.donHangQLBH) { alert('Vui lòng chọn file ĐƠN HÀNG trước.'); return; }
  const btn = document.getElementById('btn-qlbh-calculate');
  if (btn) { btn.disabled = true; btn.textContent = 'Đang tính...'; }
  try {
    const support      = await fbLoadSupportingData();
    const targets      = support.targets      || staticData.targets;
    const companyKhMap = support.companyKhMap || staticData.companyKhMap || {};
    const bangGiaMap   = support.bangGiaMap   || staticData.bangGiaMap   || {};
    if (!targets) { alert('Chưa có TARGET từ Cloud. Liên hệ admin.'); return; }

    const donHangOrders = await parseDonHangKinhDoanh(uploadedFiles.donHangQLBH);
    let allOrders = [...donHangOrders];
    enrichOrdersWithBangGia(allOrders, bangGiaMap);
    enrichOrders(allOrders, companyKhMap);
    const { results } = calculateKPI(allOrders, targets);
    results.sort((a, b) => (b.isQLBH ? 1 : 0) - (a.isQLBH ? 1 : 0));
    lastCalcData = { results, dpkhDetail: [], dpmhDetail: [] };
    staticData.quyMap = await fbLoadQuyMap();
    renderOutput(results, `Toàn bộ PKD · <b>${results.length}</b> NV · Tính thử từ ĐƠN HÀNG`, new Date());
    renderPresentation(results);
    switchTab('tinh-thuong');
  } catch(err) {
    alert('Lỗi: ' + err.message); console.error(err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Tính thử'; }
  }
}

async function onCreateTPKDAccount() {
  const btn = document.getElementById('btn-create-tpkd');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang tạo...'; }
  try {
    const status = await fbCreateSpecialAccount('TPKD', 'meracine123@', 'Trưởng phòng KD', 'tpkd');
    if (status === 'exists') {
      alert('Tài khoản TPKD đã tồn tại rồi.');
    } else {
      alert('✓ Đã tạo tài khoản TPKD!\n\nTên đăng nhập: TPKD\nMật khẩu: meracine123@\nVai trò: Trưởng phòng KD');
    }
  } catch(err) {
    alert('Lỗi tạo tài khoản: ' + err.message);
    console.error(err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔑 Tạo TK TPKD'; }
  }
}

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
    const hdrs = ['Mã ĐH','Mã KH','Tên KH','Mã SP','Tên SP','Mã NV','Tên QLBH','Tổng tiền','DS ĐPMH','SL','Ngày (ngày)','Nhóm TL','Nhóm PTML','KH CT?'];
    const rows = data.map(o => [
      o.maDH, o.maKH, o.tenKH, o.maSP, o.tenSP, o.maNV, o.qlbhNV || '',
      Math.round(o.doanhSo), Math.round(o.doanhSoDPMH),
      o.soLuong || 0, o.ngayDay || 0,
      o.nhomTinhLuong, o.nhomPTML, o.isCompanyKH ? 'Có' : '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([hdrs, ...rows]);
    ws['!cols'] = [8,10,20,8,20,8,18,14,14,6,8,10,10,6].map(w => ({ wch: w }));
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

function downloadQuyTemplate() {
  const qc = CONFIG.QUY_CONFIG;
  const wb = XLSX.utils.book_new();
  const hdrs = ['Mã TDV','Tên TDV', qc.thang1+' Target', qc.thang2+' Target', qc.thang1+' Thực (DS T+CT)', qc.thang2+' Thực (DS T+CT)'];
  const ws = XLSX.utils.aoa_to_sheet([hdrs]);
  ws['!cols'] = [10,22,16,16,22,22].map(w=>({wch:w}));
  ws['!freeze'] = { xSplit:0, ySplit:1, topLeftCell:'A2', activePane:'bottomLeft' };
  XLSX.utils.book_append_sheet(wb, ws, 'Quý');
  XLSX.writeFile(wb, `MAU_QUY_${qc.quyLabel.replace('/','_')}.xlsx`);
}

// ─── Load static from localStorage ──────────────────────────
function loadStaticFromStorage() {
  const defs = [
    { key: SK.donHang, dataKey: 'donHangOrders', previewKey: 'donHang', badgeKey: 'don-hang', label: 'ĐƠN HÀNG' },
    { key: SK.dhLon,   dataKey: 'dhLonOrders',   previewKey: 'dhLon',   badgeKey: 'dh-lon',   label: 'ĐH lộn' },
    { key: SK.target,  dataKey: 'targets',        previewKey: 'target',  badgeKey: 'target',   label: 'Target' },
    { key: SK.dskh,    dataKey: 'companyKhMap',   previewKey: 'dskh',    badgeKey: 'dskh',     label: 'DSKH CT' },
    { key: SK.bangGia, dataKey: 'bangGiaMap',     previewKey: 'bangGia', badgeKey: 'bang-gia', label: 'Bảng giá' },
    { key: SK.quy,     dataKey: 'quyMap',         previewKey: 'quy',     badgeKey: 'quy',       label: 'Quý' },
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
    renderPresentation(results);
    document.getElementById('btn-export').style.display = 'inline-block';
    if (document.getElementById('tab-btn-bao-cao').classList.contains('tab-active')) {
      renderAnalytics(results);
    }
    if (document.getElementById('tab-btn-mien-report')?.classList.contains('tab-active')) {
      renderMienReport(results);
    }

  } catch (err) {
    showError('Lỗi: ' + err.message);
    console.error(err);
  } finally {
    btn.disabled = false; btn.textContent = 'Tính Thưởng';
  }
}

function renderOutput(results, statsText, timestamp) {
  document.getElementById('output').innerHTML = renderTable(results, staticData.quyMap || null);

  const statsEl = document.getElementById('stats');
  if (statsEl) { statsEl.innerHTML = statsText; statsEl.style.display = 'inline'; }

  const savedEl = document.getElementById('saved-info');
  if (savedEl && timestamp) {
    const fmtDt = new Intl.DateTimeFormat('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    savedEl.innerHTML = '💾 Lần cuối: <b>' + fmtDt.format(timestamp) + '</b>';
    savedEl.style.display = 'inline';
  }
  document.getElementById('btn-clear').style.display = 'inline-block';
  const pw = document.getElementById('presentation-wrap');
  if (pw) pw.style.display = '';
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
    if (typeof renderMienReport === 'function' && document.getElementById('tab-btn-mien-report')?.classList.contains('tab-active')) {
      renderMienReport(p.results);
    }
  } catch(e) {}
}

function onExport() {
  if (!lastCalcData) { alert('Chưa có kết quả để xuất.'); return; }
  try {
    exportToExcel(lastCalcData.results, lastCalcData.dpkhDetail, lastCalcData.dpmhDetail, staticData.quyMap || null);
  } catch(err) {
    alert('Lỗi xuất Excel: ' + err.message);
    console.error(err);
  }
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

function togglePresentation() {
  const sec = document.getElementById('presentation-section');
  const ico = document.getElementById('pres-toggle-icon');
  if (!sec) return;
  const hidden = sec.style.display === 'none';
  sec.style.display = hidden ? '' : 'none';
  if (ico) ico.textContent = hidden ? '▼' : '▶';
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
    headers = ['Mã ĐH','Mã KH','Tên KH','Mã SP','Tên SP','Mã NV','Tên QLBH','Tổng tiền','DS ĐPMH','Nhóm TL','Nhóm PTML','KH CT?'];
    rows = data.map(o => [o.maDH, o.maKH, o.tenKH, o.maSP, o.tenSP, o.maNV, o.qlbhNV || '',
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
  const spDPKH = document.getElementById('spcd-dpkh');
  if (spDPKH) spDPKH.value = CONFIG.SP_CHI_DINH.dpkhSpCdTarget || 0;

  // Cấu hình Quý
  const quyLabelEl = document.getElementById('quy-label');
  if (quyLabelEl) quyLabelEl.value = CONFIG.QUY_CONFIG.quyLabel || '';
  const quyT1El = document.getElementById('quy-t1');
  if (quyT1El) quyT1El.value = CONFIG.QUY_CONFIG.thang1 || '';
  const quyT2El = document.getElementById('quy-t2');
  if (quyT2El) quyT2El.value = CONFIG.QUY_CONFIG.thang2 || '';
  const quyT3El = document.getElementById('quy-t3');
  if (quyT3El) quyT3El.value = CONFIG.QUY_CONFIG.thang3 || '';
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
  const spDPKH = document.getElementById('spcd-dpkh');
  if (spDPKH) CONFIG.SP_CHI_DINH.dpkhSpCdTarget = parseInt(spDPKH.value) || 0;

  // Cấu hình Quý
  const quyLabelEl = document.getElementById('quy-label');
  if (quyLabelEl) CONFIG.QUY_CONFIG.quyLabel = quyLabelEl.value.trim() || CONFIG.QUY_CONFIG.quyLabel;
  const quyT1El = document.getElementById('quy-t1');
  if (quyT1El) CONFIG.QUY_CONFIG.thang1 = quyT1El.value.trim() || CONFIG.QUY_CONFIG.thang1;
  const quyT2El = document.getElementById('quy-t2');
  if (quyT2El) CONFIG.QUY_CONFIG.thang2 = quyT2El.value.trim() || CONFIG.QUY_CONFIG.thang2;
  const quyT3El = document.getElementById('quy-t3');
  if (quyT3El) CONFIG.QUY_CONFIG.thang3 = quyT3El.value.trim() || CONFIG.QUY_CONFIG.thang3;

  try {
    localStorage.setItem(SK.config, JSON.stringify({
      PTML_WEIGHTS: CONFIG.PTML_WEIGHTS,
      DS_N2_RATIO:  CONFIG.DS_N2_RATIO,
      DS_N3_RATIO:  CONFIG.DS_N3_RATIO,
      MIN_DS_PHU:   CONFIG.MIN_DS_PHU,
      SP_CHI_DINH:  { maSP: CONFIG.SP_CHI_DINH.maSP, soLuongTarget: CONFIG.SP_CHI_DINH.soLuongTarget, dpkhSpCdTarget: CONFIG.SP_CHI_DINH.dpkhSpCdTarget },
      QUY_CONFIG:   CONFIG.QUY_CONFIG,
    }));
  } catch(e) {}

  alert('Đã lưu cấu hình. Nhấn Tính Thưởng để áp dụng.');
}

// ─── Tab switching ───────────────────────────────────────────
function switchTab(tab) {
  ['tinh-thuong', 'bao-cao', 'mien-report'].forEach(t => {
    const btn = document.getElementById('tab-btn-' + t);
    if (btn) btn.classList.toggle('tab-active', t === tab);
  });
  const outputEl    = document.querySelector('.output-section');
  const analyticsEl = document.getElementById('analytics-section');
  const mienEl      = document.getElementById('mien-report-section');
  if (outputEl)    outputEl.style.display    = tab === 'tinh-thuong'  ? '' : 'none';
  if (analyticsEl) analyticsEl.style.display = tab === 'bao-cao'      ? '' : 'none';
  if (mienEl)      mienEl.style.display      = tab === 'mien-report'  ? '' : 'none';
  if (tab === 'bao-cao'     && lastCalcData) renderAnalytics(lastCalcData.results);
  if (tab === 'mien-report' && lastCalcData) renderMienReport(lastCalcData.results);
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
      if (s.SP_CHI_DINH.maSP            !== undefined) CONFIG.SP_CHI_DINH.maSP            = s.SP_CHI_DINH.maSP;
      if (s.SP_CHI_DINH.soLuongTarget   !== undefined) CONFIG.SP_CHI_DINH.soLuongTarget   = s.SP_CHI_DINH.soLuongTarget;
      if (s.SP_CHI_DINH.dpkhSpCdTarget  !== undefined) CONFIG.SP_CHI_DINH.dpkhSpCdTarget  = s.SP_CHI_DINH.dpkhSpCdTarget;
    }
    if (s.QUY_CONFIG) {
      if (s.QUY_CONFIG.quyLabel !== undefined) CONFIG.QUY_CONFIG.quyLabel = s.QUY_CONFIG.quyLabel;
      if (s.QUY_CONFIG.thang1  !== undefined) CONFIG.QUY_CONFIG.thang1   = s.QUY_CONFIG.thang1;
      if (s.QUY_CONFIG.thang2  !== undefined) CONFIG.QUY_CONFIG.thang2   = s.QUY_CONFIG.thang2;
      if (s.QUY_CONFIG.thang3  !== undefined) CONFIG.QUY_CONFIG.thang3   = s.QUY_CONFIG.thang3;
    }
  } catch(e) {}
}

// ─── Firebase auth UI ────────────────────────────────────────
async function doLogin() {
  const username = (document.getElementById('login-user')?.value || '').trim();
  const password = document.getElementById('login-pass')?.value || '';
  if (!username || !password) { showLoginError('Vui lòng nhập tên đăng nhập và mật khẩu.'); return; }
  showLoginError('');
  const btn = document.getElementById('btn-login');
  if (btn) { btn.disabled = true; btn.textContent = 'Đang đăng nhập...'; }
  try {
    await fbLogin(username, password, document.getElementById('login-remember')?.checked || false);
  } catch(err) {
    let msg = 'Đăng nhập thất bại. Kiểm tra lại tên đăng nhập và mật khẩu.';
    if (['auth/user-not-found','auth/wrong-password','auth/invalid-credential'].includes(err.code)) msg = 'Sai tên đăng nhập hoặc mật khẩu.';
    else if (err.code === 'auth/too-many-requests') msg = 'Quá nhiều lần thử. Vui lòng thử lại sau.';
    showLoginError(msg);
    if (btn) { btn.disabled = false; btn.textContent = 'ĐĂNG NHẬP'; }
  }
}

async function doLogout() {
  await fbLogout();
  lastCalcData = null;
  Object.keys(staticData).forEach(k => { staticData[k] = null; });
  document.getElementById('output').innerHTML = '<div class="loading" style="color:#bbb">Upload file và nhấn <b>Tính Thưởng</b> để bắt đầu.</div>';
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (el) el.textContent = msg;
}

function togglePassVisibility() {
  const input = document.getElementById('login-pass');
  const icon  = document.querySelector('.toggle-pass');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  if (icon) icon.textContent = input.type === 'password' ? '👁' : '🙈';
}

// ─── Admin: Save to Cloud ────────────────────────────────────
async function onSaveToCloud() {
  if (!lastCalcData?.results?.length) { alert('Chưa có kết quả. Vui lòng Tính Thưởng trước.'); return; }
  const btn = document.getElementById('btn-save-cloud');
  btn.disabled = true; btn.textContent = '☁ Đang lưu...';
  try {
    const label = `${CONFIG.QUY_CONFIG.thang3}/${CONFIG.QUY_CONFIG.quyLabel.split('/')[1] || ''}`;
    await fbSaveResults(
      lastCalcData.results, staticData.quyMap || null, label,
      staticData.targets, staticData.companyKhMap, staticData.bangGiaMap,
    );
    await fbSaveConfig({
      PTML_WEIGHTS: CONFIG.PTML_WEIGHTS, DS_N2_RATIO: CONFIG.DS_N2_RATIO,
      DS_N3_RATIO:  CONFIG.DS_N3_RATIO,  MIN_DS_PHU:  CONFIG.MIN_DS_PHU,
      SP_CHI_DINH:  { maSP: CONFIG.SP_CHI_DINH.maSP, soLuongTarget: CONFIG.SP_CHI_DINH.soLuongTarget, dpkhSpCdTarget: CONFIG.SP_CHI_DINH.dpkhSpCdTarget },
      QUY_CONFIG:   CONFIG.QUY_CONFIG,
    });
    btn.textContent = '☁ Đã lưu!';
    setTimeout(() => { btn.textContent = '☁ Lưu Cloud'; btn.disabled = false; }, 3000);
    alert(`Đã lưu ${lastCalcData.results.length} kết quả lên Cloud thành công!`);
    return;
  } catch(err) {
    alert('Lỗi lưu Cloud: ' + err.message); console.error(err);
  }
  btn.disabled = false; btn.textContent = '☁ Lưu Cloud';
}

// ─── Admin: Create QLBH accounts ────────────────────────────
async function onCreateAccounts() {
  if (!staticData.targets) { alert('Chưa có dữ liệu TARGET. Upload file Target trước.'); return; }
  if (!confirm('Tạo tài khoản cho tất cả QLBH trong file TARGET?\n\nTài khoản đã tồn tại sẽ giữ nguyên.\nMật khẩu mặc định: 123456')) return;
  const btn = document.getElementById('btn-create-accounts');
  btn.disabled = true; btn.textContent = '👥 Đang tạo...';
  try {
    const res     = await fbCreateQLBHAccounts(staticData.targets);
    const created = res.filter(r => r.status === 'created').length;
    const exists  = res.filter(r => r.status === 'exists').length;
    const errors  = res.filter(r => r.status.startsWith('lỗi')).length;
    const detail  = res.map(r => `${r.maTDV} (${r.tenTDV}): ${r.status === 'created' ? '✓ Tạo mới' : r.status === 'exists' ? '○ Đã có' : '✗ ' + r.status}`).join('\n');
    alert(`Hoàn thành!\n✓ Tạo mới: ${created}\n○ Đã tồn tại: ${exists}\n✗ Lỗi: ${errors}\n\n${detail}`);
  } catch(err) {
    alert('Lỗi: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '👥 Tạo TK QLBH';
  }
}

function applyConfigFromFirestore(cfg) {
  if (Array.isArray(cfg.PTML_WEIGHTS) && cfg.PTML_WEIGHTS.length === CONFIG.PTML_WEIGHTS.length) CONFIG.PTML_WEIGHTS = cfg.PTML_WEIGHTS;
  if (cfg.DS_N2_RATIO !== undefined) CONFIG.DS_N2_RATIO = cfg.DS_N2_RATIO;
  if (cfg.DS_N3_RATIO !== undefined) CONFIG.DS_N3_RATIO = cfg.DS_N3_RATIO;
  if (cfg.MIN_DS_PHU  !== undefined) CONFIG.MIN_DS_PHU  = cfg.MIN_DS_PHU;
  if (cfg.SP_CHI_DINH) {
    if (cfg.SP_CHI_DINH.maSP            !== undefined) CONFIG.SP_CHI_DINH.maSP            = cfg.SP_CHI_DINH.maSP;
    if (cfg.SP_CHI_DINH.soLuongTarget   !== undefined) CONFIG.SP_CHI_DINH.soLuongTarget   = cfg.SP_CHI_DINH.soLuongTarget;
    if (cfg.SP_CHI_DINH.dpkhSpCdTarget  !== undefined) CONFIG.SP_CHI_DINH.dpkhSpCdTarget  = cfg.SP_CHI_DINH.dpkhSpCdTarget;
  }
  if (cfg.QUY_CONFIG) {
    if (cfg.QUY_CONFIG.quyLabel !== undefined) CONFIG.QUY_CONFIG.quyLabel = cfg.QUY_CONFIG.quyLabel;
    if (cfg.QUY_CONFIG.thang1   !== undefined) CONFIG.QUY_CONFIG.thang1   = cfg.QUY_CONFIG.thang1;
    if (cfg.QUY_CONFIG.thang2   !== undefined) CONFIG.QUY_CONFIG.thang2   = cfg.QUY_CONFIG.thang2;
    if (cfg.QUY_CONFIG.thang3   !== undefined) CONFIG.QUY_CONFIG.thang3   = cfg.QUY_CONFIG.thang3;
  }
  initFormulaPanel();
}
