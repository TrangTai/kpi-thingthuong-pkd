// ============================================================
// ANALYTICS-QUARTERLY.JS - Báo cáo kinh doanh theo quý
// ============================================================

const QUY_MIN_DS = 500000;

// ─── Target Quý parser ───────────────────────────────────────
// Format: MãTDV | TênTDV | KhuVực | Miền | QLBH | ĐốiTượng | DSTổngTarget | ĐPKHTarget | ĐPMHTarget
function parseTargetQuyFile(arrayBuffer) {
  const wb   = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: false });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 2) return [];

  const _n = s => String(s||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/đ/g,'d').replace(/\s+/g,'');
  const normH = rows[0].map(h => _n(h));
  const fi = (...ks) => { for (const k of ks) { const i = normH.findIndex(h => h.includes(_n(k))); if (i>=0) return i; } return -1; };
  const cMA  = fi('ma tdv', 'matdv');               if (cMA  < 0) throw new Error('Cần cột "Mã TDV"');
  const cTEN = fi('tentdv', 'ten tdv');
  const cKV  = fi('khuvuc', 'khu vuc');
  const cMI  = fi('mien');
  const cQL  = fi('qlbh');
  const cDT  = fi('doituong', 'doi tuong');
  const cDS  = fi('dstong', 'ds tong', 'doanhs', 'target');
  const cDPKH = fi('dpkh');
  const cDPMH = fi('dpmh');

  const targets = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const maTDV = String(row[cMA] || '').trim().toUpperCase();
    if (!maTDV) continue;
    const cleanNum = c => parseFloat(String(row[c]||'0').replace(/[^0-9.-]/g,'')) || 0;
    targets.push({
      maTDV,
      tenTDV:       String(row[cTEN >= 0 ? cTEN : 1] || '').trim(),
      khuVuc:       String(row[cKV  >= 0 ? cKV  : 2] || '').trim(),
      mien:         String(row[cMI  >= 0 ? cMI  : 3] || '').trim(),
      qlbhCode:     String(row[cQL  >= 0 ? cQL  : 4] || '').trim(),
      doiTuong:     String(row[cDT  >= 0 ? cDT  : 5] || '').trim().toUpperCase(),
      dsTongTarget: cleanNum(cDS  >= 0 ? cDS  : 6),
      dpkhTarget:   cleanNum(cDPKH >= 0 ? cDPKH : 7),
      dpmhTarget:   cleanNum(cDPMH >= 0 ? cDPMH : 8),
      isQuyTarget:  true,  // dsTongTarget là tổng quý, không nhân 3
    });
  }
  return targets;
}

// ─── SP→Nhóm mapping parser ──────────────────────────────────
function parseSpNhomFile(arrayBuffer) {
  const wb   = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: false });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 2) return {};

  const hdr = rows[0].map(h => _normVI(h));
  const _fi = (...ks) => { for (const k of ks) { const i = hdr.findIndex(h => h.includes(_normVI(k))); if (i>=0) return i; } return -1; };
  const cSP   = _fi('ma sp', 'masp', 'ma hang');
  const cNhom = _fi('nhom', 'group', 'phan loai', 'loai');
  if (cSP < 0 || cNhom < 0) throw new Error('File cần có cột "Mã SP" và "Nhóm"');

  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const sp   = String(rows[i][cSP]   || '').trim();
    const nhom = String(rows[i][cNhom] || '').trim();
    if (sp && nhom) map[sp] = nhom;
  }
  return map;
}

// ─── Cùng kỳ order file parser ───────────────────────────────
// Format: col0=MãĐH col1=NgàyĐH col2=MãKH col3=TênKH col4=MãSP col5=TênSP
//         col6=SL col7=Giá col8=TổngTiền col9=MaTDV col10=TênTDV col11=KhuVực col12=QLBH col13=TênQLBH
function parseQuyOrderFileCK(arrayBuffer) {
  const wb   = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: false });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 2) return null;

  // Detect QLBH column from header row
  const hdr0 = rows[0].map(h => String(h||'').toLowerCase().replace(/\s/g,''));
  const cQLBH = hdr0.findIndex(h => h.includes('qlbh') || h.includes('quan ly ban hang'));

  const byTdv        = {};  // {tdv: {ds, khDsMap, spDsMap}}
  const byMaSP       = {};  // {maSP: {tenSP, ds}}
  const bySPKhSet    = {};  // {maSP: Set<maKH>}
  const byTdvSPKhSet = {};  // {tdv: {maSP: Set<maKH>}} — dùng cho filter nhóm ĐPKH
  const byMonth      = {};  // {'yyyy-mm': totalDs}
  const byMonthKhMap = {};  // {'yyyy-mm': {maKH: totalDs}}
  const byTdvMonth   = {};  // {tdv: {'yyyy-mm': {ds, khDsMap, spDsMap}}}
  const tdvInfo      = {};  // {tdv: {tenTDV, khuVuc, maQLBH}} extracted from file
  const khInfoMap     = {};  // {maKH: tenKH}
  const byTdvOrderSet = {};  // {maTDV: Set<maĐH>}

  for (let i = 1; i < rows.length; i++) {
    const row   = rows[i];
    const maTDV = String(row[9] || '').trim().toUpperCase();
    const maKH  = String(row[2] || '').trim();
    const tenKH = String(row[3] || '').trim();
    const maSP  = String(row[4] || '').trim();
    const tenSP = String(row[5] || '').trim();
    const ds    = parseFloat(row[8]) || 0;
    if (!maTDV || ds <= 0) continue;
    if (maKH && !khInfoMap[maKH]) khInfoMap[maKH] = tenKH;
    const maDH = String(row[0] || '').trim();
    if (maDH) { if (!byTdvOrderSet[maTDV]) byTdvOrderSet[maTDV] = new Set(); byTdvOrderSet[maTDV].add(maDH); }

    // TDV name/area from file columns; QLBH from detected column or col 12
    if (!tdvInfo[maTDV]) {
      const qlbhCol = cQLBH >= 0 ? cQLBH : 12;
      tdvInfo[maTDV] = {
        tenTDV: String(row[10] || '').trim() || maTDV,
        khuVuc: String(row[11] || '').trim(),
        maQLBH: String(row[qlbhCol] || '').trim(),
      };
    }

    // Parse date → 'yyyy-mm'
    let monthKey = '';
    const dv = row[1];
    if (dv) {
      let dt = null;
      if (typeof dv === 'number' && dv > 1000) {
        dt = new Date(Math.round((dv - 25569) * 86400 * 1000));
      } else if (dv instanceof Date) {
        dt = dv;
      } else if (typeof dv === 'string') {
        // Handle dd/MM/yyyy or dd-MM-yyyy or yyyy-MM-dd
        const m1 = dv.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
        const m2 = dv.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
        if (m1) dt = new Date(+m1[3], +m1[2]-1, +m1[1]);
        else if (m2) dt = new Date(+m2[1], +m2[2]-1, +m2[3]);
      }
      if (dt && !isNaN(dt)) {
        const y = dt instanceof Date && typeof dv === 'string' ? dt.getFullYear() : dt.getUTCFullYear();
        const mo = dt instanceof Date && typeof dv === 'string' ? dt.getMonth()+1 : dt.getUTCMonth()+1;
        monthKey = `${y}-${String(mo).padStart(2,'0')}`;
      }
    }

    // Per-TDV aggregate
    if (!byTdv[maTDV]) byTdv[maTDV] = { ds:0, khDsMap:{}, spDsMap:{} };
    byTdv[maTDV].ds += ds;
    if (maKH) byTdv[maTDV].khDsMap[maKH] = (byTdv[maTDV].khDsMap[maKH]||0) + ds;
    if (maSP) byTdv[maTDV].spDsMap[maSP] = (byTdv[maTDV].spDsMap[maSP]||0) + ds;

    // Per-SP aggregate
    if (maSP) {
      if (!byMaSP[maSP]) byMaSP[maSP] = { tenSP, ds:0 };
      byMaSP[maSP].ds += ds;
      if (!bySPKhSet[maSP]) bySPKhSet[maSP] = new Set();
      if (maKH) bySPKhSet[maSP].add(maKH);
      // Per-TDV per-SP KH set (dùng cho filter nhóm ĐPKH)
      if (maKH) {
        if (!byTdvSPKhSet[maTDV]) byTdvSPKhSet[maTDV] = {};
        if (!byTdvSPKhSet[maTDV][maSP]) byTdvSPKhSet[maTDV][maSP] = new Set();
        byTdvSPKhSet[maTDV][maSP].add(maKH);
      }
    }

    // Monthly aggregates
    if (monthKey) {
      byMonth[monthKey] = (byMonth[monthKey]||0) + ds;

      if (maKH) {
        if (!byMonthKhMap[monthKey]) byMonthKhMap[monthKey] = {};
        byMonthKhMap[monthKey][maKH] = (byMonthKhMap[monthKey][maKH]||0) + ds;
      }

      if (!byTdvMonth[maTDV]) byTdvMonth[maTDV] = {};
      if (!byTdvMonth[maTDV][monthKey]) byTdvMonth[maTDV][monthKey] = { ds:0, khDsMap:{}, spDsMap:{} };
      byTdvMonth[maTDV][monthKey].ds += ds;
      if (maKH) byTdvMonth[maTDV][monthKey].khDsMap[maKH] = (byTdvMonth[maTDV][monthKey].khDsMap[maKH]||0) + ds;
      if (maSP) byTdvMonth[maTDV][monthKey].spDsMap[maSP] = (byTdvMonth[maTDV][monthKey].spDsMap[maSP]||0) + ds;
    }
  }
  return { byTdv, byMaSP, bySPKhSet, byTdvSPKhSet, byMonth, byMonthKhMap, byTdvMonth, tdvInfo, khInfoMap, byTdvOrderSet };
}

// ─── Hợp đồng parser ─────────────────────────────────────────
// Format: HĐ Năm | Tháng | Mã TDV | Mã KH | Tên KH | Diễn giải
function parseHopDongFile(arrayBuffer) {
  const wb   = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: false });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 2) return { byTdvYear: {} };
  const byTdvYear = {}; // {maTDV: {year: Set<maKH>}}
  for (let i = 1; i < rows.length; i++) {
    const row   = rows[i];
    const year  = parseInt(row[0]) || 0;
    const maTDV = String(row[2] || '').trim().toUpperCase();
    const maKH  = String(row[3] || '').trim();
    if (!maTDV || !maKH || !year) continue;
    if (!byTdvYear[maTDV]) byTdvYear[maTDV] = {};
    if (!byTdvYear[maTDV][year]) byTdvYear[maTDV][year] = new Set();
    byTdvYear[maTDV][year].add(maKH);
  }
  return { byTdvYear };
}

// ─── Calculator ──────────────────────────────────────────────
let _quyReport = null;

