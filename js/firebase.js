// ============================================================
// FIREBASE.JS - Auth + Firestore helpers
// ============================================================

const firebaseConfig = {
  apiKey:            "AIzaSyBJ4YEAzAxxdb8q9Xd18UQohhlLETNWmQQ",
  authDomain:        "kpi-meracine.firebaseapp.com",
  projectId:         "kpi-meracine",
  storageBucket:     "kpi-meracine.firebasestorage.app",
  messagingSenderId: "1013895481674",
  appId:             "1:1013895481674:web:1ff5f1f2ba2059b74d59b3",
};

firebase.initializeApp(firebaseConfig);
const db   = firebase.firestore();
const auth = firebase.auth();

async function fbLogin(username, password, remember) {
  const email = username.trim().includes('@') ? username.trim() : `${username.trim()}@kpi.local`;
  const persistence = remember ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION;
  await auth.setPersistence(persistence);
  const cred = await auth.signInWithEmailAndPassword(email, password);
  return cred.user;
}

async function fbLogout() { await auth.signOut(); }
function fbOnAuthChange(cb) { auth.onAuthStateChanged(cb); }

async function fbGetUserDoc(uid) {
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function fbSaveResults(results, quyMap, metaLabel, targets, companyKhMap, bangGiaMap) {
  const BATCH_SIZE = 400;
  for (let i = 0; i < results.length; i += BATCH_SIZE) {
    const batch = db.batch();
    results.slice(i, i + BATCH_SIZE).forEach(r => {
      const ref = db.collection('results').doc(r.maTDV);
      const doc = {};
      Object.entries(r).forEach(([k, v]) => {
        doc[k] = (v === undefined || v === null || (typeof v === 'number' && isNaN(v))) ? null : v;
      });
      doc.savedAt = firebase.firestore.FieldValue.serverTimestamp();
      batch.set(ref, doc);
    });
    await batch.commit();
  }
  const metaBatch = db.batch();
  metaBatch.set(db.collection('meta').doc('lastUpdate'), {
    label: metaLabel || '', count: results.length,
    savedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  if (quyMap)       metaBatch.set(db.collection('meta').doc('quyMap'),       { data: JSON.stringify(quyMap) });
  if (targets)      metaBatch.set(db.collection('meta').doc('targets'),      { data: JSON.stringify(targets) });
  if (companyKhMap) metaBatch.set(db.collection('meta').doc('companyKhMap'), { data: JSON.stringify(companyKhMap) });
  if (bangGiaMap)   metaBatch.set(db.collection('meta').doc('bangGiaMap'),   { data: JSON.stringify(bangGiaMap) });
  await metaBatch.commit();
}

async function fbLoadResults(qlbhCode) {
  let q = db.collection('results');
  if (qlbhCode) q = q.where('qlbhCode', '==', qlbhCode);
  const snap = await q.get();
  return snap.docs.map(d => ({ ...d.data(), maTDV: d.id }));
}

async function fbLoadMeta() {
  const snap = await db.collection('meta').doc('lastUpdate').get();
  return snap.exists ? snap.data() : null;
}

async function fbLoadQuyMap() {
  const snap = await db.collection('meta').doc('quyMap').get();
  if (!snap.exists) return null;
  try { return JSON.parse(snap.data().data); } catch { return null; }
}

async function fbLoadSupportingData() {
  const [tS, cS, bS] = await Promise.all([
    db.collection('meta').doc('targets').get(),
    db.collection('meta').doc('companyKhMap').get(),
    db.collection('meta').doc('bangGiaMap').get(),
  ]);
  return {
    targets:      tS.exists ? JSON.parse(tS.data().data) : null,
    companyKhMap: cS.exists ? JSON.parse(cS.data().data) : null,
    bangGiaMap:   bS.exists ? JSON.parse(bS.data().data) : null,
  };
}

async function fbSaveConfig(cfg) { await db.collection('config').doc('kpi').set(cfg); }
async function fbLoadConfig() {
  const snap = await db.collection('config').doc('kpi').get();
  return snap.exists ? snap.data() : null;
}

async function fbCreateOneAccount(maTDV, tenTDV, qlbhCode) {
  const email = `${maTDV}@kpi.local`;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: '123456', returnSecureToken: false }) }
  );
  const data = await res.json();
  if (data.error) {
    if (data.error.message === 'EMAIL_EXISTS') return 'exists';
    throw new Error(data.error.message);
  }
  await db.collection('users').doc(data.localId).set({
    role: 'qlbh', maTDV, tenTDV, qlbhCode: qlbhCode || maTDV, email,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  return 'created';
}

async function fbCreateSpecialAccount(username, password, tenTDV, role) {
  const email    = `${username.trim()}@kpi.local`;
  // TPKD dùng role 'admin' trong Firestore để được đọc toàn bộ results;
  // flag isTpkd phân biệt với admin thật trong app logic.
  const storeRole  = role === 'tpkd' ? 'admin' : role;
  const docFields  = { role: storeRole, maTDV: username.trim(), tenTDV, email,
                       ...(role === 'tpkd' ? { isTpkd: true } : {}) };

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: false }) }
  );
  const data = await res.json();

  if (data.error) {
    if (data.error.message === 'EMAIL_EXISTS') {
      // Tài khoản đã tồn tại — cập nhật Firestore doc (admin có quyền write)
      const snap = await db.collection('users').where('maTDV', '==', username.trim()).limit(1).get();
      if (!snap.empty) { await snap.docs[0].ref.update(docFields); return 'updated'; }
      return 'exists';
    }
    throw new Error(data.error.message);
  }

  await db.collection('users').doc(data.localId).set({
    ...docFields, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  return 'created';
}

async function fbChangeUserPassword(maTDV, currentPassword, newPassword) {
  const email = maTDV.trim().includes('@') ? maTDV.trim() : `${maTDV.trim()}@kpi.local`;
  // Sign in as the target user to get their idToken (uses REST API, does not affect current admin session)
  const signInRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: currentPassword, returnSecureToken: true }) }
  );
  const signInData = await signInRes.json();
  if (signInData.error) throw new Error('Sai mật khẩu hiện tại: ' + signInData.error.message);

  const updateRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${firebaseConfig.apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: signInData.idToken, password: newPassword, returnSecureToken: false }) }
  );
  const updateData = await updateRes.json();
  if (updateData.error) throw new Error(updateData.error.message);
}

