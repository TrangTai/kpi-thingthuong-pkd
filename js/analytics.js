// ============================================================
// ANALYTICS.JS — Báo cáo thống kê KPI  (Chart.js v4)
// Colors: BLUE ≥100%, GRAY 80-99%, RED <80%
// ============================================================

let _charts = [];

const AC = {
  blue:  '#0057A8',
  dkBlue:'#003366',
  cyan:  '#2DB8E8',
  green: '#00A651',
  red:   '#D93B3B',
  amber: '#E89B1A',
  gray:  '#8B95A6',
  lgray: '#E3E8EF',
};

function renderAnalytics(results) {
  _charts.forEach(c => { try { c.destroy(); } catch(e) {} });
  _charts = [];

  const el = document.getElementById('analytics-content');
  if (!el) return;
  if (!results || !results.length) {
    el.innerHTML = '<div style="padding:40px;text-align:center;color:#8B95A6;font-family:\'Be Vietnam Pro\',sans-serif">Nhấn <b>Tính Thưởng</b> rồi quay lại tab này.</div>';
    return;
  }
  if (typeof Chart === 'undefined') {
    el.innerHTML = '<div style="padding:16px 20px;color:#A52222;background:#FDECEC;border:1px solid #F5C0C0;border-radius:8px;margin:16px;font-family:\'Be Vietnam Pro\',sans-serif">⚠ Chart.js chưa tải. Cần kết nối internet.</div>';
    return;
  }

  const cdMaSP = (CONFIG.SP_CHI_DINH.maSP || '').trim();
  el.innerHTML = _buildHTML(cdMaSP);

  _renderCards(results);
  _chartDsDist(results);         // 1
  _chartDonuts(results, cdMaSP); // 2
  _chartN2(results);             // 3
  _chartN1(results);             // 4
  _renderMien(results);          // 5
  _chartN15(results);            // 6
  _renderTopBottom(results);     // 7
}

// ── Helpers ───────────────────────────────────────────────────
function _mkChart(id, cfg) {
  const c = document.getElementById(id);
  if (!c) return;
  const ch = new Chart(c, cfg);
  _charts.push(ch);
}

function _fmtPct(v) { return (v * 100).toFixed(1) + '%'; }
function _fmtM(v) {
  const a = Math.abs(v || 0), s = v < 0 ? '-' : '';
  if (a >= 1e6) return s + Math.round(a / 1e6) + 'M';
  return s + Math.round(a / 1e3) + 'K';
}

function _barColor(ratio) {
  if (ratio >= 1.15) return AC.dkBlue;
  if (ratio >= 1.00) return AC.blue;
  if (ratio >= 0.80) return AC.gray;
  return AC.red;
}
function _txtColor(ratio) {
  return ratio >= 1.0 ? AC.blue : ratio >= 0.8 ? AC.gray : AC.red;
}

const _baseOpts = (extra) => Object.assign({
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
}, extra || {});

// Inline plugin: draw value labels directly on bar charts
function _barLabelPlugin(isHoriz) {
  return {
    id: 'barLabels_' + (isHoriz ? 'h' : 'v'),
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.data.datasets.forEach((ds, i) => {
        chart.getDatasetMeta(i).data.forEach((bar, idx) => {
          const val = ds.data[idx];
          if (!val) return;
          ctx.save();
          ctx.font = '600 11px "Be Vietnam Pro", sans-serif';
          ctx.fillStyle = '#1F2630';
          if (isHoriz) {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(val, bar.x + 5, bar.y);
          } else {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(val, bar.x, bar.y - 3);
          }
          ctx.restore();
        });
      });
    }
  };
}

