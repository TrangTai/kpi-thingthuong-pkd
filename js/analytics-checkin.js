// ============================================================
// ANALYTICS-CHECKIN.JS - Check-in daily report
// ============================================================

const DAY_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

// ─── Parser ─────────────────────────────────────────────────
function parseCheckInFile(arrayBuffer) {
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

  const records = [];
  let year = 0, month = 0;

  for (let r = 1; r <= range.e.r; r++) {
    const maTDV = getCellStr(ws, r, 1); // col B
    const maKH  = getCellStr(ws, r, 2); // col C
    if (!maTDV) continue;

    const cell = ws[XLSX.utils.encode_cell({ r, c: 5 })]; // col F: Giờ check-in
    if (!cell || cell.v === undefined) continue;

    let dt = null;
    if (cell.t === 'n' && cell.v > 1000) {
      dt = new Date(Math.round((cell.v - 25569) * 86400 * 1000));
    } else if (cell.t === 'd') {
      dt = cell.v;
    }
    if (!dt) continue;

    if (!year) { year = dt.getUTCFullYear(); month = dt.getUTCMonth() + 1; }

    records.push({
      maTDV: maTDV.trim().toUpperCase(),
      maKH:  maKH.trim(),
      day:   dt.getUTCDate(),
    });
  }

  return { records, year, month };
}

// ─── Calculator ─────────────────────────────────────────────
function calculateCheckInReport(ciData, orderRecords, targets) {
  const { records, year, month } = ciData;

  const allDaysSet = new Set(records.map(r => r.day));
  const allDays = [...allDaysSet].sort((a, b) => a - b);

  // Target map: maTDV → { tenTDV, khuVuc, mien, qlbhCode }
  const targetMap = {};
  if (targets) targets.forEach(t => { targetMap[(t.maTDV || '').toUpperCase()] = t; });

  // ciMap[maTDV][day] = Set<maKH> (distinct KH visited)
  const ciMap = {};
  records.forEach(r => {
    if (!ciMap[r.maTDV]) ciMap[r.maTDV] = {};
    if (!ciMap[r.maTDV][r.day]) ciMap[r.maTDV][r.day] = new Set();
    ciMap[r.maTDV][r.day].add(r.maKH);
  });

  // dsMap[maTDV][day] = { ds, khSet }
  const dsMap = {};
  if (orderRecords) {
    orderRecords.forEach(o => {
      const tdv = (o.maNV || '').trim().toUpperCase();
      if (!tdv || !o.ngayDay) return;
      if (!dsMap[tdv]) dsMap[tdv] = {};
      if (!dsMap[tdv][o.ngayDay]) dsMap[tdv][o.ngayDay] = { ds: 0, khSet: new Set() };
      dsMap[tdv][o.ngayDay].ds += o.doanhSo || 0;
      if (o.maKH) dsMap[tdv][o.ngayDay].khSet.add(o.maKH.trim());
    });
  }

  const allTDVs = Object.keys(ciMap);
  const rows = allTDVs.map(tdv => {
    const info = targetMap[tdv] || {};
    const totalDS  = Object.values(dsMap[tdv] || {}).reduce((s, v) => s + v.ds, 0);
    const totalCI  = Object.values(ciMap[tdv] || {}).reduce((s, v) => s + v.size, 0);

    const daily = {};
    allDays.forEach(day => {
      const khCI = ciMap[tdv]?.[day] || new Set();
      const dsInfo = (dsMap[tdv] || {})[day] || { ds: 0, khSet: new Set() };
      daily[day] = {
        ciKH:  khCI.size,
        ds:    dsInfo.ds,
        khDS:  dsInfo.khSet.size,
      };
    });

    return {
      maTDV:    tdv,
      tenTDV:   info.tenTDV   || tdv,
      khuVuc:   info.khuVuc   || '',
      mien:     info.mien     || '',
      qlbhCode: info.qlbhCode || '',
      totalDS,
      totalCI,
      daily,
    };
  });

  // Sort by qlbhCode → maTDV
  rows.sort((a, b) => {
    const qa = a.qlbhCode || a.maTDV, qb = b.qlbhCode || b.maTDV;
    return qa !== qb ? qa.localeCompare(qb) : a.maTDV.localeCompare(b.maTDV);
  });

  // Build QLBH group summary rows
  const qlbhGroups = {};
  rows.forEach(r => {
    const key = r.qlbhCode || '__nogroup';
    if (!qlbhGroups[key]) qlbhGroups[key] = { rows: [], qlbhCode: key, khuVuc: r.khuVuc };
    qlbhGroups[key].rows.push(r);
  });

  // Insert summary row before each QLBH group
  const finalRows = [];
  Object.values(qlbhGroups).forEach(grp => {
    if (grp.rows.length > 1) {
      const summaryDaily = {};
      allDays.forEach(day => {
        summaryDaily[day] = {
          ciKH: grp.rows.reduce((s, r) => s + (r.daily[day]?.ciKH || 0), 0),
          ds:   grp.rows.reduce((s, r) => s + (r.daily[day]?.ds   || 0), 0),
          khDS: 0,
        };
      });
      finalRows.push({
        isGroup:  true,
        maTDV:    grp.qlbhCode,
        tenTDV:   'Tổng ' + grp.khuVuc,
        khuVuc:   grp.khuVuc,
        totalDS:  grp.rows.reduce((s, r) => s + r.totalDS, 0),
        totalCI:  grp.rows.reduce((s, r) => s + r.totalCI, 0),
        daily:    summaryDaily,
      });
    }
    grp.rows.forEach(r => finalRows.push(r));
  });

  return { rows: finalRows, allDays, year, month };
}