async function fbSaveCheckIn(month, year, rows, allDays) {
  await db.collection('meta').doc('checkIn').set({
    month, year, allDays,
    rows: JSON.stringify(rows),
    savedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

async function fbLoadCheckIn() {
  const snap = await db.collection('meta').doc('checkIn').get();
  if (!snap.exists) return null;
  const d = snap.data();
  try {
    return { month: d.month, year: d.year, allDays: d.allDays || [], rows: JSON.parse(d.rows || '[]') };
  } catch { return null; }
}

// ── KH Mới: chunked save/load (Firestore doc limit ~1MB) ───────
const _KM_CHUNK = 2500; // items per chunk for dskhList

async function fbSaveKhMoiData(dskhList, donHang6Summary, currentDsMap) {
  // ── 1. Save dskhList in chunks ──────────────────────────────
  const dskhChunks = [];
  for (let i = 0; i < dskhList.length; i += _KM_CHUNK)
    dskhChunks.push(dskhList.slice(i, i + _KM_CHUNK));

  // Delete old chunk docs that may no longer be needed
  const oldMeta = await db.collection('meta').doc('khMoiDskh').get();
  if (oldMeta.exists && oldMeta.data().chunkCount) {
    const oldCount = oldMeta.data().chunkCount;
    if (oldCount > dskhChunks.length) {
      const delBatch = db.batch();
      for (let i = dskhChunks.length; i < oldCount; i++)
        delBatch.delete(db.collection('meta').doc(`khMoiDskh_c${i}`));
      await delBatch.commit();
    }
  }

  // Save new chunks in parallel (each is well under 1MB)
  await Promise.all(dskhChunks.map((chunk, i) =>
    db.collection('meta').doc(`khMoiDskh_c${i}`).set({ data: JSON.stringify(chunk) })
  ));
  // Save metadata last (signals write is complete)
  await db.collection('meta').doc('khMoiDskh').set({
    chunkCount: dskhChunks.length,
    total: dskhList.length,
    savedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });

  // ── 2. Save donHang6Summary (khMap is usually <1MB, chunk if needed) ──
  if (donHang6Summary) {
    const khEntries = Object.entries(donHang6Summary.khMap || {});
    const KH_CHUNK = 20000;
    const khChunks = [];
    for (let i = 0; i < khEntries.length; i += KH_CHUNK)
      khChunks.push(Object.fromEntries(khEntries.slice(i, i + KH_CHUNK)));

    if (khChunks.length <= 1) {
      // Small enough for single doc (old format, backwards-compat)
      await db.collection('meta').doc('khMoi6Thang').set({
        data: JSON.stringify(donHang6Summary),
        savedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      const old6 = await db.collection('meta').doc('khMoi6Thang').get();
      if (old6.exists && old6.data().khChunkCount > khChunks.length) {
        const delBatch = db.batch();
        for (let i = khChunks.length; i < old6.data().khChunkCount; i++)
          delBatch.delete(db.collection('meta').doc(`khMoi6Thang_c${i}`));
        await delBatch.commit();
      }
      await Promise.all(khChunks.map((chunk, i) =>
        db.collection('meta').doc(`khMoi6Thang_c${i}`).set({ data: JSON.stringify(chunk) })
      ));
      await db.collection('meta').doc('khMoi6Thang').set({
        khChunkCount: khChunks.length,
        months: JSON.stringify(donHang6Summary.months || []),
        savedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  // ── 3. Save currentDsMap (current month DS per KH) ─────────
  if (currentDsMap && Object.keys(currentDsMap).length > 0) {
    await db.collection('meta').doc('khMoiCurrentDs').set({
      data: JSON.stringify(currentDsMap),
      savedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }
}

async function fbLoadKhMoiData() {
  const [dskhSnap, dh6Snap, cdSnap] = await Promise.all([
    db.collection('meta').doc('khMoiDskh').get(),
    db.collection('meta').doc('khMoi6Thang').get(),
    db.collection('meta').doc('khMoiCurrentDs').get(),
  ]);

  // ── Load dskhList ───────────────────────────────────────────
  let dskhList = null;
  if (dskhSnap.exists) {
    const m = dskhSnap.data();
    if (m.chunkCount) {
      // New chunked format
      const snaps = await Promise.all(
        Array.from({ length: m.chunkCount }, (_, i) =>
          db.collection('meta').doc(`khMoiDskh_c${i}`).get()
        )
      );
      dskhList = snaps.flatMap(s => s.exists ? JSON.parse(s.data().data || '[]') : []);
    } else {
      // Old single-doc format
      dskhList = JSON.parse(m.data || '[]');
    }
  }

  // ── Load donHang6Summary ────────────────────────────────────
  let donHang6Summary = null;
  if (dh6Snap.exists) {
    const m = dh6Snap.data();
    if (m.khChunkCount) {
      // Chunked khMap format
      const snaps = await Promise.all(
        Array.from({ length: m.khChunkCount }, (_, i) =>
          db.collection('meta').doc(`khMoi6Thang_c${i}`).get()
        )
      );
      const khMap = Object.assign({}, ...snaps.map(s => s.exists ? JSON.parse(s.data().data || '{}') : {}));
      donHang6Summary = { khMap, months: JSON.parse(m.months || '[]') };
    } else {
      // Old single-doc format
      donHang6Summary = JSON.parse(m.data || '{}');
    }
  }

  // ── Load currentDsMap ───────────────────────────────────────
  let currentDsMap = null;
  if (cdSnap.exists) {
    try { currentDsMap = JSON.parse(cdSnap.data().data || '{}'); } catch { currentDsMap = null; }
  }

  return { dskhList, donHang6Summary, currentDsMap };
}

async function fbCreateQLBHAccounts(targets) {
  const qlbhList = targets.filter(t => t.doiTuong && t.doiTuong.trim().toUpperCase() === 'QLBH');
  const out = [];
  for (const t of qlbhList) {
    try {
      const status = await fbCreateOneAccount(t.maTDV, t.tenTDV, t.maTDV);
      out.push({ maTDV: t.maTDV, tenTDV: t.tenTDV, status });
    } catch(e) {
      out.push({ maTDV: t.maTDV, tenTDV: t.tenTDV, status: 'lỗi: ' + e.message });
    }
  }
  return out;
}