// ── Cards: 6 tổng hợp ────────────────────────────────────────
function _renderCards(results) {
  // DS tổng lấy từ hàng QLBH (đã tổng hợp subordinates + công ty)
  const qlbhs      = results.filter(r => r.isQLBH);
  const src        = qlbhs.length > 0 ? qlbhs : results;
  const totalDS    = src.reduce((s, r) => s + (r.dsTongCT || r.dsTong || 0), 0);
  const totalTarget= src.reduce((s, r) => s + (r.dsTongTarget || 0), 0);
  const pctDS      = totalTarget > 0 ? totalDS / totalTarget : 0;
  const totalKH    = src.reduce((s, r) => s + (r.dpkh || 0), 0);
  const n          = results.length;
  const datDS      = results.filter(r => r.tyleTong  >= 1.0).length;
  const datDPKH    = results.filter(r => r.tyleDPKH  >= 1.0).length;
  const datDPMH    = results.filter(r => r.tyleDPMH  >= 1.0).length;

  _v('ac-v-ds',      _fmtM(totalDS));
  _v('ac-v-pctds',   _fmtPct(pctDS));
  _v('ac-v-kh',      totalKH);
  _v('ac-v-datds',   `${datDS} / ${n}`);
  _v('ac-v-datdpkh', `${datDPKH} / ${n}`);
  _v('ac-v-datdpmh', `${datDPMH} / ${n}`);
}
function _v(id, val) { const e = document.getElementById(id); if (e) e.textContent = val; }

// ── 1: Distribution (vertical bars) ──────────────────────────
function _chartDsDist(results) {
  const bands = [
    { label: '< 60%',    lo: -Infinity, hi: 0.60 },
    { label: '60–79%',   lo: 0.60,      hi: 0.80 },
    { label: '80–99%',   lo: 0.80,      hi: 1.00 },
    { label: '100–114%', lo: 1.00,      hi: 1.15 },
    { label: '≥ 115%',   lo: 1.15,      hi: Infinity },
  ];
  const mid = b => b.lo === -Infinity ? 0 : (b.hi === Infinity ? b.lo + 0.1 : (b.lo + b.hi) / 2);
  const counts = bands.map(b => results.filter(r => r.tyleTong >= b.lo && r.tyleTong < b.hi).length);

  _mkChart('ch-ds-dist', {
    type: 'bar',
    data: {
      labels: bands.map(b => b.label),
      datasets: [{ data: counts, backgroundColor: bands.map(b => _barColor(mid(b))), maxBarThickness: 52, borderRadius: 4 }]
    },
    options: {
      ..._baseOpts(),
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0, stepSize: 1 }, grid: { color: '#f0f0f0' } },
        x: { grid: { display: false } }
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.raw} người` } } }
    },
    plugins: [_barLabelPlugin(false)]
  });
}

// ── 2: Horizontal bar — số TDV đạt từng chỉ tiêu ─────────────
function _chartDonuts(results, cdMaSP) {
  const n    = results.length;
  const _cnt = fn => results.filter(fn).length;
  const datDS   = _cnt(r => r.tyleTong  >= 1);
  const datDPKH = _cnt(r => r.tyleDPKH  >= 1);
  const datDPMH = _cnt(r => r.tyleDPMH  >= 1);

  const labels = ['DS Tổng', 'ĐPKH', 'ĐPMH'];
  const counts = [datDS, datDPKH, datDPMH];
  const ratios = [datDS / n, datDPKH / n, datDPMH / n];

  if (cdMaSP) {
    const w = results.filter(r => r.datSpCd !== null);
    const d = w.filter(r => r.datSpCd === true).length;
    labels.push('SP CĐ');
    counts.push(d);
    ratios.push(w.length > 0 ? d / w.length : 0);
  }

  const labelPlugin = {
    id: 'achieveLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.data.datasets.forEach((ds, i) => {
        chart.getDatasetMeta(i).data.forEach((bar, idx) => {
          const val = ds.data[idx];
          const total = ds._totals ? ds._totals[idx] : n;
          ctx.save();
          ctx.font = '600 11px "Be Vietnam Pro", sans-serif';
          ctx.fillStyle = '#1F2630';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${val} / ${total} người`, bar.x + 5, bar.y);
          ctx.restore();
        });
      });
    }
  };

  const dataset = {
    data: counts,
    backgroundColor: ratios.map(r => _barColor(r)),
    maxBarThickness: 28,
    borderRadius: 4,
  };
  dataset._totals = labels.map(() => n);

  _mkChart('ch-achievement', {
    type: 'bar',
    data: { labels, datasets: [dataset] },
    options: {
      ..._baseOpts(),
      indexAxis: 'y',
      scales: {
        x: { beginAtZero: true, max: n, ticks: { precision: 0, stepSize: 1 }, grid: { color: '#f0f0f0' } },
        y: { grid: { display: false } }
      }
    },
    plugins: [labelPlugin]
  });
}

