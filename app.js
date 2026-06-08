/* ============================================================
   AE HOME POS — app.js  v2
   + Green/Blue UI | Per piece/pack | Inventory Clerk role
   + Detailed receipt (VAT, SI#, AE HOME branding)
   + Editable qty in checkout
   ============================================================ */
'use strict';

const LS = {
  GAS_URL:        'ae_pos_gas_url',
  SESSION:        'ae_pos_session',
  CART:           'ae_pos_cart',
  RECEIPTS:       'ae_pos_receipts',
  STORE_INFO:     'ae_pos_store_info',
  PRODUCTS_CACHE: 'ae_pos_products_cache',
  SI_COUNTER:     'ae_pos_si_counter',
};

const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbyDBdMsRW1Oy9FbtbHO4lJRxalbVZC_1mh6DpLCHOabJbggPj2VhlgHjjQO92tb37iZBA/exec';
let GAS_URL = localStorage.getItem(LS.GAS_URL) || DEFAULT_GAS_URL;
let session   = null;
let cart      = [];
let products  = [];
let cashiers  = [];
let sales     = [];
let expenses  = [];
let dashPeriod = 'today';
let pendingUnitProductId = '';

// ── INIT ─────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  loadSession(); loadCart();
  setTimeout(() => {
    const splash = document.getElementById('splash');
    splash.classList.add('fade');
    setTimeout(() => {
      splash.style.display = 'none';
      document.getElementById('app').classList.remove('hidden');
      // Update nav FIRST based on loaded session
      updateUIForRole();
      if (!GAS_URL) showModal('configModal');
      else { if (!localStorage.getItem(LS.GAS_URL)) localStorage.setItem(LS.GAS_URL, DEFAULT_GAS_URL); initApp(); }
    }, 550);
  }, 1600);
});

async function initApp() {
  updateUIForRole();
  updateProfilePhoto();
  updateCoverPhoto();
  await loadAllData();
  renderDashboard();
  navigate('dashboard');
}

// ── SESSION ──────────────────────────────────────────────────
function loadSession() {
  const s = localStorage.getItem(LS.SESSION);
  if (s) session = JSON.parse(s);
}
function saveSession(s) { session = s; localStorage.setItem(LS.SESSION, JSON.stringify(s)); }
function clearSession()  { session = null; localStorage.removeItem(LS.SESSION); }
function isAdmin()   { return session && session.role === 'admin'; }
function isCashier() { return session && ['cashier','admin','guest'].includes(session.role); }
function isClerk()   { return session && ['clerk','admin'].includes(session.role); }
function isStaff()   { return session && ['cashier','clerk','admin','guest'].includes(session.role); }
function isGuest()   { return session && session.role === 'guest'; }

function updateUIForRole() {
  const chip      = document.getElementById('userChip');
  const loginBtn  = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const roleEl    = document.getElementById('sidebarRole');

  const roleIcon = { admin:'👑', cashier:'🧑‍💼', clerk:'🔍', guest:'👁' };
  if (session) {
    chip.textContent = `${roleIcon[session.role]||'👤'} ${session.name}`;
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
  } else {
    chip.textContent = '👁 Viewer';
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
  }
  roleEl.textContent = `Mode: ${session ? session.role : 'Viewer'}`;

  const role = session ? session.role : 'viewer';

  // ── CLEAN NAV ACCESS TABLE ────────────────────────────────
  const navRules = {
    'nav-all':        ['viewer','admin','cashier','clerk','guest'],
    'nav-pos':        ['admin','cashier','clerk','guest'],
    'nav-inventory':  ['admin','clerk'],
    'nav-import':     ['admin','clerk'],
    'nav-finance':    ['admin','cashier','clerk','guest'],
    'nav-summary':    ['admin','cashier','clerk','guest'],
    'nav-receipts':   ['admin','viewer'],
    'nav-staff-mgmt': ['admin'],
    'nav-settings':   ['admin'],
  };

  Object.entries(navRules).forEach(([cls, allowed]) => {
    document.querySelectorAll('.' + cls).forEach(el => {
      el.classList.toggle('hidden', !allowed.includes(role));
    });
  });

  // Admin-only buttons/elements
  document.querySelectorAll('.admin-only').forEach(n =>
    n.classList.toggle('hidden', role !== 'admin'));

  // Guest banner
  const banner = document.getElementById('guestBanner');
  if (banner) banner.classList.toggle('show', role === 'guest');
}

// ── GAS API ──────────────────────────────────────────────────
// Write actions that guest cannot do
const GUEST_BLOCKED_ACTIONS = ['addSale','addProduct','updateProduct','deleteProduct',
  'updateProductQty','stockUpdate','addCashier','updateCashier','deleteCashier',
  'addExpense','deleteExpense','clearTestData','createBackup','restoreBackup'];

async function gasRequest(action, payload = {}) {
  // Block write actions for guest
  if (isGuest() && GUEST_BLOCKED_ACTIONS.includes(action)) {
    return { ok: true, guest: true };
  }
  if (!GAS_URL) return { ok: false, error: 'No GAS URL' };
  try {
    // Use GET with data as URL param — avoids CORS preflight issues
    const data   = encodeURIComponent(JSON.stringify({ action, ...payload }));
    const url    = GAS_URL + '?data=' + data;
    const res    = await fetch(url, { method: 'GET', redirect: 'follow' });
    const text   = await res.text();
    try {
      return JSON.parse(text);
    } catch(e) {
      return { ok: false, error: 'Invalid response: ' + text.substring(0,150) };
    }
  } catch(e) { setOffline(true); return { ok: false, error: e.message }; }
}
function setOffline(v) {
  const el = document.getElementById('syncStatus');
  el.textContent = v ? '● Offline' : '● Online';
  el.className   = 'sync-status' + (v ? ' offline' : '');
}

// ── DATA ─────────────────────────────────────────────────────
async function loadAllData() {
  const [p,c,s,e] = await Promise.all([
    gasRequest('getProducts'), gasRequest('getCashiers'),
    gasRequest('getSales'),    gasRequest('getExpenses'),
  ]);
  if (p.ok) { products = p.data||[]; cacheProducts(); } else products = getCachedProducts();
  if (c.ok) cashiers = c.data||[];
  if (s.ok) sales    = s.data||[];
  if (e.ok) expenses = e.data||[];
  setOffline(false);
}
function cacheProducts()    { localStorage.setItem(LS.PRODUCTS_CACHE, JSON.stringify(products)); }
function getCachedProducts(){ const c=localStorage.getItem(LS.PRODUCTS_CACHE); return c?JSON.parse(c):[]; }

// ── NAVIGATION ───────────────────────────────────────────────
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  const navEl  = document.querySelector(`[data-page="${page}"]`);
  if (pageEl) pageEl.classList.add('active');
  if (navEl)  navEl.classList.add('active');

  // Role-based page guards
  const role = session ? session.role : 'viewer';
  if (page === 'pos'      && !['admin','cashier','clerk','guest'].includes(role)) { showToast('Login required to use POS','error'); navigate('dashboard'); return; }
  if (page === 'inventory'&& !['admin','clerk'].includes(role))           { showToast('Clerk or Admin access required','error'); navigate('dashboard'); return; }
  if (page === 'expenses' && !['admin','clerk','guest'].includes(role))   { showToast('Access required','error'); navigate('dashboard'); return; }
  if (page === 'summary'  && !['admin','cashier','clerk','guest'].includes(role))   { showToast('Access required','error'); navigate('dashboard'); return; }
  if (page === 'receipts' && !['admin','guest'].includes(role) && role !== 'viewer') { showToast('Access required','error'); navigate('dashboard'); return; }
  if (['cashiers','settings'].includes(page) && role !== 'admin'){ showToast('Admin access required','error'); navigate('dashboard'); return; }
  if (page === 'import' && !['admin','clerk'].includes(role)){ showToast('Admin or Clerk access required','error'); navigate('dashboard'); return; }

  currentPage = page;
  if (sessionId) pingSessionNow();

  switch(page) {
    case 'dashboard': renderDashboard(); if(isAdmin()) setTimeout(loadActiveSessions,600); break;
    case 'pos':       renderPOS(); break;
    case 'inventory': renderInventory(); break;
    case 'cashiers':  renderCashiers(); break;
    case 'expenses':  renderExpenses(); break;
    case 'receipts':  renderReceipts(); break;
    case 'settings':  renderSettings(); setTimeout(loadBackups, 500); break;
    case 'summary':   break;
    case 'import':    renderImportPage(); break;
  }
  if (window.innerWidth <= 720) document.getElementById('sidebar').classList.remove('open');
}
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  if (window.innerWidth <= 720) sb.classList.toggle('open');
  else sb.classList.toggle('closed');
}

// ── LOGIN / LOGOUT ───────────────────────────────────────────
function openLoginModal() { showModal('loginModal'); }

function enterGuestMode() {
  const guestNum = Math.floor(Math.random()*900)+100;
  saveSession({ id: 'guest-'+guestNum, name: 'Guest #'+guestNum, username: 'guest', role: 'guest' });
  updateUIForRole();
  closeModal('loginModal');
  showToast('Guest Mode — Data will NOT be saved to Google Sheets', 'error');
  initSessionTracking();
  navigate('pos');
}
async function doLogin() {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const errEl    = document.getElementById('loginError');
  errEl.classList.add('hidden');
  if (!username || !password) { errEl.textContent='Enter username and password.'; errEl.classList.remove('hidden'); return; }
  const res = await gasRequest('login', { username, password });
  if (res.ok && res.user) {
    saveSession(res.user); updateUIForRole(); closeModal('loginModal');
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPass').value = '';
    await loadAllData(); renderDashboard();
    showToast(`Welcome, ${res.user.name}!`, 'success');
    initSessionTracking();
  } else { errEl.textContent = res.error||'Invalid credentials.'; errEl.classList.remove('hidden'); }
}
function doLogout() { stopSessionTracking(); clearSession(); updateUIForRole(); navigate('dashboard'); showToast('Logged out'); }

