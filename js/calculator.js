// ============================================================
// CALCULATOR.JS - Engine tính KPI (8 bước) + chi tiết ĐPKH/ĐPMH
// ============================================================

function calculateKPI(allOrders, targets) {
  const results    = [];
  const dpkhDetail = [];
  const dpmhDetail = [];

  // ── Build QLBH → subordinate TDV map ─────────────────────
  const qlbhByName = {};  // normalized name (lowercase) → maTDV
  const qlbhByCode = {};  // maTDV code → maTDV
  for (const t of targets) {
    if (t.doiTuong && t.doiTuong.trim().toUpperCase() === 'QLBH') {
      qlbhByName[(t.tenTDV || '').trim().toLowerCase()] = t.maTDV;
      qlbhByCode[(t.maTDV || '').trim()] = t.maTDV;
    }
  }

  const qlbhSubCodes = {};
  const qlbhSubDots  = {};
  for (const t of targets) {
    const isQLBH = t.doiTuong && t.doiTuong.trim().toUpperCase() === 'QLBH';
    if (!isQLBH && t.qlbh) {
      const ref = t.qlbh.trim();
      const qc  = qlbhByName[ref.toLowerCase()] || qlbhByCode[ref] || null;
      if (qc) {
        if (!qlbhSubCodes[qc]) { qlbhSubCodes[qc] = new Set(); qlbhSubDots[qc] = new Set(); }
        qlbhSubCodes[qc].add(t.maTDV);
        qlbhSubDots[qc].add(t.maTDV + '.');
      }
    }
  }

  // ── Main calculation loop ─────────────────────────────────
  for (const target of targets) {
    const tdv    = target.maTDV;
    const dotTDV = tdv + '.';
    const isQLBH = target.doiTuong && target.doiTuong.trim().toUpperCase() === 'QLBH';

    const subCodes = isQLBH ? (qlbhSubCodes[tdv] || new Set()) : null;
    const subDots  = isQLBH ? (qlbhSubDots[tdv]  || new Set()) : null;
    const numSubs  = isQLBH ? (subCodes.size || 1) : 1;

    const isRetailOf  = o => isQLBH ? (subCodes.has(o.maNV) || o.maNV === tdv) : o.maNV === tdv;
    const isCompanyOf = o => isQLBH ? subDots.has(o.companyTDV) : o.companyTDV === dotTDV;
    const belongsTo   = o => (!o.isCompanyKH && isRetailOf(o)) || (o.isCompanyKH && isCompanyOf(o));

    // ─── Bước 2: DS theo nhóm ───────────────────────────────
    let dsN1 = 0, dsN2 = 0, dsN3 = 0, dsTong = 0, dsCongTy = 0, dsDay15 = 0;

    for (const o of allOrders) {
      if (!o.isCompanyKH && isRetailOf(o)) {
        dsTong += o.doanhSo;
        if (o.nhomTinhLuong === 'Nhóm 2') dsN2 += o.doanhSo;
        else                               dsN1 += o.doanhSo;
        if (o.nhomPTML === 'Nhóm 3')       dsN3 += o.doanhSo;
        if (o.ngayDay > 0 && o.ngayDay <= 15) dsDay15 += o.doanhSo;
      }
      if (o.isCompanyKH && isCompanyOf(o)) {
        dsCongTy += o.doanhSo;
        if (o.nhomTinhLuong === 'Nhóm 2') dsN2 += o.doanhSo;
        if (o.nhomPTML === 'Nhóm 3')       dsN3 += o.doanhSo;
        if (o.ngayDay > 0 && o.ngayDay <= 15) dsDay15 += o.doanhSo;
      }
    }
    const dsCongTyCapped = dsCongTy > 0 ? Math.min(dsCongTy, target.dsTongTarget * 0.30) : dsCongTy;
    const dsTongCT = dsTong + dsCongTyCapped;

    // ─── Bước 3: ĐPKH ───────────────────────────────────────
    const khMap  = {};
    const khInfo = {};
    for (const o of allOrders) {
      if (belongsTo(o)) {
        khMap[o.maKH]  = (khMap[o.maKH]  || 0) + o.doanhSo;
        if (!khInfo[o.maKH]) khInfo[o.maKH] = o.tenKH || o.maKH;
      }
    }
    const dpkh = Object.values(khMap).filter(ds => ds >= CONFIG.MIN_DS_PHU).length;
    for (const [maKH, ds] of Object.entries(khMap)) {
      dpkhDetail.push({ maTDV: tdv, tenTDV: target.tenTDV, maKH, tenKH: khInfo[maKH] || '', ds, isPhu: ds >= CONFIG.MIN_DS_PHU });
    }

    // ─── Bước 4: ĐPMH ───────────────────────────────────────
    // QLBH: pivot theo o.qlbhNV (cột P đơn hàng) nếu có, ngưỡng = MIN_DS_PHU × numSubs
    const dpmhThreshold  = CONFIG.MIN_DS_PHU * numSubs;
    const qlbhNameLower  = isQLBH ? (target.tenTDV || '').trim().toLowerCase() : '';
    const spMap  = {};
    const spInfo = {};
    for (const o of allOrders) {
      let include;
      if (isQLBH && o.qlbhNV) {
        const ref = o.qlbhNV.trim().toLowerCase();
        const matchCode = qlbhByName[ref] || qlbhByCode[o.qlbhNV.trim()] || null;
        include = matchCode === tdv || ref === qlbhNameLower;
      } else {
        include = belongsTo(o);
      }
      if (include) {
        const canon = CONFIG.DPMH_GROUPS[o.maSP] || o.maSP;
        spMap[canon]  = (spMap[canon]  || 0) + o.doanhSoDPMH;
        if (!spInfo[canon]) spInfo[canon] = o.tenSP || canon;
      }
    }
    const dpmh = Object.values(spMap).filter(ds => ds >= dpmhThreshold).length;
    for (const [maSP, ds] of Object.entries(spMap)) {
      dpmhDetail.push({ maTDV: tdv, tenTDV: target.tenTDV, maSP, tenSP: spInfo[maSP] || '', ds, isPhu: ds >= dpmhThreshold });
    }

    // ─── SP chỉ định ─────────────────────────────────────────
    let soLuongSpCd = 0;
    let dpkhSpCd = 0;
    const cdMaSPStr = (CONFIG.SP_CHI_DINH.maSP || '').trim();
    const cdMaSPSet = cdMaSPStr
      ? new Set(cdMaSPStr.split(',').map(s => s.trim()).filter(Boolean))
      : null;
    if (cdMaSPSet && cdMaSPSet.size > 0) {
      const khSet = new Set();
      for (const o of allOrders) {
        if (cdMaSPSet.has(o.maSP) && belongsTo(o)) {
          soLuongSpCd += (o.soLuong || 0);
          khSet.add(o.maKH);
        }
      }
      dpkhSpCd = khSet.size;
    }
    const datSpCd = cdMaSPSet && cdMaSPSet.size > 0
      ? (soLuongSpCd >= CONFIG.SP_CHI_DINH.soLuongTarget && dpkhSpCd >= CONFIG.SP_CHI_DINH.dpkhSpCdTarget)
      : null;

    // ─── Bước 5: Tỷ lệ hoàn thành ───────────────────────────
    const dsN2Target   = target.dsTongTarget * CONFIG.DS_N2_RATIO;
    const dsN3Target   = target.dsTongTarget * CONFIG.DS_N3_RATIO;
    const dsTongTarget = target.dsTongTarget;
    const dpkhTarget   = target.dpkhTarget;
    const dpmhTarget   = target.dpmhTarget;

    const tyLeN2     = dsN2Target   > 0 ? dsN2     / dsN2Target   : 0;
    const tyLeN3     = dsN3Target   > 0 ? dsN3     / dsN3Target   : 0;
    const tyleTong   = dsTongTarget > 0 ? dsTong   / dsTongTarget : 0;
    const tyleTongCT = dsTongTarget > 0 ? dsTongCT / dsTongTarget : 0;
    const tyleDPKH   = dpkhTarget   > 0 ? dpkh     / dpkhTarget   : 0;
    const tyleDPMH   = dpmhTarget   > 0 ? dpmh     / dpmhTarget   : 0;
    const tyLeDay15  = dsTongTarget > 0 ? dsDay15  / dsTongTarget : 0;

    // ─── Bước 6: PTML ───────────────────────────────────────
    const ratios = [tyLeN3, tyleTong, tyleTongCT, tyleDPKH, tyleDPMH];
    let ptml = 0;
    for (let i = 0; i < CONFIG.PTML_WEIGHTS.length; i++) ptml += ratios[i] * CONFIG.PTML_WEIGHTS[i];

    // ─── Bước 7: % đạt N2 ────────────────────────────────────
    // DS T+CT < 100%: DS N2 / (DS T+CT × 50%) | ≥100%: DS N2 / DS N2 Target
    let pctDatN2;
    if (tyleTongCT < 1.0) {
      pctDatN2 = dsTongCT > 0 ? dsN2 / (dsTongCT * 0.5) : 0;
    } else {
      pctDatN2 = dsN2Target > 0 ? dsN2 / dsN2Target : 0;
    }
    const hsAnhHuongN1 = getHsAnhHuongN1(pctDatN2);

    // ─── Bước 8: HSHT, hệ số KH CT ──────────────────────────
    const hsht   = isQLBH ? getHshtQLBH(tyleTongCT) : getHshtTDV(tyleTongCT);
    // HSHT < 1: Hs KH CT = HSHT | HSHT ≥ 1: lookup DS công ty (1.0 → 0.8 → 0.7)
    const hsKhCT = hsht < 1 ? hsht : getHsKhCongTy(Math.abs(dsCongTy));

    const qlbhRef  = (target.qlbh || '').trim();
    const qlbhCode = isQLBH ? tdv : (qlbhByName[qlbhRef.toLowerCase()] || qlbhByCode[qlbhRef] || '');

    results.push({
      maTDV: tdv, tenTDV: target.tenTDV, khuVuc: target.khuVuc,
      mien: target.mien, qlbh: target.qlbh, doiTuong: target.doiTuong,
      dsN2Target, dsN3Target, dsTongTarget, dpkhTarget, dpmhTarget,
      dsN1, dsN2, dsN3, dsTong, dsTongCT, dsCongTy, dpkh, dpmh,
      dsDay15, tyLeDay15,
      tyLeN2, tyLeN3, tyleTong, tyleTongCT, tyleDPKH, tyleDPMH,
      ptml, pctDatN2, hsAnhHuongN1, hsht, hsKhCT,
      soLuongSpCd, dpkhSpCd, datSpCd,
      isQLBH, numSubs, qlbhCode,
    });
  }

  return { results, dpkhDetail, dpmhDetail };
}
