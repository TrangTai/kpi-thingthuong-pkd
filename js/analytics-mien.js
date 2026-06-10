// ============================================================
// ANALYTICS-MIEN.JS — Dashboard Báo cáo theo Miền (Chart.js v4)
// ============================================================

let _mienResults = null;
let _mienCharts  = {};
let _currentMien = null;

// ── Plugin 1: dashed vertical line at 100% ─────────────────
const _mienRef100Plugin = {
  id: 'mienRef100',
  afterDraw(chart) {
    if (!chart._mienRef100) return;
    const { ctx, scales } = chart;
    const xS = scales.x, yS = scales.y;
    if (!xS || !yS) return;
    const px = xS.getPixelForValue(100);
    if (px < xS.left || px > xS.right) return;
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,51,102,0.55)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.moveTo(px, yS.top);
    ctx.lineTo(px, yS.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font      = 'bold 9px sans-serif';
    ctx.fillStyle = 'rgba(0,51,102,0.65)';
    ctx.textAlign = 'center';
    ctx.fillText('100%', px, yS.top - 5);
    ctx.restore();
  }
};

// ── Plugin 2: % value labels to the right of each bar ──────
const _mienLabelPlugin = {
  id: 'mienLabel',
  afterDatasetsDraw(chart) {
    if (!chart._mienRaw) return;
    const { ctx, chartArea, canvas } = chart;
    const meta = chart.getDatasetMeta(0);
    const raw  = chart._mienRaw;
    const PAD  = chart._mienPadR || 55;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.clip();

    meta.data.forEach((bar, i) => {
      const val = raw[i];
      if (val == null) return;
      const txt = val.toFixed(1) + '%';
      const x   = bar.x + 6;
      const y   = bar.y;
      const maxX = chartArea.right + PAD - 4;
      ctx.font         = '600 10.5px "Be Vietnam Pro", Segoe UI, sans-serif';
      ctx.fillStyle    = val >= 100 ? '#003A7A' : '#8B1111';
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, Math.min(x, maxX), y);
    });

    ctx.restore();
  }
};

if (typeof Chart !== 'undefined') {
  Chart.register(_mienRef100Plugin, _mienLabelPlugin);
}

// ── Entry point ────────────────────────────────────────────

function renderMienReport(results) {
  _mienResults = results;
  const el = document.getElementById('mien-report-content');
  if (!el) return;

  if (!results || !results.length) {
    el.innerHTML = '<div style="padding:48px;text-align:center;color:#aaa;font-size:14px;font-family:var(--font)">Nhấn <b>Tính Thưởng</b> để xem báo cáo.</div>';
    return;
  }
  if (typeof Chart === 'undefined') {
    el.innerHTML = '<div style="padding:16px 20px;color:#A52222;background:#FDECEC;border:1px solid #F5C0C0;border-radius:8px;margin:16px">⚠ Chart.js chưa tải. Cần kết nối internet.</div>';
    return;
  }

  const miens = [...new Set(results.map(r => r.mien).filter(Boolean))].sort();
  if (!miens.length) {
    el.innerHTML = '<div style="padding:48px;text-align:center;color:#aaa">Không có dữ liệu Miền.</div>';
    return;
  }

  const filterHtml = miens.map(m =>
    `<button class="mf-btn" data-mien="${m}" onclick="selectMien('${m}')">${m}</button>`
  ).join('');

  el.innerHTML = `
    <div class="mf-header">
      <div class="mf-header-title">📊 BÁO CÁO DOANH SỐ MIỀN</div>
      <div class="mf-header-right">
        <div class="mf-filters">${filterHtml}</div>
        <button class="mf-screenshot-btn" onclick="captureMienReport()" title="Chụp toàn bộ báo cáo">📷 Chụp ảnh</button>
      </div>
    </div>
    <div id="mf-body"></div>`;

  const first = (_currentMien && miens.includes(_currentMien)) ? _currentMien : miens[0];
  selectMien(first);
}

// ── Render one Miền ────────────────────────────────────────

