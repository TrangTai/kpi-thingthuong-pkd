// ============================================================
// KPI-CARD.JS – Individual KPI card modal
// ============================================================

function showKpiCard(maTDV) {
  if (!lastCalcData?.results) return;
  const r = lastCalcData.results.find(x => x.maTDV === maTDV);
  if (!r) return;
  const quy = (staticData.quyMap || {})[maTDV] || null;
  document.getElementById('kpi-card-paper').innerHTML = _buildCard(r, quy);
  document.getElementById('kpi-card-modal').style.display = 'flex';
}

function closeKpiCard() {
  document.getElementById('kpi-card-modal').style.display = 'none';
}

function captureKpiCard() {
  const el = document.getElementById('kpi-card-paper');
  if (!el) return;
  if (typeof html2canvas === 'undefined') { alert('Cần kết nối internet để chụp ảnh.'); return; }
  const btn = document.getElementById('kc-btn-capture');
  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
  html2canvas(el, {
    backgroundColor: '#fff', scale: 2, useCORS: true, allowTaint: true,
    logging: false,
    onclone: (doc, cloned) => {
      cloned.style.position = 'static';
      cloned.style.overflow = 'visible';
      cloned.style.maxHeight = 'none';
    },
  }).then(canvas => {
    const link = document.createElement('a');
    const tdvName = el.querySelector('.kc-info-val')?.textContent?.replace(/\s+/g,'_') || 'KPI';
    link.download = `KPI_${tdvName}_${new Date().toLocaleDateString('vi-VN').replace(/\//g,'-')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }).catch(e => alert('Lỗi chụp ảnh: ' + e.message))
    .finally(() => { if (btn) { btn.disabled = false; btn.textContent = '📷 Chụp ảnh'; } });
}

// ─── Helpers ─────────────────────────────────────────────────
const _M  = v => v ? Math.round(v / 1e6) + 'M' : '0M';
const _pct = v => v != null ? (v * 100).toFixed(1) + '%' : '—';
const _pctRaw = v => v != null ? (v * 100).toFixed(1) : '0';

function _statusCls(val, threshold) { return val >= threshold ? 'kc-ok' : 'kc-fail'; }
function _statusTxt(val, threshold) { return val >= threshold ? 'Đạt' : 'Chưa đạt'; }

function _bar(pct, threshold) {
  const w = Math.min(100, Math.max(0, pct * 100));
  const color = pct >= threshold ? '#16A34A' : pct >= threshold * 0.6 ? '#D97706' : '#DC2626';
  const tPos  = Math.min(100, threshold * 100);
  return `<div class="kc-bar-wrap">
    <div class="kc-bar-fill" style="width:${w}%;background:${color}"></div>
    <div class="kc-bar-mark" style="left:${tPos}%"></div>
  </div>`;
}

function _miniBar(val, maxVal, label, isTarget) {
  const h = maxVal > 0 ? Math.max(4, Math.round((val / maxVal) * 100)) : 4;
  const color = isTarget ? '#CBD5E1' : '#0057A8';
  const fmtVal = Math.round(val / 1e6);
  return `<div class="kc-mcol">
    <div class="kc-mbar-wrap"><div class="kc-mbar-fill" style="height:${h}%;background:${color}"></div></div>
    <div class="kc-mlabel-val">${fmtVal}M</div>
    <div class="kc-mlabel">${label}</div>
  </div>`;
}

// ─── Card builder ─────────────────────────────────────────────
function _buildCard(r, quy) {
  const qc  = CONFIG.QUY_CONFIG;
  const now = new Date();
  const dateStr = now.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' });

  // Quarterly chart data — quy values are already in VNĐ
  const t1 = quy ? (quy.t1Thuc || 0) : 0;
  const t2 = quy ? (quy.t2Thuc || 0) : 0;
  const t3 = r.dsTongCT;
  const tgt = r.dsTongTarget;
  const tQuy = t1 + t2 + t3;                              // Tổng DS Quý thực
  const tQuyTarget = (quy?.t1Target||0) + (quy?.t2Target||0) + tgt;
  const chartMax = Math.max(t1, t2, t3, tQuy) * 1.05 || 1;

  // DS còn lại để đạt mức tháng
  const con100 = Math.max(0, tgt * 1.00 - r.dsTongCT);
  const con115 = Math.max(0, tgt * 1.15 - r.dsTongCT);
  const con125 = Math.max(0, tgt * 1.25 - r.dsTongCT);
  const con135 = Math.max(0, tgt * 1.35 - r.dsTongCT);

  // PTML threshold (61%)
  const PTML_THR = 0.61;

  // Card 1: DS Tổng+CT
  const card1 = `<div class="kc-card">
    <div class="kc-card-label">DS TỔNG THÁNG + CTY</div>
    <div class="kc-card-big">${_M(r.dsTongCT)}</div>
    <div class="kc-card-sub">/ ${_M(tgt)} kế hoạch · ${_pct(r.tyleTongCT)}</div>
  </div>`;

  // Card 2: % Đạt T+CT
  const card2 = `<div class="kc-card kc-card-blue">
    <div class="kc-card-label">% ĐẠT THÁNG + CTY</div>
    <div class="kc-card-big kc-blue">${_pct(r.tyleTongCT)}</div>
    <div class="kc-card-sub">${_M(r.dsTongCT)} / ${_M(tgt)} kế hoạch tháng</div>
  </div>`;

  // Card 3: PTML
  const ptmlOk = r.ptml >= PTML_THR;
  const card3 = `<div class="kc-card kc-card-ptml">
    <div class="kc-card-label">% ĐẠT PTML</div>
    <div class="kc-card-big ${ptmlOk ? 'kc-green' : 'kc-red'}">${_pct(r.ptml)}</div>
    <div class="kc-card-sub ${ptmlOk ? 'kc-green' : 'kc-red'}">
      ${ptmlOk ? '●' : '●'} ${ptmlOk ? 'Đạt' : 'Chưa đạt'} ngưỡng ≥ ${Math.round(PTML_THR*100)}%
    </div>
  </div>`;

  // Card 4: % Đạt N2
  const card4 = `<div class="kc-card">
    <div class="kc-card-label">% ĐẠT N2</div>
    <div class="kc-card-big kc-blue">${_pct(r.tyLeN2)}</div>
    <div class="kc-card-sub">${_M(r.dsN2)} / ${_M(r.dsN2Target)} kế hoạch N2</div>
  </div>`;

  // KPI table rows
  const kpiRows = [
    { label: 'DS N2',    val: r.tyLeN2,     thr: 0.60 },
    { label: 'DS N3',    val: r.tyLeN3,     thr: 0.60 },
    { label: 'DS Tổng',  val: r.tyleTong,   thr: 0.60 },
    { label: 'DS T+CT',  val: r.tyleTongCT, thr: 0.60 },
    { label: 'ĐPKH',     val: r.tyleDPKH,   thr: 0.60 },
    { label: 'ĐPMH',     val: r.tyleDPMH,   thr: 0.60 },
    { label: 'DS N15',   val: r.tyLeDay15 || 0, thr: 0.50 },
  ];

  const kpiTableRows = kpiRows.map(k => `
    <tr>
      <td class="kc-kpi-label">${k.label}</td>
      <td class="kc-kpi-pct ${_statusCls(k.val, k.thr)}">${_pct(k.val)}</td>
      <td class="kc-kpi-bar">${_bar(k.val, k.thr)}</td>
      <td class="kc-kpi-thr">≥ ${Math.round(k.thr*100)}%</td>
      <td class="kc-kpi-status ${_statusCls(k.val, k.thr)}">${_statusTxt(k.val, k.thr)}</td>
    </tr>`).join('');

  // DS & KH table
  const dsTable = `
    <table class="kc-ds-table">
      <thead><tr><th>Chỉ số</th><th>KH</th><th>Thực hiện</th><th>Tỷ lệ</th></tr></thead>
      <tbody>
        <tr><td>DS N2</td><td>${_M(r.dsN2Target)}</td><td>${_M(r.dsN2)}</td><td class="${_statusCls(r.tyLeN2,0.6)}">${_pct(r.tyLeN2)}</td></tr>
        <tr><td>DS N3 (SP mới)</td><td>${_M(r.dsN3Target)}</td><td>${_M(r.dsN3)}</td><td class="${_statusCls(r.tyLeN3,0.6)}">${_pct(r.tyLeN3)}</td></tr>
        <tr><td>DS Tổng</td><td>${_M(tgt)}</td><td>${_M(r.dsTong)}</td><td class="${_statusCls(r.tyleTong,0.6)}">${_pct(r.tyleTong)}</td></tr>
      </tbody>
    </table>
    <div class="kc-ds-note">Đơn vị: triệu đồng · Tỷ lệ = Thực / Kế hoạch</div>`;

  // Quarterly chart
  const barChart = `
    <div class="kc-chart">
      ${_miniBar(t1,  chartMax, qc.thang1 || 'T-2', false)}
      ${_miniBar(t2,  chartMax, qc.thang2 || 'T-1', false)}
      ${_miniBar(t3,   chartMax, qc.thang3 || 'T.này', false)}
      ${_miniBar(tQuy, chartMax, 'Tổng DS Quý', false)}
    </div>
    <div class="kc-chart-footer">
      <span class="kc-chart-actual">Lũy kế quý</span>
      <span class="kc-chart-target">${_M(tQuy)} / ${_M(tQuyTarget)}</span>
    </div>`;

  // Tổng hợp KPI
  const tongHop = [
    { label: `PTML (${(CONFIG.PTML_WEIGHTS.reduce((s,v)=>s+v,0)*100).toFixed(0)}%)`, val: r.ptml, ok: r.ptml >= PTML_THR, fmt: _pct(r.ptml) },
    { label: `Hs N1 (×${r.hsAnhHuongN1})`,  val: r.hsAnhHuongN1,  ok: r.hsAnhHuongN1 >= 1,  fmt: r.hsAnhHuongN1?.toFixed(2) },
    { label: `HSHT (×${r.hsht})`,            val: r.hsht,           ok: r.hsht >= 1,           fmt: r.hsht?.toFixed(2) },
    { label: `Hs KH CT (×${r.hsKhCT})`,      val: r.hsKhCT,         ok: r.hsKhCT >= 1,         fmt: r.hsKhCT?.toFixed(2) },
  ];
  const tongHopRows = tongHop.map(t => `
    <tr>
      <td class="kc-th-label">${t.label}</td>
      <td class="kc-th-val ${t.ok ? 'kc-green' : 'kc-red'}">${t.fmt} <span class="kc-dot ${t.ok ? 'kc-dot-green' : 'kc-dot-red'}">●</span></td>
    </tr>`).join('');

  // SP Chỉ định
  const spCd = CONFIG.SP_CHI_DINH;
  const spRows = spCd.maSP ? `
    <div class="kc-sp-row"><span class="kc-sp-label">SL SP CD</span><span class="kc-sp-val">${r.soLuongSpCd ?? '—'}</span></div>
    <div class="kc-sp-row"><span class="kc-sp-label">KH phụ SP CD</span><span class="kc-sp-val">${r.dpkhSpCd ?? '—'}</span></div>
    <div class="kc-sp-row"><span class="kc-sp-label">Đạt SP CD</span><span class="kc-sp-val ${r.datSpCd ? 'kc-green' : 'kc-red'}">${r.datSpCd ? '✓ Đạt' : '✗ Chưa'}</span></div>` :
    `<div class="kc-sp-none">Tháng này không có SP chỉ định</div>`;

  // DS còn lại
  const conLai = [
    { label: 'Mức 100%', val: con100 },
    { label: 'Mức 115%', val: con115 },
    { label: 'Mức 125%', val: con125 },
    { label: 'Mức 135%', val: con135 },
  ].map(c => `
    <div class="kc-con-row">
      <span class="kc-con-label">${c.label}</span>
      <span class="kc-con-val ${c.val === 0 ? 'kc-green' : ''}">${c.val === 0 ? '✓ Đã đạt' : _M(c.val)}</span>
    </div>`).join('');

  return `
  <div class="kc-header">
    <div class="kc-header-left">
      <div class="kc-logo">M</div>
      <div>
        <div class="kc-brand">meracine</div>
        <div class="kc-title">Báo cáo KPI cá nhân</div>
      </div>
    </div>
    <div class="kc-header-right">
      <div class="kc-date-label">KỲ BÁO CÁO</div>
      <div class="kc-date">${dateStr}</div>
      <div class="kc-quy">${qc.quyLabel}</div>
    </div>
  </div>

  <div class="kc-infobar">
    <div class="kc-info-cell">
      <div class="kc-info-lbl">TRÌNH DƯỢC VIÊN</div>
      <div class="kc-info-val">${r.tenTDV}</div>
    </div>
    <div class="kc-info-cell">
      <div class="kc-info-lbl">MÃ TDV</div>
      <div class="kc-info-val">${r.maTDV}</div>
    </div>
    <div class="kc-info-cell">
      <div class="kc-info-lbl">KHU VỰC</div>
      <div class="kc-info-val">${r.khuVuc || '—'}</div>
    </div>
    <div class="kc-info-cell">
      <div class="kc-info-lbl">MIỀN</div>
      <div class="kc-info-val">${r.mien || '—'}</div>
    </div>
    <div class="kc-info-cell">
      <div class="kc-info-lbl">QUẢN LÝ BÁN HÀNG</div>
      <div class="kc-info-val">${r.qlbh || '—'}</div>
    </div>
  </div>

  <div class="kc-cards">${card1}${card2}${card3}${card4}</div>

  <div class="kc-section-row">
    <div class="kc-section kc-section-wide">
      <div class="kc-section-title">TỶ LỆ HOÀN THÀNH KPI
        <span class="kc-section-note">Ngưỡng đạt: 60% (DS N15: 50%)</span>
      </div>
      <table class="kc-kpi-table"><tbody>${kpiTableRows}</tbody></table>
    </div>
  </div>

  <div class="kc-section-row">
    <div class="kc-section kc-section-half">
      <div class="kc-section-title">DOANH SỐ – KH & THỰC HIỆN
        <span class="kc-section-note">triệu đồng</span>
      </div>
      ${dsTable}
    </div>
    <div class="kc-section kc-section-half">
      <div class="kc-section-title">TIẾN ĐỘ ${qc.quyLabel}
        <span class="kc-section-note">triệu đồng</span>
      </div>
      ${barChart}
    </div>
  </div>

  <div class="kc-section-row">
    <div class="kc-section kc-section-third">
      <div class="kc-section-title">TỔNG HỢP KPI</div>
      <table class="kc-th-table"><tbody>${tongHopRows}</tbody></table>
    </div>
    <div class="kc-section kc-section-third">
      <div class="kc-section-title">SP CHỈ ĐỊNH</div>
      <div class="kc-sp-body">${spRows}</div>
    </div>
    <div class="kc-section kc-section-third">
      <div class="kc-section-title">DS CÒN LẠI ĐỂ ĐẠT MỨC THÁNG
        <span class="kc-section-note">${qc.quyLabel}</span>
      </div>
      <div class="kc-con-body">${conLai}</div>
    </div>
  </div>`;
}