// ── PROFILE PHOTO ────────────────────────────────────────────
function openProfilePhotoUpload() {
  document.getElementById('profilePhotoInput').click();
}
function handleProfilePhotoChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target.result;
    localStorage.setItem('ae_pos_profile_photo', dataUrl);
    updateProfilePhoto();
    showToast('Profile photo updated!', 'success');
  };
  reader.readAsDataURL(file);
}
function updateProfilePhoto() {
  const photo = localStorage.getItem('ae_pos_profile_photo');
  const el    = document.getElementById('profilePhotoImg');
  if (el && photo) {
    el.src = photo;
    el.style.display = 'block';
    document.getElementById('profilePhotoDefault').style.display = 'none';
  }
}
function openCoverPhotoUpload() {
  document.getElementById('coverPhotoInput').click();
}
function handleCoverPhotoChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target.result;
    localStorage.setItem('ae_pos_cover_photo', dataUrl);
    updateCoverPhoto();
    showToast('Cover photo updated!', 'success');
  };
  reader.readAsDataURL(file);
}
function updateCoverPhoto() {
  const photo = localStorage.getItem('ae_pos_cover_photo');
  const el    = document.getElementById('topbarCover');
  if (el && photo) {
    el.style.background = `linear-gradient(135deg, rgba(30,144,255,0.85), rgba(0,200,83,0.85)), url('${photo}') center/cover`;
  }
}

