// ============================================================
// PARSER.JS - Đọc các file Excel bằng SheetJS
// ============================================================

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// Tìm header row chứa keyword (tìm trong 15 row đầu)
function findHeaderRow(sheet, headerKeyword) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  for (let r = range.s.r; r <= Math.min(range.e.r, 14); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v && String(cell.v).toLowerCase().includes(headerKeyword.toLowerCase())) return r;
    }
  }
  return 1;
}

function getCellValue(sheet, row, col) {
  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
  if (!cell) return '';
  if (cell.t === 'n') return cell.v;
  return cell.v !== undefined ? String(cell.v).trim() : '';
}

function getCellStr(sheet, row, col) {
  const v = getCellValue(sheet, row, col);
  return typeof v === 'number' ? String(v) : v;
}

function getCellNumber(sheet, row, col) {
  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
  if (!cell) return 0;
  if (cell.t === 'n') return cell.v || 0;
  const parsed = parseFloat(String(cell.v).replace(/[,\s]/g, ''));
  return isNaN(parsed) ? 0 : parsed;
}

// ─────────────────────────────────────────────────────────────
// 1. BẢNG GIÁ
//    Row 1: title  Row 2 (index 1): headers  Row 3+: data
//    Col [1]=MÃ SP  [6]=NHÓM TÍNH LƯƠNG  [7]=NHÓM PTML
//    Returns: Map { maSP → { nhomTinhLuong, nhomPTML } }
// ─────────────────────────────────────────────────────────────
async function parseBangGia(file) {
  const buf = await readFileAsArrayBuffer(file);
  const wb  = XLSX.read(buf, { type: 'array', cellDates: false });

  let sheetName = wb.SheetNames.find(n =>
    n.toUpperCase().includes('BẢNG GIÁ') ||
    n.toUpperCase().includes('BANG GIA') ||
    n.toUpperCase().includes('GIA')
  ) || wb.SheetNames[0];

  const sheet = wb.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const headerRow = findHeaderRow(sheet, 'MÃ SP');
  const map = {};

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const maSP = getCellStr(sheet, r, 1);
    if (!maSP) continue;
    map[maSP] = {
      nhomTinhLuong: getCellStr(sheet, r, 6).trim(),
      nhomPTML:      getCellStr(sheet, r, 7).trim(),
    };
  }
  return map;
}

// ─────────────────────────────────────────────────────────────
// 2. ĐƠN HÀNG
//    Row 1: summary (skip)  Row 2 (index 1): headers  Row 3+: data
//    Col: [0]=Trạng thái [3]=MãKH [4]=TênKH [5]=MãSP [6]=TênSP
//         [10]=MãNV [13]=DoanhSo [14]=NgàyTạoĐơn
//    nhomTinhLuong / nhomPTML: đọc từ cols 16-17 nếu có, ưu tiên tra bảng giá sau
// ─────────────────────────────────────────────────────────────
async function parseDonHang(file) {
  const buf = await readFileAsArrayBuffer(file);
  const wb  = XLSX.read(buf, { type: 'array', cellDates: false });

  let sheetName = wb.SheetNames.find(n =>
    n.includes('ĐƠN HÀNG') || n.includes('DON HANG') || n.includes('đơn hàng')
  ) || wb.SheetNames[0];

  return _parseOrderSheet(wb.Sheets[sheetName]);
}

async function parseDhLon(file) {
  const buf = await readFileAsArrayBuffer(file);
  const wb  = XLSX.read(buf, { type: 'array', cellDates: false });

  let sheetName = wb.SheetNames.find(n =>
    n.toLowerCase().includes('lộn') || n.toLowerCase().includes('lon') || n.toLowerCase().includes('sai')
  ) || wb.SheetNames[0];

  return _parseOrderSheet(wb.Sheets[sheetName]);
}

// ─────────────────────────────────────────────────────────────
// 2b. ĐƠN HÀNG — Format Kinh Doanh (header-based, hỗ trợ cả mẫu cũ 18 cột và mẫu mới CMS)
//    Mẫu cũ:  [0]MãĐH [1]NgàyĐH [4]MãKH [5]TênKH [7]MãSP [8]TênSP
//              [10]ĐơnGiá [11]SốLượng [12]TổngTiền [15]MãTDV
//    Mẫu mới: [1]MãĐH [3]NgàyTạoĐơn [4]MãKH [5]TênKH [6]MãNV [9]MãSP [10]TênSP
//              [13]ĐơnGiá [12]SốLượng [16]TổngTiền
// ─────────────────────────────────────────────────────────────
async function parseDonHangKinhDoanh(file) {
  const buf = await readFileAsArrayBuffer(file);
  // Detect HTML frameset (CMS .xls export thiếu folder _files — không đọc được)
  const snippet = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf, 0, 400));
  if (/<frameset/i.test(snippet) || (/<html/i.test(snippet) && /frameset/i.test(snippet))) {
    throw new Error(
      'File .xls này là báo cáo HTML (cần folder _files đi kèm — không import trực tiếp được).\n' +
      'Cách xử lý: Mở file trong Excel → Save As → Excel Workbook (.xlsx) → Import file .xlsx đó.'
    );
  }
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false });
  return _parseOrderSheetKinhDoanh(wb.Sheets[wb.SheetNames[0]]);
}

