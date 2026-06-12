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
  const email = `${username.trim()}@kpi.local`;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: false }) }
  );
  const data = await res.json();
  if (data.error) {
    if (data.error.message === 'EMAIL_EXISTS') return 'exists';
    throw new Error(data.error.message);
  }
  await db.collection('users').doc(data.localId).set({
    role, maTDV: username, tenTDV, email,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  return 'created';
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
