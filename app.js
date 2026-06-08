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
    if (splash) splash.classList.add('fade');
  }, 800);

  initAppUiEventHandlers();
  applyLocalProfilePhotos();

  if (session) {
    showSection(session.role === 'cashier' ? 'pos' : 'dashboard');
    syncData();
  } else {
    showSection('login');
  }
});

function initAppUiEventHandlers() {
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await submitLogin();
    });
  }
  
  const barcodeInput = document.getElementById('posBarcodeScanner');
  if (barcodeInput) {
    barcodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleBarcodeScanned(e.target.value.trim());
        e.target.value = '';
      }
    });
  }
}

// ── ROUTING & NAVIGATION ─────────────────────────────────────
function showSection(id) {
  document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  const navLink = document.querySelector(`.nav-links a[onclick*="${id}"]`);
  if (navLink) navLink.classList.add('active');

  if (id === 'pos') setTimeout(() => {
    const scanner = document.getElementById('posBarcodeScanner');
    if (scanner) scanner.focus();
  }, 100);
  
  if (id === 'products') renderProductsTable();
  if (id === 'sales') renderSalesTable();
  if (id === 'cashiers') renderCashiersTable();
  if (id === 'expenses') renderExpensesTable();
}

function checkAccess(allowedRoles) {
  if (!session) { showSection('login'); return true; }
  if (!allowedRoles.includes(session.role)) {
    showToast('Access Denied: Walang pahintulot ang iyong role sa feature na ito.', 'error');
    return true;
  }
  return false;
}