function _parseOrderSheetKinhDoanh(sheet) {
  // Tìm header row theo "Mã Đơn Hàng" (mẫu cũ) hoặc "Mã ĐH" (mẫu mới)
  let hdrRow = findHeaderRow(sheet, 'Mã Đơn Hàng');
  if (hdrRow < 0) hdrRow = findHeaderRow(sheet, 'Mã ĐH');
  if (hdrRow < 0) return [];

  // Tìm cột theo tên header
  const cMaDH   = _findCol(sheet, hdrRow, ['mã đơn hàng', 'mã đh']);
  const cNgay   = _findCol(sheet, hdrRow, ['ngày đh', 'ngày tạo đơn', 'ngày']);
  const cMaKH   = _findCol(sheet, hdrRow, ['mã kh']);
  const cTenKH  = _findCol(sheet, hdrRow, ['tên khách hàng', 'tên kh']);
  const cMaNV   = _findCol(sheet, hdrRow, ['mã tdv', 'mã nv']);
  const cMaSP   = _findCol(sheet, hdrRow, ['mã sp']);
  const cTenSP  = _findCol(sheet, hdrRow, ['tên sp', 'tên sản phẩm']);
  const cDonGia = _findCol(sheet, hdrRow, ['đơn giá']);
  const cSoLuong= _findCol(sheet, hdrRow, ['số lượng']);
  // Tổng Tiền: ưu tiên "tổng tiền" (sau CK), tránh nhầm "t.tiền (lương)"
  const cDoanhSo= _findColExact(sheet, hdrRow, ['tổng tiền']);

  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const orders = [];

  for (let r = hdrRow + 1; r <= range.e.r; r++) {
    const maDH = cMaDH >= 0 ? getCellStr(sheet, r, cMaDH) : '';
    if (!maDH) continue;

    const donGia = cDonGia >= 0 ? getCellNumber(sheet, r, cDonGia) : 1;
    if (donGia === 0) continue; // bỏ hàng mẫu / tặng

    const doanhSo = cDoanhSo >= 0 ? getCellNumber(sheet, r, cDoanhSo) : 0;

    orders.push({
      maDH,
      maKH:          cMaKH   >= 0 ? getCellStr(sheet, r, cMaKH)    : '',
      tenKH:         cTenKH  >= 0 ? getCellStr(sheet, r, cTenKH)   : '',
      maSP:          cMaSP   >= 0 ? getCellStr(sheet, r, cMaSP)    : '',
      tenSP:         cTenSP  >= 0 ? getCellStr(sheet, r, cTenSP)   : '',
      maNV:          cMaNV   >= 0 ? getCellStr(sheet, r, cMaNV)    : '',
      doanhSo,
      doanhSoDPMH:   doanhSo,
      soLuong:       cSoLuong>= 0 ? getCellNumber(sheet, r, cSoLuong) : 0,
      ngayDay:       cNgay   >= 0 ? _getOrderDay(sheet, r, cNgay)  : 0,
      nhomTinhLuong: '',
      nhomPTML:      '',
      qlbhNV:        '',
      isCompanyKH:   false,
      companyTDV:    null,
    });
  }
  return orders;
}

// Khớp chính xác (không chứa thêm từ khoá ngoài) — để tránh "tổng tiền" nhầm "t.tiền (lương)"
function _findColExact(sheet, headerRow, keywords) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  for (let c = range.s.c; c <= range.e.c; c++) {
    const v = (getCellStr(sheet, headerRow, c) || '').toLowerCase().trim();
    if (keywords.some(kw => v === kw)) return c;
  }
  return -1;
}

// Chuyển Excel serial date hoặc chuỗi → ngày trong tháng (1-31)
function _getOrderDay(sheet, row, col) {
  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
  if (!cell || cell.v === undefined) return 0;
  if (cell.t === 'n' && cell.v > 1000) {
    return new Date(Math.round((cell.v - 25569) * 86400 * 1000)).getUTCDate();
  }
  if (cell.t === 'd') return cell.v.getDate();
  const s = String(cell.v).trim();
  const m = s.match(/^(\d{1,2})[\/\-]/);   // DD/MM... or DD-MM...
  if (m) return parseInt(m[1]);
  const m2 = s.match(/[\/\-](\d{1,2})[\/\-]/); // middle component
  if (m2) return parseInt(m2[1]);
  return 0;
}