function calculateQuarterlyReport(qData, currentOrders, spNhomMap, targets, dskhByTdv, ckData, hdData) {
  const today = new Date();
  const ROMAN = ['I','II','III','IV'];

  // Auto-detect reporting quarter from uploaded file months (fallback to today)
  const dataMonthKeys = Object.keys(qData?.byMonth || {})
    .filter(k => /^\d{4}-\d{2}$/.test(k)).sort();
  let curYear, q, m1, m2, m3;
  if (dataMonthKeys.length > 0) {
    const [dy, dm] = dataMonthKeys[dataMonthKeys.length - 1].split('-').map(Number);
    curYear = dy;
    q  = Math.ceil(dm / 3);
    m1 = (q-1)*3+1; m2 = (q-1)*3+2; m3 = (q-1)*3+3;
  } else {
    curYear = today.getFullYear();
    const curMonth = today.getMonth() + 1;
    q  = Math.ceil(curMonth / 3);
    m1 = (q-1)*3+1; m2 = (q-1)*3+2; m3 = curMonth;
  }
  const mkFmt    = m => `${curYear}-${String(m).padStart(2,'0')}`;
  const qMonthKeys = [mkFmt(m1), mkFmt(m2), mkFmt(m3)];
  const qMonthLabels = [`Tháng ${m1}`, `Tháng ${m2}`, `Tháng ${m3}`];

  // Target map (non-QLBH only)
  const tgtMap = {};
  (targets||[]).forEach(t => { tgtMap[(t.maTDV||'').toUpperCase()] = t; });

  // ── Aggregate current month from live orders ──────────────
  const curByTdv  = {};
  const curByMaSP = {};
  (currentOrders||[]).forEach(o => {
    const tdv = (o.maNV||'').trim().toUpperCase();
    const ds  = o.doanhSo || 0;
    if (!tdv) return;
    if (!curByTdv[tdv]) curByTdv[tdv] = { ds:0, khDsMap:{}, spDsMap:{} };
    const e = curByTdv[tdv];
    e.ds += ds;
    if (o.maKH) e.khDsMap[o.maKH] = (e.khDsMap[o.maKH]||0) + ds;
    if (o.maSP) {
      e.spDsMap[o.maSP] = (e.spDsMap[o.maSP]||0) + ds;
      if (!curByMaSP[o.maSP]) curByMaSP[o.maSP] = { tenSP: o.tenSP||o.maSP, ds:0 };
      curByMaSP[o.maSP].ds += ds;
    }
  });

  // ── Per-TDV quarterly stats ───────────────────────────────
  const h6ByTdv    = qData?.byTdvMonth || {};
  const fileTdvInfo = qData?.tdvInfo    || {}; // TDV name/area extracted from file
  const allTdvs = new Set([...Object.keys(h6ByTdv), ...Object.keys(curByTdv)]);
  const tdvRows = [];

  allTdvs.forEach(tdv => {
    const info = tgtMap[tdv] || {};
    if ((info.doiTuong||'').toUpperCase() === 'QLBH') return;

    const mStats      = {};
    const distinctKhSet = new Set(); // KH đủ điều kiện (≥500k) ít nhất 1 tháng
    const distinctSpSet = new Set(); // SP đủ điều kiện (≥500k) ít nhất 1 tháng

    qMonthKeys.forEach((mk, idx) => {
      // Prefer file data (byTdvMonth) for every month; fall back to curByTdv for current month only
      const fromFile = h6ByTdv[tdv]?.[mk];
      const d = fromFile
        ? fromFile
        : idx === 2
          ? (curByTdv[tdv] || {ds:0,khDsMap:{},spDsMap:{}})
          : {ds:0,khDsMap:{},spDsMap:{}};
      const dpkh = Object.values(d.khDsMap||{}).filter(v => v >= QUY_MIN_DS).length;
      const dpmh = Object.values(d.spDsMap||{}).filter(v => v >= QUY_MIN_DS).length;
      mStats[mk] = { ds: d.ds||0, dpkh, dpmh };

      // Track distinct KH/SP that qualified in at least 1 month
      Object.entries(d.khDsMap||{}).forEach(([kh,v]) => { if (v >= QUY_MIN_DS) distinctKhSet.add(kh); });
      Object.entries(d.spDsMap||{}).forEach(([sp,v]) => { if (v >= QUY_MIN_DS) distinctSpSet.add(sp); });
    });

    const totalDS   = qMonthKeys.reduce((s,mk) => s+(mStats[mk]?.ds  ||0), 0);
    const totalDPKH = qMonthKeys.reduce((s,mk) => s+(mStats[mk]?.dpkh||0), 0);
    const totalDPMH = qMonthKeys.reduce((s,mk) => s+(mStats[mk]?.dpmh||0), 0);

    const fileInfo = fileTdvInfo[tdv] || {};
    tdvRows.push({
      maTDV: tdv,
      tenTDV:       info.tenTDV      || fileInfo.tenTDV || tdv,
      mien:         info.mien        || fileInfo.maQLBH || '',
      qlbhCode:     (info.qlbhCode   || '').toUpperCase(),
      dpkhTarget:   info.dpkhTarget  || 0,
      dpmhTarget:   info.dpmhTarget  || 0,
      dsTongTarget: info.dsTongTarget|| 0,
      totalKhDskh:  (dskhByTdv || {})[tdv] || 0,
      totalDS, totalDPKH, totalDPMH, mStats,
      distinctKhCount: distinctKhSet.size,  // KH unique đủ ĐK ≥1 tháng trong quý
      distinctSpCount: distinctSpSet.size,  // SP unique đủ ĐK ≥1 tháng trong quý
      datTarget: (info.dsTongTarget||0) > 0 && totalDS >= (info.isQuyTarget ? (info.dsTongTarget||0) : (info.dsTongTarget||0)*3),
      ckDS: 0, ckDPKH: 0,
    });
  });
  tdvRows.sort((a,b) => b.totalDS - a.totalDS);

  // ── Cùng kỳ (same quarter, previous year) stats ──────────
  const ckByTdvMonth = ckData?.byTdvMonth || {};
  const ckByMaSP     = ckData?.byMaSP     || {};
  const ckBySPKhSet  = ckData?.bySPKhSet  || {};
  const hasCK        = !!(ckData && Object.keys(ckData.byTdv || {}).length > 0);

  // CK month keys = same months, previous year
  const ckMonthKeys = qMonthKeys.map(mk => {
    const [y, m] = mk.split('-');
    return `${parseInt(y)-1}-${m}`;
  });

  // Per-TDV CK stats (same computation method as current period)
  tdvRows.forEach(r => {
    let ckDS = 0, ckDPKH = 0;
    const ckDistinctKhSet = new Set();
    ckMonthKeys.forEach(mk => {
      const d = ckByTdvMonth[r.maTDV]?.[mk] || { ds:0, khDsMap:{} };
      ckDS   += d.ds;
      ckDPKH += Object.values(d.khDsMap).filter(v => v >= QUY_MIN_DS).length;
      Object.entries(d.khDsMap).forEach(([kh,v]) => { if (v >= QUY_MIN_DS) ckDistinctKhSet.add(kh); });
    });
    r.ckDS          = ckDS;
    r.ckDPKH        = ckDPKH;
    r.ckDistinctKh  = ckDistinctKhSet.size;
  });

  // allKhCount (tất cả KH DS>0) & orderCount (unique Mã ĐH) per TDV
  tdvRows.forEach(r => {
    const allKhSet = new Set();
    qMonthKeys.forEach(mk => {
      Object.entries(h6ByTdv[r.maTDV]?.[mk]?.khDsMap || {}).forEach(([kh, ds]) => {
        if (ds > 0) allKhSet.add(kh);
      });
    });
    r.allKhCount = allKhSet.size;
    r.orderCount  = qData?.byTdvOrderSet?.[r.maTDV]?.size || 0;
  });

  // CK nhóm DS and ĐPKH
  const ckNhomDsMap   = {};
  const ckNhomKhSets  = {};
  if (spNhomMap && hasCK) {
    Object.entries(ckByMaSP).forEach(([sp, {ds}]) => {
      const nh = spNhomMap[sp] || 'BÁN PHỦ HẾT';
      ckNhomDsMap[nh] = (ckNhomDsMap[nh]||0) + ds;
    });
    Object.entries(ckBySPKhSet).forEach(([sp, khSet]) => {
      const nh = spNhomMap[sp] || 'BÁN PHỦ HẾT';
      if (!ckNhomKhSets[nh]) ckNhomKhSets[nh] = new Set();
      khSet.forEach(kh => ckNhomKhSets[nh].add(kh));
    });
  }
  const ckNhomDpkhMap = {};
  Object.entries(ckNhomKhSets).forEach(([nh, s]) => { ckNhomDpkhMap[nh] = s.size; });

  // CK monthly totals aligned to current quarter months
  const ckDsByMonth = ckMonthKeys.map(mk => ckData?.byMonth?.[mk] || 0);
  const ckDpkhByMonth = ckMonthKeys.map(mk => {
    return tdvRows.reduce((s, r) => {
      const khMap = ckByTdvMonth[r.maTDV]?.[mk]?.khDsMap || {};
      return s + Object.values(khMap).filter(v => v >= QUY_MIN_DS).length;
    }, 0);
  });

  const ckTotalDS   = ckDsByMonth.reduce((s,v) => s+v, 0);
  // ckTotalDPKH computed after per-TDV CK loop below

  // CK SP map for Top SP comparison
  const ckByMaSPTotal = {};
  if (hasCK) {
    Object.entries(ckData.byMaSP || {}).forEach(([sp, v]) => {
      ckByMaSPTotal[sp] = v.ds || 0;
    });
  }

  // ── QLBH % achievement ───────────────────────────────────
  const qlbhTeamDsMap = {};
  tdvRows.forEach(t => {
    if (t.qlbhCode) qlbhTeamDsMap[t.qlbhCode] = (qlbhTeamDsMap[t.qlbhCode] || 0) + t.totalDS;
  });
  const qlbhPctRows = Object.entries(qlbhTeamDsMap).map(([code, ds]) => {
    const info = tgtMap[code] || {};
    const target = info.isQuyTarget ? (info.dsTongTarget||0) : (info.dsTongTarget||0) * 3;
    return { code, tenTDV: info.tenTDV || code, ds, target, pct: target > 0 ? ds / target : 0 };
  }).filter(r => r.target > 0);
  const datQLBHCount = qlbhPctRows.filter(r => r.pct >= 1).length;
  const qlbhCount    = qlbhPctRows.length;

  // ── Monthly totals ────────────────────────────────────────
  const dsByMonth   = qMonthKeys.map((mk,i) => ({ label: qMonthLabels[i], ds:   tdvRows.reduce((s,t) => s+(t.mStats[mk]?.ds  ||0), 0) }));
  const dpkhByMonth = qMonthKeys.map((mk,i) => ({ label: qMonthLabels[i], dpkh: tdvRows.reduce((s,t) => s+(t.mStats[mk]?.dpkh||0), 0) }));

  // ── Per-SP totals ─────────────────────────────────────────
  const byMaSP6 = qData?.byMaSP || {};
  const allSPs  = new Set([...Object.keys(byMaSP6), ...Object.keys(curByMaSP)]);
  const byMaSPTotal = {};
  allSPs.forEach(sp => {
    byMaSPTotal[sp] = {
      tenSP: byMaSP6[sp]?.tenSP || curByMaSP[sp]?.tenSP || sp,
      ds:   (byMaSP6[sp]?.ds||0) + (curByMaSP[sp]?.ds||0),
    };
  });

  // ── Nhóm DS ──────────────────────────────────────────────
  const nhomDsMap = {};
  if (spNhomMap) {
    Object.entries(byMaSPTotal).forEach(([sp,{ds}]) => {
      const nh = spNhomMap[sp] || 'BÁN PHỦ HẾT';
      nhomDsMap[nh] = (nhomDsMap[nh]||0) + ds;
    });
  }

  // ── Nhóm DPKH ────────────────────────────────────────────
  const nhomKhSets = {};
  if (spNhomMap) {
    const bySPKh6 = qData?.bySPKhSet || {};
    Object.entries(bySPKh6).forEach(([sp, khSet]) => {
      const nh = spNhomMap[sp] || 'BÁN PHỦ HẾT';
      if (!nhomKhSets[nh]) nhomKhSets[nh] = new Set();
      khSet.forEach(kh => nhomKhSets[nh].add(kh));
    });
    (currentOrders||[]).forEach(o => {
      if (!o.maKH || !o.maSP) return;
      const nh = spNhomMap[o.maSP] || 'BÁN PHỦ HẾT';
      if (!nhomKhSets[nh]) nhomKhSets[nh] = new Set();
      nhomKhSets[nh].add(o.maKH);
    });
  }
  const nhomDpkhMap = {};
  Object.entries(nhomKhSets).forEach(([nh,s]) => { nhomDpkhMap[nh] = s.size; });

  // ── Top SP ───────────────────────────────────────────────
  const totalDSAll = Object.values(byMaSPTotal).reduce((s,v) => s+v.ds, 0);
  const topSP = Object.entries(byMaSPTotal)
    .sort((a,b) => b[1].ds - a[1].ds)
    .slice(0, 15)
    .map(([sp,v]) => ({ maSP:sp, tenSP:v.tenSP, ds:v.ds, pct: totalDSAll>0?v.ds/totalDSAll:0, ckDS: ckByMaSPTotal[sp]||0 }));

  // ── Aggregates ────────────────────────────────────────────
  const totalDS   = tdvRows.reduce((s,t) => s+t.totalDS, 0);
  // totalDPKH = tổng KH unique (mỗi mã KH chỉ tính 1 lần trong quý)
  const totalDPKH    = tdvRows.reduce((s,t) => s + t.distinctKhCount, 0);
  const ckTotalDPKH  = tdvRows.reduce((s,t) => s + (t.ckDistinctKh||0), 0);
  const datCount  = tdvRows.filter(t => t.datTarget).length;

  // Lead nhóm
  let leadNhom='', leadPct=0;
  if (totalDS > 0) {
    for (const [nh,ds] of Object.entries(nhomDsMap)) {
      if (ds/totalDS > leadPct) { leadPct=ds/totalDS; leadNhom=nh; }
    }
  }

  // ── Nhóm SP per TDV (mục 11) ─────────────────────────────
  const tdvNhomDsMap = {}; // {maTDV: {nhom: totalDS}}
  if (spNhomMap) {
    tdvRows.forEach(r => {
      const m = {};
      qMonthKeys.forEach(mk => {
        Object.entries(h6ByTdv[r.maTDV]?.[mk]?.spDsMap || {}).forEach(([sp, ds]) => {
          const nh = spNhomMap[sp] || 'BÁN PHỦ HẾT';
          m[nh] = (m[nh]||0) + ds;
        });
      });
      tdvNhomDsMap[r.maTDV] = m;
    });
  }

  // ── Unique SP per KH per TDV buckets (mục 12) ────────────
  const byTdvSPKhSetRaw = qData?.byTdvSPKhSet || {};
  const tdvKhSpBuckets  = {}; // {maTDV: {1, 2, '3-4', '5-9', '10+'}}
  tdvRows.forEach(r => {
    const khSpMap = {};
    Object.entries(byTdvSPKhSetRaw[r.maTDV] || {}).forEach(([sp, khSet]) => {
      khSet.forEach(kh => { if (!khSpMap[kh]) khSpMap[kh] = new Set(); khSpMap[kh].add(sp); });
    });
    const b = {1:0, 2:0, '3-4':0, '5-9':0, '10+':0};
    Object.values(khSpMap).forEach(s => {
      const n = s.size;
      if (n>=10) b['10+']++; else if(n>=5) b['5-9']++; else if(n>=3) b['3-4']++; else if(n===2) b[2]++; else b[1]++;
    });
    tdvKhSpBuckets[r.maTDV] = b;
  });

  // ── KH tần suất mua per TDV (mục 13) ─────────────────────
  const tdvKhMonthBuckets = {}; // {maTDV: {1, 2, 3}}
  tdvRows.forEach(r => {
    const khCnt = {};
    qMonthKeys.forEach(mk => {
      Object.entries(h6ByTdv[r.maTDV]?.[mk]?.khDsMap || {}).forEach(([kh, ds]) => {
        if (ds > 0) khCnt[kh] = (khCnt[kh]||0) + 1;
      });
    });
    const b = {1:0, 2:0, 3:0};
    Object.values(khCnt).forEach(c => { if(c>=3) b[3]++; else if(c===2) b[2]++; else b[1]++; });
    tdvKhMonthBuckets[r.maTDV] = b;
  });

  // ── KH chỉ mua T1, không mua T2 và T3 (mục 14) ─────────
  const [mk0, mk1, mk2] = qMonthKeys;
  const atRiskByTdv = {}; // {maTDV: count}
  tdvRows.forEach(r => {
    const khT1 = h6ByTdv[r.maTDV]?.[mk0]?.khDsMap || {};
    const khT2 = h6ByTdv[r.maTDV]?.[mk1]?.khDsMap || {};
    const khT3 = h6ByTdv[r.maTDV]?.[mk2]?.khDsMap || {};
    let count = 0;
    Object.keys(khT1).forEach(kh => {
      if ((khT1[kh]||0) > 0 && (!khT2[kh] || khT2[kh] === 0) && (!khT3[kh] || khT3[kh] === 0))
        count++;
    });
    atRiskByTdv[r.maTDV] = count;
  });

  // ── CK per-TDV (mục 11 / 12 / 13 delta) ─────────────────
  const ckTdvNhomDsMap = {};
  if (spNhomMap && hasCK) {
    tdvRows.forEach(r => {
      const m = {};
      ckMonthKeys.forEach(mk => {
        Object.entries(ckByTdvMonth[r.maTDV]?.[mk]?.spDsMap || {}).forEach(([sp, ds]) => {
          const nh = spNhomMap[sp] || 'BÁN PHỦ HẾT';
          m[nh] = (m[nh]||0) + ds;
        });
      });
      ckTdvNhomDsMap[r.maTDV] = m;
    });
  }

  const ckTdvKhSpBuckets = {};
  if (hasCK) {
    const ckSpKhRaw = ckData?.byTdvSPKhSet || {};
    tdvRows.forEach(r => {
      const khSpMap = {};
      Object.entries(ckSpKhRaw[r.maTDV] || {}).forEach(([sp, khSet]) => {
        khSet.forEach(kh => { if (!khSpMap[kh]) khSpMap[kh] = new Set(); khSpMap[kh].add(sp); });
      });
      const b = {1:0, 2:0, '3-4':0, '5-9':0, '10+':0};
      Object.values(khSpMap).forEach(s => {
        const n = s.size;
        if (n>=10) b['10+']++; else if(n>=5) b['5-9']++; else if(n>=3) b['3-4']++; else if(n===2) b[2]++; else b[1]++;
      });
      ckTdvKhSpBuckets[r.maTDV] = b;
    });
  }

  const ckTdvKhMonthBuckets = {};
  if (hasCK) {
    tdvRows.forEach(r => {
      const khCnt = {};
      ckMonthKeys.forEach(mk => {
        Object.entries(ckByTdvMonth[r.maTDV]?.[mk]?.khDsMap || {}).forEach(([kh, ds]) => {
          if (ds > 0) khCnt[kh] = (khCnt[kh]||0) + 1;
        });
      });
      const b = {1:0, 2:0, 3:0};
      Object.values(khCnt).forEach(c => { if(c>=3) b[3]++; else if(c===2) b[2]++; else b[1]++; });
      ckTdvKhMonthBuckets[r.maTDV] = b;
    });
  }

  // ── SLKH theo nhóm DS per TDV (mục 19) ──────────────────
  const tdvKhDsBuckets = {};
  tdvRows.forEach(r => {
    const khTotalDs = {};
    qMonthKeys.forEach(mk => {
      Object.entries(h6ByTdv[r.maTDV]?.[mk]?.khDsMap || {}).forEach(([kh, ds]) => {
        if (ds > 0) khTotalDs[kh] = (khTotalDs[kh]||0) + ds;
      });
    });
    const b = {'lt1M':0,'1-3M':0,'3-5M':0,'5-10M':0,'10-30M':0,'gt30M':0};
    Object.values(khTotalDs).forEach(ds => {
      if      (ds >= 30e6) b['gt30M']++;
      else if (ds >= 10e6) b['10-30M']++;
      else if (ds >= 5e6)  b['5-10M']++;
      else if (ds >= 3e6)  b['3-5M']++;
      else if (ds >= 1e6)  b['1-3M']++;
      else                 b['lt1M']++;
    });
    tdvKhDsBuckets[r.maTDV] = b;
  });

  // ── HĐ stats per TDV (mục 15 & 20) ──────────────────────
  const hdByTdvYear = hdData?.byTdvYear || {};
  const hdStatsMap  = {}; // {maTDV: uniqueKhCount}
  Object.entries(hdByTdvYear).forEach(([tdv, yearMap]) => {
    hdStatsMap[tdv.toUpperCase()] = yearMap[curYear]?.size || 0;
  });

  return {
    qLabel: `Quý ${ROMAN[q-1]}`, qYear: curYear,
    qPeriod: `Tháng ${m1} – Tháng ${m3} · Năm ${curYear}`,
    qMonthKeys, qMonthLabels,
    totalDS, totalDPKH, datCount, tdvCount: tdvRows.length,
    datQLBHCount, qlbhCount, qlbhPctRows,
    leadNhom, leadPct,
    tdvRows, dsByMonth, dpkhByMonth,
    nhomDsMap, nhomDpkhMap, topSP,
    hasCK, ckTotalDS, ckTotalDPKH,
    ckDsByMonth, ckDpkhByMonth, ckMonthKeys,
    ckNhomDsMap, ckNhomDpkhMap,
    _qData: qData,        // raw file data for filter recomputation
    _ckData: ckData,      // CK file data for filter recomputation
    _spNhomMap: spNhomMap,
    _hdData: hdData,
    tdvNhomDsMap, tdvKhSpBuckets, tdvKhMonthBuckets, atRiskByTdv, hdStatsMap,
    ckTdvNhomDsMap, ckTdvKhSpBuckets, ckTdvKhMonthBuckets, tdvKhDsBuckets,
  };
}