// ── DATABASE CLIENT ENGINE ───────────────────────────────────
async function gasRequest(action, payload = {}) {
  if (!GAS_URL) { openConfigModal(); return { ok: false, error: 'Database URL not configured' }; }
  try {
    const dataObj = { action, ...payload };
    if (session) { dataObj.sessionToken = session.id; }
    
    const encData = encodeURIComponent(JSON.stringify(dataObj));
    const finalUrl = `${GAS_URL}?data=${encData}`;

    const res = await fetch(finalUrl);
    if (!res.ok) throw new Error(`HTTP network fault code: ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error(e);
    return { ok: false, error: 'Network communication dropped or timed out.' };
  }
}

async function syncData() {
  if (!session) return;
  updateGlobalSyncStatus(true);
  
  const pRes = await gasRequest('getProducts');
  if (pRes.ok) {
    products = pRes.data;
    localStorage.setItem(LS.PRODUCTS_CACHE, JSON.stringify(products));
    updatePosProductsGrid();
    if (!document.getElementById('products').classList.contains('hidden')) renderProductsTable();
  }
  
  const sRes = await gasRequest('getSales');
  if (sRes.ok) { sales = sRes.data; renderDashboard(); }

  if (session.role === 'admin') {
    const cRes = await gasRequest('getCashiers');
    if (cRes.ok) cashiers = cRes.data;
    const eRes = await gasRequest('getExpenses');
    if (eRes.ok) expenses = eRes.data;
  }
  
  updateGlobalSyncStatus(false);
}

function updateGlobalSyncStatus(isSyncing) {
  const el = document.getElementById('syncIndicatorStatus');
  if (el) el.innerHTML = isSyncing ? '🔄 Syncing Data...' : '✅ Cloud Connected';
}

// ── AUTHENTICATION ───────────────────────────────────────────
async function submitLogin() {
  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value.trim();
  if (!user || !pass) return showToast('Paki-sulat ang username at password', 'error');

  showToast('Verifying session keys...', 'info');
  const res = await gasRequest('login', { username: user, password: pass });
  
  if (res.ok) {
    session = res.session;
    localStorage.setItem(LS.SESSION, JSON.stringify(session));
    showToast(`Welcome back, ${session.name}!`, 'success');
    
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPass').value = '';
    
    updateUserNavbarUi();
    showSection(session.role === 'cashier' ? 'pos' : 'dashboard');
    syncData();
  } else {
    showToast(res.error || 'Maling username o password!', 'error');
  }
}

function handleLogout() {
  if (confirm('Sigurado ka bang mag-lo-logout sa system terminal?')) {
    localStorage.removeItem(LS.SESSION);
    session = null;
    updateUserNavbarUi();
    showSection('login');
  }
}

function loadSession() {
  const saved = localStorage.getItem(LS.SESSION);
  if (saved) { session = JSON.parse(saved); updateUserNavbarUi(); }
}

function updateUserNavbarUi() {
  const nav = document.getElementById('appMainNavbar');
  if (!session) { if (nav) nav.classList.add('hidden'); return; }
  if (nav) nav.classList.remove('hidden');

  document.getElementById('navUserLabel').innerText = session.name;
  document.getElementById('navRoleBadge').innerText = session.role.toUpperCase();

  document.querySelectorAll('.role-admin-only').forEach(el => {
    if (session.role === 'admin') el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
  document.querySelectorAll('.role-clerk-only').forEach(el => {
    if (session.role === 'admin' || session.role === 'clerk') el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
}

function getCashierName() { return session ? session.name : 'Unknown Cashier'; }
function getCashierId() { return session ? session.userId : 'N/A'; }

// ── CONFIG MODAL ─────────────────────────────────────────────
function openConfigModal() {
  document.getElementById('configGasUrlInput').value = GAS_URL;
  document.getElementById('configModal').classList.remove('hidden');
}
function closeConfigModal() { document.getElementById('configModal').classList.add('hidden'); }
function saveConfigSettings() {
  const url = document.getElementById('configGasUrlInput').value.trim();
  if (!url) return alert('Bawal ang walang backend database URL link.');
  GAS_URL = url;
  localStorage.setItem(LS.GAS_URL, url);
  closeConfigModal();
  showToast('Database URL updated locally.', 'success');
}

// ── TOAST NOTIFICATIONS ──────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = document.getElementById('toastBoxContainer') || (() => {
    const c = document.createElement('div'); c.id = 'toastBoxContainer';
    c.style.position = 'fixed'; c.style.bottom = '20px'; c.style.right = '20px';
    c.style.zIndex = '99999'; c.style.display = 'flex'; c.style.flexDirection = 'column';
    c.style.gap = '8px'; document.body.appendChild(c); return c;
  })();

  const t = document.createElement('div');
  t.style.padding = '12px 20px'; t.style.borderRadius = '8px'; t.style.color = '#fff';
  t.style.fontWeight = '500'; t.style.fontSize = '13px'; t.style.minWidth = '240px';
  t.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'; t.style.transition = 'all 0.3s ease';
  t.style.transform = 'translateY(20px)'; t.style.opacity = '0';

  if (type === 'success') t.style.background = 'var(--grad-green)';
  else if (type === 'error') t.style.background = 'linear-gradient(135deg, #ff4d4d, #cc0000)';
  else t.style.background = 'var(--grad-blue)';

  t.innerText = msg; container.appendChild(t);
  setTimeout(() => { t.style.transform = 'translateY(0)'; t.style.opacity = '1'; }, 10);
  setTimeout(() => { t.style.transform = 'translateY(-20px)'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}

// ── DASHBOARD BUSINESS INSIGHTS ──────────────────────────────
function changeDashboardPeriod(p) { dashPeriod = p; renderDashboard(); }
function renderDashboard() {
  if (!session || session.role === 'cashier') return;
  const now = new Date();
  
  let filteredSales = sales;
  let filteredExp   = expenses;

  if (dashPeriod === 'today') {
    filteredSales = sales.filter(s => new Date(s.timestamp).toDateString() === now.toDateString());
    filteredExp   = expenses.filter(e => new Date(e.timestamp).toDateString() === now.toDateString());
  } else if (dashPeriod === 'month') {
    filteredSales = sales.filter(s => new Date(s.timestamp).getMonth() === now.getMonth() && new Date(s.timestamp).getFullYear() === now.getFullYear());
    filteredExp   = expenses.filter(e => new Date(e.timestamp).getMonth() === now.getMonth() && new Date(e.timestamp).getFullYear() === now.getFullYear());
  }

  const grossSales = filteredSales.reduce((sum, s) => sum + Number(s.total || 0), 0);
  const totalExp   = filteredExp.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const netRevenue = grossSales - totalExp;

  document.getElementById('dashGrossSalesLabel').innerText = '₱' + grossSales.toFixed(2);
  document.getElementById('dashExpensesLabel').innerText   = '₱' + totalExp.toFixed(2);
  document.getElementById('dashNetRevenueLabel').innerText   = '₱' + netRevenue.toFixed(2);
  document.getElementById('dashTxCountLabel').innerText     = filteredSales.length + ' invoices';

  document.querySelectorAll('.dash-filter-btn').forEach(b => b.classList.remove('active'));
  const actBtn = document.getElementById(`dashBtn-${dashPeriod}`);
  if (actBtn) actBtn.classList.add('active');
}

// ── POS SHOPPING CART AUTOMATION ─────────────────────────────
function loadCart() { const saved = localStorage.getItem(LS.CART); if (saved) cart = JSON.parse(saved); }
function saveCart() { localStorage.setItem(LS.CART, JSON.stringify(cart)); }

function updatePosProductsGrid() {
  const grid = document.getElementById('posProductsGrid');
  if (!grid) return;
  const term = (document.getElementById('posProductSearchInput')?.value || '').toLowerCase();
  
  const cache = localStorage.getItem(LS.PRODUCTS_CACHE);
  if (cache) products = JSON.parse(cache);

  const filtered = products.filter(p => p.name.toLowerCase().includes(term) || (p.barcode && p.barcode.includes(term)));
  if (filtered.length === 0) { grid.innerHTML = '<p class="empty-msg">Walang katugmang produkto.</p>'; return; }

  grid.innerHTML = filtered.map(p => `
    <div class="product-card" onclick="openUnitSelectionModal('${p.id}')">
      <div class="prod-card-name">${p.name}</div>
      <div class="prod-card-meta">Stock: <strong>${p.qtyPcs} pcs</strong> / ${p.qtyPacks} packs</div>
      <div class="prod-card-prices">
        <span>Pc: ₱${Number(p.pricePcs).toFixed(2)}</span>
        <span>Pack: ₱${Number(p.pricePack).toFixed(2)}</span>
      </div>
    </div>
  `).join('');
}

function openUnitSelectionModal(id) {
  pendingUnitProductId = id;
  const p = products.find(prod => prod.id === id);
  if (!p) return;
  document.getElementById('unitModalItemLabel').innerText = p.name;
  document.getElementById('unitModalOptionPc').innerHTML = `💡 Piece Unit <br> <strong>₱${Number(p.pricePcs).toFixed(2)}</strong> <br> <small>${p.qtyPcs} remaining</small>`;
  document.getElementById('unitModalOptionPack').innerHTML = `📦 Pack Unit <br> <strong>₱${Number(p.pricePack).toFixed(2)}</strong> <br> <small>${p.qtyPacks} remaining</small>`;
  document.getElementById('unitSelectionModal').classList.remove('hidden');
}
function closeUnitSelectionModal() { document.getElementById('unitSelectionModal').classList.add('hidden'); }

function selectUnitAndAddToCart(unit) {
  const p = products.find(prod => prod.id === pendingUnitProductId);
  closeUnitSelectionModal();
  if (!p) return;

  const currentStock = unit === 'pcs' ? Number(p.qtyPcs) : Number(p.qtyPacks);
  if (currentStock <= 0) return showToast('Error: Walang sapat na stock sa napiling unit!', 'error');

  const price = unit === 'pcs' ? Number(p.pricePcs) : Number(p.pricePack);
  const cartIdx = cart.findIndex(item => item.id === p.id && item.unit === unit);

  if (cartIdx > -1) {
    if (cart[cartIdx].qty + 1 > currentStock) return showToast('Limit hit: Ubos na ang physical stocks!', 'error');
    cart[cartIdx].qty++;
  } else {
    cart.push({ id: p.id, name: p.name, price: price, unit: unit, qty: 1 });
  }

  saveCart(); renderCart(); showToast(`${p.name} added to cart.`, 'success');
}

function handleBarcodeScanned(code) {
  if (!code) return;
  const p = products.find(prod => prod.barcode === code);
  if (!p) return showToast('Barcode registry untraceable.', 'error');
  openUnitSelectionModal(p.id);
}

function renderCart() {
  const tbody = document.querySelector('#cartTable tbody');
  if (!tbody) return;
  if (cart.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">Shopping cart is empty.</td></tr>';
    document.getElementById('cartTotalLabel').innerText = '₱0.00';
    return;
  }

  tbody.innerHTML = cart.map((item, idx) => `
    <tr>
      <td>
        <span class="cart-item-title">${item.name}</span><br>
        <span class="badge badge-teal">${item.unit.toUpperCase()}</span>
      </td>
      <td>₱${item.price.toFixed(2)}</td>
      <td>
        <div class="qty-control">
          <button onclick="changeCartItemQty(${idx}, -1)">-</button>
          <input type="number" value="${item.qty}" min="1" onchange="editCartItemQtyDirect(${idx}, this.value)" style="width:50px; text-align:center; border:1px solid var(--border); border-radius:4px; font-size:13px;" />
          <button onclick="changeCartItemQty(${idx}, 1)">+</button>
        </div>
      </td>
      <td><strong>₱${(item.price * item.qty).toFixed(2)}</strong></td>
      <td><button class="action-btn delete-btn" style="padding:4px 8px;" onclick="removeCartItem(${idx})">🗑️</button></td>
    </tr>
  `).join('');

  const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  document.getElementById('cartTotalLabel').innerText = '₱' + total.toFixed(2);
}

function changeCartItemQty(idx, delta) {
  cart[idx].qty += delta;
  if (cart[idx].qty <= 0) {
    cart.splice(idx, 1);
  }
  saveCart(); renderCart();
}

function editCartItemQtyDirect(idx, val) {
  let n = parseInt(val);
  if (isNaN(n) || n <= 0) n = 1;
  cart[idx].qty = n;
  saveCart(); renderCart();
}

function removeCartItem(idx) {
  cart.splice(idx, 1);
  saveCart(); renderCart();
}

function clearCart() {
  if(cart.length === 0) return;
  if(confirm('Magsisimula ba ulit? I-clear ang buong shopping cart?')) {
    cart = []; saveCart(); renderCart();
  }
}

// ── CHECKOUT MODAL ───────────────────────────────────────────
function openCheckoutModal() {
  if (cart.length === 0) return showToast('Walang ibebenta! Empty ang cart.', 'error');
  if (checkAccess(['admin', 'clerk', 'cashier'])) return;

  const total = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);
  document.getElementById('checkoutTotalAmount').innerText = '₱' + total.toFixed(2);
  document.getElementById('checkoutCashReceived').value = '';
  document.getElementById('checkoutChange').innerText = '₱0.00';
  document.getElementById('checkoutModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('checkoutCashReceived').focus(), 150);
}

function closeCheckoutModal() {
  document.getElementById('checkoutModal').classList.add('hidden');
}

function calculateChange() {
  const total = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);
  const cash  = parseFloat(document.getElementById('checkoutCashReceived').value) || 0;
  const change = cash - total;
  document.getElementById('checkoutChange').innerText = '₱' + (change >= 0 ? change.toFixed(2) : '0.00');
}

// ── RECEIPT METADATA AUTO GENERATION ─────────────────────────
let receiptImageData = null;
let summaryImageData = null;

function getNextSalesInvoiceNumber() {
  let count = parseInt(localStorage.getItem(LS.SI_COUNTER)) || 100001;
  count++;
  localStorage.setItem(LS.SI_COUNTER, count);
  return 'AE-' + count;
}

async function processCheckout() {
  const total = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);
  const cash  = parseFloat(document.getElementById('checkoutCashReceived').value) || 0;
  if (cash < total) return showToast('Kulang ang perang ibinayad!', 'error');

  showToast('Recording sale to spreadsheet...', 'info');
  const transactionId = getNextSalesInvoiceNumber();
  const timestamp     = new Date().toISOString();
  
  const saleData = {
    id:           transactionId,
    timestamp:    timestamp,
    cashier:      getCashierName(),
    cashierId:    getCashierId(),
    items:        cart.map(i => ({ id: i.id, name: i.name, unit: i.unit, price: i.price, qty: i.qty })),
    total:        total,
    cashReceived: cash,
    change:       cash - total
  };

  cart.forEach(item => {
    const p = products.find(prod => prod.id === item.id);
    if (p) {
      if (item.unit === 'pcs') {
        p.qtyPcs = Math.max(0, Number(p.qtyPcs) - item.qty);
      } else {
        p.qtyPacks = Math.max(0, Number(p.qtyPacks) - item.qty);
      }
    }
  });
  localStorage.setItem(LS.PRODUCTS_CACHE, JSON.stringify(products));
  updatePosProductsGrid();

  const res = await gasRequest('addSale', saleData);
  if (res.ok) {
    showToast('Transaction registered successfully!', 'success');
    
    for (const item of cart) {
      const p = products.find(prod => prod.id === item.id);
      if(p) {
        await gasRequest('updateProductQty', {
          id:      item.id,
          field:   item.unit === 'pcs' ? 'qtyPcs' : 'qtyPacks',
          newQty:  item.unit === 'pcs' ? p.qtyPcs : p.qtyPacks,
          qty:     item.qty,
          cashier: getCashierName()
        });
      }
    }

    generateReceiptImage(saleData);
    cart = []; saveCart(); renderCart();
    closeCheckoutModal();
    openReceiptModal();
    
    const sRes = await gasRequest('getSales');
    if (sRes.ok) sales = sRes.data;
    renderDashboard();
  } else {
    showToast(res.error || 'Failed to submit transaction.', 'error');
  }
}

function openReceiptModal() {
  document.getElementById('receiptModal').classList.remove('hidden');
  const preview = document.getElementById('receiptPreview');
  if (receiptImageData) {
    preview.innerHTML = `<img src="${receiptImageData}" style="width:100%; border:1px solid var(--border); box-shadow:0 4px 12px rgba(0,0,0,0.1);" />`;
  } else {
    preview.innerHTML = '<p class="error-msg">Receipt generation failed.</p>';
  }
}
function closeReceiptModal() {
  document.getElementById('receiptModal').classList.add('hidden');
  receiptImageData = null;
}

function generateReceiptImage(data) {
  const canvas = document.createElement('canvas');
  const ctx    = canvas.getContext('2d');
  
  const W = 280; 
  let H = 220 + (data.items.length * 24);
  canvas.width  = W;
  canvas.height = H;
  
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,W,H);
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  
  ctx.font = 'bold 16px Courier New';
  ctx.fillText('AE HOME TRADE CORP.', W/2, 25);
  ctx.font = '9px Courier New';
  ctx.fillText('VIGAN CITY, ILOCOS SUR', W/2, 38);
  ctx.fillText('PROP: AE HOME TRADE CORP', W/2, 49);
  ctx.fillText('VAT REG TIN: 009-812-345-000', W/2, 60);
  
  ctx.fillText('--------------------------', W/2, 72);
  ctx.textAlign = 'left';
  ctx.fillText(`SI NO:   ${data.id}`, 12, 85);
  ctx.fillText(`DATE:    ${new Date(data.timestamp).toLocaleString([], {hour12:true})}`, 12, 97);
  ctx.fillText(`CASHIER: ${data.cashier.toUpperCase()}`, 12, 109);
  ctx.textAlign = 'center';
  ctx.fillText('--------------------------', W/2, 120);

  let y = 134;
  ctx.textAlign = 'left';
  ctx.font = 'bold 10px Courier New';
  data.items.forEach(item => {
    const title = item.name.substring(0,18);
    ctx.fillText(title, 12, y);
    ctx.textAlign = 'right';
    const lineTot = item.price * item.qty;
    ctx.fillText(lineTot.toFixed(2), W - 12, y);
    y += 12;
    
    ctx.textAlign = 'left';
    ctx.font = '9px Courier New';
    ctx.fillText(`  ${item.qty} ${item.unit} @ ${item.price.toFixed(2)}`, 12, y);
    y += 14;
    ctx.font = 'bold 10px Courier New';
  });

  ctx.font = '9px Courier New';
  ctx.textAlign = 'center';
  ctx.fillText('--------------------------', W/2, y); y+=14;
  
  ctx.textAlign = 'left';
  ctx.font = 'bold 11px Courier New';
  ctx.fillText('TOTAL AMOUNT:', 12, y);
  ctx.textAlign = 'right';
  ctx.fillText('PHP ' + data.total.toFixed(2), W - 12, y); y+=14;

  ctx.textAlign = 'left';
  ctx.font = '9px Courier New';
  ctx.fillText('CASH RECEIVED:', 12, y);
  ctx.textAlign = 'right';
  ctx.fillText(data.cashReceived.toFixed(2), W - 12, y); y+=12;

  ctx.textAlign = 'left';
  ctx.fillText('CHANGE:', 12, y);
  ctx.textAlign = 'right';
  ctx.fillText(data.change.toFixed(2), W - 12, y); y+=16;

  const vatable = data.total / 1.12;
  const vatAmount = data.total - vatable;
  ctx.textAlign = 'left';
  ctx.font = '8px Courier New';
  ctx.fillText(`VATABLE SALES: ${vatable.toFixed(2)}`, 12, y);
  ctx.fillText(`VAT AMOUNT 12%: ${vatAmount.toFixed(2)}`, W/2 + 10, y); y+=18;

  ctx.textAlign = 'center';
  ctx.font = 'bold 9px Courier New';
  ctx.fillText('THANK YOU FOR SHOPPING!', W/2, y); y+=12;
  ctx.font = '7px Courier New';
  ctx.fillText('This document serves as an Official Sales Log Summary.', W/2, y);

  receiptImageData = canvas.toDataURL('image/png');
}

function printReceiptImage() {
  if (!receiptImageData) return;
  const w = window.open();
  w.document.write(`<img src="${receiptImageData}" onload="window.print();window.close();" />`);
  w.document.close();
}

// ── PRODUCTS DATABASE VIEW ───────────────────────────────────
function renderProductsTable() {
  const term = document.getElementById('prodSearchInput').value.toLowerCase();
  const tbody = document.querySelector('#productsTable tbody');
  const filtered = products.filter(p => p.name.toLowerCase().includes(term) || (p.barcode && p.barcode.includes(term)));
  
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-msg">No active items found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(p => `
    <tr>
      <td><code>${p.id}</code></td>
      <td>${p.barcode || '<span style="#ccc;">N/A</span>'}</td>
      <td><strong>${p.name}</strong></td>
      <td><span class="badge badge-teal">${p.category}</span></td>
      <td><strong>${p.qtyPcs} pcs</strong><br><small style="color:var(--text3);">${p.qtyPacks} packs</small></td>
      <td>₱${Number(p.pricePcs).toFixed(2)}<br><small style="color:var(--text3);">Pack: ₱${Number(p.pricePack).toFixed(2)}</small></td>
      <td>${p.unit || 'pcs'}</td>
      <td>
        <div style="display:flex;gap:4px;">
          <button class="action-btn edit-btn" onclick="openEditProductModal('${p.id}')">✏️</button>
          <button class="action-btn stock-btn" onclick="openStockUpdateModal('${p.id}')">📦</button>
          <button class="action-btn delete-btn role-admin-only" onclick="submitDeleteProduct('${p.id}')">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');
  updateUserNavbarUi();
}

function openAddProductModal() {
  if (checkAccess(['admin','clerk'])) return;
  document.getElementById('productModalTitle').innerText = 'Magdagdag ng Bagong Produkto';
  document.getElementById('prodFormId').value = '';
  document.getElementById('prodFormBarcode').value = '';
  document.getElementById('prodFormName').value = '';
  document.getElementById('prodFormCategory').value = 'Grocery';
  document.getElementById('prodFormPricePc').value = '';
  document.getElementById('prodFormPricePack').value = '';
  document.getElementById('prodFormUnit').value = 'pcs';
  document.getElementById('productModal').classList.remove('hidden');
}

function openEditProductModal(id) {
  if (checkAccess(['admin','clerk'])) return;
  const p = products.find(prod => prod.id === id);
  if (!p) return;

  document.getElementById('productModalTitle').innerText = 'I-edit ang Detalye ng Produkto';
  document.getElementById('prodFormId').value = p.id;
  document.getElementById('prodFormBarcode').value = p.barcode || '';
  document.getElementById('prodFormName').value = p.name;
  document.getElementById('prodFormCategory').value = p.category || 'Grocery';
  document.getElementById('prodFormPricePc').value = p.pricePcs;
  document.getElementById('prodFormPricePack').value = p.pricePack;
  document.getElementById('prodFormUnit').value = p.unit || 'pcs';
  document.getElementById('productModal').classList.remove('hidden');
}

function closeProductModal() { 
  document.getElementById('productModal').classList.add('hidden'); 
}

async function submitProductForm() {
  const id       = document.getElementById('prodFormId').value;
  const barcode  = document.getElementById('prodFormBarcode').value.trim();
  const name     = document.getElementById('prodFormName').value.trim();
  const category = document.getElementById('prodFormCategory').value;
  const pricePcs = parseFloat(document.getElementById('prodFormPricePc').value) || 0;
  const pricePack= parseFloat(document.getElementById('prodFormPricePack').value) || 0;
  const unit     = document.getElementById('prodFormUnit').value;

  if(!name) return showToast('Paki-sulat ang pangalan ng produkto!', 'error');
  const payload = { barcode, name, category, pricePcs, pricePack, unit };
  
  if(id) {
    showToast('Updating item contents...', 'info');
    payload.id = id;
    const res = await gasRequest('updateProduct', payload);
    if(res.ok) { showToast('Product updated!', 'success'); closeProductModal(); syncData(); }
    else showToast(res.error, 'error');
  } else {
    showToast('Adding item registry...', 'info');
    const res = await gasRequest('addProduct', payload);
    if(res.ok) { showToast('Product registered!', 'success'); closeProductModal(); syncData(); }
    else showToast(res.error, 'error');
  }
}

async function submitDeleteProduct(id) {
  if (checkAccess(['admin'])) return;
  if (!confirm('Warning: Sigurado ka bang permanenteng buburahin ang produktong ito?')) return;
  
  showToast('Deleting product index...', 'info');
  const res = await gasRequest('deleteProduct', { id });
  if (res.ok) { showToast('Product asset wiped out.', 'success'); syncData(); }
  else showToast(res.error, 'error');
}

// ── STOCK MANAGEMENT ─────────────────────────────────────────
function openStockUpdateModal(id) {
  if (checkAccess(['admin','clerk'])) return;
  const p = products.find(prod => prod.id === id);
  if (!p) return;

  document.getElementById('stockModalId').value = p.id;
  document.getElementById('stockModalItemLabel').innerText = p.name;
  document.getElementById('stockCurrentState').innerText = `${p.qtyPcs} pcs | ${p.qtyPacks} packs`;
  document.getElementById('stockFormQty').value = '';
  document.getElementById('stockFormReason').value = 'Restock Inventory';
  document.getElementById('stockUpdateModal').classList.remove('hidden');
}
function closeStockUpdateModal() {
  document.getElementById('stockUpdateModal').classList.add('hidden');
}

async function submitStockAdjustment() {
  const id        = document.getElementById('stockModalId').value;
  const direction = document.getElementById('stockFormDirection').value;
  const unit      = document.getElementById('stockFormUnit').value;
  const qty       = parseInt(document.getElementById('stockFormQty').value) || 0;
  const reason    = document.getElementById('stockFormReason').value.trim();

  if (qty <= 0) return showToast('Paki-lagay ang tamang bilang ng stock adjustments', 'error');
  const p = products.find(prod => prod.id === id);
  if (!p) return;

  let currentQty = unit === 'pcs' ? Number(p.qtyPcs) : Number(p.qtyPacks);
  let newQty = (direction === 'in') ? (currentQty + qty) : (currentQty - qty);
  if (newQty < 0) return showToast('Sobering Level: Hindi pwedeng maging negative ang stock count.', 'error');

  showToast('Saving logging updates...', 'info');
  const res = await gasRequest('stockUpdate', {
    productId: id, direction, qty, unit, reason: reason || 'Audit Adjustment', newQty
  });

  if (res.ok) { showToast('Inventory logs synchronized!', 'success'); closeStockUpdateModal(); syncData(); }
  else showToast(res.error, 'error');
}

// ── TRANSACTION REPORTS VIEW ─────────────────────────────────
function renderSalesTable() {
  const tbody = document.querySelector('#salesTable tbody');
  if (sales.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">No transactions logged yet