// Tìm index cột theo keyword trong header row
function _findCol(sheet, headerRow, keywords) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  for (let c = range.s.c; c <= range.e.c; c++) {
    const v = (getCellStr(sheet, headerRow, c) || '').toLowerCase().trim();
    if (keywords.some(kw => v.includes(kw))) return c;
  }
  return -1;
}

function _parseOrderSheet(sheet) {
  const range     = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const headerRow = findHeaderRow(sheet, 'Mã ĐH');

  // Auto-detect columns với fallback
  const colNgay = (() => {
    const c = _findCol(sheet, headerRow, ['ngày tạo', 'ngay tao', 'ngày đơn', 'ngay don']);
    return c >= 0 ? c : 14; // fallback col O
  })();
  const colSL = (() => {
    const c = _findCol(sheet, headerRow, ['số lượng', 'so luong', 'sl']);
    return c >= 0 ? c : 7;  // fallback col H
  })();
  const colQLBH = (() => {
    const c = _findCol(sheet, headerRow, ['qlbh', 'quản lý bán hàng', 'quan ly ban hang']);
    return c >= 0 ? c : 15; // fallback col P
  })();

  const orders = [];
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const maDH = getCellStr(sheet, r, 1);
    if (!maDH) continue;

    // Col J (idx 9) = Tổng tiền → doanhSo chính (DS tổng, N2, N3, ĐPKH)
    // Col N (idx 13) = Doanh số  → chỉ dùng cho ĐPMH
    const doanhSo     = getCellNumber(sheet, r, 9);
    const doanhSoDPMH = getCellNumber(sheet, r, 13);
    if (doanhSo === 0 && doanhSoDPMH === 0) continue;

    orders.push({
      maDH,
      maKH:          getCellStr(sheet, r, 3),
      tenKH:         getCellStr(sheet, r, 4),
      maSP:          getCellStr(sheet, r, 5),
      tenSP:         getCellStr(sheet, r, 6),
      maNV:          getCellStr(sheet, r, 10),
      doanhSo,
      doanhSoDPMH,
      soLuong:       getCellNumber(sheet, r, colSL),
      ngayDay:       _getOrderDay(sheet, r, colNgay),  // 1-31
      nhomTinhLuong: getCellStr(sheet, r, 16).trim(),
      nhomPTML:      getCellStr(sheet, r, 17).trim(),
      qlbhNV:        getCellStr(sheet, r, colQLBH).trim(),
      isCompanyKH:   false,
      companyTDV:    null,
    });
  }
  return orders;
}