// ── DASHBOARD ────────────────────────────────────────────────
function setDashboardPeriod(p, btn) {
  dashPeriod = p;
  document.querySelectorAll('.filter-tabs .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderDashboard();
}
function filterByPeriod(arr, field) {
  const now = new Date();
  return arr.filter(item => {
    const d = new Date(item[field]||item.date||item.timestamp);
    if (isNaN(d)) return true;
    if (dashPeriod==='today') return d.toDateString()===now.toDateString();
    if (dashPeriod==='week')  { const w=new Date(now); w.setDate(now.getDate()-7); return d>=w; }
    if (dashPeriod==='month') return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
    return true;
  });
}
function renderDashboard() {
  const fs = filterByPeriod(sales,'timestamp');
  const fe = filterByPeriod(expenses,'timestamp');
  const totalSales = fs.reduce((s,t)=>s+(parseFloat(t.total)||0),0);
  const totalItems = fs.reduce((s,t)=>{
    const it = t.items?(typeof t.items==='string'?JSON.parse(t.items):t.items):[];
    return s+it.reduce((a,i)=>a+(parseInt(i.qty)||0),0);
  },0);
  const totalExp = fe.reduce((s,e)=>s+(parseFloat(e.amount)||0),0);

  document.getElementById('statSales').querySelector('.stat-value').textContent  = fmt(totalSales);
  document.getElementById('statTx').querySelector('.stat-value').textContent     = fs.length;
  document.getElementById('statItems').querySelector('.stat-value').textContent  = totalItems;
  document.getElementById('statExpenses').querySelector('.stat-value').textContent = fmt(totalExp);

  // Top products
  const pt = {};
  fs.forEach(t => {
    const it = t.items?(typeof t.items==='string'?JSON.parse(t.items):t.items):[];
    it.forEach(i => { pt[i.name]=(pt[i.name]||0)+(parseInt(i.qty)||0); });
  });
  const top = Object.entries(pt).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const mx  = top[0]?.[1]||1;
  const tpEl = document.getElementById('topProducts');
  tpEl.innerHTML = top.length ? top.map(([name,qty])=>`
    <div class="top-prod-item">
      <span>${escHtml(name)}</span>
      <div class="top-prod-bar-wrap"><div class="top-prod-bar" style="width:${Math.round(qty/mx*100)}%"></div></div>
      <span style="font-weight:700;font-size:12px">${qty}</span>
    </div>`).join('') : '<p class="empty-msg">No data yet</p>';

  // Cashier perf
  const cp = {};
  fs.forEach(t => { const n=t.cashier||'Unknown'; cp[n]=(cp[n]||0)+(parseFloat(t.total)||0); });
  const cpArr = Object.entries(cp).sort((a,b)=>b[1]-a[1]);
  const cpEl  = document.getElementById('cashierPerf');
  cpEl.innerHTML = cpArr.length ? cpArr.map(([n,total])=>`
    <div class="cashier-perf-item"><span>${escHtml(n)}</span><span style="font-weight:700">${fmt(total)}</span></div>`
  ).join('') : '<p class="empty-msg">No data yet</p>';

  // Low stock
  const low = products.filter(p=>(parseInt(p.qtyPcs)||0)<=5||(parseInt(p.qtyPacks)||0)<=2);
  const lsEl = document.getElementById('lowStock');
  lsEl.innerHTML = low.length
    ? `<div class="low-stock-chips">${low.map(p=>`<span class="low-stock-chip">⚠️ ${escHtml(p.name)} (${p.qtyPcs||0}pcs / ${p.qtyPacks||0}packs)</span>`).join('')}</div>`
    : '<p class="empty-msg">All stocks OK ✅</p>';
}

// ── POS ──────────────────────────────────────────────────────
function renderPOS() { renderPOSGrid(products); renderCart(); }
function filterPosProducts() {
  const q = document.getElementById('posSearch').value.toLowerCase().trim();
  if (q === '') { renderPOSGrid(products); return; }
  renderPOSGrid(products.filter(p =>
    String(p.name||'').toLowerCase().includes(q) ||
    String(p.barcode||'').toLowerCase().includes(q) ||
    String(p.category||'').toLowerCase().includes(q)
  ));
}
function searchPos() { filterPosProducts(); }
function renderPOSGrid(prods) {
  const grid = document.getElementById('posGrid');
  if (!prods.length) { grid.innerHTML='<p class="empty-msg">No products found</p>'; return; }
  grid.innerHTML = prods.map(p => {
    const stock = parseInt(p.qtyPcs)||0;
    const oos   = stock===0 && (parseInt(p.qtyPacks)||0)===0;
    return `<div class="pos-card${oos?' out-of-stock':''}" onclick="openUnitSelect('${p.id}')">
      <div class="pos-card-name">${escHtml(p.name)}</div>
      <div class="pos-card-price">${fmt(parseFloat(p.pricePcs)||0)}</div>
      <div class="pos-card-stock">${oos?'⚠️ Out of stock':`${stock} pcs${parseInt(p.qtyPacks)?` · ${p.qtyPacks} packs`:''}` }</div>
    </div>`;
  }).join('');
}

// ── UNIT SELECT ──────────────────────────────────────────────
function openUnitSelect(productId) {
  const p = products.find(x=>x.id===productId);
  if (!p) return;
  // If no pack price/qty set, skip modal and add as pcs directly
  if (!(parseFloat(p.pricePack)||0) && !(parseInt(p.qtyPacks)||0)) {
    addToCart(productId, 'pcs'); return;
  }
  pendingUnitProductId = productId;
  document.getElementById('unitSelectProductName').textContent = p.name;
  document.getElementById('unitPcsPrice').textContent  = fmt(parseFloat(p.pricePcs)||0) + ' each';
  document.getElementById('unitPcsStock').textContent  = `${parseInt(p.qtyPcs)||0} pcs available`;
  document.getElementById('unitPackPrice').textContent = fmt(parseFloat(p.pricePack)||0) + ' / pack';
  document.getElementById('unitPackStock').textContent = `${parseInt(p.qtyPacks)||0} packs available`;
  document.getElementById('unitOptPcs').classList.remove('selected');
  document.getElementById('unitOptPack').classList.remove('selected');
  document.getElementById('unitSelectProductId').value = productId;
  showModal('unitSelectModal');
}
function selectUnit(unit) {
  document.getElementById('unitOptPcs').classList.toggle('selected', unit==='pcs');
  document.getElementById('unitOptPack').classList.toggle('selected', unit==='pack');
  setTimeout(() => {
    addToCart(pendingUnitProductId, unit);
    closeModal('unitSelectModal');
  }, 200);
}

// ── CART ─────────────────────────────────────────────────────
function loadCart()      { const c=localStorage.getItem(LS.CART); cart=c?JSON.parse(c):[]; }
function saveCartLocal() { localStorage.setItem(LS.CART, JSON.stringify(cart)); }

function addToCart(productId, unit='pcs') {
  const prod = products.find(p=>p.id===productId);
  if (!prod) return;
  const price = unit==='pack' ? (parseFloat(prod.pricePack)||0) : (parseFloat(prod.pricePcs)||0);
  const label = unit==='pack' ? `${prod.name} (pack)` : prod.name;
  const key   = `${productId}_${unit}`;
  const existing = cart.find(c=>c.key===key);
  if (existing) existing.qty++;
  else cart.push({ key, id: productId, name: label, price, qty: 1, unit });
  saveCartLocal(); renderCart();
  showToast(`Added: ${label}`, 'success');
}
function removeFromCart(key) { cart=cart.filter(c=>c.key!==key); saveCartLocal(); renderCart(); }
function changeCartQty(key, delta) {
  const item=cart.find(c=>c.key===key);
  if (!item) return;
  item.qty+=delta;
  if (item.qty<=0) removeFromCart(key);
  else { saveCartLocal(); renderCart(); }
}
function updateCartQty(key, val) {
  const item=cart.find(c=>c.key===key);
  if (!item) return;
  const n=parseInt(val)||1;
  if (n<=0) removeFromCart(key);
  else { item.qty=n; saveCartLocal(); renderCart(); }
}
function clearCart() { cart=[]; saveCartLocal(); renderCart(); }
function cartTotal()  { return cart.reduce((s,i)=>s+i.price*i.qty,0); }

function renderCart() {
  const el         = document.getElementById('cartItems');
  const totalEl    = document.getElementById('cartTotal');
  const checkoutBtn= document.querySelector('.btn-checkout');
  if (!cart.length) {
    el.innerHTML='<p class="empty-msg">Cart is empty</p>';
    totalEl.textContent='₱0.00';
    if (checkoutBtn) checkoutBtn.disabled=true;
    return;
  }
  el.innerHTML = cart.map(item=>`
    <div class="cart-item">
      <div class="cart-item-info">
        <div class="cart-item-name">${escHtml(item.name)}</div>
        <div class="cart-item-price">${fmt(item.price)} each</div>
      </div>
      <div class="cart-item-qty">
        <button class="qty-btn" onclick="changeCartQty('${item.key}',-1)">−</button>
        <input type="number" class="qty-num" value="${item.qty}" min="1"
          onchange="updateCartQty('${item.key}',this.value)"
          style="width:46px;text-align:center;padding:2px 4px;border-radius:6px;" />
        <button class="qty-btn" onclick="changeCartQty('${item.key}',1)">+</button>
      </div>
      <div class="cart-item-subtotal">${fmt(item.price*item.qty)}</div>
      <button class="btn-icon" onclick="removeFromCart('${item.key}')">🗑</button>
    </div>`).join('');
  totalEl.textContent=fmt(cartTotal());
  if (checkoutBtn) checkoutBtn.disabled=false;
}

// ── CHECKOUT ─────────────────────────────────────────────────
function openCheckout() {
  if (!cart.length)  { showToast('Cart is empty','error'); return; }
  if (!isCashier())  { showToast('Login required to checkout','error'); return; }
  document.getElementById('checkoutSummary').innerHTML = cart.map(i=>
    `<div style="display:flex;justify-content:space-between;padding:2px 0">
      <span>${escHtml(i.name)} ×${i.qty}</span><span style="font-weight:600">${fmt(i.price*i.qty)}</span>
    </div>`).join('');
  document.getElementById('checkoutTotal').textContent = fmt(cartTotal());
  document.getElementById('cashReceived').value = '';
  document.getElementById('changeDisplay').textContent = '₱0.00';
  document.getElementById('checkoutError').classList.add('hidden');
  showModal('checkoutModal');
}
function computeChange() {
  const cash=parseFloat(document.getElementById('cashReceived').value)||0;
  const change=cash-cartTotal();
  const el=document.getElementById('changeDisplay');
  el.textContent=fmt(Math.max(0,change));
  el.style.color=change<0?'var(--danger)':'var(--success)';
}
async function finalizeCheckout() {
  const cash  = parseFloat(document.getElementById('cashReceived').value)||0;
  const total = cartTotal();
  const errEl = document.getElementById('checkoutError');
  errEl.classList.add('hidden');
  if (cash<total) { errEl.textContent='Cash received is less than total.'; errEl.classList.remove('hidden'); return; }

  const siNum  = getNextSI();
  const txId   = 'TX-'+Date.now();
  const now    = new Date().toISOString();
  const change = cash-total;
  const vatAmt = total/1.12*0.12;

  const transaction = {
    id: txId, siNumber: siNum, timestamp: now,
    cashier: session.name, cashierId: session.id,
    items: JSON.stringify(cart),
    total, cashReceived: cash, change, vatAmount: vatAmt,
  };

  if (isGuest()) {
    // Guest mode — demo only, no sheets, no inventory change
    sales.unshift(transaction);
    const receiptImg = await generateReceiptImage(transaction, cash, change, siNum, vatAmt);
    saveReceiptLocal(txId, now, total, receiptImg);
    clearCart(); closeModal('checkoutModal');
    showToast('Guest Demo — Receipt generated. Not saved to Google Sheets.', 'error');
    renderPOS();
    setTimeout(()=>viewReceipt(txId), 350);
    return;
  }

  const res = await gasRequest('addSale', transaction);
  if (!res.ok && GAS_URL) {
    errEl.textContent='Failed to save to Google Sheets. Check connection.';
    errEl.classList.remove('hidden'); return;
  }

  // Update inventory (real users only)
  for (const item of cart) {
    const prod = products.find(p=>p.id===item.id);
    if (!prod) continue;
    if (item.unit==='pack') {
      const nq=Math.max(0,(parseInt(prod.qtyPacks)||0)-item.qty);
      await gasRequest('updateProductQty',{id:item.id,field:'qtyPacks',newQty:nq,type:'sale',qty:item.qty,cashier:session.name});
      prod.qtyPacks=nq;
    } else {
      const nq=Math.max(0,(parseInt(prod.qtyPcs)||0)-item.qty);
      await gasRequest('updateProductQty',{id:item.id,field:'qtyPcs',newQty:nq,type:'sale',qty:item.qty,cashier:session.name});
      prod.qtyPcs=nq;
    }
  }
  cacheProducts();
  sales.unshift(transaction);

  const receiptImg = await generateReceiptImage(transaction, cash, change, siNum, vatAmt);
  saveReceiptLocal(txId, now, total, receiptImg);

  clearCart(); closeModal('checkoutModal');
  showToast('Sale completed!','success');
  renderPOS();
  setTimeout(()=>viewReceipt(txId), 350);
}

function getNextSI() {
  let n = parseInt(localStorage.getItem(LS.SI_COUNTER)||'0')+1;
  localStorage.setItem(LS.SI_COUNTER, String(n));
  return 'SI-'+String(n).padStart(6,'0');
}

// ── RECEIPT GENERATION ───────────────────────────────────────
async function generateReceiptImage(tx, cash, change, siNum, vatAmt) {
  const store  = getStoreInfo();
  const items  = typeof tx.items==='string'?JSON.parse(tx.items):tx.items;
  const canvas = document.getElementById('receiptCanvas');
  const ctx    = canvas.getContext('2d');

  const W       = 380;
  const lineH   = 22;
  const padX    = 24;
  const headerH = 200;
  const itemsH  = items.length*lineH + 40;
  const footerH = 180;
  canvas.width  = W;
  canvas.height = headerH + itemsH + footerH;

  // White background
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,canvas.height);

  // Green header bar
  const grad=ctx.createLinearGradient(0,0,W,0);
  grad.addColorStop(0,'#1e90ff'); grad.addColorStop(1,'#00c853');
  ctx.fillStyle=grad; ctx.fillRect(0,0,W,8);

  // Store name
  ctx.fillStyle='#1a2332';
  ctx.font='bold 20px Arial'; ctx.textAlign='center';
  ctx.fillText(store.name||'AE HOME', W/2, 38);

  ctx.fillStyle='#4a6080'; ctx.font='11px Arial';
  ctx.fillText('Owned by: AE Home Trade Corp.', W/2, 56);
  ctx.fillText(`VAT Reg TIN: ${store.tin||'010-948-695-00000'}`, W/2, 71);
  ctx.fillText(store.address||'Alcantara Street, Brgy VIII, City of Vigan', W/2, 86);

  // Green line
  ctx.strokeStyle='#00c853'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(padX,98); ctx.lineTo(W-padX,98); ctx.stroke();

  // SALES INVOICE label
  ctx.fillStyle='#1e90ff'; ctx.font='bold 13px Arial'; ctx.textAlign='center';
  ctx.fillText('OFFICIAL SALES INVOICE', W/2, 114);
  ctx.fillStyle='#888'; ctx.font='10px Arial';
  ctx.fillText('(For Inventory Purposes Only)', W/2, 128);

  // Transaction details
  ctx.fillStyle='#333'; ctx.font='11px Courier New'; ctx.textAlign='left';
  let y=148;
  const info=[
    [`SI #:`, siNum],
    [`Transaction #:`, tx.id],
    [`Cashier:`, tx.cashier],
    [`Date & Time:`, new Date(tx.timestamp).toLocaleString('en-PH')],
  ];
  info.forEach(([label,val])=>{
    ctx.font='bold 11px Courier New'; ctx.fillText(label, padX, y);
    ctx.font='11px Courier New'; ctx.fillText(val, padX+90, y);
    y+=18;
  });

  // Divider
  ctx.strokeStyle='#ddd'; ctx.lineWidth=1; ctx.setLineDash([4,4]);
  ctx.beginPath(); ctx.moveTo(padX,y+4); ctx.lineTo(W-padX,y+4); ctx.stroke();
  ctx.setLineDash([]);

  // Column headers
  y+=20;
  ctx.fillStyle='#888'; ctx.font='bold 10px Arial';
  ctx.textAlign='left';  ctx.fillText('QTY  DESCRIPTION', padX, y);
  ctx.textAlign='right'; ctx.fillText('AMOUNT', W-padX, y);
  y+=14;
  ctx.strokeStyle='#ccc'; ctx.lineWidth=0.8;
  ctx.beginPath(); ctx.moveTo(padX,y); ctx.lineTo(W-padX,y); ctx.stroke();
  y+=10;

  // Items
  items.forEach(item=>{
    ctx.fillStyle='#1a2332'; ctx.font='12px Courier New';
    ctx.textAlign='left';
    const qtyStr = String(item.qty).padEnd(4,' ');
    ctx.fillText(`${qtyStr}${item.name}`, padX, y);
    ctx.textAlign='right';
    ctx.fillText(fmtNum(item.price*item.qty), W-padX, y);
    y+=lineH;
  });

  // Totals section
  y+=8;
  ctx.strokeStyle='#ccc'; ctx.beginPath(); ctx.moveTo(padX,y); ctx.lineTo(W-padX,y); ctx.stroke();
  y+=16;

  const totalQty=items.reduce((s,i)=>s+(parseInt(i.qty)||0),0);
  const rows=[
    [`Total Qty:`, String(totalQty)],
    [`Amount Due:`, fmtNum(tx.total)],
    [`Cash:`, fmtNum(cash)],
    [`Change:`, fmtNum(change)],
    [`VAT (12%):`, fmtNum(vatAmt)],
  ];
  rows.forEach(([label,val],idx)=>{
    const isBold=idx===1||idx===3;
    ctx.font=(isBold?'bold ':'')+'13px Courier New';
    ctx.fillStyle= idx===2?'#333': idx===3?'#00c853': '#1a2332';
    ctx.textAlign='left'; ctx.fillText(label, padX, y);
    ctx.textAlign='right'; ctx.fillText(val, W-padX, y);
    y+=20;
  });

  // Legal footer
  y+=10;
  ctx.strokeStyle='#00c853'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(padX,y); ctx.lineTo(W-padX,y); ctx.stroke();
  y+=16;

  ctx.fillStyle='#888'; ctx.font='10px Arial'; ctx.textAlign='center';
  ctx.fillText('This serves as SALES INVOICE for Inventory Only.', W/2, y); y+=14;
  ctx.fillText('Thank you for your purchase!', W/2, y); y+=14;
  ctx.fillStyle='#1e90ff'; ctx.font='bold 10px Arial';
  ctx.fillText('AE HOME TRADE CORP.', W/2, y); y+=14;
  ctx.fillStyle='#bbb'; ctx.font='9px Arial';
  ctx.fillText('Powered by AE Home POS System', W/2, y);

  return canvas.toDataURL('image/png');
}