// ─── Renderer ────────────────────────────────────────────────
function renderCheckInTable(data, monthLabel) {
  const { rows, allDays, year, month } = data;
  if (!rows.length) return '<p style="padding:20px;color:#888">Không có dữ liệu check-in.</p>';

  const fmtDS = v => v ? (v / 1e6).toFixed(2) : '';

  // Day column headers (2 levels)
  const dayHeaders = allDays.map(day => {
    const dow = new Date(year, month - 1, day).getDay();
    const isSun = dow === 0;
    return `<th colspan="2" class="ci-day-hdr${isSun ? ' ci-sun' : ''}">Day ${day}<br><span class="ci-dow">${DAY_VI[dow]}</span></th>`;
  }).join('');

  const daySubHdrs = allDays.map(day => {
    const isSun = new Date(year, month - 1, day).getDay() === 0;
    const cls = isSun ? ' ci-sun' : '';
    return `<th class="ci-sub${cls}">CI</th><th class="ci-sub ci-sub-ds${cls}">DS</th>`;
  }).join('');

  let stt = 0;
  const bodyHtml = rows.map(row => {
    if (!row.isGroup) stt++;
    const isGrp = !!row.isGroup;
    const trCls = isGrp ? ' class="ci-grp-row"' : '';
    const totalFmt = row.totalDS ? row.totalDS.toLocaleString('vi-VN') : '—';

    const dayCells = allDays.map(day => {
      const d = row.daily[day] || { ciKH: 0, ds: 0 };
      const ciStr = d.ciKH || '';
      const dsStr = fmtDS(d.ds);
      return `<td class="ci-ci">${ciStr}</td><td class="ci-ds${d.ds > 0 ? ' ci-ds-val' : ''}">${dsStr}</td>`;
    }).join('');

    return `<tr${trCls}>
      <td class="ci-stt">${isGrp ? '' : stt}</td>
      <td class="ci-name">${row.tenTDV}</td>
      <td class="ci-area">${row.khuVuc}</td>
      <td class="ci-total">${totalFmt}</td>
      ${dayCells}
    </tr>`;
  }).join('');

  return `
    <div class="ci-info">
      <b>Tháng ${month}/${year}</b> &nbsp;·&nbsp;
      ${rows.filter(r => !r.isGroup).length} TDV &nbsp;·&nbsp;
      ${allDays.length} ngày có check-in
    </div>
    <div class="ci-table-wrap">
      <table class="ci-table">
        <thead>
          <tr>
            <th rowspan="2" class="ci-hdr">STT</th>
            <th rowspan="2" class="ci-hdr">Tên TDV</th>
            <th rowspan="2" class="ci-hdr">Khu vực</th>
            <th rowspan="2" class="ci-hdr">Tổng DS hiện tại</th>
            ${dayHeaders}
          </tr>
          <tr>${daySubHdrs}</tr>
        </thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>`;
}
