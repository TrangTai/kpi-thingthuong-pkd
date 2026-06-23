// ============================================================
// ANALYTICS-QUARTERLY.JS - Báo cáo kinh doanh theo quý
// ============================================================

const QUY_MIN_DS = 500000;

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

// ─── Calculator ──────────────────────────────────────────────
let _quyReport = null;

function calculateQuarterlyReport(qData, currentOrders, spNhomMap, targets, dskhByTdv) {
  const today    = new Date();
  const curYear  = today.getFullYear();
  const curMonth = today.getMonth() + 1;
  const q        = Math.ceil(curMonth / 3);
  const m1 = (q-1)*3+1, m2 = (q-1)*3+2, m3 = curMonth;
  const mkFmt    = m => `${curYear}-${String(m).padStart(2,'0')}`;
  const qMonthKeys = [mkFmt(m1), mkFmt(m2), mkFmt(m3)];
  const qMonthLabels = [`Tháng ${m1}`, `Tháng ${m2}`, `Tháng ${m3}`];
  const ROMAN    = ['I','II','III','IV'];

  // Target map (non-QLBH only)
  const tgtMap = {};
  (targets||[]).forEach(t => { tgtMap[(t.maTDV||'').toUpperCase()] = t; });

  // ── Aggregate current month from live orders ──────────────
  const curByTdv  = {}; // {tdv: {ds, khDsMap, spDsMap}}
  const curByMaSP = {}; // {maSP: {tenSP, ds}}
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
  const h6ByTdv = qData?.byTdvMonth || {};
  const allTdvs = new Set([...Object.keys(h6ByTdv), ...Object.keys(curByTdv)]);
  const tdvRows = [];

  allTdvs.forEach(tdv => {
    const info = tgtMap[tdv] || {};
    if ((info.doiTuong||'').toUpperCase() === 'QLBH') return;

    const mStats = {};
    qMonthKeys.forEach((mk, idx) => {
      const d = idx < 2 ? (h6ByTdv[tdv]?.[mk] || {ds:0,khDsMap:{},spDsMap:{}})
                        : (curByTdv[tdv]        || {ds:0,khDsMap:{},spDsMap:{}});
      const dpkh = Object.values(d.khDsMap||{}).filter(v => v >= QUY_MIN_DS).length;
      const dpmh = Object.values(d.spDsMap||{}).filter(v => v >= QUY_MIN_DS).length;
      mStats[mk] = { ds: d.ds||0, dpkh, dpmh };
    });

    const totalDS   = qMonthKeys.reduce((s,mk) => s+(mStats[mk]?.ds  ||0), 0);
    const totalDPKH = qMonthKeys.reduce((s,mk) => s+(mStats[mk]?.dpkh||0), 0);
    const totalDPMH = qMonthKeys.reduce((s,mk) => s+(mStats[mk]?.dpmh||0), 0);

    tdvRows.push({
      maTDV: tdv,
      tenTDV:       info.tenTDV      || tdv,
      mien:         info.mien        || '',
      qlbhCode:     (info.qlbhCode   || '').toUpperCase(),
      dpkhTarget:   info.dpkhTarget  || 0,
      dpmhTarget:   info.dpmhTarget  || 0,
      dsTongTarget: info.dsTongTarget|| 0,
      totalKhDskh:  (dskhByTdv || {})[tdv] || 0,
      totalDS, totalDPKH, totalDPMH, mStats,
      datTarget: (info.dsTongTarget||0) > 0 && totalDS >= (info.dsTongTarget||0) * 3,
    });
  });
  tdvRows.sort((a,b) => b.totalDS - a.totalDS);

  // ── QLBH % achievement (group TDV DS by qlbhCode) ────────
  const qlbhTeamDsMap = {};
  tdvRows.forEach(t => {
    if (t.qlbhCode) qlbhTeamDsMap[t.qlbhCode] = (qlbhTeamDsMap[t.qlbhCode] || 0) + t.totalDS;
  });
  const qlbhPctRows = Object.entries(qlbhTeamDsMap).map(([code, ds]) => {
    const info = tgtMap[code] || {};
    const target = (info.dsTongTarget || 0) * 3;
    return { code, tenTDV: info.tenTDV || code, ds, target, pct: target > 0 ? ds / target : 0 };
  }).filter(r => r.target > 0);
  const datQLBHCount = qlbhPctRows.filter(r => r.pct >= 1).length;
  const qlbhCount    = qlbhPctRows.length;

  // ── Monthly totals ────────────────────────────────────────
  const dsByMonth   = qMonthKeys.map((mk,i) => ({ label: qMonthLabels[i], ds:   tdvRows.reduce((s,t) => s+(t.mStats[mk]?.ds  ||0), 0) }));
  const dpkhByMonth = qMonthKeys.map((mk,i) => ({ label: qMonthLabels[i], dpkh: tdvRows.reduce((s,t) => s+(t.mStats[mk]?.dpkh||0), 0) }));

  // ── Per-SP totals (6M + current) ─────────────────────────
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
      const nh = spNhomMap[sp]; if (!nh) return;
      nhomDsMap[nh] = (nhomDsMap[nh]||0) + ds;
    });
  }

  // ── Nhóm DPKH (distinct KH per nhóm) ────────────────────
  const nhomKhSets = {};
  if (spNhomMap) {
    const bySPKh6 = qData?.bySPKhSet || {};
    Object.entries(bySPKh6).forEach(([sp, khSet]) => {
      const nh = spNhomMap[sp]; if (!nh) return;
      if (!nhomKhSets[nh]) nhomKhSets[nh] = new Set();
      khSet.forEach(kh => nhomKhSets[nh].add(kh));
    });
    (currentOrders||[]).forEach(o => {
      if (!o.maKH || !o.maSP) return;
      const nh = spNhomMap[o.maSP]; if (!nh) return;
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
    .map(([sp,v]) => ({ maSP:sp, tenSP:v.tenSP, ds:v.ds, pct: totalDSAll>0?v.ds/totalDSAll:0 }));

  // ── Aggregates ────────────────────────────────────────────
  const totalDS   = tdvRows.reduce((s,t) => s+t.totalDS, 0);
  const totalDPKH = dpkhByMonth.reduce((s,v) => s+v.dpkh, 0);
  const datCount  = tdvRows.filter(t => t.datTarget).length;

  // Lead nhóm
  let leadNhom='', leadPct=0;
  if (totalDS > 0) {
    for (const [nh,ds] of Object.entries(nhomDsMap)) {
      if (ds/totalDS > leadPct) { leadPct=ds/totalDS; leadNhom=nh; }
    }
  }

  return {
    qLabel: `Quý ${ROMAN[q-1]}`, qYear: curYear,
    qPeriod: `Tháng ${m1} – Tháng ${m3} · Năm ${curYear}`,
    qMonthKeys, qMonthLabels,
    totalDS, totalDPKH, datCount, tdvCount: tdvRows.length,
    datQLBHCount, qlbhCount, qlbhPctRows,
    leadNhom, leadPct,
    tdvRows, dsByMonth, dpkhByMonth,
    nhomDsMap, nhomDpkhMap, topSP,
  };
}

// ─── Renderer ────────────────────────────────────────────────
function renderQuarterlyReport(data) {
  _quyReport = data;
  const { qLabel, qYear, qPeriod, totalDS, totalDPKH, datCount, tdvCount, datQLBHCount, qlbhCount, leadNhom, leadPct, tdvRows, dsByMonth, dpkhByMonth, nhomDsMap, nhomDpkhMap, topSP, qMonthLabels } = data;

  const vndM  = v => Math.round(v/1e6).toLocaleString('vi-VN') + 'M';
  const vndC1 = v => v>=1e6 ? (v/1e6).toFixed(0)+'M' : v>=1e3 ? Math.round(v/1e3)+'K' : String(Math.round(v));
  const pctFmt= v => (v*100).toFixed(0) + '%';

  // ── Miền filter ───────────────────────────────────────────
  const allTdvRowsForMien = data._allTdvRows || tdvRows; // use original full list for dropdown
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
  const s1 = `
<div class="quy-section">
  <div class="quy-sec-hdr"><span class="quy-sec-num">I</span> DOANH SỐ</div>
  <div class="quy-chart-grid quy-chart-grid-3">
    <div class="quy-chart-card">
      <div class="quy-chart-title">01 · DOANH SỐ THEO THÁNG<span class="quy-chart-unit">(Đơn vị: triệu đồng)</span></div>
      <div style="height:180px;position:relative"><canvas id="quy-chart-01"></canvas></div>
      <div class="quy-ds-total-row">Tổng doanh số quý: <b>${vndM(totalDS)}</b></div>
    </div>
    <div class="quy-chart-card quy-pct-card">
      <div class="quy-chart-title">03 · % ĐẠT TARGET QUÝ</div>
      <div class="quy-big-pct">${qlbhCount>0 ? Math.round(datQLBHCount/qlbhCount*100) : (tdvCount>0 ? Math.round(datCount/tdvCount*100) : 0)}%</div>
      <div class="quy-big-pct-sub">${qlbhCount>0 ? `${datQLBHCount}/${qlbhCount} QLBH hoàn thành<br>chỉ tiêu quý doanh số` : `${datCount}/${tdvCount} TDV hoàn thành<br>chỉ tiêu quý doanh số`}</div>
    </div>
  </div>
  <div class="quy-chart-card" style="margin-top:12px">
    <div class="quy-chart-title">02 · DOANH SỐ THEO TRÌNH DƯỢC VIÊN<span class="quy-chart-unit">(Đơn vị: triệu đồng)</span></div>
    <div style="position:relative;height:${Math.max(160, tdvRows.length*30)}px"><canvas id="quy-chart-02"></canvas></div>
  </div>
</div>`;

  // ── Section II: Khách hàng ───────────────────────────────
  const dpkhTotal = dpkhByMonth.reduce((s,v)=>s+v.dpkh,0);

  const hasDskh = tdvRows.some(t => t.totalKhDskh > 0);

  const buildDpkhTable05 = () => {
    const rows = tdvRows.map(t => {
      const tb  = Math.round(t.totalDPKH / 3); // average monthly DPKH actual
      const tot = hasDskh ? (t.totalKhDskh || 0) : (t.dpkhTarget || 0);
      const tl  = tot > 0 ? Math.round(tb / tot * 100) : 0;
      const cls = tl>=100?'quy-tl-good':tl>=60?'quy-tl-warn':'quy-tl-bad';
      return `<tr><td>${t.tenTDV}</td><td>${tb}</td><td>${tot||'—'}</td><td class="${cls}">${tl}%</td></tr>`;
    });
    const totTb  = Math.round(tdvRows.reduce((s,t)=>s+t.totalDPKH,0) / 3);
    const totTot = hasDskh
      ? tdvRows.reduce((s,t)=>s+t.totalKhDskh,0)
      : tdvRows.reduce((s,t)=>s+t.dpkhTarget,0);
    const totTl = totTot>0 ? Math.round(totTb/totTot*100) : 0;
    const hdrTot = hasDskh ? 'Tổng KH' : 'Target TB';
    return `<table class="quy-tbl"><thead><tr><th>Tên TDV</th><th>KH TB</th><th>${hdrTot}</th><th>Tỷ lệ</th></tr></thead><tbody>${rows.join('')}<tr class="quy-tbl-total"><td>Tổng</td><td>${totTb}</td><td>${totTot||'—'}</td><td>${totTl}%</td></tr></tbody></table>`;
  };

  const buildDpkhTable06 = () => {
    const rows = tdvRows.map(t => {
      const quy = t.totalDPKH;
      const tot = hasDskh ? (t.totalKhDskh || 0) : (t.dpkhTarget * 3 || 0);
      const tl  = tot > 0 ? Math.round(quy / tot * 100) : 0;
      const cls = tl>=100?'quy-tl-good':tl>=60?'quy-tl-warn':'quy-tl-bad';
      return `<tr><td>${t.tenTDV}</td><td>${quy}</td><td>${tot||'—'}</td><td class="${cls}">${tl}%</td></tr>`;
    });
    const tot   = tdvRows.reduce((s,t)=>s+t.totalDPKH,0);
    const totTg = hasDskh
      ? tdvRows.reduce((s,t)=>s+t.totalKhDskh,0)
      : tdvRows.reduce((s,t)=>s+t.dpkhTarget*3,0);
    const totTl = totTg>0 ? Math.round(tot/totTg*100) : 0;
    const hdrTot = hasDskh ? 'Tổng KH (DSKH)' : 'Target×3';
    return `<table class="quy-tbl"><thead><tr><th>Tên TDV</th><th>KH Quý</th><th>${hdrTot}</th><th>Tỷ lệ</th></tr></thead><tbody>${rows.join('')}<tr class="quy-tbl-total"><td>Tổng</td><td>${tot}</td><td>${totTg||'—'}</td><td>${totTl}%</td></tr></tbody></table>`;
  };

  const s2 = `
<div class="quy-section">
  <div class="quy-sec-hdr"><span class="quy-sec-num">II</span> KHÁCH HÀNG</div>
  <div class="quy-chart-grid quy-chart-grid-2">
    <div class="quy-chart-card quy-span-2">
      <div class="quy-chart-title">04 · ĐỘ PHỦ KHÁCH HÀNG THEO THÁNG</div>
      <div class="quy-dpkh-row">
        <div style="flex:1;height:180px;position:relative"><canvas id="quy-chart-04"></canvas></div>
        <div class="quy-dpkh-total-box">
          <div class="quy-dpkh-total-label">TỔNG KH QUÝ</div>
          <div class="quy-dpkh-total-num">${totalDPKH.toLocaleString('vi-VN')}</div>
          <div class="quy-dpkh-total-sub">cộng dồn ${qMonthLabels.length} tháng ĐPKH</div>
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
</div>`;

  // ── Section III: Sản phẩm ────────────────────────────────
  const hasNhom = Object.keys(nhomDsMap).length > 0;
  const totalNhomDS = Object.values(nhomDsMap).reduce((s,v)=>s+v,0);
  const maxNhomDS   = Math.max(...Object.values(nhomDsMap), 1);

  const nhomDsHtml = hasNhom ? Object.entries(nhomDsMap)
    .sort((a,b)=>b[1]-a[1])
    .map(([nh,ds]) => {
      const pct = totalNhomDS>0 ? Math.round(ds/totalNhomDS*100) : 0;
      const w   = Math.round(ds/maxNhomDS*100);
      return `<div class="quy-bar-row"><span class="quy-bar-label">${nh}</span><div class="quy-bar-wrap"><div class="quy-bar-fill quy-bar-blue" style="width:${w}%"></div></div><span class="quy-bar-val">${vndM(ds)}</span><span class="quy-bar-pct">${pct}%</span></div>`;
    }).join('') : '<div style="color:#aaa;padding:12px">Chưa có mapping SP → Nhóm</div>';

  const totalNhomDPKH = Object.values(nhomDpkhMap).reduce((s,v)=>s+v,0);
  const maxNhomDPKH   = Math.max(...Object.values(nhomDpkhMap), 1);
  const nhomDpkhHtml  = Object.keys(nhomDpkhMap).length > 0
    ? Object.entries(nhomDpkhMap).sort((a,b)=>b[1]-a[1]).map(([nh,cnt]) => {
        const pct = totalNhomDPKH>0 ? Math.round(cnt/totalNhomDPKH*100) : 0;
        const w   = Math.round(cnt/maxNhomDPKH*100);
        return `<div class="quy-bar-row"><span class="quy-bar-label">${nh}</span><div class="quy-bar-wrap"><div class="quy-bar-fill quy-bar-green" style="width:${w}%"></div></div><span class="quy-bar-val">${cnt.toLocaleString('vi-VN')}</span><span class="quy-bar-pct">${pct}%</span></div>`;
      }).join('')
    : '<div style="color:#aaa;padding:12px">Chưa có mapping SP → Nhóm</div>';

  const maxTopDS = topSP.length > 0 ? topSP[0].ds : 1;
  const topSPHtml = topSP.map((sp,i) => {
    const w = Math.round(sp.ds/maxTopDS*100);
    return `<tr>
      <td class="quy-topsp-num">${i+1}</td>
      <td class="quy-topsp-name">${sp.tenSP||sp.maSP}</td>
      <td class="quy-topsp-ds">${vndM(sp.ds)}</td>
      <td class="quy-topsp-bar"><div class="quy-bar-fill quy-bar-cyan" style="width:${w}%;height:8px;border-radius:4px"></div></td>
      <td class="quy-topsp-pct">${pctFmt(sp.pct)}</td>
    </tr>`;
  }).join('');

  const dpmhRows = tdvRows.map(t => {
    const tgt = t.dpmhTarget || 0;
    const quy = t.totalDPMH;
    const wTgt = tgt>0 ? Math.min(100, Math.round(tgt/Math.max(...tdvRows.map(r=>r.totalDPMH), 1)*100)) : 0;
    const wQuy = Math.round(quy/Math.max(...tdvRows.map(r=>r.totalDPMH), 1)*100);
    return `<div class="quy-dpmh-row">
      <span class="quy-dpmh-name">${t.tenTDV.length>14?t.tenTDV.slice(0,13)+'…':t.tenTDV}</span>
      <span class="quy-dpmh-nums">${tgt} / ${quy}</span>
      <div class="quy-dpmh-bars">
        <div class="quy-dpmh-bar-tgt" style="width:${wTgt}%"></div>
        <div class="quy-dpmh-bar-quy" style="width:${wQuy}%"></div>
      </div>
    </div>`;
  }).join('');

  const s3 = `
<div class="quy-section">
  <div class="quy-sec-hdr"><span class="quy-sec-num">III</span> SẢN PHẨM</div>
  <div class="quy-chart-grid quy-chart-grid-2">
    <div class="quy-chart-card">
      <div class="quy-chart-title">07 · ĐỘ PHỦ MẶT HÀNG (ĐPMH) THEO TDV<span class="quy-chart-unit"><span class="quy-legend-dot" style="background:#B0C4DE"></span>TB tháng &nbsp; <span class="quy-legend-dot" style="background:#003D77"></span>Trong quý</span></div>
      ${dpmhRows}
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
      <thead><tr><th>#</th><th>Tên sản phẩm</th><th>Doanh số</th><th style="min-width:120px"></th><th>Tỷ trọng</th></tr></thead>
      <tbody>${topSPHtml}</tbody>
    </table>
  </div>
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
      <div class="quy-kpi-sub">Đơn vị tính: 1.000.000đ</div>
    </div>
    <div class="quy-kpi-card">
      <div class="quy-kpi-label">TRÌNH DƯỢC VIÊN</div>
      <div class="quy-kpi-val">${tdvCount}</div>
      <div class="quy-kpi-sub">${tdvCount>0?Math.round(datCount/tdvCount*100):0}% đạt chỉ tiêu</div>
    </div>
    <div class="quy-kpi-card">
      <div class="quy-kpi-label">KHÁCH HÀNG PHỦ</div>
      <div class="quy-kpi-val">${totalDPKH.toLocaleString('vi-VN')}</div>
      <div class="quy-kpi-sub">Cộng dồn ĐPKH ${qMonthLabels.length} tháng</div>
    </div>
    <div class="quy-kpi-card">
      <div class="quy-kpi-label">NHÓM DẪN ĐẦU</div>
      <div class="quy-kpi-val">${leadNhom ? pctFmt(leadPct) : '—'}</div>
      <div class="quy-kpi-sub">${leadNhom || 'Chưa có mapping nhóm'}</div>
    </div>
  </div>

  ${s1}${s2}${s3}
</div>`;
}

// ─── Chart.js initialization ─────────────────────────────────
function initQuyCharts() {
  const d = _quyReport;
  if (!d || typeof Chart === 'undefined') return;

  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.font.size   = 11;

  const BLUE  = '#3A7BD5';
  const CYAN  = '#00BCD4';
  const ALPHA = 'rgba(58,123,213,0.75)';
  const gridColor = 'rgba(0,0,0,0.06)';

  const vndM = v => (v/1e6).toFixed(0) + 'M';

  // ── Chart 01: DS theo tháng (vertical bar) ───────────────
  const c01 = document.getElementById('quy-chart-01');
  if (c01) {
    new Chart(c01, {
      type: 'bar',
      data: {
        labels: d.dsByMonth.map(v => v.label),
        datasets: [{ data: d.dsByMonth.map(v => v.ds), backgroundColor: BLUE, borderRadius: 4, barThickness: 48 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 22 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => vndM(ctx.parsed.y) + ' VNĐ' } },
          datalabels: {
            anchor: 'end', align: 'end',
            formatter: v => vndM(v),
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

  // ── Chart 02: DS theo TDV (horizontal bar) ───────────────
  const c02 = document.getElementById('quy-chart-02');
  if (c02) {
    const sorted = [...d.tdvRows].sort((a,b) => b.totalDS - a.totalDS);
    new Chart(c02, {
      type: 'bar',
      data: {
        labels: sorted.map(t => t.tenTDV),
        datasets: [{ data: sorted.map(t => t.totalDS), backgroundColor: BLUE, borderRadius: 3, barThickness: 18 }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 44 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => vndM(ctx.parsed.x) + ' VNĐ' } },
          datalabels: {
            anchor: 'end', align: 'end',
            formatter: v => vndM(v),
            color: '#555', font: { size: 9 },
          },
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { callback: v => vndM(v), color: '#888' }, beginAtZero: true },
          y: { grid: { display: false }, ticks: { color: '#333', font: { size: 11 } } },
        },
      },
    });
  }

  // ── Chart 04: DPKH theo tháng (vertical bar) ─────────────
  const c04 = document.getElementById('quy-chart-04');
  if (c04) {
    new Chart(c04, {
      type: 'bar',
      data: {
        labels: d.dpkhByMonth.map(v => v.label),
        datasets: [{ data: d.dpkhByMonth.map(v => v.dpkh), backgroundColor: CYAN, borderRadius: 4, barThickness: 48 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 22 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ctx.parsed.y + ' KH' } },
          datalabels: {
            anchor: 'end', align: 'end',
            formatter: v => v.toLocaleString('vi-VN'),
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

// ─── Miền filter ─────────────────────────────────────────────
function onQuyMienChange(selectedMien) {
  if (!_quyReport) return;

  // Filter tdvRows by Miền
  const baseTdvRows = _quyReport._allTdvRows || _quyReport.tdvRows;
  if (!_quyReport._allTdvRows) _quyReport._allTdvRows = _quyReport.tdvRows; // cache original

  const filtered = selectedMien
    ? baseTdvRows.filter(t => t.mien === selectedMien)
    : baseTdvRows;

  // Recalculate aggregates
  const { qMonthKeys, qMonthLabels } = _quyReport;
  const dsByMonth   = qMonthKeys.map((mk,i) => ({ label: qMonthLabels[i], ds:   filtered.reduce((s,t) => s+(t.mStats[mk]?.ds  ||0), 0) }));
  const dpkhByMonth = qMonthKeys.map((mk,i) => ({ label: qMonthLabels[i], dpkh: filtered.reduce((s,t) => s+(t.mStats[mk]?.dpkh||0), 0) }));
  const totalDS   = filtered.reduce((s,t) => s+t.totalDS, 0);
  const totalDPKH = dpkhByMonth.reduce((s,v) => s+v.dpkh, 0);
  const datCount  = filtered.filter(t => t.datTarget).length;
  const tdvCount  = filtered.length;

  // Recalculate QLBH % from filtered TDV set
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

  // Rebuild modified report data and re-render
  const newData = Object.assign({}, _quyReport, { tdvRows: filtered, dsByMonth, dpkhByMonth, totalDS, totalDPKH, datCount, tdvCount, datQLBHCount, qlbhCount });
  const out = document.getElementById('quy-output');
  if (!out) return;

  // Destroy existing Chart.js instances before re-render
  if (typeof Chart !== 'undefined') {
    ['quy-chart-01','quy-chart-02','quy-chart-04'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { const ch = Chart.getChart(el); if (ch) ch.destroy(); }
    });
  }

  out.innerHTML = renderQuarterlyReport(newData);

  // Restore Miền select value after re-render
  const sel = document.getElementById('quy-mien-select');
  if (sel) sel.value = selectedMien;

  setTimeout(() => initQuyCharts(), 80);
}