// ─── Renderer ────────────────────────────────────────────────
function renderQuarterlyReport(data) {
  _quyReport = data;
  const {
    qLabel, qYear, qPeriod, totalDS, totalDPKH, datCount, tdvCount,
    datQLBHCount, qlbhCount, leadNhom, leadPct,
    tdvRows, dsByMonth, dpkhByMonth, nhomDsMap, nhomDpkhMap, topSP, qMonthLabels,
    hasCK, ckTotalDS, ckTotalDPKH, ckDsByMonth, ckDpkhByMonth,
    ckNhomDsMap, ckNhomDpkhMap,
    tdvNhomDsMap = {}, tdvKhSpBuckets = {}, tdvKhMonthBuckets = {},
    atRiskByTdv = {}, hdStatsMap = {},
    ckTdvNhomDsMap = {}, ckTdvKhSpBuckets = {}, ckTdvKhMonthBuckets = {},
    tdvKhDsBuckets = {},
  } = data;

  const vndM  = v => Math.round(v/1e6).toLocaleString('vi-VN') + 'M';
  const pctFmt= v => (v*100).toFixed(0) + '%';

  // Growth badge helper
  const growthBadge = (cur, ck) => {
    if (!hasCK || !ck) return '';
    const pct = (cur - ck) / ck * 100;
    const cls = pct >= 0 ? 'quy-grow-up' : 'quy-grow-down';
    const arrow = pct >= 0 ? '▲' : '▼';
    return `<span class="${cls}">${arrow} ${Math.abs(pct).toFixed(0)}%</span>`;
  };

  // ── Miền filter ───────────────────────────────────────────
  const allTdvRowsForMien = data._allTdvRows || tdvRows;
  const mienList = [...new Set(allTdvRowsForMien.map(t => t.mien).filter(Boolean))].sort();
  const mienFilterHtml = mienList.length > 1 ? `
    <div class="quy-mien-bar">
      <label class="quy-mien-label">Miền:</label>
      <select id="quy-mien-select" onchange="onQuyMienChange(this.value)" class="quy-mien-select">
        <option value="">Tất cả</option>
        ${mienList.map(m => `<option value="${m}">${m}</option>`).join('')}
      </select>
    </div>` : '';

  // ── Section I: Doanh số ──────────────────────────────────
  const ckLabelDS = hasCK
    ? `<span class="quy-ck-badge">CK: ${vndM(ckTotalDS)} ${growthBadge(totalDS, ckTotalDS)}</span>`
    : `<span class="quy-ck-badge" style="color:#aaa">Chưa có dữ liệu cùng kỳ</span>`;

  // Card 03: Tăng trưởng DS Quý (vs CK) hoặc % Đạt Target nếu chưa có CK
  const growthPct03 = hasCK && ckTotalDS > 0 ? (totalDS - ckTotalDS) / ckTotalDS * 100 : null;
  const card03BigNum = growthPct03 !== null
    ? `<span style="color:${growthPct03 >= 0 ? '#007A3D' : '#C0392B'}">${growthPct03 >= 0 ? '+' : ''}${growthPct03.toFixed(1)}%</span>`
    : `${qlbhCount>0 ? Math.round(datQLBHCount/qlbhCount*100) : (tdvCount>0 ? Math.round(datCount/tdvCount*100) : 0)}%`;
  const card03Sub = growthPct03 !== null
    ? `${vndM(totalDS)} vs CK ${vndM(ckTotalDS)}`
    : (qlbhCount>0 ? `${datQLBHCount}/${qlbhCount} QLBH đạt chỉ tiêu` : `${datCount}/${tdvCount} TDV đạt chỉ tiêu`);
  const card03Title = growthPct03 !== null ? '03 · TĂNG TRƯỞNG DS QUÝ' : '03 · % ĐẠT TARGET QUÝ';

  // ── HTML bar chart 02 (thay canvas để cho phép growth badge bên phải) ──
  const _buildHtmlBarChart02 = () => {
    const sorted   = [...tdvRows].sort((a,b) => b.totalDS - a.totalDS);
    const maxDS    = sorted[0]?.totalDS || 1;
    const maxCKDS  = hasCK ? Math.max(...sorted.map(t => t.ckDS||0), 1) : 1;
    const maxAll   = Math.max(maxDS, maxCKDS);
    return sorted.map(t => {
      const wCur  = Math.round(t.totalDS / maxAll * 100);
      const wCK   = hasCK ? Math.round((t.ckDS||0) / maxAll * 100) : 0;
      const badge = hasCK && t.ckDS > 0 ? growthBadge(t.totalDS, t.ckDS) : '';
      const ckBar = hasCK
        ? `<div style="height:4px;background:#B0C4DE;border-radius:2px;width:${wCK}%;margin-top:3px;opacity:.8"></div>`
        : '';
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f0f4f8">
        <span style="min-width:110px;max-width:110px;font-size:11px;color:#334;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.tenTDV}</span>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:6px">
            <div style="flex:1;background:#EEF2F7;border-radius:3px;height:14px;position:relative">
              <div style="width:${wCur}%;height:100%;background:#3A7BD5;border-radius:3px"></div>
            </div>
            <span style="min-width:44px;font-size:11px;font-weight:700;color:#3A7BD5;text-align:right">${vndM(t.totalDS)}</span>
          </div>
          ${ckBar}
        </div>
        <span style="min-width:52px;text-align:right;font-size:11px">${badge}</span>
      </div>`;
    }).join('');
  };

  // Bảng % đạt DS Quý theo TDV (chỉ hiện khi có target)
  const buildDsTgtTable = () => {
    const tgtRows = tdvRows.filter(t => t.dsTongTarget > 0);
    if (!tgtRows.length) return '<div style="color:#aaa;padding:12px;font-size:12px">Chưa có file Target — không có chỉ tiêu DS</div>';
    const rows = tgtRows.map(t => {
      const pct = Math.round(t.totalDS / t.dsTongTarget * 100);
      const cls = pct >= 100 ? 'quy-tl-good' : pct >= 80 ? 'quy-tl-warn' : 'quy-tl-bad';
      return `<tr><td>${t.tenTDV}</td><td style="text-align:right">${vndM(t.totalDS)}</td><td style="text-align:right">${vndM(t.dsTongTarget)}</td><td class="${cls}" style="text-align:center;font-weight:700">${pct}%</td></tr>`;
    });
    const totDS = tgtRows.reduce((s,t)=>s+t.totalDS,0);
    const totTg = tgtRows.reduce((s,t)=>s+t.dsTongTarget,0);
    const totPct = totTg > 0 ? Math.round(totDS/totTg*100) : 0;
    const totCls = totPct >= 100 ? 'quy-tl-good' : totPct >= 80 ? 'quy-tl-warn' : 'quy-tl-bad';
    return `<table class="quy-tbl"><thead><tr><th>Tên TDV</th><th style="text-align:right">DS Thực Đạt</th><th style="text-align:right">Target Quý</th><th style="text-align:center">% Đạt Quý</th></tr></thead><tbody>${rows.join('')}<tr class="quy-tbl-total"><td>Tổng</td><td style="text-align:right">${vndM(totDS)}</td><td style="text-align:right">${vndM(totTg)}</td><td class="${totCls}" style="text-align:center;font-weight:700">${totPct}%</td></tr></tbody></table>`;
  };
  const hasDSTgt = tdvRows.some(t => t.dsTongTarget > 0);

  const s1 = `
<div class="quy-section">
  <div class="quy-sec-hdr"><span class="quy-sec-num">I</span> DOANH SỐ</div>
  <div class="quy-chart-grid quy-chart-grid-3">
    <div class="quy-chart-card">
      <div class="quy-chart-title">01 · DOANH SỐ THEO THÁNG<span class="quy-chart-unit">(Đơn vị: triệu đồng)</span></div>
      <div style="height:180px;position:relative"><canvas id="quy-chart-01"></canvas></div>
      <div class="quy-ds-total-row">Tổng doanh số quý: <b>${vndM(totalDS)}</b>${hasCK?` &nbsp;·&nbsp; CK: <b>${vndM(ckTotalDS)}</b> ${growthBadge(totalDS,ckTotalDS)}`:''}</div>
    </div>
    <div class="quy-chart-card quy-pct-card">
      <div class="quy-chart-title">${card03Title}</div>
      <div class="quy-big-pct">${card03BigNum}</div>
      <div class="quy-big-pct-sub">${card03Sub}</div>
    </div>
  </div>
  <div class="quy-chart-card" style="margin-top:12px">
    <div class="quy-chart-title">02 · DOANH SỐ THEO TRÌNH DƯỢC VIÊN${hasCK?'<span class="quy-chart-unit"><span class="quy-legend-dot" style="background:#3A7BD5"></span>Quý này &nbsp;<span class="quy-legend-dot" style="background:#B0C4DE"></span>Cùng kỳ</span>':''}</div>
    <div style="padding:4px 0">${_buildHtmlBarChart02()}</div>
    <div style="margin-top:8px;display:flex;gap:16px;font-size:10px;color:#9AABB9">
      <span><span style="display:inline-block;width:10px;height:10px;background:#3A7BD5;border-radius:2px;margin-right:4px"></span>DS Quý này</span>
      ${hasCK?'<span><span style="display:inline-block;width:10px;height:4px;background:#B0C4DE;border-radius:2px;margin-right:4px;vertical-align:middle"></span>CK</span>':''}
    </div>
  </div>
  ${hasDSTgt ? `<div class="quy-chart-card" style="margin-top:12px">
    <div class="quy-chart-title">03 · % ĐẠT DOANH SỐ QUÝ THEO TDV</div>
    ${buildDsTgtTable()}
  </div>` : ''}
</div>`;

  // ── Section II: Khách hàng ───────────────────────────────
  const dpkhTotal = dpkhByMonth.reduce((s,v)=>s+v.dpkh,0);
  const hasDskh = tdvRows.some(t => t.totalKhDskh > 0);

  const buildDpkhTable05 = () => {
    // Cột: Tên TDV | KH TB (avg tháng) | ĐPKH Quý (unique KH ≥1 tháng) | Tỷ lệ | [KH TB CK | ĐPKH Quý CK | TT/CK]
    const hdrCK = hasCK ? '<th class="quy-ck-col">KH TB CK</th><th class="quy-ck-col">ĐPKHQuý CK</th><th class="quy-ck-col">TT/CK</th>' : '';
    const rows = tdvRows.map(t => {
      const tb      = Math.round(t.totalDPKH / 3);   // ĐPKH TB tháng
      const uniq    = t.distinctKhCount;              // ĐPKH Quý = unique KH
      const tl      = uniq > 0 ? Math.round(tb / uniq * 100) : 0;
      const cls     = tl>=100?'quy-tl-good':tl>=60?'quy-tl-warn':'quy-tl-bad';
      const ckTb    = hasCK ? Math.round(t.ckDPKH / 3) : null;
      const ckUniq  = hasCK ? (t.ckDistinctKh || 0) : null;
      const ckCols  = hasCK
        ? `<td class="quy-ck-col">${ckTb}</td><td class="quy-ck-col">${ckUniq}</td><td class="quy-ck-col">${growthBadge(tb, ckTb||1)}</td>`
        : '';
      return `<tr><td>${t.tenTDV}</td><td>${tb}</td><td>${uniq}</td><td class="${cls}">${tl}%</td>${ckCols}</tr>`;
    });
    const totTb   = Math.round(tdvRows.reduce((s,t)=>s+t.totalDPKH,0) / 3);
    const totUniq = tdvRows.reduce((s,t)=>s+t.distinctKhCount, 0);
    const totTl   = totUniq > 0 ? Math.round(totTb / totUniq * 100) : 0;
    const ckTotTb   = hasCK ? Math.round(tdvRows.reduce((s,t)=>s+t.ckDPKH,0) / 3) : null;
    const ckTotUniq = hasCK ? tdvRows.reduce((s,t)=>s+(t.ckDistinctKh||0), 0) : null;
    const ckTotCols = hasCK
      ? `<td class="quy-ck-col">${ckTotTb}</td><td class="quy-ck-col">${ckTotUniq}</td><td class="quy-ck-col">${growthBadge(totTb, ckTotTb||1)}</td>`
      : '';
    return `<table class="quy-tbl"><thead><tr><th>Tên TDV</th><th>KH TB/tháng</th><th>ĐPKH Quý</th><th>KH TB/ĐPKH</th>${hdrCK}</tr></thead><tbody>${rows.join('')}<tr class="quy-tbl-total"><td>Tổng</td><td>${totTb}</td><td>${totUniq}</td><td>${totTl}%</td>${ckTotCols}</tr></tbody></table>`;
  };

  const buildDpkhTable06 = () => {
    // KH Quý = KH unique đủ ĐK | Tổng KH = tổng KH trong file DSKH
    const hdrCK = hasCK ? '<th class="quy-ck-col">KH Quý CK</th><th class="quy-ck-col">TT/CK</th>' : '';
    const rows = tdvRows.map(t => {
      const quy = t.distinctKhCount;
      const tot = t.totalKhDskh || 0;   // luôn dùng DSKH
      const tl  = tot > 0 ? Math.round(quy / tot * 100) : 0;
      const cls = tl>=100?'quy-tl-good':tl>=60?'quy-tl-warn':'quy-tl-bad';
      const ckCols = hasCK
        ? `<td class="quy-ck-col">${t.ckDistinctKh||'—'}</td><td class="quy-ck-col">${t.ckDistinctKh?growthBadge(quy, t.ckDistinctKh):''}</td>`
        : '';
      return `<tr><td>${t.tenTDV}</td><td>${quy}</td><td>${tot||'—'}</td><td class="${cls}">${tot>0?tl+'%':'—'}</td>${ckCols}</tr>`;
    });
    const tot    = tdvRows.reduce((s,t)=>s+t.distinctKhCount,0);
    const totTg  = tdvRows.reduce((s,t)=>s+(t.totalKhDskh||0),0);
    const totTl  = totTg>0 ? Math.round(tot/totTg*100) : 0;
    const totCkDist = tdvRows.reduce((s,t)=>s+(t.ckDistinctKh||0),0);
    const ckTotCols = hasCK
      ? `<td class="quy-ck-col">${totCkDist||'—'}</td><td class="quy-ck-col">${totCkDist?growthBadge(tot,totCkDist):''}</td>`
      : '';
    return `<table class="quy-tbl"><thead><tr><th>Tên TDV</th><th>KH Quý<br><span style="font-weight:400;font-size:10px;color:#9AABB9">unique ≥${(QUY_MIN_DS/1000).toFixed(0)}k ≥1 tháng</span></th><th>Tổng KH DSKH</th><th>Tỷ lệ</th>${hdrCK}</tr></thead><tbody>${rows.join('')}<tr class="quy-tbl-total"><td>Tổng</td><td>${tot}</td><td>${totTg||'—'}</td><td>${totTg>0?totTl+'%':'—'}</td>${ckTotCols}</tr></tbody></table>`;
  };

  const ckDpkhLabel = hasCK
    ? ` &nbsp;·&nbsp; CK: <b>${ckTotalDPKH.toLocaleString('vi-VN')}</b> ${growthBadge(totalDPKH, ckTotalDPKH)}`
    : '';

  const s2 = `
<div class="quy-section">
  <div class="quy-sec-hdr"><span class="quy-sec-num">II</span> KHÁCH HÀNG</div>
  <div class="quy-chart-grid quy-chart-grid-2">
    <div class="quy-chart-card quy-span-2">
      <div class="quy-chart-title">04 · ĐỘ PHỦ KHÁCH HÀNG THEO THÁNG${hasCK?'<span class="quy-chart-unit"><span class="quy-legend-dot" style="background:#00BCD4"></span>Quý này &nbsp;<span class="quy-legend-dot" style="background:#B2EBF2"></span>Cùng kỳ</span>':''}</div>
      <div class="quy-dpkh-row">
        <div style="flex:1;height:180px;position:relative"><canvas id="quy-chart-04"></canvas></div>
        <div class="quy-dpkh-total-box">
          <div class="quy-dpkh-total-label">TỔNG KH QUÝ</div>
          <div class="quy-dpkh-total-num">${totalDPKH.toLocaleString('vi-VN')}</div>
          <div class="quy-dpkh-total-sub">KH unique đủ ĐK (DS ≥ ${(QUY_MIN_DS/1e3).toFixed(0)}k ≥1 tháng)</div>
          ${hasCK?`<div class="quy-ck-badge" style="margin-top:6px">CK: ${ckTotalDPKH.toLocaleString('vi-VN')} ${growthBadge(totalDPKH,ckTotalDPKH)}</div>`:''}
        </div>
      </div>
    </div>
  </div>
  <div class="quy-chart-grid quy-chart-grid-2" style="margin-top:12px">
    <div class="quy-chart-card">
      <div class="quy-chart-title">05 · ĐỘ PHỦ KH TRUNG BÌNH QUÝ<span class="quy-chart-unit">Số đầu phủ/tháng (ĐPKH) ≥ ${(QUY_MIN_DS/1000).toFixed(0)}k mỗi KH</span></div>
      ${buildDpkhTable05()}
    </div>
    <div class="quy-chart-card">
      <div class="quy-chart-title">06 · ĐỘ PHỦ KH QUÝ / TỔNG KH<span class="quy-chart-unit">Tổng % đầu phủ trên tổng đầu KH có số</span></div>
      ${buildDpkhTable06()}
    </div>
  </div>
  ${(() => {
    // Mục 13 — Tần suất KH per TDV + CK delta dòng Tổng
    const ck13Badge = (cur, ck) => {
      if (!hasCK || !ck) return '';
      const pct = (cur - ck) / ck * 100;
      const cls = pct >= 0 ? 'quy-grow-up' : 'quy-grow-down';
      return `<span class="${cls}" style="font-size:9px;margin-left:3px">${pct>=0?'+':''}${pct.toFixed(0)}%</span>`;
    };
    const rows13 = tdvRows.map(t => {
      const b   = tdvKhMonthBuckets[t.maTDV] || {1:0,2:0,3:0};
      const tot = b[1]+b[2]+b[3];
      const ckB   = ckTdvKhMonthBuckets[t.maTDV] || {1:0,2:0,3:0};
      const ckTot = ckB[1]+ckB[2]+ckB[3];
      const cell = (n,bg) => `<td style="text-align:center;background:${bg};font-weight:${n>0?'700':'400'}">${n}${tot>0?`<br><span style="font-size:10px;font-weight:400;color:#555">${Math.round(n/tot*100)}%</span>`:''}</td>`;
      return `<tr><td>${t.tenTDV}</td>${cell(b[1],'#FFEBEE')}${cell(b[2],'#FFF9C4')}${cell(b[3],'#E8F5E9')}<td style="text-align:center">${tot}${ck13Badge(tot,ckTot)}</td></tr>`;
    });
    const tot1=tdvRows.reduce((s,t)=>{const b=tdvKhMonthBuckets[t.maTDV]||{};return s+(b[1]||0);},0);
    const tot2=tdvRows.reduce((s,t)=>{const b=tdvKhMonthBuckets[t.maTDV]||{};return s+(b[2]||0);},0);
    const tot3=tdvRows.reduce((s,t)=>{const b=tdvKhMonthBuckets[t.maTDV]||{};return s+(b[3]||0);},0);
    const ck1=hasCK?tdvRows.reduce((s,t)=>{const b=ckTdvKhMonthBuckets[t.maTDV]||{};return s+(b[1]||0);},0):0;
    const ck2=hasCK?tdvRows.reduce((s,t)=>{const b=ckTdvKhMonthBuckets[t.maTDV]||{};return s+(b[2]||0);},0):0;
    const ck3=hasCK?tdvRows.reduce((s,t)=>{const b=ckTdvKhMonthBuckets[t.maTDV]||{};return s+(b[3]||0);},0):0;
    const totAll13=tot1+tot2+tot3, ckAll13=ck1+ck2+ck3;
    return `<div class="quy-chart-card" style="margin-top:12px">
      <div class="quy-chart-title">13 · TẦN SUẤT KHÁCH HÀNG MUA TRONG QUÝ THEO TDV<span class="quy-chart-unit">Số KH có đơn hàng (DS > 0) trong N tháng</span></div>
      <table class="quy-tbl"><thead><tr><th>Tên TDV</th><th style="text-align:center;background:#FFEBEE">1 Tháng</th><th style="text-align:center;background:#FFF9C4">2 Tháng</th><th style="text-align:center;background:#E8F5E9">3 Tháng</th><th style="text-align:center">Tổng KH</th></tr></thead>
      <tbody>${rows13.join('')}<tr class="quy-tbl-total"><td>Tổng</td><td style="text-align:center;background:#FFEBEE;font-weight:700">${tot1}${ck13Badge(tot1,ck1)}</td><td style="text-align:center;background:#FFF9C4;font-weight:700">${tot2}${ck13Badge(tot2,ck2)}</td><td style="text-align:center;background:#E8F5E9;font-weight:700">${tot3}${ck13Badge(tot3,ck3)}</td><td style="text-align:center;font-weight:700">${totAll13}${ck13Badge(totAll13,ckAll13)}</td></tr></tbody></table>
    </div>`;
  })()}
  ${(() => {
    // Mục 14 — KH chỉ mua T1, không mua T2 và T3
    const hasMuc14 = tdvRows.some(t => (atRiskByTdv[t.maTDV]||0) > 0);
    if (!hasMuc14) return '';
    const sorted14 = [...tdvRows].filter(t => (atRiskByTdv[t.maTDV]||0) > 0).sort((a,b) => (atRiskByTdv[b.maTDV]||0) - (atRiskByTdv[a.maTDV]||0));
    const max14 = Math.max(...sorted14.map(t => atRiskByTdv[t.maTDV]||0), 1);
    const tot14 = sorted14.reduce((s,t) => s+(atRiskByTdv[t.maTDV]||0), 0);
    const bar14Html = sorted14.map(t => {
      const cnt = atRiskByTdv[t.maTDV]||0;
      const w = Math.round(cnt/max14*100);
      return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f0f4f8">
        <span style="min-width:110px;max-width:110px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.tenTDV}</span>
        <div style="flex:1;background:#EEF2F7;border-radius:3px;height:14px"><div style="width:${w}%;height:100%;background:#EF5350;border-radius:3px"></div></div>
        <span style="min-width:40px;font-size:11px;font-weight:700;color:#EF5350;text-align:right">${cnt} KH</span>
      </div>`;
    }).join('');
    return `<div class="quy-chart-card" style="margin-top:12px">
      <div class="quy-chart-title">14 · KH CHỈ MUA ${qMonthLabels[0]||'T1'} CHƯA LẤY LẠI<span class="quy-chart-unit">Có đơn ${qMonthLabels[0]||'T1'}, không có đơn ${qMonthLabels[1]||'T2'} và ${qMonthLabels[2]||'T3'} · Tổng: ${tot14} KH</span></div>
      <div style="padding:4px 0">${bar14Html}</div>
    </div>`;
  })()}
  ${(() => {
    // Mục 19 — SLKH theo nhóm DS per TDV
    const bkKeys19   = ['lt1M','1-3M','3-5M','5-10M','10-30M','gt30M'];
    const bkLabels19 = ['< 1M','1–3M','3–5M','5–10M','10–30M','≥ 30M'];
    const hasMuc19 = tdvRows.some(t => Object.values(tdvKhDsBuckets[t.maTDV]||{}).some(v=>v>0));
    if (!hasMuc19) return '';
    const rows19 = tdvRows.map(t => {
      const b   = tdvKhDsBuckets[t.maTDV] || {};
      const tot = bkKeys19.reduce((s,k)=>s+(b[k]||0),0);
      const cells = bkKeys19.map(k => { const n=b[k]||0; return `<td style="text-align:center;font-weight:${n>0?'700':'400'}">${n||'—'}</td>`; });
      return `<tr><td>${t.tenTDV}</td>${cells.join('')}<td style="text-align:center;font-weight:700">${tot}</td></tr>`;
    });
    const totBk19 = {};
    bkKeys19.forEach(k => { totBk19[k] = tdvRows.reduce((s,t)=>s+(tdvKhDsBuckets[t.maTDV]?.[k]||0),0); });
    const grand19  = bkKeys19.reduce((s,k)=>s+totBk19[k],0);
    const hdrs19   = bkLabels19.map(l=>`<th style="text-align:center">${l}</th>`).join('');
    const totC19   = bkKeys19.map(k=>`<td style="text-align:center;font-weight:700">${totBk19[k]||0}</td>`).join('');
    return `<div class="quy-chart-card" style="margin-top:12px">
      <div class="quy-chart-title">19 · SỐ LƯỢNG KHÁCH HÀNG THEO NHÓM DOANH SỐ<span class="quy-chart-unit">Tổng DS KH trong 3 tháng quý phân nhóm theo từng TDV</span></div>
      <table class="quy-tbl"><thead><tr><th>Tên TDV</th>${hdrs19}<th style="text-align:center">Tổng KH</th></tr></thead><tbody>${rows19.join('')}<tr class="quy-tbl-total"><td>Tổng</td>${totC19}<td style="text-align:center;font-weight:700">${grand19}</td></tr></tbody></table>
    </div>`;
  })()}
</div>`;

  // ── Section III: Sản phẩm ────────────────────────────────
  const hasNhom = Object.keys(nhomDsMap).length > 0;
  const totalNhomDS = Object.values(nhomDsMap).reduce((s,v)=>s+v,0);
  const maxNhomDS   = Math.max(...Object.values(nhomDsMap), ...Object.values(ckNhomDsMap), 1);

  const nhomDsHtml = hasNhom ? Object.entries(nhomDsMap)
    .sort((a,b)=>b[1]-a[1])
    .map(([nh,ds]) => {
      const pct  = totalNhomDS>0 ? Math.round(ds/totalNhomDS*100) : 0;
      const w    = Math.round(ds/maxNhomDS*100);
      const ckDs = ckNhomDsMap[nh] || 0;
      const wCK  = hasCK && ckDs ? Math.round(ckDs/maxNhomDS*100) : 0;
      return `<div class="quy-bar-row">
        <span class="quy-bar-label">${nh}</span>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:${hasCK?'3px':'0'}">
            <div class="quy-bar-wrap" style="flex:1"><div class="quy-bar-fill quy-bar-blue" style="width:${w}%"></div></div>
            <span class="quy-bar-val">${vndM(ds)}</span>
            <span class="quy-bar-pct">${pct}%</span>
            ${hasCK?growthBadge(ds,ckDs):''}
          </div>
          ${hasCK?`<div style="display:flex;align-items:center;gap:6px">
            <div class="quy-bar-wrap" style="flex:1"><div class="quy-bar-fill" style="width:${wCK}%;background:#9AABB9"></div></div>
            <span class="quy-bar-val" style="font-size:11px;color:#7A8FA0">CK: ${vndM(ckDs)}</span>
            <span class="quy-bar-pct"></span><span style="min-width:48px"></span>
          </div>`:''}
        </div>
      </div>`;
    }).join('') : '<div style="color:#aaa;padding:12px">Chưa có mapping SP → Nhóm</div>';

  const totalNhomDPKH = Object.values(nhomDpkhMap).reduce((s,v)=>s+v,0);
  const maxNhomDPKH   = Math.max(...Object.values(nhomDpkhMap), ...Object.values(ckNhomDpkhMap), 1);
  const nhomDpkhHtml  = Object.keys(nhomDpkhMap).length > 0
    ? Object.entries(nhomDpkhMap).sort((a,b)=>b[1]-a[1]).map(([nh,cnt]) => {
        const pct  = totalNhomDPKH>0 ? Math.round(cnt/totalNhomDPKH*100) : 0;
        const w    = Math.round(cnt/maxNhomDPKH*100);
        const ckCnt = ckNhomDpkhMap[nh] || 0;
        const wCK   = hasCK && ckCnt ? Math.round(ckCnt/maxNhomDPKH*100) : 0;
        return `<div class="quy-bar-row">
          <span class="quy-bar-label">${nh}</span>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:${hasCK?'3px':'0'}">
              <div class="quy-bar-wrap" style="flex:1"><div class="quy-bar-fill quy-bar-green" style="width:${w}%"></div></div>
              <span class="quy-bar-val">${cnt.toLocaleString('vi-VN')}</span>
              <span class="quy-bar-pct">${pct}%</span>
              ${hasCK?growthBadge(cnt,ckCnt):''}
            </div>
            ${hasCK?`<div style="display:flex;align-items:center;gap:6px">
              <div class="quy-bar-wrap" style="flex:1"><div class="quy-bar-fill" style="width:${wCK}%;background:#9AABB9"></div></div>
              <span class="quy-bar-val" style="font-size:11px;color:#7A8FA0">CK: ${ckCnt.toLocaleString('vi-VN')}</span>
              <span class="quy-bar-pct"></span><span style="min-width:48px"></span>
            </div>`:''}
          </div>
        </div>`;
      }).join('')
    : '<div style="color:#aaa;padding:12px">Chưa có mapping SP → Nhóm</div>';

  const maxTopDS = topSP.length > 0 ? topSP[0].ds : 1;
  const topSPHtml = topSP.map((sp,i) => {
    const w = Math.round(sp.ds/maxTopDS*100);
    const ckCol = hasCK
      ? `<td class="quy-topsp-ck">${sp.ckDS ? vndM(sp.ckDS) : '—'}</td><td class="quy-topsp-ck">${growthBadge(sp.ds, sp.ckDS)}</td>`
      : '';
    return `<tr>
      <td class="quy-topsp-num">${i+1}</td>
      <td class="quy-topsp-name">${sp.tenSP||sp.maSP}</td>
      <td class="quy-topsp-ds">${vndM(sp.ds)}</td>
      <td class="quy-topsp-bar"><div class="quy-bar-fill quy-bar-cyan" style="width:${w}%;height:8px;border-radius:4px"></div></td>
      <td class="quy-topsp-pct">${pctFmt(sp.pct)}</td>
      ${ckCol}
    </tr>`;
  }).join('');

  const topSPCkHdr = hasCK ? '<th>DS Cùng kỳ</th><th>TT/CK</th>' : '';

  // ĐPMH heat table: TB tháng | Unique SP Quý | Tỷ lệ TB/Unique
  const dpmhHeatRows = tdvRows.map(t => {
    const avgMH  = Math.round(t.totalDPMH / 3);   // ĐPMH TB tháng
    const uniqSP = t.distinctSpCount;              // SP unique trong quý
    const tl     = uniqSP > 0 ? Math.round(avgMH / uniqSP * 100) : 0;
    const heat   = tl >= 80 ? '#C8E6C9' : tl >= 60 ? '#FFF9C4' : tl >= 40 ? '#FFE0B2' : '#FFCDD2';
    return `<tr>
      <td>${t.tenTDV}</td>
      <td style="text-align:center;font-weight:700">${avgMH}</td>
      <td style="text-align:center">${uniqSP}</td>
      <td style="text-align:center;background:${heat};font-weight:700">${uniqSP>0?tl+'%':'—'}</td>
    </tr>`;
  }).join('');
  const totAvgMH  = Math.round(tdvRows.reduce((s,t)=>s+t.totalDPMH,0) / 3);
  const totUniqSP = tdvRows.reduce((s,t)=>s+t.distinctSpCount,0);
  const totTlSP   = totUniqSP>0 ? Math.round(totAvgMH/totUniqSP*100) : 0;

  const s3 = `
<div class="quy-section">
  <div class="quy-sec-hdr"><span class="quy-sec-num">III</span> SẢN PHẨM</div>
  <div class="quy-chart-grid quy-chart-grid-2">
    <div class="quy-chart-card">
      <div class="quy-chart-title">07 · ĐỘ PHỦ MẶT HÀNG (ĐPMH) THEO TDV</div>
      <div style="font-size:10px;color:#9AABB9;margin-bottom:8px">SP có DS ≥ ${(QUY_MIN_DS/1000).toFixed(0)}k/tháng &nbsp;·&nbsp; Tỷ lệ = ĐPMH TB tháng / SP unique trong quý</div>
      <table class="quy-tbl">
        <thead><tr><th>Tên TDV</th><th style="text-align:center">ĐPMH TB/tháng</th><th style="text-align:center">SP unique Quý</th><th style="text-align:center">TB/Unique</th></tr></thead>
        <tbody>${dpmhHeatRows}<tr class="quy-tbl-total"><td>Tổng</td><td style="text-align:center;font-weight:700">${totAvgMH}</td><td style="text-align:center">${totUniqSP}</td><td style="text-align:center;font-weight:700">${totUniqSP>0?totTlSP+'%':'—'}</td></tr></tbody>
      </table>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="quy-chart-card">
        <div class="quy-chart-title">08 · DOANH SỐ THEO NHÓM HÀNG</div>
        ${nhomDsHtml}
      </div>
      <div class="quy-chart-card">
        <div class="quy-chart-title">09 · ĐỘ PHỦ KHÁCH HÀNG THEO NHÓM HÀNG<span class="quy-chart-unit">Số khách hàng mua từng nhóm trong quý</span></div>
        ${nhomDpkhHtml}
      </div>
    </div>
  </div>
  <div class="quy-chart-card" style="margin-top:12px">
    <div class="quy-chart-title">10 · TOP SẢN PHẨM THEO DOANH SỐ</div>
    <table class="quy-topsp-tbl">
      <thead><tr><th>#</th><th>Tên sản phẩm</th><th>Doanh số</th><th style="min-width:120px"></th><th>Tỷ trọng</th>${topSPCkHdr}</tr></thead>
      <tbody>${topSPHtml}</tbody>
    </table>
  </div>
  ${(() => {
    // Mục 11 — Nhóm SP theo TDV + total row + CK pp delta
    const hasNhom11 = Object.keys(tdvNhomDsMap).length > 0;
    if (!hasNhom11) return '';
    const allNhoms = [...new Set(Object.values(tdvNhomDsMap).flatMap(m => Object.keys(m)))].sort((a,b) => a==='BÁN PHỦ HẾT'?1:b==='BÁN PHỦ HẾT'?-1:a.localeCompare(b,'vi'));
    const heatBg11 = pct => pct>=40?'#1565C0':pct>=20?'#42A5F5':pct>=10?'#BBDEFB':pct>0?'#E3F2FD':'#f8f8f8';
    const heatFg11 = pct => pct>=40?'#fff':'#1a1a1a';
    const ckBadge11 = (cur, ck) => {
      if (!hasCK || ck === 0) return '';
      const d = cur - ck;
      const cls = d >= 0 ? 'quy-grow-up' : 'quy-grow-down';
      return `<br><span class="${cls}" style="font-size:9px">${d>=0?'+':''}${d.toFixed(0)}pp</span>`;
    };
    const rows11 = tdvRows.map(t => {
      const nhomDs   = tdvNhomDsMap[t.maTDV] || {};
      const tdvTot   = Object.values(nhomDs).reduce((s,v)=>s+v,0);
      const ckNhomDs = ckTdvNhomDsMap[t.maTDV] || {};
      const ckTdvTot = Object.values(ckNhomDs).reduce((s,v)=>s+v,0);
      const cells = allNhoms.map(nh => {
        const ds    = nhomDs[nh] || 0;
        const pct   = tdvTot   > 0 ? Math.round(ds/tdvTot*100) : 0;
        const ckPct = ckTdvTot > 0 ? Math.round((ckNhomDs[nh]||0)/ckTdvTot*100) : 0;
        return `<td style="text-align:center;background:${heatBg11(pct)};color:${heatFg11(pct)};font-weight:${pct>=10?'700':'400'}">${pct>0?pct+'%':'—'}${ckBadge11(pct,ckPct)}</td>`;
      });
      return `<tr><td>${t.tenTDV}</td>${cells.join('')}</tr>`;
    });
    const totNhomDs11 = {};
    tdvRows.forEach(t => { Object.entries(tdvNhomDsMap[t.maTDV]||{}).forEach(([nh,ds]) => { totNhomDs11[nh]=(totNhomDs11[nh]||0)+ds; }); });
    const totAll11 = Object.values(totNhomDs11).reduce((s,v)=>s+v,0);
    const ckTotNhomDs11 = {};
    tdvRows.forEach(t => { Object.entries(ckTdvNhomDsMap[t.maTDV]||{}).forEach(([nh,ds]) => { ckTotNhomDs11[nh]=(ckTotNhomDs11[nh]||0)+ds; }); });
    const ckTotAll11 = Object.values(ckTotNhomDs11).reduce((s,v)=>s+v,0);
    const totCells11 = allNhoms.map(nh => {
      const pct   = totAll11   > 0 ? Math.round((totNhomDs11[nh]||0)/totAll11*100) : 0;
      const ckPct = ckTotAll11 > 0 ? Math.round((ckTotNhomDs11[nh]||0)/ckTotAll11*100) : 0;
      return `<td style="text-align:center;font-weight:700">${pct>0?pct+'%':'—'}${ckBadge11(pct,ckPct)}</td>`;
    });
    const hdrs = allNhoms.map(nh=>`<th style="text-align:center;font-size:11px">${nh}</th>`).join('');
    return `<div class="quy-chart-card" style="margin-top:12px">
      <div class="quy-chart-title">11 · TỶ TRỌNG NHÓM SẢN PHẨM THEO TDV<span class="quy-chart-unit">% DS từng nhóm / tổng DS TDV đó${hasCK?' · pp = biến động vs cùng kỳ':''}</span></div>
      <div style="overflow-x:auto"><table class="quy-tbl" style="min-width:600px"><thead><tr><th>Tên TDV</th>${hdrs}</tr></thead><tbody>${rows11.join('')}<tr class="quy-tbl-total"><td>Tổng</td>${totCells11.join('')}</tr></tbody></table></div>
    </div>`;
  })()}
  ${(() => {
    // Mục 16 — % đạt nhóm SP theo Target Quý per TDV
    const hasMuc16 = Object.keys(tdvNhomDsMap).length > 0 && tdvRows.some(t => t.dsTongTarget > 0);
    if (!hasMuc16) return '';
    const tgtRows16 = tdvRows.filter(t => t.dsTongTarget > 0);
    const allNhoms16 = [...new Set(tgtRows16.flatMap(t => Object.keys(tdvNhomDsMap[t.maTDV]||{})))].sort((a,b) => a==='BÁN PHỦ HẾT'?1:b==='BÁN PHỦ HẾT'?-1:a.localeCompare(b,'vi'));
    const heatBg16 = pct => pct>=80?'#C8E6C9':pct>=50?'#FFF9C4':pct>=20?'#FFE0B2':'#FFCDD2';
    const rows16new = tgtRows16.map(t => {
      const nhomDs = tdvNhomDsMap[t.maTDV] || {};
      const cells = allNhoms16.map(nh => {
        const ds  = nhomDs[nh] || 0;
        const pct = t.dsTongTarget > 0 ? Math.round(ds/t.dsTongTarget*100) : 0;
        return `<td style="text-align:center;background:${heatBg16(pct)};font-weight:${pct>0?'700':'400'}">${pct>0?pct+'%':'—'}</td>`;
      });
      const totPct = t.dsTongTarget > 0 ? Math.round(t.totalDS/t.dsTongTarget*100) : 0;
      const totCls = totPct>=100?'quy-tl-good':totPct>=80?'quy-tl-warn':'quy-tl-bad';
      return `<tr><td>${t.tenTDV}</td>${cells.join('')}<td class="${totCls}" style="text-align:center;font-weight:700">${totPct}%</td></tr>`;
    });
    const totNhomDs16 = {};
    tgtRows16.forEach(t => { Object.entries(tdvNhomDsMap[t.maTDV]||{}).forEach(([nh,ds]) => { totNhomDs16[nh]=(totNhomDs16[nh]||0)+ds; }); });
    const totTgt16 = tgtRows16.reduce((s,t)=>s+t.dsTongTarget,0);
    const totDS16  = tgtRows16.reduce((s,t)=>s+t.totalDS,0);
    const totCells16 = allNhoms16.map(nh => {
      const pct = totTgt16 > 0 ? Math.round((totNhomDs16[nh]||0)/totTgt16*100) : 0;
      return `<td style="text-align:center;font-weight:700">${pct>0?pct+'%':'—'}</td>`;
    });
    const totPct16 = totTgt16 > 0 ? Math.round(totDS16/totTgt16*100) : 0;
    const totCls16 = totPct16>=100?'quy-tl-good':totPct16>=80?'quy-tl-warn':'quy-tl-bad';
    const hdrs16 = allNhoms16.map(nh=>`<th style="text-align:center;font-size:11px">${nh}</th>`).join('');
    return `<div class="quy-chart-card" style="margin-top:12px">
      <div class="quy-chart-title">16 · % ĐẠT TARGET QUÝ THEO NHÓM SẢN PHẨM PER TDV<span class="quy-chart-unit">DS nhóm / Target Quý TDV · xanh ≥80%, vàng ≥50%, cam ≥20%, đỏ &lt;20%</span></div>
      <div style="overflow-x:auto"><table class="quy-tbl" style="min-width:600px"><thead><tr><th>Tên TDV</th>${hdrs16}<th style="text-align:center">Tổng %Đạt</th></tr></thead><tbody>${rows16new.join('')}<tr class="quy-tbl-total"><td>Tổng</td>${totCells16.join('')}<td class="${totCls16}" style="text-align:center;font-weight:700">${totPct16}%</td></tr></tbody></table></div>
    </div>`;
  })()}
  ${(() => {
    // Mục 12 — ĐPMH per KH per TDV + % tỷ trọng + dòng Tổng + CK delta
    const has12 = Object.keys(tdvKhSpBuckets).length > 0;
    if (!has12) return '';
    const bucketKeys12   = [1, 2, '3-4', '5-9', '10+'];
    const bucketLabels12 = ['1 SP','2 SP','3–4 SP','5–9 SP','10+ SP'];
    const ckBadge12 = (cur, ck) => {
      if (!hasCK || !ck) return '';
      const pct = (cur - ck) / ck * 100;
      const cls = pct >= 0 ? 'quy-grow-up' : 'quy-grow-down';
      return `<span class="${cls}" style="font-size:9px;margin-left:3px">${pct>=0?'+':''}${pct.toFixed(0)}%</span>`;
    };
    const rows12 = tdvRows.map(t => {
      const b   = tdvKhSpBuckets[t.maTDV] || {};
      const tot = bucketKeys12.reduce((s,k)=>s+(b[k]||0),0);
      const mx  = Math.max(...bucketKeys12.map(k => b[k]||0), 1);
      const ckB   = ckTdvKhSpBuckets[t.maTDV] || {};
      const ckTot = hasCK ? bucketKeys12.reduce((s,k)=>s+(ckB[k]||0),0) : 0;
      const cells = bucketKeys12.map(k => {
        const n = b[k]||0;
        const intensity = Math.round(n/mx*100);
        const bg = intensity>=80?'#1B5E20':intensity>=60?'#388E3C':intensity>=40?'#66BB6A':intensity>=20?'#C8E6C9':'#f8f8f8';
        const fg = intensity>=60?'#fff':'#1a1a1a';
        const pctStr = tot > 0 ? `<br><span style="font-size:10px;font-weight:400">${Math.round(n/tot*100)}%</span>` : '';
        return `<td style="text-align:center;background:${bg};color:${fg};font-weight:${n>0?'700':'400'}">${n||'—'}${pctStr}</td>`;
      });
      return `<tr><td>${t.tenTDV}</td>${cells.join('')}<td style="text-align:center">${tot}${ckBadge12(tot,ckTot)}</td></tr>`;
    });
    // Dòng Tổng
    const totBuckets12 = {};
    bucketKeys12.forEach(k => { totBuckets12[k] = tdvRows.reduce((s,t)=>s+(tdvKhSpBuckets[t.maTDV]?.[k]||0),0); });
    const grandTot12 = bucketKeys12.reduce((s,k)=>s+totBuckets12[k],0);
    const ckGrandTot12 = hasCK ? tdvRows.reduce((s,t)=>{const b=ckTdvKhSpBuckets[t.maTDV]||{};return s+bucketKeys12.reduce((ss,k)=>ss+(b[k]||0),0);},0) : 0;
    const totCells12 = bucketKeys12.map(k => {
      const n = totBuckets12[k];
      const pctStr = grandTot12 > 0 ? `<br><span style="font-size:10px;font-weight:400">${Math.round(n/grandTot12*100)}%</span>` : '';
      return `<td style="text-align:center;font-weight:700">${n}${pctStr}</td>`;
    });
    const hdrs12 = bucketLabels12.map(l=>`<th style="text-align:center">${l}</th>`).join('');
    return `<div class="quy-chart-card" style="margin-top:12px">
      <div class="quy-chart-title">12 · ĐỘ PHỦ MẶT HÀNG PER KHÁCH HÀNG THEO TDV<span class="quy-chart-unit">Số KH mua N sản phẩm unique trong cả quý</span></div>
      <table class="quy-tbl"><thead><tr><th>Tên TDV</th>${hdrs12}<th style="text-align:center">Tổng KH</th></tr></thead><tbody>${rows12.join('')}<tr class="quy-tbl-total"><td>Tổng</td>${totCells12.join('')}<td style="text-align:center;font-weight:700">${grandTot12}${ckBadge12(grandTot12,ckGrandTot12)}</td></tr></tbody></table>
    </div>`;
  })()}
</div>`;

  return `
<div id="quy-report-wrap">
  ${mienFilterHtml}
  <div class="quy-header">
    <div class="quy-header-left">
      <div class="quy-logo-circle">M</div>
      <div>
        <div class="quy-header-sup">BÁO CÁO BÁN HÀNG</div>
        <div class="quy-header-title">Tổng kết kinh doanh ${data.qLabel}</div>
        <div class="quy-header-sub">Kỳ báo cáo: ${data.qPeriod}</div>
      </div>
    </div>
    <div class="quy-header-brand">meracine<br><span style="font-size:9px;letter-spacing:1px;opacity:.8">CHUYÊN TÂM VÌ SỨC KHỎE</span></div>
  </div>

  <div class="quy-kpi-grid">
    <div class="quy-kpi-card">
      <div class="quy-kpi-label">TỔNG DOANH SỐ QUÝ</div>
      <div class="quy-kpi-val">${vndM(totalDS)}</div>
      <div class="quy-kpi-sub">${hasCK ? `CK: ${vndM(ckTotalDS)} ${growthBadge(totalDS, ckTotalDS)}` : 'Đơn vị tính: 1.000.000đ'}</div>
    </div>
    <div class="quy-kpi-card">
      <div class="quy-kpi-label">TRÌNH DƯỢC VIÊN</div>
      <div class="quy-kpi-val">${tdvCount}</div>
      <div class="quy-kpi-sub">${tdvCount>0?Math.round(datCount/tdvCount*100):0}% đạt chỉ tiêu</div>
    </div>
    <div class="quy-kpi-card">
      <div class="quy-kpi-label">KHÁCH HÀNG PHỦ</div>
      <div class="quy-kpi-val">${totalDPKH.toLocaleString('vi-VN')}</div>
      <div class="quy-kpi-sub">${hasCK ? `CK: ${ckTotalDPKH.toLocaleString('vi-VN')} ${growthBadge(totalDPKH, ckTotalDPKH)}` : `KH unique đủ ĐK trong quý`}</div>
    </div>
    <div class="quy-kpi-card">
      <div class="quy-kpi-label">NHÓM DẪN ĐẦU</div>
      <div class="quy-kpi-val">${leadNhom ? pctFmt(leadPct) : '—'}</div>
      <div class="quy-kpi-sub">${leadNhom || 'Chưa có mapping nhóm'}</div>
    </div>
  </div>

  ${s1}${s2}${s3}
  ${(() => {
    // Section IV — Hợp đồng
    const hdTdvRows = tdvRows.filter(t => (hdStatsMap[t.maTDV]||0) > 0);
    const hasHd = hdTdvRows.length > 0 || Object.keys(hdStatsMap).length > 0;
    if (!hasHd) return '';
    const allHdRows = [...tdvRows].map(t => ({...t, hdCount: hdStatsMap[t.maTDV]||0})).filter(t=>t.hdCount>0||t.distinctKhCount>0||t.totalKhDskh>0);
    // Mục 15 — Bar chart HĐ per TDV
    const hdSorted  = [...allHdRows].sort((a,b) => b.hdCount - a.hdCount).filter(t=>t.hdCount>0);
    const maxHd     = hdSorted[0]?.hdCount || 1;
    const barHtml15 = hdSorted.map(t => {
      const w = Math.round(t.hdCount/maxHd*100);
      return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f0f4f8">
        <span style="min-width:110px;max-width:110px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.tenTDV}</span>
        <div style="flex:1;background:#EEF2F7;border-radius:3px;height:14px"><div style="width:${w}%;height:100%;background:#5C6BC0;border-radius:3px"></div></div>
        <span style="min-width:32px;font-size:11px;font-weight:700;color:#5C6BC0;text-align:right">${t.hdCount}</span>
      </div>`;
    }).join('');
    // Mục 16 — Heat table HĐ vs KH
    const rows16 = allHdRows.map(t => {
      const hd   = t.hdCount;
      const kquy = t.distinctKhCount;
      const kdsk = t.totalKhDskh;
      const pquy = kquy > 0 ? Math.round(hd/kquy*100) : 0;
      const pdsk = kdsk > 0 ? Math.round(hd/kdsk*100) : 0;
      const heatCls = p => p>=70?'quy-tl-good':p>=40?'quy-tl-warn':'quy-tl-bad';
      return `<tr><td>${t.tenTDV}</td><td style="text-align:center;font-weight:700">${hd||'—'}</td><td style="text-align:center">${kquy||'—'}</td><td style="text-align:center">${kdsk||'—'}</td><td class="${heatCls(pquy)}" style="text-align:center;font-weight:700">${kquy>0?pquy+'%':'—'}</td><td class="${heatCls(pdsk)}" style="text-align:center;font-weight:700">${kdsk>0?pdsk+'%':'—'}</td></tr>`;
    });
    const totHd  = allHdRows.reduce((s,t)=>s+t.hdCount,0);
    const totKq  = allHdRows.reduce((s,t)=>s+t.distinctKhCount,0);
    const totKd  = allHdRows.reduce((s,t)=>s+(t.totalKhDskh||0),0);
    const totPq  = totKq>0?Math.round(totHd/totKq*100):0;
    const totPd  = totKd>0?Math.round(totHd/totKd*100):0;
    return `<div class="quy-section">
  <div class="quy-sec-hdr"><span class="quy-sec-num">IV</span> HỢP ĐỒNG</div>
  <div class="quy-chart-grid quy-chart-grid-2">
    <div class="quy-chart-card">
      <div class="quy-chart-title">15 · SỐ LƯỢNG HỢP ĐỒNG THEO TDV<span class="quy-chart-unit">Unique KH ký HĐ trong năm ${data.qYear||''}</span></div>
      <div style="padding:4px 0">${barHtml15}</div>
    </div>
    <div class="quy-chart-card">
      <div class="quy-chart-title">20 · HỢP ĐỒNG SO VỚI TỔNG KHÁCH HÀNG<span class="quy-chart-unit">SL HĐ = unique KH ký HĐ năm ${data.qYear||''}</span></div>
      <table class="quy-tbl"><thead><tr><th>Tên TDV</th><th style="text-align:center">SL HĐ</th><th style="text-align:center">KH Quý</th><th style="text-align:center">KH DSKH</th><th style="text-align:center">HĐ/KH Quý</th><th style="text-align:center">HĐ/DSKH</th></tr></thead>
      <tbody>${rows16.join('')}<tr class="quy-tbl-total"><td>Tổng</td><td style="text-align:center;font-weight:700">${totHd}</td><td style="text-align:center">${totKq}</td><td style="text-align:center">${totKd||'—'}</td><td style="text-align:center;font-weight:700">${totKq>0?totPq+'%':'—'}</td><td style="text-align:center;font-weight:700">${totKd>0?totPd+'%':'—'}</td></tr></tbody></table>
    </div>
  </div>
</div>`;
  })()}
  ${(() => {
    // Mục 17 & 18 — DS TB/KH và DS TB/ĐH per TDV
    const validRows17 = [...tdvRows].filter(t => t.allKhCount > 0).sort((a,b) => (b.totalDS/b.allKhCount)-(a.totalDS/a.allKhCount));
    const validRows18 = [...tdvRows].filter(t => t.orderCount > 0).sort((a,b) => (b.totalDS/b.orderCount)-(a.totalDS/a.orderCount));
    if (!validRows17.length && !validRows18.length) return '';
    const max17 = validRows17.length ? Math.max(...validRows17.map(t => t.totalDS/t.allKhCount), 1) : 1;
    const max18 = validRows18.length ? Math.max(...validRows18.map(t => t.totalDS/t.orderCount), 1) : 1;
    const bar17 = validRows17.map(t => {
      const avg = Math.round(t.totalDS/t.allKhCount);
      const w   = Math.round(avg/max17*100);
      return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f0f4f8">
        <span style="min-width:110px;max-width:110px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.tenTDV}</span>
        <div style="flex:1;background:#EEF2F7;border-radius:3px;height:14px"><div style="width:${w}%;height:100%;background:#7E57C2;border-radius:3px"></div></div>
        <span style="min-width:52px;font-size:11px;font-weight:700;color:#7E57C2;text-align:right">${vndM(avg)}</span>
      </div>`;
    }).join('');
    const bar18 = validRows18.map(t => {
      const avg = Math.round(t.totalDS/t.orderCount);
      const w   = Math.round(avg/max18*100);
      return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f0f4f8">
        <span style="min-width:110px;max-width:110px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.tenTDV}</span>
        <div style="flex:1;background:#EEF2F7;border-radius:3px;height:14px"><div style="width:${w}%;height:100%;background:#26A69A;border-radius:3px"></div></div>
        <span style="min-width:52px;font-size:11px;font-weight:700;color:#26A69A;text-align:right">${vndM(avg)}</span>
      </div>`;
    }).join('');
    return `<div class="quy-section">
  <div class="quy-sec-hdr"><span class="quy-sec-num">V</span> NĂNG SUẤT BÁN HÀNG</div>
  <div class="quy-chart-grid quy-chart-grid-2">
    ${validRows17.length ? `<div class="quy-chart-card">
      <div class="quy-chart-title">17 · DOANH SỐ TB / KHÁCH HÀNG<span class="quy-chart-unit">Tổng DS ÷ Số KH phát sinh (DS > 0)</span></div>
      <div style="padding:4px 0">${bar17}</div>
    </div>` : ''}
    ${validRows18.length ? `<div class="quy-chart-card">
      <div class="quy-chart-title">18 · DOANH SỐ TB / ĐƠN HÀNG<span class="quy-chart-unit">Tổng DS ÷ Số unique Mã ĐH</span></div>
      <div style="padding:4px 0">${bar18}</div>
    </div>` : ''}
  </div>
</div>`;
  })()}
</div>`;
}

// ─── TDV comparison summary (dùng cho chart 02 area) ─────────
function _buildTdvCkSummary(tdvRows, vndM, growthBadge, hasCK) {
  if (!tdvRows || tdvRows.length === 0) return '';
  const sorted = [...tdvRows].sort((a,b) => b.totalDS - a.totalDS);
  const rows = sorted.map(t => {
    const g = hasCK && t.ckDS > 0 ? growthBadge(t.totalDS, t.ckDS) : '';
    const ckDsCell   = hasCK ? `<td class="quy-ck-col">${t.ckDS?vndM(t.ckDS):'—'}</td>` : '';
    const growthCell = hasCK ? `<td class="quy-ck-col">${g}</td>` : '';
    return `<tr><td>${t.tenTDV}</td><td>${vndM(t.totalDS)}</td>${ckDsCell}${growthCell}</tr>`;
  }).join('');
  const totDS      = sorted.reduce((s,t)=>s+t.totalDS,0);
  const totCK      = sorted.reduce((s,t)=>s+(t.ckDS||0),0);
  const ckHdrCols  = hasCK ? `<th class="quy-ck-col">DS Cùng kỳ</th><th class="quy-ck-col">TT/CK</th>` : '';
  const ckTotCols  = hasCK ? `<td class="quy-ck-col">${totCK?vndM(totCK):'—'}</td><td class="quy-ck-col">${totCK?growthBadge(totDS,totCK):''}</td>` : '';
  return `<div style="margin-top:14px;overflow-x:auto">
    <table class="quy-tbl" style="font-size:11px">
      <thead><tr><th>Tên TDV</th><th>DS Quý này</th>${ckHdrCols}</tr></thead>
      <tbody>${rows}<tr class="quy-tbl-total"><td>Tổng</td><td>${vndM(totDS)}</td>${ckTotCols}</tr></tbody>
    </table>
  </div>`;
}

// ─── Chart.js initialization ─────────────────────────────────
function initQuyCharts() {
  const d = _quyReport;
  if (!d || typeof Chart === 'undefined') return;

  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.font.size   = 11;

  const BLUE     = '#3A7BD5';
  const BLUE_CK  = 'rgba(176,196,222,0.85)';
  const CYAN     = '#00BCD4';
  const CYAN_CK  = 'rgba(178,235,242,0.9)';
  const gridColor = 'rgba(0,0,0,0.06)';

  const vndM = v => (v/1e6).toFixed(0) + 'M';
  const { hasCK, ckDsByMonth, ckDpkhByMonth } = d;

  // ── Chart 01: DS theo tháng ──────────────────────────────
  const c01 = document.getElementById('quy-chart-01');
  if (c01) {
    const datasets = [
      {
        label: 'Quý này',
        data: d.dsByMonth.map(v => v.ds),
        backgroundColor: BLUE, borderRadius: 4, barThickness: 40, order: 2,
      },
    ];
    if (hasCK) {
      datasets.push({
        label: 'Cùng kỳ',
        data: ckDsByMonth,
        type: 'line',
        borderColor: '#B0C4DE', backgroundColor: 'transparent',
        borderWidth: 2, borderDash: [5,3], pointRadius: 4,
        pointBackgroundColor: '#B0C4DE', tension: 0.3, order: 1,
      });
    }
    new Chart(c01, {
      type: 'bar',
      data: { labels: d.dsByMonth.map(v => v.label), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 22 } },
        plugins: {
          legend: { display: hasCK, position: 'top', labels: { boxWidth: 12, font: { size: 10 } } },
          tooltip: { callbacks: { label: ctx => vndM(ctx.parsed.y) + ' VNĐ' } },
          datalabels: {
            anchor: 'end', align: 'end',
            formatter: (v, ctx) => ctx.dataset.type === 'line' ? '' : vndM(v),
            color: BLUE, font: { size: 11, weight: '700' },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#555' } },
          y: { grid: { color: gridColor }, ticks: { callback: v => vndM(v), color: '#888' }, beginAtZero: true },
        },
      },
    });
  }

  // Chart 02 đã được thay bằng HTML bar chart trong renderQuarterlyReport

  // ── Chart 04: DPKH theo tháng ────────────────────────────
  const c04 = document.getElementById('quy-chart-04');
  if (c04) {
    const datasets = [
      {
        label: 'Quý này',
        data: d.dpkhByMonth.map(v => v.dpkh),
        backgroundColor: CYAN, borderRadius: 4, barThickness: 40, order: 2,
      },
    ];
    if (hasCK) {
      datasets.push({
        label: 'Cùng kỳ',
        data: ckDpkhByMonth,
        type: 'line',
        borderColor: '#4DD0E1', backgroundColor: 'transparent',
        borderWidth: 2, borderDash: [5,3], pointRadius: 4,
        pointBackgroundColor: '#4DD0E1', tension: 0.3, order: 1,
      });
    }
    new Chart(c04, {
      type: 'bar',
      data: { labels: d.dpkhByMonth.map(v => v.label), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 22 } },
        plugins: {
          legend: { display: hasCK, position: 'top', labels: { boxWidth: 12, font: { size: 10 } } },
          tooltip: { callbacks: { label: ctx => ctx.parsed.y + ' KH' } },
          datalabels: {
            anchor: 'end', align: 'end',
            formatter: (v, ctx) => ctx.dataset.type === 'line' ? '' : v.toLocaleString('vi-VN'),
            color: CYAN, font: { size: 11, weight: '700' },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#555' } },
          y: { grid: { color: gridColor }, ticks: { stepSize: 100, color: '#888' }, beginAtZero: true },
        },
      },
    });
  }
}

// ─── QLBH filter ─────────────────────────────────────────────
function onQuyMienChange(selectedMien) {
  if (!_quyReport) return;

  const baseTdvRows = _quyReport._allTdvRows || _quyReport.tdvRows;
  if (!_quyReport._allTdvRows) _quyReport._allTdvRows = _quyReport.tdvRows;

  const filtered = selectedMien
    ? baseTdvRows.filter(t => t.mien === selectedMien)
    : baseTdvRows;

  const { qMonthKeys, qMonthLabels } = _quyReport;
  const dsByMonth   = qMonthKeys.map((mk,i) => ({ label: qMonthLabels[i], ds:   filtered.reduce((s,t) => s+(t.mStats[mk]?.ds  ||0), 0) }));
  const dpkhByMonth = qMonthKeys.map((mk,i) => ({ label: qMonthLabels[i], dpkh: filtered.reduce((s,t) => s+(t.mStats[mk]?.dpkh||0), 0) }));
  const totalDS   = filtered.reduce((s,t) => s+t.totalDS, 0);
  const totalDPKH = filtered.reduce((s,t) => s + t.distinctKhCount, 0);
  const datCount  = filtered.filter(t => t.datTarget).length;
  const tdvCount  = filtered.length;

  // CK aggregates from filtered TDVs
  const ckMonthKeys    = _quyReport.ckMonthKeys || [];
  const ckTotalDS      = filtered.reduce((s,t) => s+(t.ckDS||0), 0);
  const ckTotalDPKH    = filtered.reduce((s,t) => s+(t.ckDistinctKh||0), 0);
  // Recompute CK monthly bars from filtered TDVs
  const ckRawData      = _quyReport._ckData || {};
  const ckByTdvMonthF  = ckRawData.byTdvMonth || {};
  const ckDsByMonth    = ckMonthKeys.map(mk => filtered.reduce((s,t) => s+(ckByTdvMonthF[t.maTDV]?.[mk]?.ds||0), 0));
  const ckDpkhByMonth  = ckMonthKeys.map(mk => filtered.reduce((s,t) => {
    const khMap = ckByTdvMonthF[t.maTDV]?.[mk]?.khDsMap || {};
    return s + Object.values(khMap).filter(v => v >= QUY_MIN_DS).length;
  }, 0));

  // ── Recompute nhóm DS / nhóm ĐPKH / topSP từ TDVs đã lọc ──
  const rawData    = _quyReport._qData   || {};
  const spNhomMap  = _quyReport._spNhomMap || null;
  const filtTdvSet = new Set(filtered.map(t => t.maTDV));

  const filtNhomDsMap  = {};
  const filtNhomKhSets = {};
  const filtSPDs       = {};  // {maSP: totalDs}

  filtTdvSet.forEach(tdv => {
    // DS per nhóm & top SP: sum spDsMap across 3 months
    qMonthKeys.forEach(mk => {
      const spDsM = rawData.byTdvMonth?.[tdv]?.[mk]?.spDsMap || {};
      Object.entries(spDsM).forEach(([sp, ds]) => {
        filtSPDs[sp] = (filtSPDs[sp]||0) + ds;
        if (spNhomMap) {
          const nh = spNhomMap[sp] || 'BÁN PHỦ HẾT';
          filtNhomDsMap[nh] = (filtNhomDsMap[nh]||0) + ds;
        }
      });
    });
    // ĐPKH per nhóm: merge per-TDV SP-KH sets
    if (spNhomMap) {
      const tdvSpKh = rawData.byTdvSPKhSet?.[tdv] || {};
      Object.entries(tdvSpKh).forEach(([sp, khSet]) => {
        const nh = spNhomMap[sp] || 'BÁN PHỦ HẾT';
        if (!filtNhomKhSets[nh]) filtNhomKhSets[nh] = new Set();
        khSet.forEach(kh => filtNhomKhSets[nh].add(kh));
      });
    }
  });

  const nhomDsMap  = Object.keys(filtNhomDsMap).length > 0 ? filtNhomDsMap : _quyReport.nhomDsMap;
  const nhomDpkhMap = Object.keys(filtNhomKhSets).length > 0
    ? Object.fromEntries(Object.entries(filtNhomKhSets).map(([nh,s]) => [nh, s.size]))
    : _quyReport.nhomDpkhMap;

  // ── Recompute CK nhóm DS/ĐPKH từ filtered TDVs ──────────
  const ckByTdvSPKhSetF = ckRawData.byTdvSPKhSet || {};
  const filtCkNhomDsMap = {};
  const filtCkNhomKhSets = {};
  filtTdvSet.forEach(tdv => {
    ckMonthKeys.forEach(mk => {
      const spDsM = ckByTdvMonthF[tdv]?.[mk]?.spDsMap || {};
      Object.entries(spDsM).forEach(([sp, ds]) => {
        if (spNhomMap) { const nh = spNhomMap[sp] || 'BÁN PHỦ HẾT'; filtCkNhomDsMap[nh] = (filtCkNhomDsMap[nh]||0) + ds; }
      });
    });
    if (spNhomMap) {
      Object.entries(ckByTdvSPKhSetF[tdv] || {}).forEach(([sp, khSet]) => {
        const nh = spNhomMap[sp] || 'BÁN PHỦ HẾT';
        if (!filtCkNhomKhSets[nh]) filtCkNhomKhSets[nh] = new Set();
        khSet.forEach(kh => filtCkNhomKhSets[nh].add(kh));
      });
    }
  });
  const ckNhomDsMap = Object.keys(filtCkNhomDsMap).length > 0 ? filtCkNhomDsMap : _quyReport.ckNhomDsMap;
  const ckNhomDpkhMap = Object.keys(filtCkNhomKhSets).length > 0
    ? Object.fromEntries(Object.entries(filtCkNhomKhSets).map(([nh,s]) => [nh, s.size]))
    : _quyReport.ckNhomDpkhMap;

  // topSP từ filtered TDVs — tính cả CK DS per SP từ TDV đã lọc
  const rawByMaSP  = rawData.byMaSP || {};
  const filtCkSPDs = {};
  filtTdvSet.forEach(tdv => {
    ckMonthKeys.forEach(mk => {
      const spDsM = ckByTdvMonthF[tdv]?.[mk]?.spDsMap || {};
      Object.entries(spDsM).forEach(([sp, ds]) => { filtCkSPDs[sp] = (filtCkSPDs[sp]||0) + ds; });
    });
  });
  const filtTotalDS = Object.values(filtSPDs).reduce((s,v)=>s+v,0);
  const topSP = Object.keys(filtSPDs).length > 0
    ? Object.entries(filtSPDs)
        .sort((a,b) => b[1]-a[1]).slice(0,15)
        .map(([sp,ds]) => ({
          maSP: sp,
          tenSP: rawByMaSP[sp]?.tenSP || sp,
          ds,
          pct: filtTotalDS>0 ? ds/filtTotalDS : 0,
          ckDS: filtCkSPDs[sp] || 0,
        }))
    : _quyReport.topSP;

  // leadNhom từ nhomDsMap mới
  const nhomDsTotalFilt = Object.values(nhomDsMap).reduce((s,v)=>s+v,0);
  let leadNhom='', leadPct=0;
  if (nhomDsTotalFilt > 0) {
    for (const [nh,ds] of Object.entries(nhomDsMap)) {
      if (ds/nhomDsTotalFilt > leadPct) { leadPct=ds/nhomDsTotalFilt; leadNhom=nh; }
    }
  }

  // Recalculate QLBH progress from filtered set
  const filteredQlbhDsMap = {};
  filtered.forEach(t => {
    if (t.qlbhCode) filteredQlbhDsMap[t.qlbhCode] = (filteredQlbhDsMap[t.qlbhCode]||0) + t.totalDS;
  });
  const allQlbhRows = _quyReport.qlbhPctRows || [];
  const filteredQlbhRows = allQlbhRows
    .filter(r => r.code in filteredQlbhDsMap)
    .map(r => { const ds = filteredQlbhDsMap[r.code]||0; return { ...r, ds, pct: r.target>0?ds/r.target:0 }; });
  const datQLBHCount = filteredQlbhRows.filter(r => r.pct >= 1).length;
  const qlbhCount    = filteredQlbhRows.length;

  const newData = Object.assign({}, _quyReport, {
    tdvRows: filtered, dsByMonth, dpkhByMonth,
    totalDS, totalDPKH, datCount, tdvCount,
    datQLBHCount, qlbhCount,
    ckTotalDS, ckTotalDPKH,
    ckDsByMonth, ckDpkhByMonth,
    nhomDsMap, nhomDpkhMap, topSP, leadNhom, leadPct,
    ckNhomDsMap, ckNhomDpkhMap,
    // per-TDV data: không cần recompute, renderer chỉ đọc TDVs đã lọc
    tdvNhomDsMap:      _quyReport.tdvNhomDsMap      || {},
    tdvKhSpBuckets:    _quyReport.tdvKhSpBuckets    || {},
    tdvKhMonthBuckets: _quyReport.tdvKhMonthBuckets || {},
    tdvKhDsBuckets:    _quyReport.tdvKhDsBuckets    || {},
    atRiskByTdv: Object.fromEntries(Object.entries(_quyReport.atRiskByTdv||{}).filter(([tdv]) => filtTdvSet.has(tdv))),
    hdStatsMap:        _quyReport.hdStatsMap        || {},
    ckTdvNhomDsMap:    _quyReport.ckTdvNhomDsMap    || {},
    ckTdvKhSpBuckets:  _quyReport.ckTdvKhSpBuckets  || {},
    ckTdvKhMonthBuckets: _quyReport.ckTdvKhMonthBuckets || {},
  });
  const out = document.getElementById('quy-output');
  if (!out) return;

  if (typeof Chart !== 'undefined') {
    ['quy-chart-01','quy-chart-04'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { const ch = Chart.getChart(el); if (ch) ch.destroy(); }
    });
  }

  out.innerHTML = renderQuarterlyReport(newData);

  const sel = document.getElementById('quy-mien-select');
  if (sel) sel.value = selectedMien;

  setTimeout(() => initQuyCharts(), 80);
}