// ── 3: N2 horizontal bar ──────────────────────────────────────
function _chartN2(results) {
  const bands = [
    { label: '≥ 100%', lo: 1.00,      hi: Infinity },
    { label: '80–99%', lo: 0.80,      hi: 1.00 },
    { label: '60–79%', lo: 0.60,      hi: 0.80 },
    { label: '40–59%', lo: 0.40,      hi: 0.60 },
    { label: '< 40%',  lo: -Infinity, hi: 0.40 },
  ];
  const mid = b => b.lo === -Infinity ? 0 : (b.hi === Infinity ? b.lo + 0.1 : (b.lo + b.hi) / 2);
  _mkChart('ch-n2', {
    type: 'bar',
    data: {
      labels: bands.map(b => b.label),
      datasets: [{ data: bands.map(b => results.filter(r => r.pctDatN2 >= b.lo && r.pctDatN2 < b.hi).length), backgroundColor: bands.map(b => _barColor(mid(b))), maxBarThickness: 20, borderRadius: 3 }]
    },
    options: { ..._baseOpts(), indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f0f0f0' } }, y: { grid: { display: false } } } },
    plugins: [_barLabelPlugin(true)]
  });
}

// ── 4: N1 coefficient horizontal bar ─────────────────────────
function _chartN1(results) {
  const bands = [
    { label: '1.0  (≥80% N2)', hs: 1.0 },
    { label: '0.9  (60–79%)',   hs: 0.9 },
    { label: '0.8  (40–59%)',   hs: 0.8 },
    { label: '0.7  (<40%)',     hs: 0.7 },
  ];
  _mkChart('ch-n1', {
    type: 'bar',
    data: {
      labels: bands.map(b => b.label),
      datasets: [{ data: bands.map(b => results.filter(r => Math.abs(r.hsAnhHuongN1 - b.hs) < 0.05).length), backgroundColor: bands.map(b => _barColor(b.hs >= 1 ? 1 : b.hs >= 0.9 ? 0.9 : b.hs >= 0.8 ? 0.8 : 0)), maxBarThickness: 20, borderRadius: 3 }]
    },
    options: { ..._baseOpts(), indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f0f0f0' } }, y: { grid: { display: false } } } },
    plugins: [_barLabelPlugin(true)]
  });
}

// ── 5: Theo Miền — inline bars ───────────────────────────────
function _renderMien(results) {
  const tdvOnly = results.filter(r => !r.isQLBH);
  const miens = [...new Set(tdvOnly.map(r => r.mien).filter(Boolean))];
  const rows  = miens.map(m => {
    const grp    = tdvOnly.filter(r => r.mien === m);
    const thuc   = grp.reduce((s, r) => s + (r.dsTong || 0), 0);
    const target = grp.reduce((s, r) => s + (r.dsTongTarget || 0), 0);
    const ratio  = target > 0 ? thuc / target : 0;
    return { m, thuc, target, ratio };
  }).sort((a, b) => b.ratio - a.ratio);

  const max = Math.max(...rows.map(r => r.ratio), 1);
  const html = rows.map(r => `
    <div class="ac-bar-row">
      <div class="ac-bar-name">${r.m}</div>
      <div class="ac-bar-track">
        <div class="ac-bar-fill" style="width:${Math.min(r.ratio / max * 100, 100).toFixed(1)}%;background:${_barColor(r.ratio)}"></div>
        <div class="ac-bar-ref"  style="left:${Math.min(1 / max * 100, 100).toFixed(1)}%"></div>
      </div>
      <div class="ac-bar-pct" style="color:${_txtColor(r.ratio)}">${_fmtPct(r.ratio)}</div>
    </div>
    <div class="ac-bar-sub">${_fmtM(r.thuc)} / ${_fmtM(r.target)}</div>`
  ).join('');
  const el = document.getElementById('ac-mien-list');
  if (el) el.innerHTML = html;
}

// ── 6: N15 horizontal bar ────────────────────────────────────
function _chartN15(results) {
  const bands = [
    { label: '≥ 75%',  lo: 0.75,      hi: Infinity },
    { label: '50–74%', lo: 0.50,      hi: 0.75 },
    { label: '25–49%', lo: 0.25,      hi: 0.50 },
    { label: '< 25%',  lo: -Infinity, hi: 0.25 },
  ];
  const mid = b => b.lo === -Infinity ? 0 : (b.hi === Infinity ? b.lo + 0.1 : (b.lo + b.hi) / 2);
  _mkChart('ch-n15', {
    type: 'bar',
    data: {
      labels: bands.map(b => b.label),
      datasets: [{ data: bands.map(b => results.filter(r => r.tyLeDay15 >= b.lo && r.tyLeDay15 < b.hi).length), backgroundColor: bands.map(b => _barColor(mid(b) >= 0.5 ? 1 : mid(b) >= 0.25 ? 0.85 : 0)), maxBarThickness: 20, borderRadius: 3 }]
    },
    options: { ..._baseOpts(), indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f0f0f0' } }, y: { grid: { display: false } } } },
    plugins: [_barLabelPlugin(true)]
  });
}

// ── 7: Top/Bottom tables ──────────────────────────────────────
function _renderTopBottom(results) {
  const _miniBar = (ratio) => `<div style="display:flex;align-items:center;gap:6px">
    <div style="flex:1;height:6px;background:#eee;border-radius:3px;position:relative">
      <div style="position:absolute;left:0;top:0;height:100%;width:${Math.min(ratio,1)*100}%;background:${_barColor(ratio)};border-radius:3px"></div>
    </div>
    <span style="min-width:42px;font-size:11px;font-weight:700;color:${_txtColor(ratio)}">${_fmtPct(ratio)}</span>
  </div>`;

  const _row = r => `<tr>
    <td style="font-family:monospace;font-weight:700;color:${AC.dkBlue};white-space:nowrap">${r.maTDV}</td>
    <td style="white-space:nowrap">${r.tenTDV}</td>
    <td style="white-space:nowrap;text-align:right">${_fmtM(r.dsTong)}</td>
    <td style="min-width:120px">${_miniBar(r.tyleTong)}</td>
  </tr>`;

  const _tbl = (title, rows, icon) => `
    <div class="ac-tbl-hd">${icon} ${title}</div>
    <table class="ac-table"><thead><tr><th>Mã</th><th>Tên</th><th>DS Thực</th><th>% DS Tổng</th></tr></thead>
    <tbody>${rows.map(_row).join('')}</tbody></table>`;

  const byDS = [...results].sort((a, b) => b.tyleTong - a.tyleTong);
  const el1 = document.getElementById('ac-topbot-ds');
  if (el1) el1.innerHTML =
    '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
    `<div style="flex:1;min-width:240px">${_tbl('Top 5 DS Tổng', byDS.slice(0, 5), '🏆')}</div>` +
    `<div style="flex:1;min-width:240px">${_tbl('Bottom 5 DS Tổng', byDS.slice(-5).reverse(), '⚠')}</div>` +
    '</div>';

  const _rowP = r => `<tr>
    <td style="font-family:monospace;font-weight:700;color:${AC.dkBlue};white-space:nowrap">${r.maTDV}</td>
    <td style="white-space:nowrap">${r.tenTDV}</td>
    <td style="min-width:140px">${_miniBar(r.ptml)}</td>
  </tr>`;

  const _tblP = (title, rows, icon) => `
    <div class="ac-tbl-hd">${icon} ${title}</div>
    <table class="ac-table"><thead><tr><th>Mã</th><th>Tên</th><th>PTML</th></tr></thead>
    <tbody>${rows.map(_rowP).join('')}</tbody></table>`;

  const byP = [...results].sort((a, b) => b.ptml - a.ptml);
  const el2 = document.getElementById('ac-topbot-ptml');
  if (el2) el2.innerHTML =
    '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
    `<div style="flex:1;min-width:240px">${_tblP('Top 5 PTML', byP.slice(0, 5), '🏆')}</div>` +
    `<div style="flex:1;min-width:240px">${_tblP('Bottom 5 PTML', byP.slice(-5).reverse(), '⚠')}</div>` +
    '</div>';
}

// ── HTML builder ──────────────────────────────────────────────
function _buildHTML(cdMaSP) {
  return `<div class="ac-wrap">

  <!-- Cards: 6 chỉ tiêu tổng hợp -->
  <div class="ac-cards">
    <div class="ac-card">
      <div class="ac-lbl">Tổng doanh số hoàn thành</div>
      <div class="ac-val" id="ac-v-ds">—</div>
    </div>
    <div class="ac-card ac-card-blue">
      <div class="ac-lbl">% Đạt doanh số tổng</div>
      <div class="ac-val" id="ac-v-pctds">—</div>
    </div>
    <div class="ac-card">
      <div class="ac-lbl">Tổng số lượng KH</div>
      <div class="ac-val" id="ac-v-kh">—</div>
    </div>
    <div class="ac-card ac-card-blue">
      <div class="ac-lbl">TDV đạt DS Tổng ≥ 100%</div>
      <div class="ac-val" id="ac-v-datds">—</div>
    </div>
    <div class="ac-card ac-card-blue">
      <div class="ac-lbl">TDV đạt ĐPKH ≥ 100%</div>
      <div class="ac-val" id="ac-v-datdpkh">—</div>
    </div>
    <div class="ac-card ac-card-blue">
      <div class="ac-lbl">TDV đạt ĐPMH ≥ 100%</div>
      <div class="ac-val" id="ac-v-datdpmh">—</div>
    </div>
  </div>

  <!-- Hàng 1: 1. Phân phối DS | 2. Tỷ lệ đạt | 3. Nhóm 2 -->
  <div class="ac-row">
    <div class="ac-box" style="flex:1;min-width:220px">
      <div class="ac-box-ttl">1. Phân phối % hoàn thành DS Tổng</div>
      <div style="height:200px"><canvas id="ch-ds-dist"></canvas></div>
    </div>
    <div class="ac-box" style="flex:1;min-width:220px">
      <div class="ac-box-ttl">2. Số TDV đạt ≥ 100% từng chỉ tiêu</div>
      <div style="height:200px"><canvas id="ch-achievement"></canvas></div>
    </div>
    <div class="ac-box" style="flex:1;min-width:220px">
      <div class="ac-box-ttl">3. Phân phối % đạt Nhóm 2</div>
      <div style="height:180px"><canvas id="ch-n2"></canvas></div>
    </div>
  </div>

  <!-- Hàng 2: 4. Hệ số N1 | 5. Theo Miền | 6. DS Ngày 15 -->
  <div class="ac-row">
    <div class="ac-box" style="flex:1;min-width:220px">
      <div class="ac-box-ttl">4. Hệ số ảnh hưởng Nhóm 1</div>
      <div style="height:160px"><canvas id="ch-n1"></canvas></div>
    </div>
    <div class="ac-box" style="flex:1;min-width:220px">
      <div class="ac-box-ttl">5. DS Tổng theo Miền <span class="ac-legend-row"><span class="ac-leg-dot" style="background:${AC.blue}"></span>≥100% <span class="ac-leg-dot" style="background:${AC.gray}"></span>80–99% <span class="ac-leg-dot" style="background:${AC.red}"></span>&lt;80%</span></div>
      <div id="ac-mien-list" class="ac-bar-list"></div>
    </div>
    <div class="ac-box" style="flex:1;min-width:220px">
      <div class="ac-box-ttl">6. Phân phối DS Ngày 15 / Target</div>
      <div style="height:160px"><canvas id="ch-n15"></canvas></div>
    </div>
  </div>

  <!-- Hàng 3: 7. Top / Bottom -->
  <div class="ac-section-hd">7. Top / Bottom</div>
  <div class="ac-row">
    <div class="ac-box" style="flex:1">
      <div class="ac-box-ttl">Top &amp; Bottom 5 — DS Tổng</div>
      <div id="ac-topbot-ds"></div>
    </div>
  </div>
  <div class="ac-row">
    <div class="ac-box" style="flex:1">
      <div class="ac-box-ttl">Top &amp; Bottom 5 — PTML</div>
      <div id="ac-topbot-ptml"></div>
    </div>
  </div>

</div>`;
}