function selectMien(mien) {
  if (!_mienResults) return;
  _currentMien = mien;

  document.querySelectorAll('.mf-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mien === mien));

  const grp      = _mienResults.filter(r => r.mien === mien);
  const qlbhOnly = grp.filter(r =>  r.isQLBH);
  const tdvOnly  = grp.filter(r => !r.isQLBH);
  const body     = document.getElementById('mf-body');
  if (!body) return;

  // Summary — dùng QLBH rows để tránh đếm double (QLBH đã bao gồm DS của TDV)
  const totalDS     = qlbhOnly.reduce((s, r) => s + (r.dsTongCT    || 0), 0);
  const totalTarget = qlbhOnly.reduce((s, r) => s + (r.dsTongTarget || 0), 0);
  const pctDS       = totalTarget > 0 ? totalDS / totalTarget : 0;
  const totalKH     = qlbhOnly.reduce((s, r) => s + (r.dpkh        || 0), 0);
  const tdvN        = tdvOnly.length;
  const tdvDatDS    = tdvOnly.filter(r => (r.tyleTongCT || 0) >= 1.0).length;
  const tdvDatDPKH  = tdvOnly.filter(r => (r.tyleDPKH   || 0) >= 1.0).length;
  const tdvDatDPMH  = tdvOnly.filter(r => (r.tyleDPMH   || 0) >= 1.0).length;

  const fmtBig = v => {
    const a = Math.abs(v || 0), s = (v || 0) < 0 ? '-' : '';
    if (a >= 1e9) return s + (a / 1e9).toFixed(1) + 'Tỷ';
    if (a >= 1e6) return s + Math.round(a / 1e6) + 'M';
    return s + Math.round(a).toLocaleString('vi-VN');
  };

  const pctCls  = pctDS  >= 1   ? 'mf-card-green' : pctDS  >= 0.6 ? 'mf-card-amber' : 'mf-card-red';
  const dsCls   = tdvDatDS   > 0 ? 'mf-card-green' : 'mf-card-red';
  const dpkhCls = tdvDatDPKH > 0 ? 'mf-card-green' : 'mf-card-red';
  const dpmhCls = tdvDatDPMH > 0 ? 'mf-card-green' : 'mf-card-red';

  body.innerHTML = `
    <div class="mf-cards">
      <div class="mf-card">
        <div class="mf-card-lbl">Tổng doanh số hoàn thành</div>
        <div class="mf-card-val">${fmtBig(totalDS)}</div>
      </div>
      <div class="mf-card ${pctCls}">
        <div class="mf-card-lbl">% Đạt doanh số tổng</div>
        <div class="mf-card-val">${(pctDS * 100).toFixed(1)}%</div>
      </div>
      <div class="mf-card">
        <div class="mf-card-lbl">Tổng số lượng KH</div>
        <div class="mf-card-val">${totalKH.toLocaleString('vi-VN')}</div>
      </div>
      <div class="mf-card ${dsCls}">
        <div class="mf-card-lbl">TDV đạt DS Tổng ≥ 100%</div>
        <div class="mf-card-val">${tdvDatDS} / ${tdvN}</div>
      </div>
      <div class="mf-card ${dpkhCls}">
        <div class="mf-card-lbl">TDV đạt ĐPKH ≥ 100%</div>
        <div class="mf-card-val">${tdvDatDPKH} / ${tdvN}</div>
      </div>
      <div class="mf-card ${dpmhCls}">
        <div class="mf-card-lbl">TDV đạt ĐPMH ≥ 100%</div>
        <div class="mf-card-val">${tdvDatDPMH} / ${tdvN}</div>
      </div>
    </div>
    <div class="mf-charts-grid">
      ${_mfBox(1,'mc-tonct','% ĐẠT DOANH SỐ TỔNG + CT')}
      ${_mfBox(2,'mc-n2',   '% ĐẠT DOANH SỐ NHÓM 2')}
      ${_mfBox(3,'mc-n3',   '% ĐẠT DOANH SỐ NHÓM 3')}
      ${_mfBox(4,'mc-dpkh', '% ĐẠT ĐPKH')}
      ${_mfBox(5,'mc-dpmh', '% ĐẠT ĐPMH')}
      ${_mfBox(6,'mc-ptml', '% ĐẠT PTML')}
    </div>`;

  Object.values(_mienCharts).forEach(c => { try { c.destroy(); } catch(e) {} });
  _mienCharts = {};

  const BAR = 24;
  _buildMienBar('mc-tonct', tdvOnly, r => (r.tyleTongCT || 0) * 100, BAR);
  _buildMienBar('mc-n2',    tdvOnly, r => (r.pctDatN2   || 0) * 100, BAR);
  _buildMienBar('mc-n3',    tdvOnly, r => (r.tyLeN3     || 0) * 100, BAR);
  _buildMienBar('mc-dpkh',  tdvOnly, r => (r.tyleDPKH   || 0) * 100, BAR);
  _buildMienBar('mc-dpmh',  tdvOnly, r => (r.tyleDPMH   || 0) * 100, BAR);
  _buildMienBar('mc-ptml',  tdvOnly, r => (r.ptml       || 0) * 100, BAR);
}

function _mfBox(n, id, title) {
  return `<div class="mf-chart-box">
    <div class="mf-chart-title"><span class="mf-ct-num">${n}</span>${title}</div>
    <div class="mf-chart-wrap" id="w-${id}"><canvas id="${id}"></canvas></div>
  </div>`;
}

// ── Build one horizontal bar chart ─────────────────────────

function _buildMienBar(id, data, valFn, barH) {
  const canvas = document.getElementById(id);
  const wrap   = document.getElementById('w-' + id);
  if (!canvas || !wrap) return;

  const sorted  = [...data].sort((a, b) => valFn(b) - valFn(a));
  const labels  = sorted.map(r => {
    const n = r.tenTDV || '';
    return n.length > 20 ? n.substring(0, 19) + '…' : n;
  });
  const rawVals = sorted.map(r => +valFn(r).toFixed(2));

  const maxRaw = Math.max(...rawVals, 110);
  const xMax   = Math.min(350, Math.ceil(maxRaw / 20) * 20 + 30);

  const bgColors  = rawVals.map(v => v >= 100 ? '#0057A8' : '#D93B3B');
  const hovColors = rawVals.map(v => v >= 100 ? '#004080' : '#B02222');

  const PAD_R  = 58;
  const chartH = Math.max(140, labels.length * (barH + 7) + 54);
  wrap.style.height = chartH + 'px';

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: rawVals,
        backgroundColor: bgColors,
        hoverBackgroundColor: hovColors,
        borderRadius: 3,
        borderSkipped: false,
        barThickness: barH,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: PAD_R, top: 16, bottom: 6, left: 2 } },
      animation: { duration: 350 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => sorted[ctx[0].dataIndex]?.tenTDV || ctx[0].label,
            label: ctx  => '  ' + ctx.raw.toFixed(1) + '%',
          },
          bodyFont:  { size: 13 },
          titleFont: { size: 12, weight: 'bold' },
          padding:   10,
        }
      },
      scales: {
        x: {
          min: 0,
          max: xMax,
          ticks: {
            callback:     v => v + '%',
            font:         { size: 10, family: "'Be Vietnam Pro', sans-serif" },
            color:        '#8B95A6',
            maxTicksLimit: 7,
            stepSize:     20,
          },
          grid:   { color: 'rgba(0,0,0,0.07)' },
          border: { display: false },
        },
        y: {
          ticks: {
            font:        { size: 11, family: "'Be Vietnam Pro', sans-serif" },
            color:       '#353D4B',
            crossAlign:  'far',
          },
          grid:   { display: false },
          border: { display: false },
        }
      }
    }
  });

  chart._mienRaw  = rawVals;
  chart._mienRef100 = true;
  chart._mienPadR = PAD_R;

  _mienCharts[id] = chart;
}

// ── Chụp ảnh toàn bộ báo cáo Miền ─────────────────────────
function captureMienReport() {
  const el = document.getElementById('mien-report-content');
  if (!el) return;
  if (typeof html2canvas === 'undefined') {
    alert('html2canvas chưa tải. Cần kết nối internet.');
    return;
  }
  const btn = el.querySelector('.mf-screenshot-btn');
  if (btn) btn.disabled = true;

  html2canvas(el, {
    backgroundColor: '#F4F6FA',
    scale: 2,
    useCORS: true,
    allowTaint: true,
    scrollX: 0,
    scrollY: 0,
    windowWidth: el.scrollWidth,
    width: el.scrollWidth,
    height: el.scrollHeight,
  }).then(canvas => {
    const link = document.createElement('a');
    const mienLabel = (_currentMien || 'mien').replace(/\s+/g, '_');
    link.download = 'BaoCao_' + mienLabel + '_' + new Date().toLocaleDateString('vi-VN').replace(/\//g, '-') + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }).catch(err => {
    alert('Lỗi chụp ảnh: ' + err.message);
  }).finally(() => {
    if (btn) btn.disabled = false;
  });
}