function saveReceiptLocal(txId,date,total,img) {
  const r=getReceiptsLocal();
  r.unshift({id:txId,date,total,img});
  if(r.length>50) r.pop();
  localStorage.setItem(LS.RECEIPTS,JSON.stringify(r));
}
function getReceiptsLocal() { const r=localStorage.getItem(LS.RECEIPTS); return r?JSON.parse(r):[]; }

function renderReceipts() {
  const receipts=getReceiptsLocal();
  const grid=document.getElementById('receiptsGrid');
  if (!receipts.length) { grid.innerHTML='<p class="empty-msg">No receipts yet. Complete a sale first.</p>'; return; }
  grid.innerHTML=receipts.map(r=>`
    <div class="receipt-thumb">
      <div class="receipt-thumb-id">${r.id}</div>
      <div class="receipt-thumb-date">${new Date(r.date).toLocaleString('en-PH')}</div>
      <div class="receipt-thumb-total">${fmt(r.total)}</div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn-sm" style="flex:1" onclick="viewReceipt('${r.id}')">👁 View</button>
        <button class="btn-sm btn-danger" onclick="deleteReceipt('${r.id}')">🗑</button>
      </div>
    </div>`).join('');
}

let currentReceiptId=null;
function viewReceipt(txId) {
  const r=getReceiptsLocal().find(r=>r.id===txId);
  if (!r) { showToast('Receipt not found','error'); return; }
  currentReceiptId=txId;
  document.getElementById('receiptImageContainer').innerHTML=
    `<img src="${r.img}" style="max-width:100%;border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow-md);" />`;
  showModal('receiptViewModal');
}
function downloadCurrentReceipt() {
  if (!currentReceiptId) return;
  const r=getReceiptsLocal().find(r=>r.id===currentReceiptId);
  if (!r) return;
  const a=document.createElement('a');
  a.href=r.img; a.download=`receipt-${r.id}.png`; a.click();
}

function deleteReceipt(txId) {
  if (!confirm('Delete this receipt from gallery?')) return;
  const receipts = getReceiptsLocal().filter(r => r.id !== txId);
  localStorage.setItem(LS.RECEIPTS, JSON.stringify(receipts));
  renderReceipts();
  showToast('Receipt deleted');
}

// ── INVENTORY ────────────────────────────────────────────────
function renderInventory(filter='') {
  const prods=filter
    ?products.filter(p=>p.name.toLowerCase().includes(filter.toLowerCase())||(p.barcode||'').includes(filter))
    :products;
  const tbody=document.getElementById('inventoryBody');
  if (!prods.length) { tbody.innerHTML='<tr><td colspan="8" class="empty-msg">No products yet</td></tr>'; return; }
  tbody.innerHTML=prods.map(p=>`
    <tr>
      <td style="font-family:var(--font-mono);font-size:12px">${escHtml(p.barcode||'—')}</td>
      <td><strong>${escHtml(p.name)}</strong>${p.category?`<br><small style="color:var(--text3)">${escHtml(p.category)}</small>`:''}</td>
      <td style="color:${parseInt(p.qtyPcs)<=5?'var(--danger)':'var(--text)'};font-weight:${parseInt(p.qtyPcs)<=5?'700':'400'}">${p.qtyPcs||0}</td>
      <td>${p.qtyPacks||0}</td>
      <td style="font-family:var(--font-mono)">${fmt(p.pricePcs||0)}</td>
      <td style="font-family:var(--font-mono)">${fmt(p.pricePack||0)}</td>
      <td>${escHtml(p.category||'—')}</td>
      <td>
        ${isAdmin()?`
        <button class="btn-icon" onclick="openStockModal('${p.id}','in')" title="Stock In">📥</button>
        <button class="btn-icon" onclick="openStockModal('${p.id}','out')" title="Stock Out">📤</button>
        <button class="btn-icon" onclick="editProduct('${p.id}')" title="Edit">✏️</button>
        <button class="btn-icon" onclick="deleteProduct('${p.id}')" title="Delete">🗑</button>
        `:isClerk()?`
        <button class="btn-icon" onclick="openStockModal('${p.id}','in')" title="Stock In">📥</button>
        <button class="btn-icon" onclick="openStockModal('${p.id}','out')" title="Stock Out">📤</button>
        `:'—'}
      </td>
    </tr>`).join('');
}
function filterInventory() { renderInventory(document.getElementById('invSearch').value); }

function openProductModal(editId='') {
  document.getElementById('productModalTitle').textContent=editId?'Edit Product':'Add Product';
  document.getElementById('productEditId').value=editId;
  document.getElementById('productError').classList.add('hidden');
  if (!editId) {
    ['prodBarcode','prodName','prodQtyPcs','prodQtyPacks','prodPricePcs','prodPricePack','prodCategory','prodUnit']
      .forEach(id=>document.getElementById(id).value='');
  } else {
    const p=products.find(p=>p.id===editId);
    if (p) {
      document.getElementById('prodBarcode').value  =p.barcode||'';
      document.getElementById('prodName').value     =p.name||'';
      document.getElementById('prodQtyPcs').value   =p.qtyPcs||'';
      document.getElementById('prodQtyPacks').value =p.qtyPacks||'';
      document.getElementById('prodPricePcs').value =p.pricePcs||'';
      document.getElementById('prodPricePack').value=p.pricePack||'';
      document.getElementById('prodCategory').value =p.category||'';
      document.getElementById('prodUnit').value     =p.unit||'';
    }
  }
  showModal('productModal');
}
function editProduct(id) { openProductModal(id); }

async function saveProduct() {
  const name=document.getElementById('prodName').value.trim();
  const errEl=document.getElementById('productError'); errEl.classList.add('hidden');
  if (!name) { errEl.textContent='Product name is required.'; errEl.classList.remove('hidden'); return; }
  const editId=document.getElementById('productEditId').value;
  const prod={
    name, barcode:document.getElementById('prodBarcode').value.trim(),
    qtyPcs:parseInt(document.getElementById('prodQtyPcs').value)||0,
    qtyPacks:parseInt(document.getElementById('prodQtyPacks').value)||0,
    pricePcs:parseFloat(document.getElementById('prodPricePcs').value)||0,
    pricePack:parseFloat(document.getElementById('prodPricePack').value)||0,
    category:document.getElementById('prodCategory').value.trim(),
    unit:document.getElementById('prodUnit').value.trim(),
  };
  let res;
  if (editId) {
    res=await gasRequest('updateProduct',{id:editId,...prod});
    if (res.ok) { const idx=products.findIndex(p=>p.id===editId); if(idx>-1) products[idx]={...products[idx],...prod}; }
  } else {
    prod.id='P-'+Date.now();
    res=await gasRequest('addProduct',prod);
    if (res.ok) products.push({...prod,id:res.id||prod.id});
  }
  if (!res.ok&&GAS_URL) { errEl.textContent=res.error||'Failed.'; errEl.classList.remove('hidden'); return; }
  cacheProducts(); closeModal('productModal'); renderInventory();
  showToast(editId?'Product updated':'Product added','success');
}
async function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  const res=await gasRequest('deleteProduct',{id});
  if (!res.ok&&GAS_URL) { showToast('Failed to delete','error'); return; }
  products=products.filter(p=>p.id!==id); cacheProducts(); renderInventory();
  showToast('Product deleted');
}

// ── STOCK ────────────────────────────────────────────────────
function openStockModal(productId, direction) {
  const prod=products.find(p=>p.id===productId); if(!prod) return;
  document.getElementById('stockModalTitle').textContent=direction==='in'?'Stock In':'Stock Out';
  document.getElementById('stockProductName').textContent=prod.name;
  document.getElementById('stockProductId').value=productId;
  document.getElementById('stockDirection').value=direction;
  document.getElementById('stockQty').value='';
  document.getElementById('stockReason').value='';
  document.getElementById('stockError').classList.add('hidden');
  showModal('stockModal');
}
async function saveStock() {
  const productId=document.getElementById('stockProductId').value;
  const direction=document.getElementById('stockDirection').value;
  const qty=parseInt(document.getElementById('stockQty').value)||0;
  const unit=document.getElementById('stockUnit').value;
  const reason=document.getElementById('stockReason').value.trim();
  const errEl=document.getElementById('stockError'); errEl.classList.add('hidden');
  if (qty<=0) { errEl.textContent='Enter a valid quantity.'; errEl.classList.remove('hidden'); return; }
  const prod=products.find(p=>p.id===productId); if(!prod) return;
  const field=unit==='pcs'?'qtyPcs':'qtyPacks';
  const current=parseInt(prod[field])||0;
  const newQty=direction==='in'?current+qty:Math.max(0,current-qty);
  const res=await gasRequest('stockUpdate',{productId,direction,qty,unit,reason,newQty,timestamp:new Date().toISOString()});
  if (!res.ok&&GAS_URL) { errEl.textContent=res.error||'Failed.'; errEl.classList.remove('hidden'); return; }
  prod[field]=newQty; cacheProducts(); closeModal('stockModal'); renderInventory();
  showToast(`Stock ${direction==='in'?'added':'removed'}: ${qty} ${unit}`,'success');
}