// ─────────────────────────────────────────────────────────────
// 3. DSKH Công ty
//    Row 1 (index 0): headers  Row 2+: data
//    Col [1]=MãKH  [6]=ĐỔI MÃ TDV (có dấu chấm → KH công ty)
// ─────────────────────────────────────────────────────────────
async function parseDSKHCongTy(file) {
  const buf = await readFileAsArrayBuffer(file);
  const wb  = XLSX.read(buf, { type: 'array', cellDates: false });

  let sheetName = wb.SheetNames.find(n =>
    n.includes('DSKH') || n.toLowerCase().includes('công ty') || n.toLowerCase().includes('cong ty')
  ) || wb.SheetNames[0];

  const sheet = wb.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const headerRow = findHeaderRow(sheet, 'Mã KH');
  const map = {};

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const maKH   = getCellStr(sheet, r, 1);
    const dotTDV = getCellStr(sheet, r, 6);
    if (maKH && dotTDV && dotTDV.endsWith('.')) {
      map[maKH] = dotTDV;
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────
// 4. TARGET
//    Hỗ trợ 2 format:
//    A) Sheet "Tính Thưởng" từ file Excel gốc (row header=2, data từ row 4)
//    B) File đơn giản (1 header row)
// ─────────────────────────────────────────────────────────────
async function parseTarget(file) {
  const buf = await readFileAsArrayBuffer(file);
  const wb  = XLSX.read(buf, { type: 'array', cellDates: false });

  const tinhThuongName = wb.SheetNames.find(n =>
    n.includes('Tính Thưởng') || n.includes('Tinh Thuong')
  );
  if (tinhThuongName) return _parseTargetFromTinhThuong(wb.Sheets[tinhThuongName]);
  return _parseTargetSimple(wb.Sheets[wb.SheetNames[0]]);
}

function _parseTargetFromTinhThuong(sheet) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const headerRow = findHeaderRow(sheet, 'Mã TDV');
  const dataStart = headerRow + 2;  // skip sub-header row
  const targets = [];

  for (let r = dataStart; r <= range.e.r; r++) {
    const maTDV = getCellStr(sheet, r, 0);
    if (!maTDV || maTDV === 'Mã TDV') continue;
    const dsTong = getCellNumber(sheet, r, 8);
    if (dsTong === 0 && !getCellStr(sheet, r, 5)) continue;

    targets.push({
      maTDV,
      tenTDV:       getCellStr(sheet, r, 1),
      khuVuc:       getCellStr(sheet, r, 2),
      mien:         getCellStr(sheet, r, 3),
      qlbh:         getCellStr(sheet, r, 4),
      doiTuong:     getCellStr(sheet, r, 5),
      dsTongTarget: dsTong,
      dpkhTarget:   getCellNumber(sheet, r, 9),
      dpmhTarget:   getCellNumber(sheet, r, 10),
    });
  }
  return targets;
}

function _parseTargetSimple(sheet) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const headerRow = findHeaderRow(sheet, 'Mã TDV');
  const colMap = { maTDV:0, tenTDV:1, khuVuc:2, mien:3, qlbh:4, doiTuong:5, dsTongTarget:6, dpkhTarget:7, dpmhTarget:8 };

  for (let c = 0; c <= range.e.c; c++) {
    const v = getCellStr(sheet, headerRow, c).toLowerCase();
    if (v.includes('mã tdv'))                                      colMap.maTDV = c;
    else if (v.includes('tên tdv') || v.includes('ten tdv'))       colMap.tenTDV = c;
    else if (v.includes('khu vực') || v.includes('khu vuc'))       colMap.khuVuc = c;
    else if (v.includes('miền') || v.includes('mien'))             colMap.mien = c;
    else if (v === 'qlbh')                                         colMap.qlbh = c;
    else if (v.includes('đối tượng') || v.includes('doi tuong'))   colMap.doiTuong = c;
    // Check ĐPKH/ĐPMH TRƯỚC khi check 'target' chung để tránh nhầm cột
    else if (v.includes('đpkh') || v.includes('dpkh'))             colMap.dpkhTarget = c;
    else if (v.includes('đpmh') || v.includes('dpmh'))             colMap.dpmhTarget = c;
    else if (v.includes('ds tổng') || v.includes('ds tong') || v.includes('target')) colMap.dsTongTarget = c;
  }

  const targets = [];
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const maTDV = getCellStr(sheet, r, colMap.maTDV);
    if (!maTDV) continue;
    targets.push({
      maTDV,
      tenTDV:       getCellStr(sheet, r, colMap.tenTDV),
      khuVuc:       getCellStr(sheet, r, colMap.khuVuc),
      mien:         getCellStr(sheet, r, colMap.mien),
      qlbh:         getCellStr(sheet, r, colMap.qlbh),
      doiTuong:     getCellStr(sheet, r, colMap.doiTuong),
      dsTongTarget: getCellNumber(sheet, r, colMap.dsTongTarget),
      dpkhTarget:   getCellNumber(sheet, r, colMap.dpkhTarget),
      dpmhTarget:   getCellNumber(sheet, r, colMap.dpmhTarget),
    });
  }
  return targets;
}

// ─────────────────────────────────────────────────────────────
// Enrich helpers
// ─────────────────────────────────────────────────────────────

// Gắn nhóm từ bảng giá (ưu tiên hơn cột trong ĐƠN HÀNG)
function enrichOrdersWithBangGia(orders, bangGiaMap) {
  for (const o of orders) {
    const entry = bangGiaMap[o.maSP];
    if (entry) {
      o.nhomTinhLuong = entry.nhomTinhLuong;
      o.nhomPTML      = entry.nhomPTML;
    }
  }
  return orders;
}

// Gắn cờ KH công ty từ DSKH
function enrichOrders(orders, companyKhMap) {
  for (const o of orders) {
    if (companyKhMap[o.maKH]) {
      o.isCompanyKH = true;
      o.companyTDV  = companyKhMap[o.maKH];
    }
  }
  return orders;
}

// ── Đọc file Quý (T1/T2 Target + Thực, T3 = tháng hiện tại) ──
async function parseQuyData(file) {
  const buf = await readFileAsArrayBuffer(file);
  const wb  = XLSX.read(buf, { type: 'array' });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const maTDV = String(row[0] || '').trim();
    if (!maTDV) continue;
    map[maTDV] = {
      t1Target: parseFloat(row[2]) || 0,
      t2Target: parseFloat(row[3]) || 0,
      t1Thuc:   parseFloat(row[4]) || 0,
      t2Thuc:   parseFloat(row[5]) || 0,
    };
  }
  return map;
}
