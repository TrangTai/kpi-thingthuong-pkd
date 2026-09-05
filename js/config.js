// ============================================================
// CONFIG.JS - Chính sách lương thưởng cố định (từ sheet CSL)
// ============================================================

const CONFIG = {

  // ----------------------------------------------------------
  // Trọng số PTML (từ Tính Thưởng row 2, cols 19-23)
  // Áp dụng cho: [DS N3, DS Tổng, DS Tổng+CT, ĐPKH, ĐPMH]
  // Xác minh: 1.2944×0.1 + 0×0 + 0.5769×0.6 + 0.7033×0.15 + 1.2222×0.15 = 76.44% ✓
  // ----------------------------------------------------------
  PTML_WEIGHTS: [0.10, 0.00, 0.60, 0.15, 0.15],

  // ----------------------------------------------------------
  // Derived targets từ DS Tổng Target
  // ----------------------------------------------------------
  DS_N2_RATIO: 0.50,   // DS N2 Target = DS Tổng Target × 50%
  DS_N3_RATIO: 0.08,   // DS N3 Target = DS Tổng Target × 8%

  // ----------------------------------------------------------
  // HSHT TDV - Hệ số hoàn thành target cho TDV (CSL cols 1-2)
  // [minPercent, hệ số] - VLOOKUP kiểu xấp xỉ (lấy giá trị ≤)
  // ----------------------------------------------------------
  HSHT_TDV: [
    { minPct: 0.00, hs: 0.0 },
    { minPct: 0.60, hs: 0.6 },
    { minPct: 0.80, hs: 0.8 },
    { minPct: 1.00, hs: 1.0 },
    { minPct: 1.15, hs: 1.1 },
    { minPct: 1.25, hs: 1.2 },
    { minPct: 1.35, hs: 1.3 },
  ],

  // ----------------------------------------------------------
  // HSHT QLBH - Hệ số hoàn thành target cho QLBH (CSL cols 4-5)
  // ----------------------------------------------------------
  HSHT_QLBH: [
    { minPct: 0.00, hs: 0.00 },
    { minPct: 0.60, hs: 0.50 },
    { minPct: 0.80, hs: 0.65 },
    { minPct: 0.90, hs: 0.80 },
    { minPct: 1.00, hs: 1.00 },
    { minPct: 1.10, hs: 1.28 },
    { minPct: 1.20, hs: 1.50 },
  ],

  // ----------------------------------------------------------
  // Hệ số ảnh hưởng Nhóm 1 (CSL cols 13-15)
  // Lookup theo % đạt N2
  // ----------------------------------------------------------
  HS_ANH_HUONG_N1: [
    { minPct: 0.00, hs: 0.0 },
    { minPct: 0.40, hs: 0.7 },
    { minPct: 0.60, hs: 0.8 },
    { minPct: 0.80, hs: 0.9 },
    { minPct: 1.00, hs: 1.0 },
  ],

  // ----------------------------------------------------------
  // Hệ số KH Công ty (CSL rows 27-30)
  // Lookup theo DS Công ty (VNĐ)
  // ----------------------------------------------------------
  HS_KH_CONG_TY: [
    { minDS: 0,           hs: 1.0 },
    { minDS: 200_000_000, hs: 0.8 },
    { minDS: 400_000_000, hs: 0.7 },
  ],

  // ----------------------------------------------------------
  // Ngưỡng ĐPKH / ĐPMH (DS >= 500K mới tính là 1 phủ)
  // ----------------------------------------------------------
  MIN_DS_PHU: 500_000,

  // ----------------------------------------------------------
  // ĐPMH – mã SP gộp chung doanh số trước khi đếm
  // Key = mã phụ → Value = mã đại diện của nhóm
  // ----------------------------------------------------------
  DPMH_GROUPS: {
    'TP027': 'TP026',
    'TP030': 'TP026',
    'TB012': 'TB011',
    'TB013': 'TB011',
    'TB014': 'TB011',
    'TB015': 'TB011',
    'TB016': 'TB011',
    'TB017': 'TB011',
    'TB018': 'TB011',
  },

  // ----------------------------------------------------------
  // SP chỉ định tháng (thay đổi mỗi tháng)
  // maSP: mã sản phẩm chỉ định (để trống = không áp dụng)
  // soLuongTarget: số lượng tối thiểu mỗi TDV phải bán
  // ----------------------------------------------------------
  SP_CHI_DINH: {
    maSP: '',
    soLuongTarget: 0,
    dpkhSpCdTarget: 0,
  },

  // ----------------------------------------------------------
  // Cấu hình Quý (thay đổi mỗi quý)
  // ----------------------------------------------------------
  QUY_CONFIG: {
    quyLabel: 'Q3/2026',
    thang1: 'T07',
    thang2: 'T08',
    thang3: 'T09',
  },

};

// Hàm VLOOKUP xấp xỉ (approximate match, sorted ascending)
// Trả về hệ số của hàng cao nhất mà minPct/minDS <= giá trị tra cứu
function vlookupApprox(value, table, keyField, valField) {
  let result = null;
  for (const row of table) {
    if (value >= row[keyField]) {
      result = row[valField];
    } else {
      break;
    }
  }
  return result;
}

function getHshtTDV(tyLe)      { return vlookupApprox(tyLe, CONFIG.HSHT_TDV,          'minPct', 'hs'); }
function getHshtQLBH(tyLe)     { return vlookupApprox(tyLe, CONFIG.HSHT_QLBH,         'minPct', 'hs'); }
function getHsAnhHuongN1(pct)  { return vlookupApprox(pct,  CONFIG.HS_ANH_HUONG_N1,   'minPct', 'hs'); }
function getHsKhCongTy(ds)     { return vlookupApprox(ds,   CONFIG.HS_KH_CONG_TY,     'minDS',  'hs'); }