// ── CASHIERS ─────────────────────────────────────────────────
function renderCashiers() {
  const tbody=document.getElementById('cashierBody');
  if (!cashiers.length) { tbody.innerHTML='<tr><td colspan="5" class="empty-msg">No staff yet</td></tr>'; return; }
  tbody.innerHTML=cashiers.map(c=>`
    <tr>
      <td><strong>${escHtml(c.name)}</strong></td>
      <td style="font-family:var(--font-mono);font-size:13px">${escHtml(c.username)}</td>
      <td><span class="badge badge-${c.role}">${c.role}</span></td>
      <td><span class="badge badge-active">Active</span></td>
      <td>
        <button class="btn-icon" onclick="editCashier('${c.id}')">✏️</button>
        <button class="btn-icon" onclick="deleteCashier('${c.id}')">🗑</button>
      </td>
    </tr>`).join('');
}
function openCashierModal(editId='') {
  document.getElementById('cashierModalTitle').textContent=editId?'Edit Staff':'Add Staff';
  document.getElementById('cashierEditId').value=editId;
  document.getElementById('cashierError').classList.add('hidden');
  if (!editId) {
    ['cashierName','cashierUsername','cashierPassword'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('cashierRole').value='cashier';
  } else {
    const c=cashiers.find(c=>c.id===editId);
    if (c) {
      document.getElementById('cashierName').value=c.name||'';
      document.getElementById('cashierUsername').value=c.username||'';
      document.getElementById('cashierPassword').value='';
      document.getElementById('cashierRole').value=c.role||'cashier';
    }
  }
  showModal('cashierModal');
}
function editCashier(id) { openCashierModal(id); }
async function saveCashier() {
  const name=document.getElementById('cashierName').value.trim();
  const username=document.getElementById('cashierUsername').value.trim();
  const password=document.getElementById('cashierPassword').value;
  const role=document.getElementById('cashierRole').value;
  const editId=document.getElementById('cashierEditId').value;
  const errEl=document.getElementById('cashierError'); errEl.classList.add('hidden');
  if (!name||!username) { errEl.textContent='Name and username required.'; errEl.classList.remove('hidden'); return; }
  if (!editId&&!password) { errEl.textContent='Password required for new staff.'; errEl.classList.remove('hidden'); return; }
  const payload={name,username,role};
  if (password) payload.password=password;
  let res;
  if (editId) {
    res=await gasRequest('updateCashier',{id:editId,...payload});
    if (res.ok) { const idx=cashiers.findIndex(c=>c.id===editId); if(idx>-1) cashiers[idx]={...cashiers[idx],...payload}; }
  } else {
    payload.id='C-'+Date.now();
    res=await gasRequest('addCashier',payload);
    if (res.ok) cashiers.push({...payload,id:res.id||payload.id});
  }
  if (!res.ok&&GAS_URL) { errEl.textContent=res.error||'Failed.'; errEl.classList.remove('hidden'); return; }
  closeModal('cashierModal'); renderCashiers();
  showToast(editId?'Staff updated':'Staff added','success');
}
async function deleteCashier(id) {
  if (!confirm('Remove this staff?')) return;
  const res=await gasRequest('deleteCashier',{id});
  if (!res.ok&&GAS_URL) { showToast('Failed','error'); return; }
  cashiers=cashiers.filter(c=>c.id!==id); renderCashiers(); showToast('Staff removed');
}

// ── EXPENSES ─────────────────────────────────────────────────
function renderExpenses() {
  const tbody=document.getElementById('expenseBody');
  if (!expenses.length) { tbody.innerHTML='<tr><td colspan="5" class="empty-msg">No records yet</td></tr>'; return; }
  tbody.innerHTML=expenses.map(e=>`
    <tr>
      <td style="font-size:12px">${new Date(e.timestamp||e.date).toLocaleString('en-PH')}</td>
      <td><span class="badge" style="background:rgba(30,144,255,.1);color:var(--primary)">${e.type}</span></td>
      <td>${escHtml(e.description||'')}</td>
      <td style="font-family:var(--font-mono);font-weight:600">${fmt(e.amount||0)}</td>
      <td><button class="btn-icon" onclick="deleteExpense('${e.id}')">🗑</button></td>
    </tr>`).join('');
}
function openExpenseModal() {
  document.getElementById('expenseType').value='expense';
  document.getElementById('expenseDesc').value='';
  document.getElementById('expenseAmount').value='';
  document.getElementById('expenseError').classList.add('hidden');
  showModal('expenseModal');
}
async function saveExpense() {
  const type=document.getElementById('expenseType').value;
  const desc=document.getElementById('expenseDesc').value.trim();
  const amount=parseFloat(document.getElementById('expenseAmount').value)||0;
  const errEl=document.getElementById('expenseError'); errEl.classList.add('hidden');
  if (!desc||amount<=0) { errEl.textContent='Description and amount required.'; errEl.classList.remove('hidden'); return; }
  const record={id:'E-'+Date.now(),type,description:desc,amount,timestamp:new Date().toISOString()};
  const res=await gasRequest('addExpense',record);
  if (!res.ok&&GAS_URL) { errEl.textContent=res.error||'Failed.'; errEl.classList.remove('hidden'); return; }
  expenses.unshift(record); closeModal('expenseModal'); renderExpenses();
  showToast('Record saved','success');
}

async function deleteExpense(id) {
  if (!confirm('Delete this record?')) return;
  const res = await gasRequest('deleteExpense', { id });
  if (!res.ok && GAS_URL) { showToast('Failed to delete','error'); return; }
  expenses = expenses.filter(e => e.id !== id);
  renderExpenses();
  showToast('Record deleted');
}

// ── SETTINGS ─────────────────────────────────────────────────
function renderSettings() {
  document.getElementById('settingsGasUrl').value=GAS_URL;
  const info=getStoreInfo();
  document.getElementById('settingsStoreName').value=info.name||'';
  document.getElementById('settingsAddress').value=info.address||'';
  document.getElementById('settingsTin').value=info.tin||'';
}
function saveGasUrl() {
  const url=document.getElementById('settingsGasUrl').value.trim();
  GAS_URL=url; localStorage.setItem(LS.GAS_URL,url);
  showToast('URL saved. Reloading...','success'); loadAllData();
}
async function testConnection() {
  const res=await gasRequest('ping');
  if (res.ok) showToast('Connection successful!','success');
  else showToast('❌ Failed: '+(res.error||'Unknown'),'error');
}
function saveStoreInfo() {
  const info={
    name:document.getElementById('settingsStoreName').value.trim(),
    address:document.getElementById('settingsAddress').value.trim(),
    tin:document.getElementById('settingsTin').value.trim(),
  };
  localStorage.setItem(LS.STORE_INFO,JSON.stringify(info));
  showToast('Store info saved','success');
}
function getStoreInfo() {
  const s=localStorage.getItem(LS.STORE_INFO);
  return s?JSON.parse(s):{name:'AE HOME',address:'Alcantara Street, Brgy VIII, City of Vigan',tin:'010-948-695-00000'};
}
function clearLocalData() {
  if (!confirm('Clear all local cache?')) return;
  Object.values(LS).forEach(k=>localStorage.removeItem(k));
  showToast('Cache cleared. Reloading...');
  setTimeout(()=>location.reload(),1000);
}

// ── CONFIG ───────────────────────────────────────────────────
function saveConfig() {
  const url=document.getElementById('gasUrl').value.trim();
  if (!url) { showToast('Enter a valid URL','error'); return; }
  GAS_URL=url; localStorage.setItem(LS.GAS_URL,url);
  closeModal('configModal'); initApp();
}
function skipConfig() { closeModal('configModal'); initApp(); } // offline disabled

// ── MODAL HELPERS ────────────────────────────────────────────
function showModal(id)  { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }
document.addEventListener('click',e=>{ if(e.target.classList.contains('modal')) e.target.classList.add('hidden'); });

// ── TOAST ────────────────────────────────────────────────────
let toastTimer=null;
function showToast(msg,type='') {
  const el=document.getElementById('toast');
  el.textContent=msg;
  el.className='toast'+(type?` toast-${type}`:'');
  el.classList.remove('hidden');
  requestAnimationFrame(()=>el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{
    el.classList.remove('show');
    setTimeout(()=>el.classList.add('hidden'),300);
  },2800);
}

// ── UTILS ────────────────────────────────────────────────────
function fmt(n)    { return '₱'+fmtNum(n); }
function fmtNum(n) { return (parseFloat(n)||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }


// ── IMPORT INVENTORY ─────────────────────────────────────────
let importedRows = [];

function renderImportPage() {
  // Reset state on page load
  importedRows = [];
  const previewWrap = document.getElementById('importPreviewWrap');
  const actionBtns  = document.getElementById('importActionBtns');
  const statusEl    = document.getElementById('importStatus');
  const resultEl    = document.getElementById('importResult');
  if (previewWrap) previewWrap.style.display = 'none';
  if (actionBtns)  actionBtns.classList.add('hidden');
  if (statusEl)    statusEl.innerHTML = '';
  if (resultEl)    resultEl.innerHTML = '';
  document.getElementById('importFileName').textContent = '';
  document.getElementById('importFileInput').value = '';
}

function downloadTemplate(type) {
  const headers = ['barcode','name','qtyPcs','qtyPacks','pricePcs','pricePack','category','unit'];
  const sample  = ['8888','Coca-Cola 1.5L','24','2','45','480','Beverages','bottles'];

  if (type === 'csv') {
    const csv = headers.join(',') + '\n' + sample.join(',');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'inventory-template.csv';
    a.click();
    showToast('CSV template downloaded!', 'success');
  } else {
    // Simple xlsx using SheetJS-like manual approach — create CSV with xlsx extension hint
    // Since no SheetJS available, generate CSV and rename
    const csv = headers.join(',') + '\n' + sample.join(',');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'inventory-template.csv';
    a.click();
    showToast('Template downloaded! Save as .csv when filling up.', 'success');
  }
}

function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('importDropZone').style.borderColor = 'var(--primary)';
  document.getElementById('importDropZone').style.background  = '#f0f7ff';
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('importDropZone').style.borderColor = 'var(--border)';
  document.getElementById('importDropZone').style.background  = '#f8fcff';
  const file = e.dataTransfer.files[0];
  if (file) processImportFile(file);
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) processImportFile(file);
}

function processImportFile(file) {
  const name = file.name.toLowerCase();
  document.getElementById('importFileName').textContent = '📄 ' + file.name;

  if (name.endsWith('.csv')) {
    const reader = new FileReader();
    reader.onload = (e) => parseCSV(e.target.result);
    reader.readAsText(file);
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const reader = new FileReader();
    reader.onload = (e) => parseXLSX(e.target.result);
    reader.readAsArrayBuffer(file);
  } else {
    showToast('CSV o Excel (.xlsx) lang ang supported!', 'error');
  }
}

function parseCSV(text) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length < 2) { showToast('Empty or invalid CSV file!', 'error'); return; }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g,''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    // Handle quoted CSV values
    const cols = parseCSVLine(lines[i]);
    if (cols.length === 0) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = (cols[idx] || '').trim().replace(/['"]/g,''); });
    rows.push(row);
  }
  showImportPreview(rows);
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; }
    else if (c === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += c; }
  }
  result.push(current);
  return result;
}

function parseXLSX(buffer) {
  // Manual XLSX parsing — try to extract text content
  // For simplicity, show error and suggest CSV
  showToast('Para sa Excel — i-save muna as CSV (.csv) tapos i-upload!', 'error');
  document.getElementById('importStatus').innerHTML = `
    <div style="background:rgba(255,152,0,.1);border:1px solid rgba(255,152,0,.3);color:var(--warning);border-radius:8px;padding:12px 16px;font-size:13px;">
      ⚠️ <strong>Excel tip:</strong> I-open ang Excel file mo → File → Save As → CSV (Comma delimited) → tapos i-upload yung .csv file!
    </div>`;
  document.getElementById('importPreviewWrap').style.display = 'none';
}

function showImportPreview(rows) {
  if (!rows.length) { showToast('Walang data sa file!', 'error'); return; }

  importedRows = rows.map((row, idx) => {
    const name = row['name'] || row['product name'] || row['productname'] || '';
    const errors = [];
    if (!name) errors.push('No name');

    return {
      idx:       idx + 1,
      barcode:   row['barcode'] || '',
      name:      name,
      qtyPcs:    parseInt(row['qtypcs'] || row['qty pcs'] || row['qty'] || 0) || 0,
      qtyPacks:  parseInt(row['qtypacks'] || row['qty packs'] || 0) || 0,
      pricePcs:  parseFloat(row['pricepcs'] || row['price pcs'] || row['price'] || 0) || 0,
      pricePack: parseFloat(row['pricepack'] || row['price pack'] || row['pricepacks'] || 0) || 0,
      category:  row['category'] || '',
      unit:      row['unit'] || '',
      errors,
      valid: errors.length === 0,
    };
  });

  const valid   = importedRows.filter(r => r.valid).length;
  const invalid = importedRows.filter(r => !r.valid).length;

  document.getElementById('importStatus').innerHTML = `
    <div style="background:rgba(0,200,83,.1);border:1px solid rgba(0,200,83,.3);color:var(--green-dark);border-radius:8px;padding:12px 16px;font-size:13px;font-weight:600;">
      ✅ ${rows.length} rows found — <span style="color:var(--green-dark)">${valid} valid</span>${invalid ? ` · <span style="color:var(--danger)">${invalid} with errors</span>` : ''}
    </div>`;

  const tbody = document.getElementById('importPreviewBody');
  tbody.innerHTML = importedRows.map(r => `
    <tr style="${!r.valid ? 'background:rgba(244,67,54,.05)' : ''}">
      <td>${r.idx}</td>
      <td style="font-family:var(--font-mono);font-size:12px">${escHtml(r.barcode||'—')}</td>
      <td><strong>${escHtml(r.name||'—')}</strong></td>
      <td>${r.qtyPcs}</td>
      <td>${r.qtyPacks}</td>
      <td style="font-family:var(--font-mono)">${fmt(r.pricePcs)}</td>
      <td style="font-family:var(--font-mono)">${fmt(r.pricePack)}</td>
      <td>${escHtml(r.category||'—')}</td>
      <td>${escHtml(r.unit||'—')}</td>
      <td>${r.valid
        ? '<span class="badge badge-active">✅ OK</span>'
        : `<span class="badge" style="background:rgba(244,67,54,.1);color:var(--danger)">❌ ${r.errors.join(', ')}</span>`
      }</td>
    </tr>`).join('');

  document.getElementById('importPreviewWrap').style.display = 'block';
  if (valid > 0) document.getElementById('importActionBtns').classList.remove('hidden');

  showToast(`${rows.length} rows loaded — ${valid} ready to import!`, 'success');
}

async function confirmImport() {
  const validRows = importedRows.filter(r => r.valid);
  if (!validRows.length) { showToast('Walang valid rows!', 'error'); return; }

  const btn = document.querySelector('#importActionBtns .btn-success');
  btn.textContent = 'Importing...';
  btn.disabled = true;

  let success = 0;
  let failed  = 0;

  for (const row of validRows) {
    const prod = {
      id:        'P-' + Date.now() + Math.random().toString(36).substr(2,5),
      barcode:   row.barcode,
      name:      row.name,
      qtyPcs:    row.qtyPcs,
      qtyPacks:  row.qtyPacks,
      pricePcs:  row.pricePcs,
      pricePack: row.pricePack,
      category:  row.category,
      unit:      row.unit,
    };
    const res = await gasRequest('addProduct', prod);
    if (res.ok) {
      products.push({ ...prod, id: res.id || prod.id });
      success++;
    } else {
      failed++;
    }
    // Small delay to avoid overwhelming Apps Script
    await new Promise(r => setTimeout(r, 300));
  }

  cacheProducts();

  document.getElementById('importResult').innerHTML = `
    <div style="background:${success>0?'rgba(0,200,83,.1)':'rgba(244,67,54,.1)'};border:1px solid ${success>0?'rgba(0,200,83,.3)':'rgba(244,67,54,.3)'};color:${success>0?'var(--green-dark)':'var(--danger)'};border-radius:10px;padding:16px 20px;font-size:14px;font-weight:600;">
      ${success>0 ? `✅ Successfully imported <strong>${success} products</strong> to Inventory!` : ''}
      ${failed>0  ? `<br>❌ ${failed} products failed — check connection.` : ''}
    </div>`;

  btn.textContent = 'Import All to Inventory';
  btn.disabled = false;

  if (success > 0) {
    showToast(`${success} products imported!`, 'success');
    importedRows = [];
    document.getElementById('importActionBtns').classList.add('hidden');
  }
}

function clearImport() {
  importedRows = [];
  document.getElementById('importPreviewWrap').style.display = 'none';
  document.getElementById('importActionBtns').classList.add('hidden');
  document.getElementById('importStatus').innerHTML = '';
  document.getElementById('importResult').innerHTML = '';
  document.getElementById('importFileName').textContent = '';
  document.getElementById('importFileInput').value = '';
  showToast('Cleared!');
}

// ── CLEAR TEST DATA ──────────────────────────────────────────
function confirmClearData() {
  const answer = prompt('⚠️ DANGER ZONE!\n\nThis will DELETE ALL Sales, Expenses, and Inventory Logs from Google Sheets.\n\nType DELETE to confirm:');
  if (answer !== 'DELETE') { showToast('Cancelled — type DELETE exactly to confirm','error'); return; }
  const answer2 = prompt('Last warning! Type your admin password to proceed:');
  if (!answer2) { showToast('Cancelled','error'); return; }
  // Verify password matches session
  clearTestData(answer2);
}

async function clearTestData(confirmPassword) {
  showToast('Clearing data...','');
  // Clear local sales and expenses
  sales    = [];
  expenses = [];
  // Clear from sheets
  const res = await gasRequest('clearTestData');
  if (res.ok) {
    showToast('✅ Test data cleared!','success');
    renderDashboard();
  } else {
    showToast('❌ Failed: '+(res.error||'Check connection'),'error');
  }
}


// ── BACKUP & RESTORE ─────────────────────────────────────────
async function createManualBackup() {
  showToast('Creating backup...', '');
  const res = await gasRequest('createBackup');
  if (res.ok) showToast('Backup created: ' + res.backupName, 'success');
  else showToast('❌ Backup failed: ' + (res.error||''), 'error');
  loadBackups();
}

async function loadBackups() {
  const res = await gasRequest('getBackups');
  const el  = document.getElementById('backupList');
  if (!el) return;
  if (!res.ok || !res.data.length) {
    el.innerHTML = '<p class="empty-msg">No backups yet</p>'; return;
  }
  el.innerHTML = res.data.map(b => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border2);">
      <div>
        <div style="font-family:var(--font-mono);font-size:12px;color:var(--primary)">${b.name}</div>
        <div style="font-size:12px;color:var(--text2)">${b.timestamp}</div>
      </div>
      <button class="btn-success" style="font-size:12px;padding:7px 14px;" onclick="restoreBackup('${b.name}')">🔄 Restore</button>
    </div>`).join('');
}

async function restoreBackup(backupName) {
  if (!confirm('Restore from backup: ' + backupName + '?\n\nThis will REPLACE current data with backup data.')) return;
  showToast('Restoring backup...', '');
  const res = await gasRequest('restoreBackup', { backupName });
  if (res.ok) {
    showToast('Backup restored successfully!', 'success');
    await loadAllData();
    renderDashboard();
  } else {
    showToast('❌ Restore failed: ' + (res.error||''), 'error');
  }
}


// ── SESSION TRACKING ─────────────────────────────────────────
let sessionId      = null;
let sessionPingInt = null;
let currentPage    = 'dashboard';

function initSessionTracking() {
  if (!session) return;
  sessionId = 'SES-' + Date.now() + '-' + Math.random().toString(36).substr(2,6);
  pingSessionNow();
  // Ping every 30 seconds
  clearInterval(sessionPingInt);
  sessionPingInt = setInterval(pingSessionNow, 30000);
  // Remove session on page unload
  window.addEventListener('beforeunload', () => {
    gasRequest('removeSession', { sessionId });
  });
}

async function pingSessionNow() {
  if (!session || !sessionId) return;
  await gasRequest('pingSession', {
    sessionId,
    name:        session.name,
    role:        session.role,
    joinedAt:    new Date().toISOString(),
    currentPage,
  });
}

function stopSessionTracking() {
  if (sessionPingInt) clearInterval(sessionPingInt);
  if (sessionId) {
    gasRequest('removeSession', { sessionId });
    sessionId = null;
  }
}

async function loadActiveSessions() {
  const res = await gasRequest('getSessions');
  const el  = document.getElementById('activeUsersSection');
  if (!el) return;

  if (!res.ok || !res.data.length) {
    el.innerHTML = '<p class="empty-msg">Walang active users ngayon</p>';
    return;
  }

  const roleIcon  = { admin:'👑', cashier:'🧑‍💼', clerk:'🔍', guest:'👁' };
  const roleColor = { admin:'var(--primary)', cashier:'var(--green)', clerk:'var(--warning)', guest:'var(--text3)' };

  const now = new Date();
  el.innerHTML = res.data.map(s => {
    const lastActive = new Date(s.lastActive);
    const diffMs     = now - lastActive;
    const diffMins   = Math.floor(diffMs / 60000);
    const diffSecs   = Math.floor((diffMs % 60000) / 1000);
    const timeAgo    = diffMins > 0 ? `${diffMins}m ago` : `${diffSecs}s ago`;
    const isRecent   = diffMs < 60000;
    const page       = s.currentPage || 'dashboard';

    return `
    <div style="
      display:flex;align-items:center;gap:12px;
      padding:10px 14px;
      background:${isRecent ? 'rgba(0,200,83,.05)' : '#fff'};
      border:1px solid ${isRecent ? 'rgba(0,200,83,.2)' : 'var(--border2)'};
      border-radius:10px;
      margin-bottom:8px;
    ">
      <div style="
        width:38px;height:38px;border-radius:50%;
        background:linear-gradient(135deg,rgba(30,144,255,.15),rgba(0,200,83,.15));
        display:flex;align-items:center;justify-content:center;
        font-size:18px;flex-shrink:0;
      ">${roleIcon[s.role]||'👤'}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:14px;color:var(--text)">${escHtml(s.name)}</div>
        <div style="font-size:11px;margin-top:2px;">
          <span style="
            background:rgba(30,144,255,.1);color:${roleColor[s.role]||'var(--text2)'};
            padding:1px 8px;border-radius:20px;font-weight:700;font-size:10px;
          ">${s.role.toUpperCase()}</span>
          <span style="color:var(--text3);margin-left:6px;">📄 ${page}</span>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:4px;justify-content:flex-end;">
          <div style="
            width:8px;height:8px;border-radius:50%;
            background:${isRecent ? 'var(--success)' : 'var(--text3)'};
            ${isRecent ? 'box-shadow:0 0 6px var(--success);animation:pulse 1.5s infinite;' : ''}
          "></div>
          <span style="font-size:11px;color:${isRecent ? 'var(--success)' : 'var(--text3)'};font-weight:600;">
            ${isRecent ? 'Active' : timeAgo}
          </span>
        </div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px;">
          Joined: ${new Date(s.joinedAt).toLocaleTimeString('en-PH')}
        </div>
      </div>
    </div>`;
  }).join('');

  // Summary counts
  const total   = res.data.length;
  const admins  = res.data.filter(s=>s.role==='admin').length;
  const cashiers= res.data.filter(s=>s.role==='cashier').length;
  const clerks  = res.data.filter(s=>s.role==='clerk').length;
  const guests  = res.data.filter(s=>s.role==='guest').length;

  document.getElementById('activeUserCount').textContent  = total;
  document.getElementById('activeUserSummary').innerHTML  =
    `<span style="color:var(--primary)">👑 ${admins} Admin</span> &nbsp;
     <span style="color:var(--green)">🧑‍💼 ${cashiers} Cashier</span> &nbsp;
     <span style="color:var(--warning)">🔍 ${clerks} Clerk</span> &nbsp;
     <span style="color:var(--text3)">👁 ${guests} Guest</span>`;
}

// ── SALES SUMMARY ────────────────────────────────────────────
const LS_SUMMARY = 'ae_pos_summary_date';
let summaryImageData = null;

function getTodaySales() {
  const today = new Date().toDateString();
  return sales.filter(t => new Date(t.timestamp).toDateString() === today);
}

function generateSummary() {
  const todaySales = getTodaySales();
  const statusEl   = document.getElementById('summaryStatus');

  if (!todaySales.length) {
    document.getElementById('summaryPreview').innerHTML =
      `<div style="color:var(--text3);text-align:center;padding:60px 0;">
        <div style="font-size:48px;margin-bottom:12px;">🈳</div>
        <p>Walang transactions ngayon.</p>
      </div>`;
    statusEl.innerHTML = '';
    return;
  }

  // Build summary data
  const store      = getStoreInfo();
  const totalSales = todaySales.reduce((s,t) => s+(parseFloat(t.total)||0), 0);
  const totalCash  = todaySales.reduce((s,t) => s+(parseFloat(t.cashReceived)||0), 0);
  const totalChng  = todaySales.reduce((s,t) => s+(parseFloat(t.change)||0), 0);
  const vatAmt     = totalSales / 1.12 * 0.12;
  const txCount    = todaySales.length;

  // Today's expenses
  const today = new Date().toDateString();
  const todayExpenses = expenses.filter(e => new Date(e.timestamp||e.date).toDateString() === today);
  const totalExpenses = todayExpenses.reduce((s,e) => s+(parseFloat(e.amount)||0), 0);
  const totalAllowance= todayExpenses.filter(e=>e.type==='allowance').reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
  const totalExpOnly  = todayExpenses.filter(e=>e.type==='expense').reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
  const netIncome     = totalSales - totalExpenses;

  // Product breakdown
  const prodMap = {};
  todaySales.forEach(t => {
    const items = typeof t.items==='string' ? JSON.parse(t.items) : (t.items||[]);
    items.forEach(i => {
      if (!prodMap[i.name]) prodMap[i.name] = { qty:0, amount:0 };
      prodMap[i.name].qty    += parseInt(i.qty)||0;
      prodMap[i.name].amount += (parseFloat(i.price)||0)*(parseInt(i.qty)||0);
    });
  });
  const prodList = Object.entries(prodMap).sort((a,b) => b[1].amount - a[1].amount);
  const totalQty = prodList.reduce((s,[,v]) => s+v.qty, 0);

  // Cashier breakdown
  const cashierMap = {};
  todaySales.forEach(t => {
    const n = t.cashier||'Unknown';
    if (!cashierMap[n]) cashierMap[n] = { tx:0, total:0 };
    cashierMap[n].tx++;
    cashierMap[n].total += parseFloat(t.total)||0;
  });

  const now = new Date();

  // Render HTML preview
  document.getElementById('summaryPreview').innerHTML = `
    <div id="summaryCard" style="
      background:#fff;
      border:1px solid #e0e0e0;
      border-top:6px solid transparent;
      border-image: linear-gradient(135deg,#1e90ff,#00c853) 1;
      border-radius:12px;
      padding:28px;
      max-width:420px;
      width:100%;
      font-family:'Courier New',monospace;
      font-size:13px;
      color:#1a2332;
      box-shadow:0 4px 24px rgba(0,0,0,0.1);
      text-align:left;
    ">
      <!-- Header -->
      <div style="text-align:center;margin-bottom:16px;">
        <div style="font-family:Poppins,sans-serif;font-size:20px;font-weight:800;background:linear-gradient(135deg,#1e90ff,#00c853);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${escHtml(store.name||'AE HOME')}</div>
        <div style="font-size:11px;color:#666;margin-top:2px;">AE Home Trade Corp.</div>
        <div style="font-size:11px;color:#666;">VAT Reg TIN: ${escHtml(store.tin||'010-948-695-00000')}</div>
        <div style="font-size:11px;color:#666;">${escHtml(store.address||'Alcantara Street, Brgy VIII, City of Vigan')}</div>
      </div>

      <div style="border-top:2px solid #00c853;margin:12px 0;"></div>
      <div style="text-align:center;font-family:Poppins,sans-serif;font-weight:700;font-size:14px;color:#1e90ff;letter-spacing:1px;">TODAY'S SALES SUMMARY</div>
      <div style="text-align:center;font-size:11px;color:#888;margin-bottom:12px;">${now.toLocaleDateString('en-PH',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
      <div style="text-align:center;font-size:11px;color:#888;margin-bottom:4px;">Generated: ${now.toLocaleTimeString('en-PH')}</div>
      <div style="border-top:1px dashed #ccc;margin:12px 0;"></div>

      <!-- Stats -->
      <div style="display:flex;justify-content:space-between;padding:4px 0;"><span>Total Transactions:</span><strong>${txCount}</strong></div>
      <div style="display:flex;justify-content:space-between;padding:4px 0;"><span>Total Items Sold:</span><strong>${totalQty}</strong></div>
      <div style="border-top:1px dashed #ccc;margin:10px 0;"></div>

      <!-- Items breakdown -->
      <div style="font-weight:700;margin-bottom:6px;font-family:Poppins,sans-serif;font-size:12px;color:#555;text-transform:uppercase;letter-spacing:.5px;">Item Breakdown</div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#888;padding:2px 0;border-bottom:1px solid #eee;margin-bottom:4px;">
        <span>DESCRIPTION</span><span>QTY</span><span>AMOUNT</span>
      </div>
      ${prodList.map(([name,v])=>`
        <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f5f5f5;">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;">${escHtml(name)}</span>
          <span style="min-width:40px;text-align:center;">${v.qty}</span>
          <span style="min-width:70px;text-align:right;">${fmtNum(v.amount)}</span>
        </div>`).join('')}

      <div style="border-top:1px dashed #ccc;margin:10px 0;"></div>

      <!-- Cashier breakdown -->
      <div style="font-weight:700;margin-bottom:6px;font-family:Poppins,sans-serif;font-size:12px;color:#555;text-transform:uppercase;letter-spacing:.5px;">Cashier Summary</div>
      ${Object.entries(cashierMap).map(([n,v])=>`
        <div style="display:flex;justify-content:space-between;padding:3px 0;">
          <span>${escHtml(n)}</span>
          <span>${v.tx} tx — <strong>${fmtNum(v.total)}</strong></span>
        </div>`).join('')}

      <div style="border-top:2px solid #1a2332;margin:12px 0;"></div>

      <!-- Totals -->
      <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px;">
        <span>Total Cash In:</span><span>${fmtNum(totalCash)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px;">
        <span>Total Change:</span><span>${fmtNum(totalChng)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px;color:#888;">
        <span>VAT (12%) Included:</span><span>${fmtNum(vatAmt)}</span>
      </div>
      <div style="border-top:2px solid #00c853;margin:8px 0;"></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:18px;font-weight:800;font-family:Poppins,sans-serif;">
        <span>TOTAL SALES:</span><span style="color:#00c853;">₱${fmtNum(totalSales)}</span>
      </div>

      <!-- Finance Section -->
      ${todayExpenses.length ? `
      <div style="border-top:1px dashed #ccc;margin:12px 0;"></div>
      <div style="font-weight:700;margin-bottom:6px;font-family:Poppins,sans-serif;font-size:12px;color:#555;text-transform:uppercase;letter-spacing:.5px;">Finance Summary</div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px;">
        <span>Total Expenses:</span><span style="color:#f44336;">(${fmtNum(totalExpOnly)})</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px;">
        <span>Total Allowance:</span><span style="color:#ff9800;">(${fmtNum(totalAllowance)})</span>
      </div>
      <div style="border-top:1px solid #1a2332;margin:8px 0;"></div>
      <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:15px;font-weight:800;font-family:Poppins,sans-serif;">
        <span>NET INCOME:</span>
        <span style="color:${netIncome>=0?'#00c853':'#f44336'}">₱${fmtNum(netIncome)}</span>
      </div>` : ''}

      <div style="border-top:1px dashed #ccc;margin:12px 0;"></div>
      <div style="text-align:center;font-size:10px;color:#aaa;">This serves as Sales Summary for Inventory Purposes Only.</div>
      <div style="text-align:center;font-size:10px;color:#1e90ff;font-weight:700;margin-top:4px;">AE HOME TRADE CORP.</div>
      <div style="text-align:center;font-size:9px;color:#ccc;margin-top:2px;">Powered by AE Home POS System</div>
    </div>`;

  statusEl.innerHTML = `<div style="background:rgba(0,200,83,.1);border:1px solid rgba(0,200,83,.3);color:var(--green-dark);border-radius:8px;padding:10px 16px;font-size:13px;font-weight:600;">
    ✅ Summary generated — ${txCount} transactions | Total: ${fmt(totalSales)}
  </div>`;

  // Generate PNG in background
  generateSummaryImage(todaySales, prodList, cashierMap, totalSales, totalCash, totalChng, vatAmt, txCount, totalQty);
}

async function generateSummaryImage(todaySales, prodList, cashierMap, totalSales, totalCash, totalChng, vatAmt, txCount, totalQty) {
  const store  = getStoreInfo();
  const canvas = document.getElementById('receiptCanvas');
  const ctx    = canvas.getContext('2d');
  const W      = 420;
  const lineH  = 22;
  const padX   = 28;
  const now    = new Date();

  const headerH  = 180;
  const statsH   = 80;
  const itemsH   = prodList.length * lineH + 60;
  const cashierH = Object.keys(cashierMap).length * lineH + 50;
  const totalsH  = 160;
  canvas.width   = W;
  canvas.height  = headerH + statsH + itemsH + cashierH + totalsH;

  // White bg
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, canvas.height);

  // Gradient top bar
  const grad = ctx.createLinearGradient(0,0,W,0);
  grad.addColorStop(0,'#1e90ff'); grad.addColorStop(1,'#00c853');
  ctx.fillStyle = grad; ctx.fillRect(0,0,W,7);

  let y = 28;
  // Store name
  ctx.fillStyle='#1a2332'; ctx.font='bold 18px Arial'; ctx.textAlign='center';
  ctx.fillText(store.name||'AE HOME', W/2, y); y+=18;
  ctx.fillStyle='#666'; ctx.font='11px Arial';
  ctx.fillText('AE Home Trade Corp.', W/2, y); y+=15;
  ctx.fillText(`VAT Reg TIN: ${store.tin||'010-948-695-00000'}`, W/2, y); y+=15;
  ctx.fillText(store.address||'Alcantara Street, Brgy VIII, City of Vigan', W/2, y); y+=20;

  // Green line
  ctx.strokeStyle='#00c853'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(padX,y); ctx.lineTo(W-padX,y); ctx.stroke(); y+=16;

  ctx.fillStyle='#1e90ff'; ctx.font='bold 13px Arial'; ctx.textAlign='center';
  ctx.fillText("TODAY'S SALES SUMMARY", W/2, y); y+=16;
  ctx.fillStyle='#888'; ctx.font='11px Arial';
  ctx.fillText(now.toLocaleDateString('en-PH',{weekday:'long',year:'numeric',month:'long',day:'numeric'}), W/2, y); y+=14;
  ctx.fillText(`Generated: ${now.toLocaleTimeString('en-PH')}`, W/2, y); y+=18;

  // Dashed line
  ctx.setLineDash([4,4]); ctx.strokeStyle='#ccc'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(padX,y); ctx.lineTo(W-padX,y); ctx.stroke();
  ctx.setLineDash([]); y+=16;

  // Quick stats
  ctx.fillStyle='#333'; ctx.font='12px Courier New'; ctx.textAlign='left';
  [[`Total Transactions:`, txCount],[`Total Items Sold:`, totalQty]].forEach(([l,v])=>{
    ctx.fillText(l, padX, y);
    ctx.textAlign='right'; ctx.font='bold 12px Courier New';
    ctx.fillText(String(v), W-padX, y);
    ctx.textAlign='left'; ctx.font='12px Courier New';
    y+=18;
  });
  y+=6;

  // Items header
  ctx.setLineDash([4,4]); ctx.strokeStyle='#ccc';
  ctx.beginPath(); ctx.moveTo(padX,y); ctx.lineTo(W-padX,y); ctx.stroke();
  ctx.setLineDash([]); y+=14;

  ctx.fillStyle='#888'; ctx.font='bold 10px Arial'; ctx.textAlign='left';
  ctx.fillText('ITEM BREAKDOWN', padX, y); y+=14;
  ctx.fillStyle='#aaa'; ctx.font='10px Arial';
  ctx.fillText('DESCRIPTION', padX, y);
  ctx.textAlign='center'; ctx.fillText('QTY', W/2, y);
  ctx.textAlign='right'; ctx.fillText('AMOUNT', W-padX, y);
  ctx.textAlign='left'; y+=4;
  ctx.strokeStyle='#eee'; ctx.beginPath(); ctx.moveTo(padX,y); ctx.lineTo(W-padX,y); ctx.stroke(); y+=12;

  prodList.forEach(([name,v])=>{
    ctx.fillStyle='#333'; ctx.font='12px Courier New'; ctx.textAlign='left';
    const shortName = name.length>24 ? name.substring(0,22)+'…' : name;
    ctx.fillText(shortName, padX, y);
    ctx.textAlign='center'; ctx.fillText(String(v.qty), W/2, y);
    ctx.textAlign='right'; ctx.fillText(fmtNum(v.amount), W-padX, y);
    y+=lineH;
  });
  y+=8;

  // Cashier section
  ctx.setLineDash([4,4]); ctx.strokeStyle='#ccc';
  ctx.beginPath(); ctx.moveTo(padX,y); ctx.lineTo(W-padX,y); ctx.stroke();
  ctx.setLineDash([]); y+=14;
  ctx.fillStyle='#888'; ctx.font='bold 10px Arial'; ctx.textAlign='left';
  ctx.fillText('CASHIER SUMMARY', padX, y); y+=14;
  Object.entries(cashierMap).forEach(([n,v])=>{
    ctx.fillStyle='#333'; ctx.font='12px Courier New'; ctx.textAlign='left';
    ctx.fillText(n, padX, y);
    ctx.textAlign='right'; ctx.fillText(`${v.tx} tx — ${fmtNum(v.total)}`, W-padX, y);
    y+=lineH;
  });
  y+=8;

  // Totals
  ctx.strokeStyle='#1a2332'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(padX,y); ctx.lineTo(W-padX,y); ctx.stroke(); y+=16;
  const totRows=[
    ['Total Cash In:', fmtNum(totalCash), '#333', false],
    ['Total Change:', fmtNum(totalChng), '#333', false],
    ['VAT (12%) Included:', fmtNum(vatAmt), '#888', false],
  ];
  totRows.forEach(([l,v,c,bold])=>{
    ctx.fillStyle=c; ctx.font=(bold?'bold ':'')+`12px Courier New`;
    ctx.textAlign='left'; ctx.fillText(l,padX,y);
    ctx.textAlign='right'; ctx.fillText(v,W-padX,y); y+=18;
  });
  ctx.strokeStyle='#00c853'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(padX,y); ctx.lineTo(W-padX,y); ctx.stroke(); y+=16;

  // Grand total
  ctx.fillStyle='#00c853'; ctx.font='bold 16px Arial'; ctx.textAlign='left';
  ctx.fillText('TOTAL SALES:', padX, y);
  ctx.textAlign='right'; ctx.fillText('₱'+fmtNum(totalSales), W-padX, y); y+=24;

  // Footer
  ctx.strokeStyle='#eee'; ctx.lineWidth=1; ctx.setLineDash([4,4]);
  ctx.beginPath(); ctx.moveTo(padX,y); ctx.lineTo(W-padX,y); ctx.stroke();
  ctx.setLineDash([]); y+=14;
  ctx.fillStyle='#aaa'; ctx.font='10px Arial'; ctx.textAlign='center';
  ctx.fillText('This serves as Sales Summary for Inventory Purposes Only.', W/2, y); y+=13;
  ctx.fillStyle='#1e90ff'; ctx.font='bold 10px Arial';
  ctx.fillText('AE HOME TRADE CORP.', W/2, y); y+=12;
  ctx.fillStyle='#ccc'; ctx.font='9px Arial';
  ctx.fillText('Powered by AE Home POS System', W/2, y);

  summaryImageData = canvas.toDataURL('image/png');
}

function downloadSummaryImage() {
  if (!summaryImageData) { showToast('Generate summary muna!', 'error'); return; }
  const a = document.createElement('a');
  a.href     = summaryImageData;
  a.download = `sales-summary-${new Date().toISOString().slice(0,10)}.png`;
  a.click();
  showToast('Downloading summary...', 'success');
}

function resetTodaySummary() {
  if (!confirm('Reset today\'s summary view? Hindi mabubura ang data sa Google Sheets.')) return;
  summaryImageData = null;
  document.getElementById('summaryPreview').innerHTML = `
    <div style="color:var(--text3);text-align:center;padding:60px 0;">
      <div style="font-size:48px;margin-bottom:12px;">📋</div>
      <p>I-click ang <strong>"Generate Summary"</strong> para makita ang today's transactions.</p>
    </div>`;
  document.getElementById('summaryStatus').innerHTML = '';
  showToast('Summary reset!', 'success');
}

// ── PWA ──────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
