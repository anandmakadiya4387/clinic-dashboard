const APP_VERSION = 'PRO 5';
const role = document.body.dataset.role || 'office';
const savedTheme = localStorage.getItem('anandClinicTheme') || 'light';
document.documentElement.dataset.theme = savedTheme;
const KEY = 'anandClinicV16_' + role;
const OLD_KEYS = ['anandClinicV15_' + role, 'anandClinicV14_' + role, 'anandClinicV13_' + role, 'anandClinicV12_' + role];
const SERVER_KEY = 'anandClinicServerV27';
const DEVICE_KEY = 'anandClinicDeviceV27';
const DEVICE_ID = localStorage.getItem(DEVICE_KEY) || ('device_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,10));
localStorage.setItem(DEVICE_KEY, DEVICE_ID);
const $ = s => document.querySelector(s),
    $$ = s => [...document.querySelectorAll(s)];
const money = n => '₹ ' + Number(n || 0).toLocaleString('en-IN', {
    maximumFractionDigits: 0
});

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function isoToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function fmtDate(v) {
    if (!v) return '-';
    const [y, m, d] = String(v).split('-');
    return `${d}/${m}/${y}`
}

function addYear(v) {
    if (!v) return '';
    const d = new Date(v + 'T00:00:00');
    d.setFullYear(d.getFullYear() + 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function dueDate(p) {
    return p.lastRenewalDate ? addYear(p.lastRenewalDate) : addYear(p.date)
}

function renewalDue(p, as = isoToday()) {
    return !!dueDate(p) && dueDate(p) <= as
}

function hasRenewalPayment(p) {
    return active(DB.payments).some(x => x.patientId === p.id && (x.feeCategory === 'renewal' || x.caseType === 'renewal') && Number(x.amount || 0) > 0);
}

/** Permanent case number for a patient row */
function permanentCaseNo(p) {
    return p.linkedCaseNo || p.caseNo;
}

/** Prefer original new-case registration for a case number */
function primaryRegistration(caseNo) {
    const rows = active(DB.patients).filter(p => String(permanentCaseNo(p)) === String(caseNo));
    if (!rows.length) return null;
    const news = rows.filter(p => p.caseType === 'new').sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (news.length) return news[0];
    return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
}

/** Patients with renewal due (unique by permanent case no, based on primary registration) */
function listRenewalDuePatients() {
    const map = new Map();
    active(DB.patients).forEach(p => {
        if (p.caseType === 'old' && p.linkedFromId) return; // skip follow-up rows for counting base
        const key = String(permanentCaseNo(p));
        if (map.has(key)) return;
        const prim = primaryRegistration(key) || p;
        // Check renewal against primary + any payments for this case family
        const due = renewalDue(prim);
        const paid = hasRenewalPaymentForCase(key);
        if (due && !paid) map.set(key, prim);
    });
    return [...map.values()].sort((a, b) => String(dueDate(a) || '').localeCompare(String(dueDate(b) || '')));
}

function hasRenewalPaymentForCase(caseNo) {
    const ids = active(DB.patients).filter(p => String(permanentCaseNo(p)) === String(caseNo)).map(p => p.id);
    return active(DB.payments).some(x => ids.includes(x.patientId) && (x.feeCategory === 'renewal' || x.caseType === 'renewal') && Number(x.amount || 0) > 0);
}

/** All patient rows belonging to the same permanent case number */
function caseFamily(pOrCaseNo) {
    const key = typeof pOrCaseNo === 'object' ? String(permanentCaseNo(pOrCaseNo)) : String(pOrCaseNo);
    return active(DB.patients).filter(x => String(permanentCaseNo(x)) === key)
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

/** All payments for the entire case family */
function familyPayments(pOrCaseNo) {
    const ids = new Set(caseFamily(pOrCaseNo).map(x => x.id));
    return active(DB.payments).filter(x => ids.has(x.patientId))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

/** Total amount paid across the whole case family */
function familyPaidTotal(pOrCaseNo) {
    return familyPayments(pOrCaseNo).reduce((s, x) => s + Number(x.amount || 0), 0);
}

function listTodayPendingPatients() {
    return active(DB.patients).filter(p => {
        if (!isTodayCase(p)) return false;
        return pendingFor(p) > 0;
    }).sort((a, b) => caseNoNumericPart(a.caseNo) - caseNoNumericPart(b.caseNo));
}



function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    } [c]))
}

function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
}
const DEFAULT = {
    schemaVersion: 25,
    patients: [],
    payments: [],
    expenses: [],
    medicines: [],
    settings: {
        receptionPaymentEnabled: false,
        receptionPermissions: {
            patient: 'edit',
            payment: 'view',
            paymentEntry: 'hidden',
            medicine: 'view',
            medicineEntry: 'hidden',
            reports: 'hidden',
            dashboard: 'edit',
            clinic: 'hidden',
            dashNewOldEntry: 'edit',
            dashTodayQueue: 'view',
            dashQueueStatus: 'view',
            dashMoreStats: 'view',
            paymentClinic: 'view',
            paymentYearly: 'view',
            paymentIncome: 'view',
            paymentSpend: 'view'
        },
        _updated: ''
    },
    clinic: {
        name: 'Anand Homoeopathy Multi Speciality Clinic',
        logo: 'clinic-logo.jpg',
        address: '',
        phone: '',
        _updated: ''
    },
    meta: {
        deleted: []
    }
};
let DB = loadLocal();
let server = localStorage.getItem(SERVER_KEY) || '';
if (location.protocol === 'http:' && (location.hostname === '127.0.0.1' || location.hostname === 'localhost') && (location.port === '8787' || location.port === '8789')) {
    if (!server || /^(https?:\/\/)(localhost|127\.0\.0\.1):(8787|8789)$/.test(server)) server = location.origin;
}
if (server && !/^https?:\/\//.test(server)) server = '';
let reportKind = 'patients',
    reportType = 'total',
    reportPeriod = 'daily',
    medPage = 1,
    medPageSize = 10,
    receptionMedPage = 1,
    patientTypeFilter = 'new',
    patientReportPage = 1,
    patientReportPageSize = 25,
    expenseMonthlyYear = String(new Date().getFullYear()),
    expenseYearPage = 1,
    expenseYearPageSize = 10,
    expenseYearShowAll = false,
    spendLedgerPage = 1,
    spendLedgerPageSize = 20,
    spendLedgerY = '',
    spendLedgerM = '',
    histPage = 1,
    histPageSize = 10,
    histQuery = '',
    queuePage = 1,
    queuePageSize = 10,
    autoBackupTimer = null,
    patientFilterY = '',
    patientFilterM = '',
    patientFilterD = '',
    payFilterY = '',
    monthlyCompareYear = String(new Date().getFullYear()),
    yearComparePage = 1,
    yearComparePageSize = 10,
    yearCompareShowAll = false,
    payFilterM = '',
    payFilterD = '',
    rangeFrom = '',
    rangeTo = '',
    patientFromDate = '',
    patientToDate = '',
    paymentFromDate = '',
    paymentToDate = '',
    calendarDate = isoToday();

function normalizeData(d) {
    const out = Object.assign(structuredClone(DEFAULT), d || {});
    out.schemaVersion = Math.max(30, Number(out.schemaVersion || 0));
    const oldSettings = out.settings || {};
    out.settings = Object.assign(structuredClone(DEFAULT.settings), oldSettings);
    out.settings.receptionPermissions = Object.assign(structuredClone(DEFAULT.settings.receptionPermissions), oldSettings.receptionPermissions || {});
    const rp = out.settings.receptionPermissions;
    // Migrate legacy YES/NO permissions to Hidden/View/Edit.
    ['patient','payment','medicine'].forEach(k => {
        if (typeof rp[k] === 'boolean') rp[k] = rp[k] ? 'edit' : 'hidden';
    });
    if (!oldSettings.receptionPermissions && oldSettings.receptionPaymentEnabled === true) rp.payment = 'view';
    if (!('paymentEntry' in rp)) rp.paymentEntry = 'hidden';
    if (!('medicineEntry' in rp)) rp.medicineEntry = 'hidden';
    if (!('reports' in rp)) rp.reports = 'hidden';
    if (!('dashboard' in rp)) rp.dashboard = 'edit';
    if (!('dashNewOldEntry' in rp)) rp.dashNewOldEntry = rp.dashboard || 'edit';
    if (!('dashTodayQueue' in rp)) rp.dashTodayQueue = rp.dashboard || 'view';
    if (!('dashQueueStatus' in rp)) rp.dashQueueStatus = rp.dashboard || 'view';
    if (!('dashMoreStats' in rp)) rp.dashMoreStats = 'view';
    if (!('paymentClinic' in rp)) rp.paymentClinic = rp.payment || 'view';
    if (!('paymentYearly' in rp)) rp.paymentYearly = rp.payment || 'view';
    if (!('paymentIncome' in rp)) rp.paymentIncome = rp.payment || 'view';
    if (!('paymentSpend' in rp)) rp.paymentSpend = rp.payment || 'view';
    if (!('clinic' in rp)) rp.clinic = 'hidden';
    out.clinic = Object.assign(structuredClone(DEFAULT.clinic), out.clinic || {});
    out.meta = Object.assign(structuredClone(DEFAULT.meta), out.meta || {});
    out.patients = Array.isArray(out.patients) ? out.patients.filter(x => x && x.id) : [];
    out.medicines = Array.isArray(out.medicines) ? out.medicines.filter(x => x && x.id) : [];
    out.expenses = Array.isArray(out.expenses) ? out.expenses.filter(x => x && x.id && Number(x.amount || 0) >= 0) : [];
    out.payments = Array.isArray(out.payments) ? out.payments.filter(x => x && x.patientId && !x.demoSeed && Number(x.amount || 0) !== 1800) : [];
    // De-duplicate accidental repeated patient registrations while preserving the newest edit.
    const seenPatients = new Map();
    out.patients.forEach(x => { const fp=[x.caseNo,x.date,x.caseType,String(x.name||'').trim().toLowerCase(),String(x.mobile||'').replace(/\D/g,'')].join('|'); const old=seenPatients.get(fp); if(!old || String(x._updated||'')>String(old._updated||'')) seenPatients.set(fp,x); });
    out.patients=[...seenPatients.values()];
    return out;
}

function loadLocal() {
    try {
        let raw = localStorage.getItem(KEY);
        if (!raw) {
            for (const k of OLD_KEYS) {
                raw = localStorage.getItem(k);
                if (raw) break
            }
        }
        const d = raw ? JSON.parse(raw) : null;
        return normalizeData(d)
    } catch {
        return structuredClone(DEFAULT)
    }
}

function saveLocal() {
    DB = normalizeData(DB);
    localStorage.setItem(KEY, JSON.stringify(DB));
    renderAll()
}

function active(a) {
    return a.filter(x => !x._deleted)
}


function caseNoNumericPart(caseNo) {
    const s = String(caseNo || '').trim();
    const m = s.match(/(\d+)\s*$/);
    return m ? Number(m[1]) : 0;
}

function normalizeCaseNoInput(raw) {
    let s = String(raw || '').trim();
    if (!s) return s;
    if (/^\d+$/.test(s)) {
        return '0A' + s.padStart(6, '0');
    }
    const m = s.match(/^([A-Za-z]+)(\d+)$/);
    if (m && m[1].toUpperCase() === '0A') {
        return '0A' + m[2].padStart(6, '0');
    }
    return s;
}

function migrateCaseNumbersToPrefixed() {
    if (!DB.patients) return 0;
    let n = 0;
    DB.patients.forEach(p => {
        if (!p) return;
        const c = String(p.caseNo ?? '').trim();
        if (/^\d+$/.test(c)) {
            p.caseNo = '0A' + c.padStart(6, '0');
            markUpdated(p);
            n++;
        } else if (/^0A\d+$/i.test(c)) {
            const dig = c.replace(/^0A/i, '');
            const fixed = '0A' + dig.padStart(6, '0');
            if (fixed !== c) {
                p.caseNo = fixed;
                markUpdated(p);
                n++;
            }
        }
        const lc = String(p.linkedCaseNo ?? '').trim();
        if (lc && /^\d+$/.test(lc)) {
            p.linkedCaseNo = '0A' + lc.padStart(6, '0');
            markUpdated(p);
            n++;
        }
    });
    if (n) {
        try { saveLocal(); } catch (e) {}
    }
    return n;
}

function maxCase() {
    return active(DB.patients).reduce((m, p) => Math.max(m, caseNoNumericPart(p.caseNo), caseNoNumericPart(p.linkedCaseNo)), 0);
}

function nextCase() {
    const n = maxCase() + 1;
    return '0A' + String(n).padStart(6, '0');
}

function feeTotal(p) {
    return Number(p.consultation || 0) + Number(p.medicine || 0) + (renewalDue(p) ? Number(p.renewal || 0) : 0)
}

function paidFor(id) {
    return active(DB.payments).filter(x => x.patientId === id).reduce((s, x) => s + Number(x.amount || 0), 0)
}

function pendingFor(p) {
    return Math.max(0, feeTotal(p) - paidFor(p.id))
}

/** Unified payment status: foc | pending | partial | received */
function paymentStatusInfo(p) {
    if (!p) return { kind: 'foc', label: 'FOC', pending: 0, paid: 0, fees: 0, locked: false };
    const fees = feeTotal(p);
    const paid = paidFor(p.id);
    const pending = Math.max(0, fees - paid);
    // FOC only when explicitly marked — zero fees ≠ FOC (Reception register stays Pending/Waiting)
    if (p.foc === true) {
        return { kind: 'foc', label: 'FOC', pending: 0, paid: 0, fees: 0, locked: false };
    }
    if (p.received === true && pending <= 0) {
        return { kind: 'received', label: 'Received', pending: 0, paid, fees, locked: true };
    }
    if (pending <= 0 && paid > 0) {
        return { kind: 'received', label: 'Received', pending: 0, paid, fees, locked: true };
    }
    if (paid > 0 && pending > 0) {
        return { kind: 'partial', label: 'Partial', pending, paid, fees, locked: false };
    }
    return { kind: 'pending', label: 'Pending', pending: pending || 0, paid: paid || 0, fees, locked: false };
}

function paymentStatusHtml(p) {
    const st = paymentStatusInfo(p);
    if (st.kind === 'foc') return '<span class="payFocTag">FOC</span>';
    if (st.kind === 'received') return '<span class="payReceivedTag">Received</span>';
    if (st.kind === 'partial') return `<span class="payPartialTag">Partial</span> <span class="mini">Paid ${money(st.paid)} · Due ${money(st.pending)}</span>`;
    return `<span class="payPendingTag">Pending ${money(st.pending)}</span>`;
}

function isPaymentLocked(p) {
    return paymentStatusInfo(p).locked === true;
}


function markUpdated(x) {
    x._updated = new Date().toISOString();
    x._deviceId = DEVICE_ID;
    return x
}

function toast(t, bad = false) {
    const x = document.createElement('div');
    x.className = 'toast' + (bad ? ' bad' : '');
    x.textContent = t;
    document.body.appendChild(x);
    setTimeout(() => x.remove(), 2600)
}
async function api(path, method = 'GET', body) {
    if (!server) return null;
    const r = await fetch(server.replace(/\/$/, '') + path, {
        method,
        headers: {
            'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(Object.assign({deviceId: DEVICE_ID}, body)) : undefined
    });
    if (!r.ok) throw new Error('Server error ' + r.status);
    return r.json()
}

function mergeLocalRemote(remote) {
    const merge = (a, b) => {
        const map = new Map();
        [...active(a), ...active(b)].forEach(x => {
            const old = map.get(x.id);
            if (!old || String(x._updated || '') > String(old._updated || '')) map.set(x.id, x)
        });
        return [...map.values()]
    };
    DB.patients = merge(DB.patients, remote.patients || []);
    DB.payments = merge(DB.payments, remote.payments || []).filter(x => x && x.patientId && !x.demoSeed && Number(x.amount || 0) !== 1800);
    DB.medicines = merge(DB.medicines, remote.medicines || []);
    DB.expenses = merge(DB.expenses || [], remote.expenses || []);
    const dels = new Set([...(DB.meta.deleted || []), ...((remote.meta || {}).deleted || [])]);
    ['patients', 'payments', 'medicines', 'expenses'].forEach(k => {
        DB[k] = DB[k].filter(x => !dels.has(x.id))
    });
    if (String(remote.settings?._updated || '') > String(DB.settings?._updated || '')) DB.settings = remote.settings;
    if (String(remote.clinic?._updated || '') > String(DB.clinic?._updated || '')) DB.clinic = remote.clinic;
    DB.meta.deleted = [...dels];
    DB.settings = Object.assign(structuredClone(DEFAULT.settings), DB.settings || {});
    DB.settings.receptionPermissions = Object.assign(structuredClone(DEFAULT.settings.receptionPermissions), DB.settings.receptionPermissions || {});
}

let clinicWs = null;
let clinicWsTimer = null;
function connectClinicWebSocket() {
    try {
        if (!server || !/^https?:\/\//.test(server)) return;
        const wsBase = server.replace(/^http/, 'ws').replace(/\/$/, '');
        if (clinicWs) {
            try { clinicWs.close(); } catch (e) {}
            clinicWs = null;
        }
        const ws = new WebSocket(wsBase + '/ws');
        clinicWs = ws;
        ws.onopen = () => {
            setConn(true, 'Live WebSocket connected', 0);
            try { ws.send('ping'); } catch (e) {}
        };
        ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data || '{}');
                if (msg.type === 'data_changed' || msg.type === 'sync_ok') {
                    syncNow(true).then(() => {
                        try { if (typeof renderDashboard === 'function') renderDashboard(); } catch (e) {}
                        try { if (typeof renderReceptionQueue === 'function') renderReceptionQueue(); } catch (e) {}
                        try { if (typeof renderPatientReport === 'function') renderPatientReport(); } catch (e) {}
                    }).catch(() => {});
                }
            } catch (e) {}
        };
        ws.onclose = () => {
            clinicWs = null;
            clearTimeout(clinicWsTimer);
            clinicWsTimer = setTimeout(connectClinicWebSocket, 4000);
        };
        ws.onerror = () => { try { ws.close(); } catch (e) {} };
    } catch (e) {}
}

async function syncNow(silent = false) {
    if (!server) {
        setConn(false, 'Offline mode — entries are stored on this computer.', null);
        return
    }
    const t0 = performance.now();
    try {
        const remote = await api('/api/data');
        mergeLocalRemote(remote);
        const out = await api('/api/sync', 'POST', DB);
        mergeLocalRemote(out);
        saveLocal();
        const lag = Math.round(performance.now() - t0);
        setConn(true, 'Connected and synchronized.', lag);
        if (!clinicWs || clinicWs.readyState > 1) connectClinicWebSocket();
        if (!silent) toast('Synchronized successfully')
    } catch (e) {
        setConn(false, 'Offline mode. Local entries are safe and will sync when connection returns.', null);
        if (!silent) toast('Sync unavailable — working offline', true)
    }
}

function setConn(ok, msg, lagMs) {
    const dot = $('#connDot'),
        txt = $('#connText'),
        big = $('#connBig'),
        detail = $('#connDetail');
    if (dot) {
        dot.className = 'status ' + (ok ? 'ok' : 'off');
        dot.textContent = ok ? 'Online' : 'Offline';
    }
    if (txt) txt.textContent = ok ? 'Online' : 'Offline';
    if (big) {
        big.textContent = ok
            ? (`Online · lag ${lagMs != null ? lagMs : '—'} ms`)
            : 'Offline / not connected';
        big.className = 'connectionBig ' + (ok ? 'ok' : 'off')
    }
    if (detail) detail.textContent = msg || '';
    if ($('#serverUrl')) $('#serverUrl').value = server;
    const live = $('#syncLiveBadge');
    if (live) {
        if (ok) {
            live.textContent = lagMs != null ? `Online · ${lagMs} ms` : 'Online';
            live.className = 'syncLiveBadge live online';
        } else {
            live.textContent = 'Offline';
            live.className = 'syncLiveBadge off offline';
        }
    }
    const ls = $('#lastSyncText');
    if (ls) {
        if (ok) {
            window.__lastSyncAt = new Date();
            ls.textContent = 'Last sync: ' + window.__lastSyncAt.toLocaleTimeString();
        } else if (window.__lastSyncAt) {
            ls.textContent = 'Last sync: ' + window.__lastSyncAt.toLocaleTimeString() + ' (stale)';
        } else {
            ls.textContent = '';
        }
    }
}
async function testConn() {
    if (!server) {
        setConn(false, 'Enter a server URL such as http://192.168.1.25:8787');
        return
    }
    try {
        await api('/api/health');
        setConn(true, 'Server is reachable. Click Connect & Sync to merge data.')
    } catch (e) {
        setConn(false, 'Server is not reachable. You can continue offline.')
    }
}

function caseRows() {
    return active(DB.patients).sort((a, b) => caseNoNumericPart(a.caseNo) - caseNoNumericPart(b.caseNo) || String(a.date).localeCompare(String(b.date)))
}

/** Bill patient list: ONLY unique New Case registrations (one name once), latest case no on top */
function billUniquePatients() {
    const map = new Map();
    active(DB.patients).forEach(p => {
        if ((p.caseType || '') !== 'new') return;
        const key = String(permanentCaseNo(p) || p.caseNo || p.id);
        const prev = map.get(key);
        if (!prev) {
            map.set(key, p);
            return;
        }
        if (String(p.date || '') < String(prev.date || '')) map.set(key, p);
    });
    return [...map.values()].sort((a, b) => {
        const nb = caseNoNumericPart(b.caseNo || permanentCaseNo(b));
        const na = caseNoNumericPart(a.caseNo || permanentCaseNo(a));
        if (nb !== na) return nb - na;
        return String(b.date || '').localeCompare(String(a.date || ''));
    });
}

function periodMatch(date, p) {
    const d = isoToday(),
        v = String(date || '');
    if (rangeFrom || rangeTo) {
        if (rangeFrom && v < rangeFrom) return false;
        if (rangeTo && v > rangeTo) return false;
        return true
    }
    if (p === 'total') return true;
    if (p === 'daily') return v === d;
    if (p === 'monthly') return v.slice(0, 7) === d.slice(0, 7);
    return v.slice(0, 4) === d.slice(0, 4);
}

function dateSelects(prefix) {
    const y = $('#' + prefix + 'Year'),
        m = $('#' + prefix + 'Month'),
        day = $('#' + prefix + 'Day');
    if (!y || !m || !day) return;
    const current = new Date(),
        cy = current.getFullYear();
    y.innerHTML = '';
    for (let yy = cy - 10; yy <= cy + 5; yy++) y.insertAdjacentHTML('beforeend', `<option value="${yy}">${yy}</option>`);
    m.innerHTML = '<option value="">Any month</option>';
    for (let mm = 1; mm <= 12; mm++) m.insertAdjacentHTML('beforeend', `<option value="${String(mm).padStart(2,'0')}">${String(mm).padStart(2,'0')}</option>`);
    day.innerHTML = '<option value="">Any day</option>';
    for (let dd = 1; dd <= 31; dd++) day.insertAdjacentHTML('beforeend', `<option value="${String(dd).padStart(2,'0')}">${String(dd).padStart(2,'0')}</option>`);
    y.value = String(cy);
}

function applyDateSelect(prefix) {
    const y = $('#' + prefix + 'Year')?.value,
        m = $('#' + prefix + 'Month')?.value,
        d = $('#' + prefix + 'Day')?.value;
    if (!y) return;
    if (m && d) {
        const iso = `${y}-${m}-${d}`;
        const el = $('#' + prefix.replace('Year', 'From'));
        if (el) el.value = iso;
        const to = $('#' + prefix.replace('Year', 'To'));
        if (to) to.value = iso
    } else if (m) {
        const from = `${y}-${m}-01`,
            last = new Date(Number(y), Number(m), 0).getDate();
        const el = $('#' + prefix.replace('Year', 'From'));
        if (el) el.value = from;
        const to = $('#' + prefix.replace('Year', 'To'));
        if (to) to.value = `${y}-${m}-${String(last).padStart(2,'0')}`
    } else {
        const el = $('#' + prefix.replace('Year', 'From'));
        if (el) el.value = `${y}-01-01`;
        const to = $('#' + prefix.replace('Year', 'To'));
        if (to) to.value = `${y}-12-31`
    }
}

function setReportRange(from, to) {
    if (reportKind === 'patients') {
        patientFromDate = from || '';
        patientToDate = to || ''
    } else {
        paymentFromDate = from || '';
        paymentToDate = to || ''
    }
    rangeFrom = reportKind === 'patients' ? patientFromDate : paymentFromDate;
    rangeTo = reportKind === 'patients' ? patientToDate : paymentToDate;
    reportPeriod = (rangeFrom || rangeTo) ? 'custom' : reportPeriod;
    renderReports()
}

function clearReportRange() {
    if (reportKind === 'patients') {
        patientFromDate = '';
        patientToDate = ''
    } else {
        paymentFromDate = '';
        paymentToDate = ''
    }
    rangeFrom = '';
    rangeTo = '';
    if (reportPeriod === 'custom') reportPeriod = 'daily';
    renderReports()
}
const FESTIVALS_2026 = [
    ['Makar Sankranti', '2026-01-14'],
    ['Vasant Panchami', '2026-01-23'],
    ['Maha Shivaratri', '2026-02-15'],
    ['Holi', '2026-03-04'],
    ['Rama Navami', '2026-03-27'],
    ['Mahavir Jayanti', '2026-03-31'],
    ['Hanuman Jayanti', '2026-04-02'],
    ['Akshaya Tritiya', '2026-04-19'],
    ['Jagannath Rathyatra', '2026-07-16'],
    ['Guru Purnima', '2026-07-29'],
    ['Raksha Bandhan', '2026-08-28'],
    ['Krishna Janmashtami', '2026-09-04'],
    ['Ganesh Chaturthi', '2026-09-14'],
    ['Navratri Begins', '2026-10-11'],
    ['Dussehra', '2026-10-20'],
    ['Diwali', '2026-11-08'],
    ['Gujarati New Year', '2026-11-09'],
    ['Bhai Dooj', '2026-11-10'],
    ['Guru Nanak Jayanti', '2026-11-24'],
    ['Christmas', '2026-12-25']
];

function festivalInfo(date) {
    const target = new Date(date + 'T00:00:00');
    let list = FESTIVALS_2026.map(([name, ds]) => ({
        name,
        date: ds,
        dt: new Date(ds + 'T00:00:00')
    })).filter(x => x.dt >= target).sort((a, b) => a.dt - b.dt);
    if (!list.length) list = FESTIVALS_2026.map(([name, ds]) => ({
        name,
        date: ds,
        dt: new Date(ds + 'T00:00:00')
    })).sort((a, b) => a.dt - b.dt);
    return list[0];
}

function renderCalendarInfo() {
    const e = $('#calendarDate');
    if (e) e.value = calendarDate;
    const f = festivalInfo(calendarDate);
    if (!f) return;
    const t = new Date(calendarDate + 'T00:00:00'),
        fd = new Date(f.date + 'T00:00:00');
    const diff = Math.ceil((fd - t) / 86400000);
    const show = diff >= 0 && diff <= 15;
    set('festivalInfo', show ? `Upcoming festival: ${f.name} — ${fmtDate(f.date)} (in ${diff} day${diff===1?'':'s'})` : 'No festival within the next 15 days');
    set('calendarSelected', `Selected date: ${fmtDate(calendarDate)}`);
}

function isRecurringYearEnabled(year) {
    const y = String(year || '');
    const dis = DB.settings?.recurringDisabledYears;
    if (!Array.isArray(dis)) return true;
    return !dis.includes(y);
}

function expenseCountsInTotals(x) {
    if (!x || x._deleted) return false;
    return true;
}

function expenseAmount(period='total', y=null, m=null, d=null) {
    return active(DB.expenses || []).filter(x => {
        if (!expenseCountsInTotals(x)) return false;
        const ds=String(x.date||''); if (period==='total' && !y && !m && !d) return true;
        if (y && ds.slice(0,4)!==String(y)) return false;
        if (m && ds.slice(5,7)!==String(m).padStart(2,'0')) return false;
        if (d && ds.slice(8,10)!==String(d).padStart(2,'0')) return false;
        return true;
    }).reduce((a,x)=>a+Number(x.amount||0),0);
}
function netIncomeForPeriod(p) {
    const gross=active(DB.payments).filter(x=>periodMatch(x.date,p)).reduce((a,x)=>a+Number(x.amount||0),0);
    const exp=active(DB.expenses||[]).filter(x=>periodMatch(x.date,p) && expenseCountsInTotals(x)).reduce((a,x)=>a+Number(x.amount||0),0);
    return gross-exp;
}

function stats() {
    const ps = active(DB.patients),
        pays = active(DB.payments),
        d = isoToday();
    const count = (type, p) => ps.filter(x => (type === 'total' || x.caseType === type) && periodMatch(x.date, p)).length;
    const pay = (type, p) => pays.filter(x => (type === 'total' || x.caseType === type) && periodMatch(x.date, p)).reduce((s, x) => s + Number(x.amount || 0), 0);
    return {
        newD: count('new', 'daily'),
        oldD: count('old', 'daily'),
        totalD: count('total', 'daily'),
        incomeD: netIncomeForPeriod('daily'),
        incomeM: netIncomeForPeriod('monthly'),
        incomeY: netIncomeForPeriod('yearly'),
        patient: {
            newD: count('new', 'daily'),
            oldD: count('old', 'daily'),
            totalD: count('total', 'daily'),
            newM: count('new', 'monthly'),
            oldM: count('old', 'monthly'),
            totalM: count('total', 'monthly'),
            newY: count('new', 'yearly'),
            oldY: count('old', 'yearly'),
            totalY: count('total', 'yearly'),
            newT: count('new', 'total'),
            oldT: count('old', 'total'),
            renewT: ps.filter(hasRenewalPayment).length,
            totalT: ps.length
        },
        payment: {
            newD: pay('new', 'daily'),
            oldD: pay('old', 'daily'),
            renewalD: pay('renewal', 'daily'),
            totalD: pay('total', 'daily'),
            newM: pay('new', 'monthly'),
            oldM: pay('old', 'monthly'),
            renewalM: pay('renewal', 'monthly'),
            totalM: pay('total', 'monthly'),
            newY: pay('new', 'yearly'),
            oldY: pay('old', 'yearly'),
            renewalY: pay('renewal', 'yearly'),
            totalY: pay('total', 'yearly'),
            newT: pay('new', 'total'),
            oldT: pay('old', 'total'),
            renewalT: pay('renewal', 'total'),
            totalT: pay('total', 'total')
        }
    }
}

function set(id, v) {
    const e = $('#' + id);
    if (e) e.textContent = v
}

function patientQueueStatus(p) {
    // Waiting → With Doctor → Completed only after Office Receive (or explicit FOC)
    if (p.foc === true && (p.received === true || !!p.completedAt)) return 'completed';
    if (p.received === true && pendingFor(p) <= 0) return 'completed';
    if (p.withDoctor) return 'doctor';
    return 'waiting';
}

function renderDashboard() {
    const s = stats();
    const today = isoToday();
    const todayPatients = active(DB.patients).filter(p => String(p.date || '') === today);
    const receivedToday = active(DB.payments).filter(x => String(x.date || '') === today)
        .reduce((a, x) => a + Number(x.amount || 0), 0);
    const pendingToday = todayPatients.reduce((a, p) => a + pendingFor(p), 0);
    const withDoc = todayPatients.filter(p => patientQueueStatus(p) === 'doctor').length;
    const waiting = todayPatients.filter(p => patientQueueStatus(p) === 'waiting').length;
    const completed = todayPatients.filter(p => patientQueueStatus(p) === 'completed').length;
    const renewDue = listRenewalDuePatients().length;
    const lowStock = active(DB.medicines).filter(m => {
        const q = Number(m.quantity || 0);
        return q <= 0 || String(m.available || '').toLowerCase() === 'no';
    }).length;
    // Morning before 14:00 entry time if stored, else split by caseNo heuristic — use created hour from _updated or default all morning
    let morning = 0, evening = 0;
    todayPatients.forEach(p => {
        const ts = p._updated || p.completedAt || (p.date + 'T10:00:00');
        const h = new Date(ts).getHours();
        if (!isNaN(h) && h >= 14) evening++; else morning++;
    });

    const yearCollect = active(DB.payments || []).filter(x => String(x.date || '').slice(0, 4) === today.slice(0, 4))
        .reduce((a, x) => a + Number(x.amount || 0), 0);
    set('topNew', s.newD);
    set('topOld', s.oldD);
    set('topTotal', s.totalD);
    set('topIncome', money(receivedToday));
    set('topReceived', money(receivedToday));
    set('topPending', money(pendingToday));
    set('topMonth', money(s.incomeM));
    set('topYear', money(s.incomeY));
    set('topYearCollect', money(yearCollect));
    set('topWithDoctor', withDoc);
    set('topRenewDue', renewDue);
    set('topLowStock', lowStock);
    set('qWaiting', waiting);
    set('qWithDoctor', withDoc);
    set('qCompleted', completed);
    set('renewCount', s.patient?.renewT || renewDue);
    set('pendingTotal', money(active(DB.patients).reduce((a, p) => a + pendingFor(p), 0)));
    try { renderQueue(); } catch (e) {}
    try { renderReceptionQueue(); } catch (e) {}
    try { setupKpiCollapse(); } catch (e) {}
}

function financialYearRange(label) {
    // label like 2025-26
    const startY = Number(String(label || '').slice(0, 4));
    if (!startY) {
        const n = new Date();
        const y = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1;
        return { start: y + '-04-01', end: (y + 1) + '-03-31', label: y + '-' + String(y + 1).slice(2) };
    }
    return { start: startY + '-04-01', end: (startY + 1) + '-03-31', label: String(label) };
}

function currentFyLabel() {
    const n = new Date();
    const y = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1;
    return y + '-' + String(y + 1).slice(2);
}

function initReportFySelect() {
    const sel = $('#reportFySelect');
    if (!sel) return;
    const cur = currentFyLabel();
    const start = 2019;
    const cy = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    const prev = sel.value || cur;
    let html = '';
    for (let y = cy; y >= start; y--) {
        const lab = y + '-' + String(y + 1).slice(2);
        html += `<option value="${lab}">FY ${lab}</option>`;
    }
    sel.innerHTML = html;
    if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
    else sel.value = cur;
    // Ensure visible selected text
    if (!sel.value) sel.value = cur;
    const bar = $('#reportFyBtnBar');
    if (bar) {
        let bh = '';
        for (let y = cy; y >= start; y--) {
            const lab = y + '-' + String(y + 1).slice(2);
            const active = lab === sel.value ? ' active' : '';
            bh += `<button type="button" class="btn embossed yearPickBtn${active}" data-fy="${lab}">FY ${lab}</button>`;
        }
        bar.innerHTML = bh;
        bar.querySelectorAll('[data-fy]').forEach(btn => {
            btn.onclick = () => {
                sel.value = btn.getAttribute('data-fy');
                renderReports();
            };
        });
    }
    if (!sel._bound) {
        sel._bound = true;
        sel.addEventListener('change', () => renderReports());
        $('#reportRefreshBtn')?.addEventListener('click', () => renderReports());
    }
}

function renderReports() {
    // Always rebuild FY list first so dropdown is never blank
    initReportFySelect();
    const selVal = $('#reportFySelect')?.value || currentFyLabel();
    const fy = financialYearRange(selVal);
    const inFy = (d) => {
        const s = String(d || '');
        return s >= fy.start && s <= fy.end;
    };
    // Previous FY for growth %
    const startY = Number(String(fy.label).slice(0, 4)) || (new Date().getFullYear());
    const prevLab = (startY - 1) + '-' + String(startY).slice(2);
    const prevFy = financialYearRange(prevLab);
    const inPrev = (d) => {
        const s = String(d || '');
        return s >= prevFy.start && s <= prevFy.end;
    };

    const pays = active(DB.payments || []);
    const fyPays = pays.filter(x => inFy(x.date));
    const fyTotal = fyPays.reduce((a, x) => a + Number(x.amount || 0), 0);
    const renewFy = fyPays.filter(x => x.feeCategory === 'renewal' || x.caseType === 'renewal').reduce((a, x) => a + Number(x.amount || 0), 0);
    const medFy = fyPays.filter(x => x.feeCategory === 'medicine').reduce((a, x) => a + Number(x.amount || 0), 0);
    const consultFy = fyPays.filter(x => x.feeCategory === 'consultation' || (!x.feeCategory && x.caseType === 'new')).reduce((a, x) => a + Number(x.amount || 0), 0);
    // patients
    const newFy = active(DB.patients).filter(p => p.caseType === 'new' && inFy(p.date)).length;
    const oldFy = active(DB.patients).filter(p => p.caseType !== 'new' && inFy(p.date)).length;
    const newPrev = active(DB.patients).filter(p => p.caseType === 'new' && inPrev(p.date)).length;
    let growthPct = 0;
    let growthLabel = 'vs FY ' + prevLab;
    if (newPrev === 0) {
        growthPct = newFy > 0 ? 100 : 0;
        growthLabel = newFy > 0 ? ('New cases started in FY ' + fy.label) : ('No new cases in FY ' + prevLab + ' or ' + fy.label);
    } else {
        growthPct = Math.round(((newFy - newPrev) / newPrev) * 1000) / 10;
        growthLabel = newFy + ' new vs ' + newPrev + ' previous FY (' + prevLab + ')';
    }
    const pendingAll = active(DB.patients).reduce((a, p) => a + pendingFor(p), 0);
    const expFy = active(DB.expenses || []).filter(x => inFy(x.date) && (!x._deleted) && (typeof expenseCountsInTotals !== 'function' || expenseCountsInTotals(x))).reduce((a, x) => a + Number(x.amount || 0), 0);

    set('repFy', money(fyTotal));
    // New-case collection in this FY (payments on new-case patient rows dated in FY, or consultation on new cases)
    const newPatientIds = new Set(active(DB.patients).filter(p => p.caseType === 'new' && inFy(p.date)).map(p => p.id));
    const newFyAmt = fyPays.filter(x => newPatientIds.has(x.patientId) || (x.caseType === 'new' && inFy(x.date)))
        .reduce((a, x) => a + Number(x.amount || 0), 0);
    set('repNewFy', newFy);
    set('repNewFyAmt', money(newFyAmt));
    set('repOldFy', oldFy);
    set('repRenewFy', money(renewFy));
    set('repMedFy', money(medFy));
    set('repPending', money(pendingAll));
    set('repExpFy', money(expFy));
    const growthText = (growthPct > 0 ? '+' : '') + growthPct + '%';
    set('repGrowth', growthText);
    const gh = $('#repGrowthHint');
    if (gh) gh.textContent = growthLabel;
    const fh = $('#repFyHint');
    if (fh) fh.textContent = 'FY ' + fy.label + ' · ' + fy.start + ' → ' + fy.end;
    set('repFyLabel', 'FY ' + fy.label + '  ·  ' + fy.start + ' → ' + fy.end);

    const body = $('#repFyBody');
    if (body) {
        const rows = [];
        let y = Number(fy.start.slice(0, 4));
        let m = 4;
        for (let i = 0; i < 12; i++) {
            const mm = String(m).padStart(2, '0');
            const key = y + '-' + mm;
            const nn = pays.filter(x => String(x.date || '').slice(0, 7) === key && (x.feeCategory === 'consultation' || (!x.feeCategory && (x.caseType === 'new' || !x.caseType)))).reduce((a, x) => a + Number(x.amount || 0), 0);
            const rr = pays.filter(x => String(x.date || '').slice(0, 7) === key && (x.feeCategory === 'renewal' || x.caseType === 'renewal')).reduce((a, x) => a + Number(x.amount || 0), 0);
            const md = pays.filter(x => String(x.date || '').slice(0, 7) === key && x.feeCategory === 'medicine').reduce((a, x) => a + Number(x.amount || 0), 0);
            const tot = pays.filter(x => String(x.date || '').slice(0, 7) === key).reduce((a, x) => a + Number(x.amount || 0), 0);
            const ex = active(DB.expenses || []).filter(x => String(x.date || '').slice(0, 7) === key && !x._deleted).reduce((a, x) => a + Number(x.amount || 0), 0);
            const label = (MONTH_NAMES && MONTH_NAMES[m - 1] ? MONTH_NAMES[m - 1] : mm) + ' ' + y;
            rows.push(`<tr><td>${label}</td><td>${money(nn)}</td><td>${money(rr)}</td><td>${money(md)}</td><td><b>${money(tot)}</b></td><td>${money(ex)}</td><td><b>${money(tot - ex)}</b></td></tr>`);
            m++;
            if (m > 12) { m = 1; y++; }
        }
        body.innerHTML = rows.join('') || '<tr><td colspan="7">No data for this financial year</td></tr>';
    }
}



function findSimilarPatients(name, mobile, excludeId) {
    const n = String(name || '').trim().toLowerCase();
    const m = String(mobile || '').replace(/\D/g, '');
    if (!n && m.length < 5) return [];
    return active(DB.patients).filter(p => {
        if (excludeId && p.id === excludeId) return false;
        const pn = String(p.name || '').trim().toLowerCase();
        const pm = String(p.mobile || '').replace(/\D/g, '');
        if (m.length >= 8 && pm && (pm === m || pm.endsWith(m.slice(-10)) || m.endsWith(pm.slice(-10)))) return true;
        if (n.length >= 3 && pn && (pn === n || pn.includes(n) || n.includes(pn))) return true;
        return false;
    }).slice(0, 8);
}

function openPatientProfile(id) {
    const p = active(DB.patients).find(x => x.id === id);
    if (!p) { toast('Patient not found', true); return; }
    const family = (typeof caseFamily === 'function' ? caseFamily(p) : (typeof getCaseFamily === 'function' ? getCaseFamily(p) : [p]));
    const famPays = (typeof familyPayments === 'function' ? familyPayments(p) : active(DB.payments).filter(x => family.some(v => v.id === x.patientId)));
    const visits = family.length;
    const lastVisit = family.map(x => x.date).filter(Boolean).sort().reverse()[0] || p.date;
    const pend = family.reduce((a, x) => a + pendingFor(x), 0);
    const paid = famPays.reduce((a, x) => a + Number(x.amount || 0), 0);
    const due = typeof dueDate === 'function' ? dueDate(p) : null;
    const renew = typeof renewalDue === 'function' ? renewalDue(p) : false;
    const apptRows = family.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map((v, i) =>
        `<tr><td>${i + 1}</td><td>${fmtDate(v.date)}</td><td><span class="tag ${v.caseType || 'new'}">${(v.caseType || 'new').toUpperCase()}</span></td><td>${money(feeTotal(v))}</td><td>${paymentStatusInfo(v).label}${paymentStatusInfo(v).kind==='partial' ? ' '+money(paymentStatusInfo(v).pending) : ''}</td><td><button class="btn embossed patientMiniBtn" onclick="editP('${v.id}')">Edit</button></td></tr>`
    ).join('') || '<tr><td colspan="6">No visits</td></tr>';
    const payRows = famPays.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map((x, i) =>
        `<tr><td>${i + 1}</td><td>${fmtDate(x.date)}</td><td>${esc(x.feeCategory || x.caseType || '—')}</td><td>${money(x.amount)}</td><td>${x.status === 'pending' ? 'Pending' : 'Received'}</td></tr>`
    ).join('') || '<tr><td colspan="5">No payments</td></tr>';
    modal(`Patient Profile — ${esc(p.title)} ${esc(p.name)}`, `
      <div class="profileHeader glassCard">
        <div><h2 style="margin:0">${esc(p.title)} ${esc(p.name)}</h2>
        <div class="mini">Case #${permanentCaseNo(p)} · ${esc(p.gender || '—')} · Age ${p.age || '—'}</div>
        <div class="mini">📱 ${esc(p.mobile || '—')} · ${esc(p.address || '')}</div></div>
        <div class="profileStats">
          <div><small>Visits</small><b>${visits}</b></div>
          <div><small>Last visit</small><b>${fmtDate(lastVisit)}</b></div>
          <div><small>Paid</small><b>${money(paid)}</b></div>
          <div><small>Pending</small><b class="${pend > 0 ? 'textPend' : ''}">${money(pend)}</b></div>
          <div><small>Renewal</small><b class="${renew ? 'textPend' : ''}">${due ? fmtDate(due) : '—'}${renew ? ' DUE' : ''}</b></div>
        </div>
      </div>
      <div class="profileTabs" id="profileTabs">
        <button type="button" class="btn embossed active" data-ptab="overview">Overview</button>
        <button type="button" class="btn embossed" data-ptab="appt">Appointments</button>
        <button type="button" class="btn embossed" data-ptab="pay">Payments</button>
        <button type="button" class="btn embossed" data-ptab="pending">Pending</button>
      </div>
      <div class="profilePane" id="ptab-overview">
        <p class="mini">Complete quick view for reception / doctor.</p>
        <div class="actions" style="flex-wrap:wrap;gap:8px">
          <button class="btn embossed primary" onclick="editP('${p.id}');closeModal()">Edit Patient</button>
          <button class="btn embossed" onclick="viewPatientHistory('${p.id}')">Full History</button>
          <button class="btn embossed green" onclick="closeModal();openPage('bill');setTimeout(()=>fillBillFromPatient('${p.id}'),200)">Create Bill</button>
        </div>
      </div>
      <div class="profilePane hidden" id="ptab-appt"><div class="tablewrap"><table class="table compactTable"><thead><tr><th>#</th><th>Date</th><th>Type</th><th>Fees</th><th>Pay</th><th></th></tr></thead><tbody>${apptRows}</tbody></table></div></div>
      <div class="profilePane hidden" id="ptab-pay"><div class="tablewrap"><table class="table compactTable"><thead><tr><th>#</th><th>Date</th><th>Category</th><th>Amount</th><th>Status</th></tr></thead><tbody>${payRows}</tbody></table></div></div>
      <div class="profilePane hidden" id="ptab-pending"><p>${pend > 0 ? `<b>Pending ${money(pend)}</b> — <button class="btn embossed receiveBtn" onclick="receiveP('${p.id}');closeModal()">Receive Now</button>` : 'No pending amount.'}</p></div>
    `);
    $$('#profileTabs [data-ptab]').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('#profileTabs [data-ptab]').forEach(b => b.classList.toggle('active', b === btn));
            const tab = btn.getAttribute('data-ptab');
            ['overview', 'appt', 'pay', 'pending'].forEach(k => {
                const el = $('#ptab-' + k);
                if (el) el.classList.toggle('hidden', k !== tab);
            });
        });
    });
}


function openPage(id) {
    // Parent menu (Patients / Payment) has no data-page — never navigate on empty id
    if (!id || id === 'undefined' || id === 'null') return;
    if (role === 'reception') {
        const map = {dashboard:'dashboard', patients:'patient', payments:'payment', medicines:'medicine', clinic:'clinic', reports:'reports', appointmentHistory:'dashboard'};
        const mod = map[id];
        if (mod && !receptionCanView(mod)) {
            toast('This interface is hidden by Office', true);
            return
        }
    }
    // ALWAYS close Patients / Payment submenus when changing page (esp. Dashboard)
    try {
        $('#patientsNavSub')?.classList.remove('open');
        $('#paymentNavSub')?.classList.remove('open');
    } catch (e) {}
    try { closeOldAppointmentPanel(); } catch (e) {}
    try { closeModal(); } catch (e) {}
    try {
        $('#patientForm')?.classList.add('hidden');
        document.querySelectorAll('#oldApptPanel, .oldApptPanel, #patientFormWrap').forEach(el => {
            el.classList.add('hidden'); el.classList.remove('open','active');
        });
    } catch (e) {}
    $$('.page').forEach(x => x.classList.remove('active'));
    $('#' + id)?.classList.add('active');
    // Only mark leaf nav buttons active (not parent toggles)
    $$('.navBtn').forEach(b => {
        if (b.classList.contains('navParent')) {
            b.classList.remove('active');
            return;
        }
        b.classList.toggle('active', b.dataset.page === id);
    });
    if (window.innerWidth < 700) $('#side')?.classList.remove('open');
    renderPage(id)
}

function renderPage(id) {
    if (id === 'dashboard') { renderDashboard(); try { setupKpiCollapse(); } catch (e) {} }
    if (id === 'patients') renderReportPage();
    if (id === 'payments') {
        initPaymentYearSelect();
        renderPaymentSummary();
        renderExpenses();
    }
    if (id === 'medicines') renderMedicines();
    if (id === 'clinic') renderClinic();
    if (id === 'connection') setConn(!!server, server ? 'Checking connection…' : 'Offline mode — no server selected.');
    if (id === 'medicines' && role === 'reception') renderReceptionMedicines();
    if (id === 'appointmentHistory') renderAppointmentHistory();
    if (id === 'bill') setupBillPage(true);
    if (id === 'reports') renderReports();
}


function openOldAppointmentPanel() {
    if (role === 'reception' && !receptionCanEdit('patient')) {
        toast('Not allowed by Office permissions', true);
        return;
    }
    $('#patientForm')?.classList.add('hidden');
    const panel = $('#oldAppointmentPanel');
    if (!panel) {
        toast('Old appointment panel missing', true);
        return;
    }
    panel.classList.remove('hidden');
    const inp = $('#oldApptSearch');
    if (inp) {
        inp.value = '';
        inp.focus();
    }
    const res = $('#oldApptResults');
    if (res) res.innerHTML = '<div class="mini">Type name, mobile or case number and press Find</div>';
    $('#oldApptSelected')?.classList.add('hidden');
    if ($('#oldApptSelected')) $('#oldApptSelected').innerHTML = '';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeOldAppointmentPanel() {
    $('#oldAppointmentPanel')?.classList.add('hidden');
}

function runOldApptSearch() {
    const q = ($('#oldApptSearch')?.value || '').trim();
    const box = $('#oldApptResults');
    if (!box) return;
    // hide previous selection while typing new query
    $('#oldApptSelected')?.classList.add('hidden');
    if (!q) {
        box.innerHTML = '<div class="mini">Type name, mobile or case number — matches appear automatically</div>';
        return;
    }
    const hits = searchPatientsQuery(q);
    if (!hits.length) {
        box.innerHTML = '<div class="gsEmpty">No match yet — keep typing or check spelling</div>';
        return;
    }
    // Deduplicate: prefer lowest caseNo per mobile+name key so original registration shows
    const byKey = new Map();
    hits.forEach(p => {
        const key = (String(p.mobile || '').replace(/\D/g, '') || 'x') + '|' + String(p.name || '').toLowerCase().trim();
        const prev = byKey.get(key);
        if (!prev || Number(p.caseNo || 0) < Number(prev.caseNo || 0)) byKey.set(key, p);
    });
    // also always include exact caseNo matches
    const unique = [...byKey.values()];
    hits.forEach(p => {
        if (String(p.caseNo) === q && !unique.some(x => x.id === p.id)) unique.push(p);
    });
    unique.sort((a, b) => Number(a.caseNo || 0) - Number(b.caseNo || 0));
    box.innerHTML = unique.slice(0, 20).map(p => {
        const pend = pendingFor(p);
        const pay = pend > 0 ? `Pending ${money(pend)}` : 'Cleared';
        return `<button type="button" class="oldApptHit" data-id="${p.id}">
          <span class="gsCase">#${p.caseNo}</span>
          <span class="oldHitName">${esc(p.title)} ${esc(p.name)}</span>
          <span class="gsMeta">${esc(p.mobile || '—')} · ${fmtDate(p.date)} · ${p.caseType || ''} · ${pay}</span>
        </button>`;
    }).join('');
    box.querySelectorAll('.oldApptHit').forEach(btn => {
        btn.addEventListener('click', () => selectOldApptPatient(btn.getAttribute('data-id')));
    });
}

function selectOldApptPatient(id) {
    const p = active(DB.patients).find(x => x.id === id);
    if (!p) {
        toast('Patient not found', true);
        return;
    }
    const resBox = $('#oldApptResults');
    if (resBox) resBox.innerHTML = '';
    const searchInp = $('#oldApptSearch');
    if (searchInp) searchInp.value = '';

    const box = $('#oldApptSelected');
    if (!box) return;
    box.classList.remove('hidden');
    const renew = renewalDue(p) && !hasRenewalPayment(p);
    const renewFee = Number(p.renewal || 0) || 0;
    let priorPend = 0;
    let priorPendIds = [];
    try {
        const key = String(p.linkedCaseNo || p.caseNo || '');
        active(DB.patients).forEach(x => {
            const pend = pendingFor(x);
            if (String(x.linkedCaseNo || x.caseNo || '') === key && pend > 0) {
                priorPend += pend;
                priorPendIds.push(x.id);
            }
        });
    } catch (e) {
        priorPend = pendingFor(p);
        if (priorPend > 0) priorPendIds = [p.id];
    }
    const todayStr = isoToday();
    if (role === 'reception') {
      box.innerHTML = `
      <div class="oldApptLine embossed oldApptSelectedActive">
        <span class="oldLineCase">#${p.caseNo}</span>
        <span class="oldLineName">${esc(p.title)} ${esc(p.name)}</span>
        <span class="oldLineMeta">${esc(p.mobile || '—')}</span>
        <span class="oldLineMeta">${esc(p.address || '—')}</span>
        <span class="oldLineMeta">Reg ${fmtDate(p.date)}</span>
      </div>
      <div class="oldApptActions oldApptOneLine">
        <label class="oldMedLabel">Appointment date
          <input type="date" id="oldApptDate" value="${todayStr}" min="${todayStr}" max="${todayStr}" readonly>
        </label>
        <input type="hidden" id="oldApptMedicine" value="0">
        <input type="hidden" id="oldApptRenewal" value="0">
        <input type="hidden" id="oldApptPayPending" value="0">
        <input type="hidden" id="oldApptFoc" value="">
        <button type="button" class="btn embossed primary" id="oldApptConfirm">Add appointment</button>
      </div>
      <p class="mini">Reception: only add today's appointment. Payment is done in Office after With Doctor.</p>
    `;
    } else {
      box.innerHTML = `
      <div class="oldApptLine embossed oldApptSelectedActive">
        <span class="oldLineCase">#${p.caseNo}</span>
        <span class="oldLineName">${esc(p.title)} ${esc(p.name)}</span>
        <span class="oldLineMeta">${esc(p.mobile || '—')}</span>
        <span class="oldLineMeta">${esc(p.address || '—')}</span>
        <span class="oldLineMeta">Reg ${fmtDate(p.date)}</span>
        ${renew ? '<span class="renewBadge">Renewal due</span>' : ''}
        ${priorPend > 0 ? `<span class="payPartialTag">Prior pending ${money(priorPend)}</span>` : ''}
      </div>
      <div class="oldApptActions oldApptOneLine">
        <label class="oldMedLabel">Medicine charges (₹)
          <input type="number" id="oldApptMedicine" min="0" step="1" value="0" title="Received amount">
        </label>
        ${renew ? `<label class="oldMedLabel renewHighlightLabel">Renewal charges (₹)
          <input type="number" id="oldApptRenewal" min="0" step="1" value="${renewFee}" class="renewHighlightInput">
        </label>` : `<input type="hidden" id="oldApptRenewal" value="0">`}
        <label class="oldMedLabel pendingPayLabel">Payment pending (₹)
          <input type="number" id="oldApptPayPending" min="0" step="1" value="0" title="Pending amount — next visit carry forward">
        </label>
        <label class="oldMedLabel">Appointment date
          <input type="date" id="oldApptDate" value="${todayStr}">
        </label>
        <label class="oldFocLabel" title="Free of charge visit"><input type="checkbox" id="oldApptFoc"> FOC</label>
        <button type="button" class="btn embossed primary" id="oldApptConfirm">Add appointment</button>
        ${priorPend > 0 ? `<button type="button" class="btn embossed" id="oldApptRecvPrior">Receive prior pending</button>` : ''}
      </div>
      <p class="mini">Medicine / Renewal = received. Payment pending = baaki amount (next visit pe carry). FOC = free visit.</p>
    `;
    }
        // FOC clears amounts
    $('#oldApptFoc')?.addEventListener('change', () => {
        if ($('#oldApptFoc').checked) {
            if ($('#oldApptMedicine')) $('#oldApptMedicine').value = 0;
            if ($('#oldApptRenewal')) $('#oldApptRenewal').value = 0;
            if ($('#oldApptPayPending')) $('#oldApptPayPending').value = 0;
        }
    });
    $('#oldApptConfirm')?.addEventListener('click', () => confirmOldAppointment(p.id));
    $('#oldApptRecvPrior')?.addEventListener('click', () => {
        // Receive oldest pending in family first
        const id = priorPendIds[0];
        if (id) receiveP(id);
    });
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function confirmOldAppointment(sourceId) {
    if (role === 'reception' && !receptionCanEdit('patient')) {
        toast('Not allowed', true);
        return;
    }
    const src = active(DB.patients).find(x => x.id === sourceId);
    if (!src) {
        toast('Patient not found', true);
        return;
    }
    const isFoc = role === 'reception' ? false : !!($('#oldApptFoc')?.checked);
    let medRecv = Math.max(0, Number($('#oldApptMedicine')?.value || 0));
    let renRecv = Math.max(0, Number($('#oldApptRenewal')?.value || 0));
    let payPend = Math.max(0, Number($('#oldApptPayPending')?.value || 0));
    const date = $('#oldApptDate')?.value || isoToday();
    if (isFoc) {
        medRecv = 0; renRecv = 0; payPend = 0;
    }
    // Total fees: received parts + pending (pending treated as unpaid medicine balance)
    const medFee = medRecv + payPend;
    const renFee = renRecv;
    const permanentCaseNo = src.linkedCaseNo || src.caseNo;
    let lastRen = src.lastRenewalDate || src.date;
    if (renFee > 0) lastRen = date;
    const appt = {
        id: uid('pat'),
        caseNo: permanentCaseNo,
        caseType: 'old',
        date,
        title: src.title || 'Mr',
        name: src.name || '',
        address: src.address || '',
        mobile: src.mobile || '',
        gender: src.gender || 'Male',
        age: Number(src.age || 0),
        refBy: src.refBy || '',
        consultation: 0,
        medicine: medFee,
        renewal: renFee,
        lastRenewalDate: lastRen,
        linkedFromId: src.id,
        linkedCaseNo: permanentCaseNo,
        withDoctor: false,
        received: false,
        completedAt: null,
        foc: isFoc,
        forcePending: false
    };
    markUpdated(appt);
    DB.patients.push(appt);
    if (renFee > 0) {
        const key = String(permanentCaseNo);
        active(DB.patients).forEach(x => {
            if (String(x.linkedCaseNo || x.caseNo || '') === key) {
                x.lastRenewalDate = date;
                markUpdated(x);
            }
        });
        src.lastRenewalDate = date;
        markUpdated(src);
    }
    appt._created = new Date().toISOString();
    if (role === 'reception') {
        appt.received = false;
        appt.foc = false;
        appt.withDoctor = false;
        appt.completedAt = null;
        appt.consultation = 0;
        appt.medicine = 0;
        appt.renewal = 0;
    } else if (isFoc) {
        appt.received = true;
        appt.foc = true;
        appt.completedAt = new Date().toISOString();
    } else if (medRecv > 0 || renRecv > 0) {
        // Record received portions; pending stays unpaid automatically via pendingFor
        applyReceiveAmounts(appt, { consultation: 0, medicine: medRecv, renewal: renRecv }, date);
    } else if (!isTodayCase(appt)) {
        // Back-dated with nothing received → keep pending (do not auto-receive)
        appt.received = false;
        appt.completedAt = null;
    } else {
        appt.received = false;
        appt.completedAt = null;
    }
    markUpdated(appt);
    saveLocal();
    closeOldAppointmentPanel();
    try { refreshAllPatientViews(); } catch (e) {
        renderDashboard(); renderQueue(); renderReceptionQueue();
        if (typeof renderReportPage === 'function') renderReportPage();
        if (typeof renderAppointmentHistory === 'function') renderAppointmentHistory();
    }
    const pendLeft = pendingFor(appt);
    let msg = `Follow-up #${appt.caseNo} — ${src.title} ${src.name}`;
    if (role === 'reception') {
        msg += '';
    } else if (isFoc) {
        msg += ' · FOC';
    } else {
        if (medRecv > 0) msg += ` · Medicine received ${money(medRecv)}`;
        if (renRecv > 0) msg += ` · Renewal received ${money(renRecv)}`;
        if (pendLeft > 0) msg += ` · Pending ${money(pendLeft)}`;
        else if (medFee + renFee > 0) msg += ' · Fully received';
    }
    toast(msg);
    try { syncNow(true); } catch (e) {}
}

function setupOldAppointmentPanel() {
    $('#oldApptClose')?.addEventListener('click', closeOldAppointmentPanel);
    $('#oldApptSearchBtn')?.addEventListener('click', runOldApptSearch);
    let _oldApptTimer = null;
    $('#oldApptSearch')?.addEventListener('input', () => {
        clearTimeout(_oldApptTimer);
        _oldApptTimer = setTimeout(runOldApptSearch, 120);
    });
    $('#oldApptSearch')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(_oldApptTimer);
            runOldApptSearch();
        }
    });
}

function buildPatientForm(type, patient = null) {
    const f = $('#patientForm');
    f.classList.remove('hidden');
    $('#formTitle').textContent = patient ? 'Edit Case' : (type === 'new' ? 'New Case Registration' : 'Old Case Registration');
    const fb = $('#patientForm button.primary');
    if (fb) fb.textContent = patient ? 'Update' : 'Register';
    $('#caseType').value = type;
    $('#editId').value = patient?.id || '';
    $('#patientDate').value = patient?.date || isoToday();
    $('#caseNo').value = patient ? (normalizeCaseNoInput(patient.caseNo) || patient.caseNo) : nextCase();
    $('#title').value = patient?.title || 'Mr';
    $('#name').value = patient?.name || '';
    $('#address').value = patient?.address || '';
    $('#mobile').value = patient?.mobile || '';
    $('#gender').value = patient?.gender || 'Male';
    $('#age').value = patient?.age || '';
    $('#refBy').value = patient?.refBy || '';
    $('#consultation').value = patient?.consultation ?? 0;
    $('#medicine').value = patient?.medicine ?? 0;
    $('#renewal').value = patient?.renewal ?? 0;
    // Reception: no fee entry / no mark-pending — Office handles payment
    try {
      const isRec = role === 'reception';
      ['consultation','medicine','renewal'].forEach(id => {
        const lab = $('#'+id)?.closest('label');
        if (lab) lab.style.display = isRec ? 'none' : '';
      });
      const bp = document.querySelector('.backdatePendingWrap');
      if (bp) bp.style.display = isRec ? 'none' : '';
      if (isRec && !patient) {
        $('#consultation').value = 0;
        $('#medicine').value = 0;
        $('#renewal').value = 0;
        const bpc = $('#backdatePending');
        if (bpc) bpc.checked = false;
      }
    } catch (e) {}
    const locked = patient ? isPaymentLocked(patient) : false;
    ['consultation', 'medicine', 'renewal'].forEach(id => {
        const el = $('#' + id);
        if (el) {
            el.disabled = locked;
            el.title = locked ? 'Payment locked after full Received. FOC / Partial can still be edited.' : (patient && paymentStatusInfo(patient).kind === 'foc' ? 'FOC — you can add fees/payment anytime.' : '');
            el.closest('label')?.classList.toggle('lockedFee', locked)
        }
    });
    checkRenewal();
    f.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
    })
}

function checkRenewal() {
    const type = $('#caseType')?.value;
    if (type !== 'old') {
        $('#renewWrap')?.classList.add('hidden');
        return
    }
    const p = active(DB.patients).find(x => String(x.id) === $('#editId').value || String(x.caseNo) === $('#caseNo').value);
    const base = p?.lastRenewalDate || p?.date || $('#patientDate').value;
    const due = addYear(base);
    if ($('#renewWrap')) {
        if (due && due <= ($('#patientDate').value || isoToday())) {
            $('#renewWrap').classList.remove('hidden');
            if ($('#renewDue')) $('#renewDue').textContent = 'Due since ' + fmtDate(due)
        } else $('#renewWrap').classList.add('hidden')
    }
}

function createBackdatedPayments(p) {
    // Backdated registrations are assumed fully paid. Keep those payments in reports.
    if (isTodayCase(p)) return;
    const cats = [
        ['consultation', Number(p.consultation || 0)],
        ['medicine', Number(p.medicine || 0)],
        ['renewal', renewalDue(p) ? Number(p.renewal || 0) : 0]
    ];
    cats.forEach(([feeCategory, amount]) => {
        let pay = active(DB.payments).find(x => x.patientId === p.id && x.autoBackdated === true && x.feeCategory === feeCategory);
        if (amount <= 0) {
            if (pay) {
                DB.meta.deleted.push(pay.id);
                DB.payments = DB.payments.filter(x => x.id !== pay.id);
            }
            return;
        }
        if (!pay) {
            pay = {
                id: uid('pay'),
                patientId: p.id,
                caseType: p.caseType,
                date: p.date,
                feeCategory,
                amount,
                autoBackdated: true
            };
        } else {
            pay.date = p.date;
            pay.caseType = p.caseType;
            pay.amount = amount;
            pay._deleted = false;
        }
        markUpdated(pay);
        DB.payments = DB.payments.filter(x => x.id !== pay.id);
        DB.payments.push(pay);
    });
}

function removePatientPayments(patientId) {
    const ids = active(DB.payments).filter(x => x.patientId === patientId).map(x => x.id);
    ids.forEach(id => DB.meta.deleted.push(id));
    DB.payments = DB.payments.filter(x => x.patientId !== patientId);
}


/** One-time / load: back-dated visits with fees but still unpaid → mark Received (unless forcePending) */
function fixLegacyBackdatedUnpaid() {
    if (!DB.patients) return 0;
    let n = 0;
    active(DB.patients).forEach(p => {
        if (!p || isTodayCase(p)) return;
        if (p.forcePending) return;
        const fees = feeTotal(p);
        if (fees <= 0) {
            if (!p.received) {
                p.received = true;
                p.completedAt = p.completedAt || (p.date + 'T12:00:00');
                markUpdated(p);
                n++;
            }
            return;
        }
        if (pendingFor(p) > 0) {
            reconcileBackdatedPayments(p);
            markUpdated(p);
            n++;
        }
    });
    if (n) {
        try { saveLocal(); } catch (e) {}
    }
    return n;
}

function reconcileBackdatedPayments(p) {
    if (isTodayCase(p)) return;
    createBackdatedPayments(p);
    // FOC (zero fees): mark completed but not payment-locked
    if (feeTotal(p) <= 0) {
        p.received = false;
        p.foc = true;
        p.withDoctor = false;
        p.completedAt = p.completedAt || new Date().toISOString();
        return;
    }
    p.received = true;
    p.foc = false;
    p.withDoctor = false;
    p.completedAt = p.completedAt || new Date().toISOString();
}

function reconcileCurrentCasePayments(p) {
    if (!isTodayCase(p) || p.received !== true) return;
    const cats = [
        ['consultation', Number(p.consultation || 0)],
        ['medicine', Number(p.medicine || 0)],
        ['renewal', renewalDue(p) ? Number(p.renewal || 0) : 0]
    ];
    cats.forEach(([feeCategory, feeAmount]) => {
        const auto = active(DB.payments).find(x => x.patientId === p.id && x.caseFeePayment === true && x.feeCategory === feeCategory);
        const nonAuto = active(DB.payments).filter(x => x.patientId === p.id && x.feeCategory === feeCategory && x.caseFeePayment !== true).reduce((a, x) => a + Number(x.amount || 0), 0);
        const target = Math.max(0, feeAmount - nonAuto);
        if (target <= 0) {
            if (auto) {
                DB.meta.deleted.push(auto.id);
                DB.payments = DB.payments.filter(x => x.id !== auto.id);
            }
            return;
        }
        if (auto) {
            auto.amount = target;
            auto.date = auto.date || isoToday();
            markUpdated(auto);
        } else {
            const pay = {
                id: uid('pay'),
                patientId: p.id,
                caseType: p.caseType,
                date: isoToday(),
                feeCategory,
                amount: target,
                receivedNow: true,
                caseFeePayment: true
            };
            markUpdated(pay);
            DB.payments.push(pay);
        }
    });
}

function registerCase(e) {
    if (e && e.preventDefault) e.preventDefault();
    const _dupName = $('#name')?.value?.trim() || '';
    const _dupMobile = $('#mobile')?.value?.trim() || '';
    const _editId = $('#editId')?.value || '';
    if (!_editId && $('#caseType')?.value === 'new') {
        const sims = findSimilarPatients(_dupName, _dupMobile, null);
        if (sims.length && !window.__allowDupPatient) {
            const list = sims.map(p => `<button type="button" class="btn embossed" style="width:100%;margin:4px 0;text-align:left" onclick="closeModal();openPatientProfile('${p.id}')"><b>${esc(p.title)} ${esc(p.name)}</b> — ${esc(p.mobile || '')} · Case #${permanentCaseNo(p)}</button>`).join('');
            modal('⚠️ Similar patient already exists', `
              <p class="mini">Same name or mobile found. Use existing patient to avoid duplicate case.</p>
              ${list}
              <div class="actions" style="margin-top:12px">
                <button type="button" class="btn embossed primary" onclick="window.__allowDupPatient=true;closeModal();document.querySelector('#patientForm form')?.requestSubmit();setTimeout(()=>window.__allowDupPatient=false,500)">Create New Anyway</button>
                <button type="button" class="btn embossed" onclick="closeModal()">Cancel</button>
              </div>`);
            return;
        }
    }

    e.preventDefault();
    const id = $('#editId').value;
    const oldP = active(DB.patients).find(x => String(x.id) === String(id));
    const receivedLocked = !!oldP?.received;
    const p = {
        id: id || uid('p'),
        caseType: $('#caseType').value,
        caseNo: (function(){ const raw = ($('#caseNo')?.value || '').trim(); if (!raw) return nextCase(); return normalizeCaseNoInput(raw); })(),
        date: $('#patientDate').value,
        title: $('#title').value,
        name: $('#name').value.trim(),
        address: $('#address').value.trim(),
        mobile: $('#mobile').value.trim(),
        gender: $('#gender').value,
        age: Number($('#age').value || 0),
        refBy: $('#refBy').value.trim(),
        consultation: receivedLocked ? Number(oldP.consultation || 0) : role === 'office' ? Number($('#consultation')?.value || 0) : 0,
        medicine: receivedLocked ? Number(oldP.medicine || 0) : role === 'office' ? Number($('#medicine')?.value || 0) : 0,
        renewal: receivedLocked ? Number(oldP.renewal || 0) : role === 'office' ? Number($('#renewal')?.value || 0) : 0,
        lastRenewalDate: oldP?.lastRenewalDate || $('#patientDate').value,
        withDoctor: oldP?.withDoctor || false,
        received: oldP?.received === true ? true : false,
        completedAt: oldP?.completedAt || null
    };
    const forcePending = !!($('#backdatePending')?.checked);
    p.forcePending = forcePending;
    if (!oldP) {
        if (!isTodayCase(p)) {
            if (forcePending) {
                p.received = false;
                p.completedAt = null;
            } else {
                reconcileBackdatedPayments(p);
            }
        } else {
            p.received = false;
        }
    } else if (!receivedLocked) {
        if (!isTodayCase(p)) {
            if (forcePending) {
                p.received = false;
                p.completedAt = null;
                // remove auto-backdated pays if forcing pending
                DB.payments = DB.payments.filter(x => !(x.patientId === p.id && x.autoBackdated === true));
            } else {
                reconcileBackdatedPayments(p);
            }
        } else if (oldP.date !== p.date) {
            p.received = false;
            p.completedAt = null;
            p.withDoctor = false;
            DB.payments = DB.payments.filter(x => !(x.patientId === p.id && x.autoBackdated === true));
        }
        if (isTodayCase(p)) reconcileCurrentCasePayments(p);
    }
    // Preserve linked fields on edit
    if (oldP) {
        if (oldP.linkedFromId) p.linkedFromId = oldP.linkedFromId;
        if (oldP.linkedCaseNo) p.linkedCaseNo = oldP.linkedCaseNo;
        if (oldP.permanentCaseNo) p.permanentCaseNo = oldP.permanentCaseNo;
    }
    // Reception new/old register: always Waiting, never FOC/completed
    if (role === 'reception' && !id) {
        p.withDoctor = false;
        p.received = false;
        p.foc = false;
        p.completedAt = null;
        p.consultation = Number(p.consultation || 0);
        p.medicine = Number(p.medicine || 0);
        p.renewal = Number(p.renewal || 0);
    }
    if (!id) p._created = new Date().toISOString();
    markUpdated(p);
    // Robust replace by id (string-safe)
    const pid = String(p.id);
    DB.patients = (DB.patients || []).filter(x => String(x.id) !== pid);
    DB.patients.push(p);
    saveLocal();
    closeForm();
    refreshAllPatientViews();
    toast(id ? 'Case updated' : 'Case registered');
    try { syncNow(true); } catch (e) {}
}

function closeForm() {
    $('#patientForm')?.classList.add('hidden');
    const ei = $('#editId');
    if (ei) ei.value = '';
}

/** After any patient / payment change — refresh every related screen */
function refreshAllPatientViews() {
    try { migrateCaseNumbersToPrefixed(); } catch (e) {}
    try { fixLegacyBackdatedUnpaid(); } catch (e) {}
    try { renderDashboard(); } catch (e) {}
    try { renderQueue(); } catch (e) {}
    try { renderReceptionQueue(); } catch (e) {}
    try { if ($('#reportBodyPatients')) renderPatientReport(); } catch (e) {}
    try { if ($('#histBody')) renderAppointmentHistory(); } catch (e) {}
    try {
        if ($('#payMonthBody') || $('#paymentYearSelect') || $('#paySummaryTop')) {
            initPaymentYearSelect();
            renderPaymentSummary();
        }
    } catch (e) {}
    try { if ($('#expenseBody') || $('#grossLifetime')) renderExpenses(); } catch (e) {}
    try { updateGrossIncomeLifetime(); } catch (e) {}
    try { if (typeof renderReports === 'function') renderReports(); } catch (e) {}
}

function isTodayCase(p) {
    return String(p.date || '') === isoToday();
}

function queueStatus(p) {
    if (p.foc === true && (p.received === true || p.completedAt)) return 'received';
    if (p.received === true && pendingFor(p) <= 0) return 'received';
    if (p.withDoctor) return 'doctor';
    return 'pending';
}


function patientEntryTime(p) {
    // First registered earlier → smaller key (top of active queue)
    return String(p._created || p._updated || p.id || '');
}
function patientCompletedTime(p) {
    return String(p.completedAt || p._updated || '');
}
function splitTodayQueue(arr) {
    const active = [];
    const done = [];
    arr.forEach(p => {
        const st = queueStatus(p);
        if (st === 'received') done.push(p);
        else active.push(p);
    });
    // Active: pehle entry upar, last entry niche
    active.sort((a, b) => patientEntryTime(a).localeCompare(patientEntryTime(b)));
    // Completed: sabse last completed sabse upar
    done.sort((a, b) => patientCompletedTime(b).localeCompare(patientCompletedTime(a)));
    return { active, done };
}
function receptionPayStatusLabel(p) {
    const st = paymentStatusInfo(p);
    if (st.kind === 'received') return '<span class="payReceivedTag">Received</span>';
    if (st.kind === 'foc') return '<span class="payFocTag">FOC</span>';
    if (st.kind === 'partial') return `<span class="payPartialTag">Pending</span> <span class="mini">Partial · due ${money(st.pending)}</span>`;
    // fees set or not — jab tak Office Receive na kare
    return '<span class="payPendingTag">Pending</span>';
}

function renderQueue() {
    const b = $('#queueBody');
    if (!b) return;
    const q = ($('#queueSearch')?.value || '').toLowerCase();
    let arr = caseRows().filter(isTodayCase).filter(p => p.caseType === 'new' || p.caseType === 'old').filter(p => !q || `${p.caseNo} ${p.name} ${p.mobile} ${p.address}`.toLowerCase().includes(q));
    const { active, done } = splitTodayQueue(arr);
    const waiting = active.filter(p => queueStatus(p) !== 'doctor');
    const doctor = active.filter(p => queueStatus(p) === 'doctor');
    waiting.sort((a,b)=>patientEntryTime(a).localeCompare(patientEntryTime(b)));
    doctor.sort((a,b)=>patientEntryTime(a).localeCompare(patientEntryTime(b)));
    done.sort((a,b)=>patientCompletedTime(b).localeCompare(patientCompletedTime(a)));

    // Queue is intentionally NOT paginated: show every today's entry in one
    // vertically scrollable table so the user can see all patients by scrolling.
    const sliceWaiting = waiting;
    const sliceDoctor = doctor;
    set('queueCountHint', `${waiting.length} waiting · ${doctor.length} with doctor · ${done.length} completed today`);

    const rowHtml = (p, i, statusSection) => {
        const pending = pendingFor(p), withDoc = !!p.withDoctor, status = queueStatus(p);
        const stPay = paymentStatusInfo(p), fullyReceived = stPay.kind === 'received';
        const pulse = fullyReceived && p.completedAt && (Date.now() - new Date(p.completedAt).getTime() < 8000);
        const renewHighlight = renewalDue(p) && !hasRenewalPayment(p);
        let rowClass = stPay.kind === 'foc' ? 'focRow' : (status === 'doctor' ? 'doctorRow' : 'pendingRow');
        if (stPay.kind === 'partial') rowClass += ' partialPendingRow';
        if (renewHighlight) rowClass += ' renewDueRow';
        const payLabel = paymentStatusHtml(p);
        const locked = fullyReceived, dis = locked ? ' disabled' : '', lockCls = locked ? ' actLocked' : '';
        const sr = i + 1;
        return `<tr class="${rowClass}${pulse?' receivedPulse':''}">
   <td>${sr}</td><td><b>${permanentCaseNo(p)}</b></td><td>${fmtDate(p.date)}</td><td><span class="tag ${p.caseType}">${p.caseType==='new'?'NEW':'OLD'}</span></td>
   <td><div class="patientMain">${esc(p.title)} ${esc(p.name)}${renewHighlight?' <span class="renewBadge">R</span>':''}</div><div class="mini">${esc(p.mobile || '')}</div></td>
   <td class="amount">${money(feeTotal(p))}</td><td class="totalPayCell">${payLabel}</td>
   <td><span class="queueStatusTag ${status}">${status==='doctor'?'With Doctor':'Waiting'}</span></td>
   <td><div class="actions embossedActions compactActions queueActions">
    ${(role!=='reception'||receptionCanEdit('patient'))?`<button class="btn embossed actNeutral" onclick="editP('${p.id}')">Edit</button>`:''}
    ${(role!=='reception'||receptionCanEdit('patient'))?`<button class="btn embossed actNeutral${withDoc?' withDocActive':''}${lockCls}" onclick="docP('${p.id}')"${dis}>Doctor</button>`:''}
    ${(role!=='reception'||receptionCanEdit('paymentEntry'))?`<button class="btn embossed ${fullyReceived?'actReceived':'actNeutral'}${lockCls}" onclick="receiveP('${p.id}')"${fullyReceived?' disabled':''}>Receive</button>`:''}
    ${(role!=='reception'||receptionCanEdit('paymentEntry'))?`<button class="btn embossed actNeutral${lockCls}" onclick="pendingP('${p.id}')"${dis}>Pend</button>`:''}
    ${(role!=='reception'||receptionCanEdit('patient'))?`<button class="btn embossed deleteBox" onclick="delP('${p.id}')">Del</button>`:''}
    </div></td></tr>`;
    };

    let html = '';
    if (sliceWaiting.length) {
        html += `<tr class="queueSectionBreak"><td colspan="9">Waiting Today</td></tr>`;
        sliceWaiting.forEach((p,i)=>html += rowHtml(p,i,'waiting'));
    }
    if (sliceDoctor.length) {
        html += `<tr class="queueSectionBreak"><td colspan="9">With Doctor Today</td></tr>`;
        sliceDoctor.forEach((p,i)=>html += rowHtml(p,i,'doctor'));
    }
    if (done.length) {
        html += `<tr class="queueSectionBreak"><td colspan="9">Completed today</td></tr>`;
        done.forEach((p,i)=>{
            const payLabel=paymentStatusHtml(p);
            html += `<tr class="receivedRow"><td>${i+1}</td><td><b>${permanentCaseNo(p)}</b></td><td>${fmtDate(p.date)}</td><td><span class="tag ${p.caseType}">${p.caseType==='new'?'NEW':'OLD'}</span></td><td><div class="patientMain">${esc(p.title)} ${esc(p.name)}</div><div class="mini">${esc(p.mobile||'')}</div></td><td class="amount">${money(feeTotal(p))}</td><td class="totalPayCell">${payLabel}</td><td><span class="queueStatusTag received">Completed</span></td><td><div class="actions embossedActions compactActions queueActions"><button class="btn embossed actNeutral" onclick="editP('${p.id}')">Edit</button><button class="btn embossed actNeutral" onclick="docP('${p.id}')">Doctor</button><button class="btn embossed actReceived" onclick="receiveP('${p.id}')">Receive</button><button class="btn embossed actNeutral" onclick="pendingP('${p.id}')">Pend</button><button class="btn embossed deleteBox" onclick="delP('${p.id}')">Del</button></div></td></tr>`;
        });
    }
    if (!html) html = '<tr><td colspan="9">No new or old case entries today</td></tr>';
    b.innerHTML = html;
    const pag=$('#queuePagination');
    if(pag) pag.innerHTML=`<span class="mini">${waiting.length} waiting · ${doctor.length} with doctor · ${done.length} completed today · all entries shown</span>`;
}


function patientDateMatch(dateStr) {
    const v = String(dateStr || '');
    if (patientFilterY && v.slice(0, 4) !== String(patientFilterY)) return false;
    if (patientFilterM && v.slice(5, 7) !== String(patientFilterM).padStart(2, '0')) return false;
    if (patientFilterD && v.slice(8, 10) !== String(patientFilterD).padStart(2, '0')) return false;
    return true;
}

function renderPatientReport() {
    const body = $('#reportBodyPatients');
    if (!body) return;
    const view = (patientTypeFilter === 'renewal' || patientTypeFilter === 'followup') ? patientTypeFilter : 'new';
    patientTypeFilter = view;

    // Title / label
    const titleMap = { renewal: 'Renewal Cases', followup: 'Follow up Cases', new: 'New Cases' };
    set('pCountLabel', titleMap[view] || 'Cases');
    const heroH = document.querySelector('#patients .hero h1');
    if (heroH) heroH.textContent = titleMap[view] || 'Patients';

    let rows = [];
    if (view === 'renewal') {
        // Cases that have at least one renewal payment — unique by case no, last renewal first
        const byCase = new Map();
        active(DB.payments).filter(x => (x.feeCategory === 'renewal' || x.caseType === 'renewal') && Number(x.amount || 0) > 0)
            .forEach(x => {
                const p = active(DB.patients).find(pt => pt.id === x.patientId);
                if (!p) return;
                const key = String(permanentCaseNo(p));
                const prim = primaryRegistration(key) || p;
                const prev = byCase.get(key);
                const payDate = String(x.date || '');
                if (!prev || payDate > prev._lastRenewPay) {
                    byCase.set(key, { ...prim, _lastRenewPay: payDate });
                }
            });
        rows = [...byCase.values()].sort((a, b) => String(b._lastRenewPay).localeCompare(String(a._lastRenewPay)));
        rows = rows.filter(p => patientDateMatch(p.date) || patientDateMatch(p._lastRenewPay));
    } else if (view === 'followup') {
        // All OLD / follow-up visits — latest follow-up first
        rows = active(DB.patients)
            .filter(p => p.caseType === 'old' || p.linkedFromId)
            .filter(p => patientDateMatch(p.date))
            .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b._updated || '').localeCompare(String(a._updated || '')));
    } else {
        // Only NEW case registrations (original), unique by permanent case no
        const byCase = new Map();
        active(DB.patients).filter(p => p.caseType === 'new').forEach(p => {
            const key = String(permanentCaseNo(p));
            const prev = byCase.get(key);
            if (!prev || String(p.date) < String(prev.date)) byCase.set(key, p);
        });
        rows = [...byCase.values()].filter(p => patientDateMatch(p.date))
            .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || caseNoNumericPart(b.caseNo) - caseNoNumericPart(a.caseNo));
    }

    set('pCountNew', rows.length);
    set('patientFilterHint', (titleMap[view] || 'Cases') + ` · ${rows.length} record(s)`);

    const totalPages = Math.max(1, Math.ceil(rows.length / patientReportPageSize));
    if (patientReportPage > totalPages) patientReportPage = totalPages;
    if (patientReportPage < 1) patientReportPage = 1;
    const slice = rows.slice((patientReportPage - 1) * patientReportPageSize, patientReportPage * patientReportPageSize);

    body.innerHTML = slice.map(p => {
        const payLabel = paymentStatusHtml(p);
        const extra = view === 'renewal' && p._lastRenewPay ? ` · Last renew ${fmtDate(p._lastRenewPay)}` : '';
        return `<tr>
          <td><b>${permanentCaseNo(p)}</b></td>
          <td>${fmtDate(p.date)}</td>
          <td><span class="tag ${p.caseType || 'new'}">${(p.caseType || 'new').toUpperCase()}</span></td>
          <td>${esc(p.title)} ${esc(p.name)}${extra}<div class="mini">${esc(p.mobile || '')}</div></td>
          <td>${p.age || '-'}</td>
          <td>${esc(p.mobile || '-')}</td>
          <td>${payLabel}</td>
          <td><div class="actions compactActions patientListActions">
            <button class="btn embossed patientMiniBtn" onclick="editP('${p.id}')">Edit</button>
            <button class="btn embossed patientMiniBtn" onclick="viewPatientHistory('${p.id}')">View</button>
            <button class="btn deleteBox embossed patientMiniBtn" onclick="delP('${p.id}')">Del</button>
          </div></td>
        </tr>`;
    }).join('') || `<tr><td colspan="8">No ${view === 'renewal' ? 'renewal' : (view === 'followup' ? 'follow-up' : 'new')} cases for selected filter</td></tr>`;

    // Pagination
    const pag = $('#patientReportPagination');
    if (pag) {
        if (rows.length <= patientReportPageSize) {
            pag.innerHTML = '';
        } else {
            let html = `<button type="button" class="btn embossed" data-pg="prev" ${patientReportPage<=1?'disabled':''}>‹ Prev</button>`;
            for (let i = 1; i <= totalPages; i++) {
                if (totalPages > 8 && Math.abs(i - patientReportPage) > 2 && i !== 1 && i !== totalPages) {
                    if (i === 2 || i === totalPages - 1) html += `<span class="pgEllipsis">…</span>`;
                    continue;
                }
                html += `<button type="button" class="btn embossed ${i===patientReportPage?'active':''}" data-pg="${i}">${i}</button>`;
            }
            html += `<button type="button" class="btn embossed" data-pg="next" ${patientReportPage>=totalPages?'disabled':''}>Next ›</button>`;
            pag.innerHTML = html;
            pag.querySelectorAll('[data-pg]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const v = btn.getAttribute('data-pg');
                    if (v === 'prev') patientReportPage = Math.max(1, patientReportPage - 1);
                    else if (v === 'next') patientReportPage = Math.min(totalPages, patientReportPage + 1);
                    else patientReportPage = Number(v) || 1;
                    renderPatientReport();
                });
            });
        }
    }
}




function initPatientFilterSelects() {
    const y = $('#patientYear'), m = $('#patientMonth'), d = $('#patientDay');
    if (!y || !m || !d) return;
    const cy = new Date().getFullYear();
    if (!y.options.length) {
        y.innerHTML = '<option value="">Any year</option>';
        for (let yy = cy + 1; yy >= cy - 20; yy--) y.insertAdjacentHTML('beforeend', `<option value="${yy}">${yy}</option>`);
        m.innerHTML = '<option value="">Any month</option>';
        for (let mm = 1; mm <= 12; mm++) m.insertAdjacentHTML('beforeend', `<option value="${String(mm).padStart(2,'0')}">${String(mm).padStart(2,'0')} — ${MONTH_NAMES[mm-1]}</option>`);
        d.innerHTML = '<option value="">Any day</option>';
        for (let dd = 1; dd <= 31; dd++) d.insertAdjacentHTML('beforeend', `<option value="${String(dd).padStart(2,'0')}">${String(dd).padStart(2,'0')}</option>`);
    }
}




const DEFAULT_RECURRING_SPENDS = [
    { key: 'clinic_maintenance', name: 'Clinic maintenance', amount: 500, active: true },
    { key: 'aral_pension', name: 'Aral pension Yojana', amount: 1196, active: true },
    { key: 'clinic_employee_salary', name: 'Clinic employee salary', amount: 15000, active: true },
    { key: 'car_cleaner', name: 'Car cleaner payment', amount: 500, active: true },
    { key: 'milk_buttermilk', name: 'Milk & butter milk', amount: 6000, active: true },
    { key: 'mutual_fund', name: 'Mutual fund', amount: 10000, active: true },
    { key: 'clinic_emi', name: 'Clinic EMI', amount: 20000, active: true },
    { key: 'bike_petrol', name: 'Bike petrol', amount: 2000, active: true },
    { key: 'car_petrol', name: 'Car petrol', amount: 3000, active: true },
    { key: 'newspaper', name: 'Newspaper bill', amount: 180, active: true },
    { key: 'sanay_van', name: 'Sanay school van payment', amount: 2200, active: true },
    { key: 'sanay_academy', name: 'Sanay academy fee', amount: 2500, active: true },
    { key: 'house_maid', name: 'House maid fee', amount: 2100, active: true }
];

function getRecurringSpends() {
    const list = DB.settings?.recurringSpends;
    if (Array.isArray(list) && list.length) return list;
    return DEFAULT_RECURRING_SPENDS.map(x => ({ ...x }));
}

function getRecurringDisabledYears() {
    const d = DB.settings?.recurringDisabledYears;
    return Array.isArray(d) ? d.map(String) : [];
}

function setRecurringYearEnabled(year, enabled) {
    const y = String(year);
    let dis = getRecurringDisabledYears().filter(x => x !== y);
    if (!enabled) dis.push(y);
    dis = [...new Set(dis)].sort();
    DB.settings = markUpdated({ ...(DB.settings || {}), recurringDisabledYears: dis });
    saveLocal();
}

function renderRecurringYearToggles() {
    const sel = $('#recurringYearSelect');
    if (!sel) return;
    const cy = new Date().getFullYear();
    const prev = sel.value || String(cy);
    let html = '';
    for (let y = cy; y >= 2019; y--) {
        const ys = String(y);
        html += `<option value="${ys}">${ys}</option>`;
    }
    sel.innerHTML = html;
    if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
    else sel.value = String(cy);
    const updateStatus = () => {
        const ys = sel.value || String(cy);
        const on = isRecurringYearEnabled(ys);
        const st = $('#recurringYearStatus');
        if (st) {
            st.textContent = on ? `Year ${ys}: COUNTING in Income & Expenses` : `Year ${ys}: OFF (not in totals)`;
            st.style.color = on ? '#1a7a4e' : '#a93131';
        }
    };
    sel.onchange = updateStatus;
    updateStatus();
}

function refreshExpenseTotalsEverywhere() {
    try { renderExpenses(); } catch (e) {}
    try { renderPaymentSummary(); } catch (e) {}
}

function removeAllAutoRecurringSpends() {
    if (!DB.expenses) return 0;
    let n = 0;
    DB.expenses.forEach(e => {
        if (!e || e._deleted) return;
        const auto = e._recurring || e._recurringKey || String(e.note || '').includes('Auto monthly spend');
        if (!auto) return;
        e._deleted = true;
        markUpdated(e);
        if (DB.meta && Array.isArray(DB.meta.deleted)) DB.meta.deleted.push(e.id);
        n++;
    });
    if (n) {
        saveLocal();
        try { syncNow(true); } catch (e) {}
    }
    return n;
}


function updateSpendSelectedHint() {
    const n = $$('.spendRowChk:checked').length;
    const h = $('#spendSelectedHint');
    if (h) h.textContent = n ? `${n} selected` : '';
}

function bindSpendBulkActions() {
    const delBtn = $('#spendDeleteSelectedBtn');
    if (delBtn && !delBtn._bound) {
        delBtn._bound = true;
        delBtn.addEventListener('click', () => {
            const ids = [...$$('.spendRowChk:checked')].map(c => c.value).filter(Boolean);
            if (!ids.length) { toast('Select at least one entry', true); return; }
            if (!confirm(`Delete ${ids.length} selected spend entr${ids.length === 1 ? 'y' : 'ies'}?`)) return;
            let n = 0;
            ids.forEach(id => {
                const x = (DB.expenses || []).find(e => e.id === id);
                if (x && !x._deleted) {
                    x._deleted = true;
                    markUpdated(x);
                    if (DB.meta && Array.isArray(DB.meta.deleted)) DB.meta.deleted.push(id);
                    n++;
                }
            });
            if (n) {
                saveLocal();
                try { syncNow(true); } catch (e) {}
                renderExpenses();
                toast(`Deleted ${n} spend entr${n === 1 ? 'y' : 'ies'}`);
            }
        });
    }
    const autoBtn = $('#spendClearAutoBtn');
    if (autoBtn && !autoBtn._bound) {
        autoBtn._bound = true;
        autoBtn.addEventListener('click', () => {
            if (!confirm('Remove ALL auto fixed monthly spends (2019 → now)? Manual expenses stay. Only current-month manual entries remain useful.')) return;
            const n = removeAllAutoRecurringSpends();
            // Also soft-delete any remaining auto-looking rows without flags by known fixed category names
            const names = new Set((typeof DEFAULT_RECURRING_SPENDS !== 'undefined' ? DEFAULT_RECURRING_SPENDS : []).map(x => String(x.name || '').toLowerCase()));
            let extra = 0;
            (DB.expenses || []).forEach(e => {
                if (!e || e._deleted) return;
                if (e._recurring || e._recurringKey) return; // already handled
                if (String(e.note || '').includes('Auto monthly spend')) {
                    e._deleted = true; markUpdated(e); extra++;
                    if (DB.meta && Array.isArray(DB.meta.deleted)) DB.meta.deleted.push(e.id);
                    return;
                }
                if (names.has(String(e.category || '').toLowerCase()) && String(e.date || '').slice(0, 7) !== isoToday().slice(0, 7)) {
                    // old fixed-category lines outside this month
                    e._deleted = true; markUpdated(e); extra++;
                    if (DB.meta && Array.isArray(DB.meta.deleted)) DB.meta.deleted.push(e.id);
                }
            });
            if (extra) { saveLocal(); try { syncNow(true); } catch (e) {} }
            renderExpenses();
            toast((n + extra) ? `Removed ${n + extra} auto/fixed lines` : 'No auto fixed spends found');
        });
    }
}

function saveRecurringSpendsFromUI() {
    const rows = $$('#recurringSpendBody tr');
    const list = [];
    rows.forEach((tr, i) => {
        const name = tr.querySelector('.recName')?.value?.trim();
        const amount = Math.max(0, Number(tr.querySelector('.recAmt')?.value || 0));
        const active = !!tr.querySelector('.recActive')?.checked;
        const key = tr.getAttribute('data-key') || ('custom_' + i + '_' + Date.now());
        if (name) list.push({ key, name, amount, active });
    });
    DB.settings = markUpdated({ ...(DB.settings || {}), recurringSpends: list });
    saveLocal();
    toast('Fixed monthly spends saved');
    renderRecurringSpendUI();
}

function renderRecurringSpendUI() {
    const body = $('#recurringSpendBody');
    if (!body) return;
    const list = getRecurringSpends();
    body.innerHTML = list.map((x, i) => `<tr data-key="${esc(x.key)}">
      <td>${i + 1}</td>
      <td><input class="recName embossed" value="${esc(x.name)}" style="width:100%;min-width:160px"></td>
      <td><input type="number" class="recAmt embossed" min="0" value="${Number(x.amount || 0)}" style="width:110px"></td>
      <td style="text-align:center"><input type="checkbox" class="recActive" ${x.active !== false ? 'checked' : ''}></td>
    </tr>`).join('') || '<tr><td colspan="4">No fixed spends — click Add row</td></tr>';
    renderRecurringYearToggles();
}

function applyRecurringSpendsForMonth(ym) {
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) ym = isoToday().slice(0, 7);
    if (!DB.expenses) DB.expenses = [];
    const list = getRecurringSpends().filter(x => x.active !== false && Number(x.amount) > 0);
    let added = 0;
    list.forEach(item => {
        const exists = active(DB.expenses).some(e =>
            e._recurringKey === item.key && String(e.date || '').slice(0, 7) === ym
        );
        if (exists) return;
        DB.expenses.push(markUpdated({
            id: uid('exp'),
            date: ym + '-01',
            category: item.name,
            note: 'Auto monthly spend',
            amount: Number(item.amount || 0),
            _recurringKey: item.key,
            _recurring: true
        }));
        added++;
    });
    if (added) {
        saveLocal();
        try { syncNow(true); } catch (e) {}
    }
    return added;
}

function applyRecurringSpendsAllYears() {
    const startY = 2019;
    const now = new Date();
    const endY = now.getFullYear();
    const endM = now.getMonth() + 1;
    let total = 0;
    for (let y = startY; y <= endY; y++) {
        const maxM = (y === endY) ? endM : 12;
        for (let m = 1; m <= maxM; m++) {
            const ym = y + '-' + String(m).padStart(2, '0');
            total += applyRecurringSpendsForMonth(ym);
        }
    }
    return total;
}

function ensureCurrentMonthRecurring() {
    try {
        const y = isoToday().slice(0, 4);
        if (!isRecurringYearEnabled(y)) return;
        const n = applyRecurringSpendsForMonth(isoToday().slice(0, 7));
        if (n > 0) console.log('Auto recurring spends added:', n);
    } catch (e) {}
}

function setupFixedSpendsCollapse() {
    const head = $('#fixedSpendsToggle');
    const body = $('#fixedSpendsBody');
    const arrow = $('#fixedSpendsArrow');
    if (!head || !body || head._bound) return;
    head._bound = true;
    const apply = (open) => {
        body.style.display = open ? '' : 'none';
        if (arrow) arrow.textContent = open ? '▾' : '▸';
        head.classList.toggle('collapsed', !open);
    };
    // default open first time
    apply(true);
    head.addEventListener('click', () => {
        const open = body.style.display === 'none';
        apply(open);
    });
}

function applyPaymentView(v) {
    const key = 'anandPaymentViewV42';
    if (!['clinicPayment', 'yearlyPayment', 'incomeExpense', 'spendEntries'].includes(v)) v = 'clinicPayment';
    localStorage.setItem(key, v);
    const sel = $('#paymentViewSelect');
    if (sel) sel.value = v;
    $('#clinicPaymentPanel')?.classList.toggle('hidden', v !== 'clinicPayment');
    $('#yearlyPaymentPanel')?.classList.toggle('hidden', v !== 'yearlyPayment');
    $('#incomeExpensePanel')?.classList.toggle('hidden', v !== 'incomeExpense');
    $('#spendEntriesPanel')?.classList.toggle('hidden', v !== 'spendEntries');
    $$('.navSubBtn[data-pay-view]').forEach(b => b.classList.toggle('active', b.getAttribute('data-pay-view') === v));
    const titles = {
        clinicPayment: 'Clinic Payment',
        yearlyPayment: 'Yearly Payment',
        incomeExpense: 'Income & Expenses',
        spendEntries: 'Spend Entries'
    };
    const heroH = document.querySelector('#payments .hero h1');
    if (heroH) heroH.textContent = titles[v] || 'Payment';
    try { renderPaymentSummary(); } catch (e) {}
    if (v === 'incomeExpense' || v === 'spendEntries') {
        /* auto fixed spends removed */
        try { renderExpenses(); } catch (e) {}
        if (v === 'spendEntries') { try { renderSpendLedger(); } catch(e) {} }
    }
}

function setupPaymentView() {
    const key = 'anandPaymentViewV42';
    let saved = localStorage.getItem(key) || 'clinicPayment';
    if (!['clinicPayment', 'yearlyPayment', 'incomeExpense', 'spendEntries'].includes(saved)) saved = 'clinicPayment';
    const sel = $('#paymentViewSelect');
    if (sel) {
        sel.value = saved;
        sel.addEventListener('change', () => applyPaymentView(sel.value));
    }
    const tog = $('#paymentNavToggle');
    const sub = $('#paymentNavSub');
    if (tog && sub && !tog._payBound) {
        tog._payBound = true;
        tog.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Toggle payment submenu only — do NOT navigate / open dashboard
            const willOpen = !sub.classList.contains('open');
            sub.classList.toggle('open', willOpen);
            $('#patientsNavSub')?.classList.remove('open');
        });
    }
    $$('.navSubBtn[data-pay-view]').forEach(btn => {
        if (btn._payBound) return;
        btn._payBound = true;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const v = btn.getAttribute('data-pay-view') || 'clinicPayment';
            openPage('payments');
            applyPaymentView(v);
            // close submenu after selection
            $('#paymentNavSub')?.classList.remove('open');
        });
    });
    // recurring spend buttons
    /* fixed spends UI removed */
    $('#saveRecurringSpendBtn')?.addEventListener('click', () => {});
    $('#applyRecurringSpendBtn')?.addEventListener('click', () => {
        saveRecurringSpendsFromUI();
        const y = isoToday().slice(0, 4);
        if (!isRecurringYearEnabled(y)) {
            toast(`Year ${y} is OFF — turn Count ON first, or entries will not appear in Income & Expenses`, true);
        }
        const n = applyRecurringSpendsForMonth(isoToday().slice(0, 7));
        refreshExpenseTotalsEverywhere();
        toast(n ? `${n} spends applied for this month` : 'This month already has these spends');
    });
    $('#addRecurringSpendBtn')?.addEventListener('click', () => {
        const list = getRecurringSpends();
        list.push({ key: 'custom_' + Date.now(), name: 'New spend', amount: 0, active: true });
        DB.settings = markUpdated({ ...(DB.settings || {}), recurringSpends: list });
        saveLocal();
        renderRecurringSpendUI();
    });
    $('#removeAutoRecurringBtn')?.addEventListener('click', () => {
        if (!confirm('Remove ALL auto fixed monthly spends from the ledger? Manual expenses stay. This cleans Fill-2019 style lines.')) return;
        const n = removeAllAutoRecurringSpends();
        refreshExpenseTotalsEverywhere();
        toast(n ? `Removed ${n} auto fixed spend lines` : 'No auto fixed spends found');
    });
    $('#recurringYearOnBtn')?.addEventListener('click', () => {
        const ys = $('#recurringYearSelect')?.value || String(new Date().getFullYear());
        setRecurringYearEnabled(ys, true);
        renderRecurringYearToggles();
        refreshExpenseTotalsEverywhere();
        toast(`Year ${ys}: fixed spends ON in totals`);
    });
    $('#recurringYearOffBtn')?.addEventListener('click', () => {
        const ys = $('#recurringYearSelect')?.value || String(new Date().getFullYear());
        setRecurringYearEnabled(ys, false);
        renderRecurringYearToggles();
        refreshExpenseTotalsEverywhere();
        toast(`Year ${ys}: fixed spends OFF in totals`);
    });
    $('#recurringYearsAllOnBtn')?.addEventListener('click', () => {
        DB.settings = markUpdated({ ...(DB.settings || {}), recurringDisabledYears: [] });
        saveLocal();
        renderRecurringYearToggles();
        refreshExpenseTotalsEverywhere();
        toast('All years ON — fixed spends count in totals');
    });
    $('#recurringYearsAllOffBtn')?.addEventListener('click', () => {
        const cy = new Date().getFullYear();
        const all = [];
        for (let y = 2019; y <= cy; y++) all.push(String(y));
        DB.settings = markUpdated({ ...(DB.settings || {}), recurringDisabledYears: all });
        saveLocal();
        renderRecurringYearToggles();
        refreshExpenseTotalsEverywhere();
        toast('All years OFF — fixed spends hidden from totals');
    });
    setupFixedSpendsCollapse();
    applyPaymentView(saved);
    /* auto fixed spends removed */
}

function buildMonthlyYearSelect() {
    const sel = $('#monthlyYearSelect');
    if (!sel) return;
    const cy = new Date().getFullYear();
    const start = 2019;
    if (!monthlyCompareYear || Number(monthlyCompareYear) < start || Number(monthlyCompareYear) > cy) {
        monthlyCompareYear = String(cy);
    }
    let html = '';
    for (let y = cy; y >= start; y--) {
        const ys = String(y);
        html += `<option value="${ys}"${ys === String(monthlyCompareYear) ? ' selected' : ''}>${ys}</option>`;
    }
    sel.innerHTML = html;
    sel.onchange = () => {
        monthlyCompareYear = sel.value || String(cy);
        renderMonthlyPaymentCompare();
    };
}

function renderMonthlyPaymentCompare() {
    const mBody = $('#payMonthCompareBody');
    if (!mBody) return;
    const cy = new Date().getFullYear();
    const yForMonths = String(monthlyCompareYear || cy);
    let mN = 0, mR = 0, mMed = 0, mT = 0;
    const mRows = [];
    for (let m = 1; m <= 12; m++) {
        const mm = String(m).padStart(2, '0');
        const n = paymentAmountBy(yForMonths, mm, null, 'new');
        const r = paymentAmountBy(yForMonths, mm, null, 'renewal');
        const med = feeCategoryAmountBy(yForMonths, mm, null, 'medicine');
        const t = paymentAmountBy(yForMonths, mm, null, 'total');
        mN += n; mR += r; mMed += med; mT += t;
        mRows.push(`<tr><td>${MONTH_NAMES[m - 1]}</td><td>${money(n)}</td><td>${money(r)}</td><td>${money(med)}</td><td><b>${money(t)}</b></td></tr>`);
    }
    mRows.push(`<tr class="summaryTotalRow"><td>Total ${yForMonths}</td><td>${money(mN)}</td><td>${money(mR)}</td><td>${money(mMed)}</td><td><b>${money(mT)}</b></td></tr>`);
    mBody.innerHTML = mRows.join('');
    const mTitle = $('#payMonthCompareTitle');
    if (mTitle) mTitle.textContent = `Monthly Payment Comparison — ${yForMonths}`;
}

function initPaymentYearSelect() {
    const ySel = $('#paymentYearSelect');
    const mSel = $('#paymentMonthSelect');
    const dSel = $('#paymentDaySelect');
    if (!ySel) return;
    const pays = active(DB.payments);
    const years = new Set();
    const cyNum = new Date().getFullYear();
    // Always offer 2018 through current year so any year can be selected
    for (let y = 2018; y <= cyNum; y++) years.add(String(y));
    pays.forEach(x => {
        const y = String(x.date || '').slice(0, 4);
        if (y && /^\d{4}$/.test(y)) years.add(y);
    });
    active(DB.patients).forEach(p => {
        const y = String(p.date || '').slice(0, 4);
        if (y && /^\d{4}$/.test(y)) years.add(y);
    });
    const cy = String(cyNum);
    const list = [...years].sort((a, b) => Number(b) - Number(a));
    const prevY = ySel.value || payFilterY || 'ALL';
    ySel.innerHTML = `<option value="ALL">All years (Till Date)</option>` + list.map(y => `<option value="${y}">${y}</option>`).join('');
    if (prevY === 'ALL' || list.includes(prevY)) ySel.value = prevY;
    else ySel.value = list.includes(cy) ? cy : (list[0] || 'ALL');
    payFilterY = ySel.value;

    if (mSel && !mSel._filled) {
        mSel.innerHTML = '<option value="">Any month</option>';
        for (let mm = 1; mm <= 12; mm++) mSel.insertAdjacentHTML('beforeend', `<option value="${String(mm).padStart(2,'0')}">${String(mm).padStart(2,'0')} — ${MONTH_NAMES[mm-1]}</option>`);
        mSel._filled = true;
    }
    if (dSel && !dSel._filled) {
        dSel.innerHTML = '<option value="">Any day</option>';
        for (let dd = 1; dd <= 31; dd++) dSel.insertAdjacentHTML('beforeend', `<option value="${String(dd).padStart(2,'0')}">${String(dd).padStart(2,'0')}</option>`);
        dSel._filled = true;
    }
    if (mSel && payFilterM) mSel.value = payFilterM;
    if (dSel && payFilterD) dSel.value = payFilterD;

    if (!ySel._bound) {
        const sync = () => {
            payFilterY = ySel.value;
            payFilterM = mSel?.value || '';
            payFilterD = dSel?.value || '';
            renderPaymentSummary();
        };
        ySel.addEventListener('change', () => {
            // Year change: keep month/day so user can refine, but always refresh
            payFilterY = ySel.value;
            payFilterM = mSel?.value || '';
            payFilterD = dSel?.value || '';
            renderPaymentSummary();
        });
        mSel?.addEventListener('change', sync);
        dSel?.addEventListener('change', sync);
        $('#payFilterShow')?.addEventListener('click', () => {
            payFilterY = ySel.value;
            payFilterM = mSel?.value || '';
            payFilterD = dSel?.value || '';
            renderPaymentSummary();
        });
        $('#payFilterClear')?.addEventListener('click', () => {
            payFilterY = ySel.value = 'ALL';
            payFilterM = '';
            payFilterD = '';
            if (mSel) mSel.value = '';
            if (dSel) dSel.value = '';
            const cf = $('#payCustomFrom'), ct = $('#payCustomTo');
            if (cf) cf.value = '';
            if (ct) ct.value = '';
            renderPaymentSummary();
        });
        $('#payCustomFrom')?.addEventListener('change', () => renderPaymentSummary());
        $('#payCustomTo')?.addEventListener('change', () => renderPaymentSummary());
        ySel._bound = true;
    }
}

function paymentAmountBy(year, month, day, caseType) {
    const pays = active(DB.payments);
    return pays.filter(x => {
        const d = String(x.date || '');
        if (!d) return false;
        if (year && year !== 'ALL' && d.slice(0, 4) !== String(year)) return false;
        if (month && d.slice(5, 7) !== String(month).padStart(2, '0')) return false;
        if (day && d.slice(8, 10) !== String(day).padStart(2, '0')) return false;
        if (caseType && caseType !== 'total') {
            const isRenew = x.feeCategory === 'renewal' || x.caseType === 'renewal';
            if (caseType === 'renewal') return isRenew;
            return x.caseType === caseType && !isRenew;
        }
        return true;
    }).reduce((s, x) => s + Number(x.amount || 0), 0);
}

/** Sum ledger by feeCategory (consultation / medicine / renewal) with optional date filters */
function feeCategoryAmountBy(year, month, day, feeCategory) {
    return active(DB.payments).filter(x => {
        const d = String(x.date || '');
        if (!d) return false;
        if (year && year !== 'ALL' && d.slice(0, 4) !== String(year)) return false;
        if (month && d.slice(5, 7) !== String(month).padStart(2, '0')) return false;
        if (day && d.slice(8, 10) !== String(day).padStart(2, '0')) return false;
        if (feeCategory) return (x.feeCategory || '') === feeCategory;
        return true;
    }).reduce((s, x) => s + Number(x.amount || 0), 0);
}

/** Custom date-range sum from payment ledger */
function paymentAmountRange(from, to, caseType, feeCategory) {
    return active(DB.payments).filter(x => {
        const d = String(x.date || '');
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        if (feeCategory) return (x.feeCategory || '') === feeCategory;
        if (caseType && caseType !== 'total') {
            const isRenew = x.feeCategory === 'renewal' || x.caseType === 'renewal';
            if (caseType === 'renewal') return isRenew;
            return x.caseType === caseType && !isRenew;
        }
        return true;
    }).reduce((s, x) => s + Number(x.amount || 0), 0);
}


function buildExpenseMonthlyYearSelect() {
    const sel = $('#expenseMonthlyYearSelect');
    if (!sel) return;
    const cy = new Date().getFullYear();
    const start = 2019;
    if (!expenseMonthlyYear) expenseMonthlyYear = String(cy);
    if (expenseMonthlyYear !== 'all') {
        const n = Number(expenseMonthlyYear);
        if (!n || n < start || n > cy) expenseMonthlyYear = String(cy);
    }
    let html = `<option value="all"${expenseMonthlyYear === 'all' ? ' selected' : ''}>All years</option>`;
    for (let y = cy; y >= start; y--) {
        const ys = String(y);
        html += `<option value="${ys}"${ys === String(expenseMonthlyYear) ? ' selected' : ''}>${ys}</option>`;
    }
    sel.innerHTML = html;
    sel.onchange = () => {
        expenseMonthlyYear = sel.value || String(cy);
        // Refresh summary boxes + monthly table for selected year
        try { renderExpenses(); } catch (e) {
            renderExpenseMonthlyCompare();
            renderExpenseYearComparison();
        }
    };
}

function renderExpenseMonthlyCompare() {
    const cb = $('#expenseCompareBody');
    if (!cb) return;
    let y = String(expenseMonthlyYear || new Date().getFullYear());
    if (y === 'all') y = String(new Date().getFullYear());
    let totalIncome = 0, totalExpense = 0, totalNet = 0;
    const rows = [];
    for (let m = 1; m <= 12; m++) {
        const mm = String(m).padStart(2, '0');
        const gross = paymentAmountBy(y, mm, null, 'total');
        const ex = expenseAmount('custom', y, mm, null);
        const net = gross - ex;
        totalIncome += gross; totalExpense += ex; totalNet += net;
        rows.push(`<tr><td>${MONTH_NAMES[m - 1]}</td><td>${money(gross)}</td><td>${money(ex)}</td><td><b>${money(net)}</b></td></tr>`);
    }
    rows.push(`<tr class="summaryTotalRow"><td>Total ${y}</td><td>${money(totalIncome)}</td><td>${money(totalExpense)}</td><td><b>${money(totalNet)}</b></td></tr>`);
    cb.innerHTML = rows.join('');
    const title = $('#expenseMonthlyTitle');
    if (title) title.textContent = `Income vs Expenses (Monthly) — ${y}`;
}

function getExpenseYearsDesc() {
    const years = new Set();
    active(DB.payments).forEach(x => { const y = String(x.date || '').slice(0, 4); if (/^\d{4}$/.test(y)) years.add(y); });
    active(DB.expenses || []).forEach(x => { const y = String(x.date || '').slice(0, 4); if (/^\d{4}$/.test(y)) years.add(y); });
    const cy = new Date().getFullYear();
    for (let y = 2019; y <= cy; y++) years.add(String(y));
    return [...years].sort((a, b) => Number(b) - Number(a));
}

function renderExpenseYearComparison() {
    const yExpBody = $('#expenseYearCompareBody');
    if (!yExpBody) return;
    let list = getExpenseYearsDesc();
    if (!expenseYearShowAll) {
        list = list.filter(y => paymentAmountBy(y, null, null, 'total') > 0 || expenseAmount('custom', y, null, null) > 0);
    }
    const totalAll = list.length;
    let pageRows = list;
    let totalPages = 1;
    if (!expenseYearShowAll) {
        totalPages = Math.max(1, Math.ceil(list.length / expenseYearPageSize));
        if (expenseYearPage > totalPages) expenseYearPage = totalPages;
        if (expenseYearPage < 1) expenseYearPage = 1;
        pageRows = list.slice((expenseYearPage - 1) * expenseYearPageSize, expenseYearPage * expenseYearPageSize);
    }
    let tInc = 0, tExp = 0, tNet = 0;
    list.forEach(y => {
        const gross = paymentAmountBy(y, null, null, 'total');
        const ex = expenseAmount('custom', y, null, null);
        tInc += gross; tExp += ex; tNet += gross - ex;
    });
    const rows = pageRows.map(y => {
        const gross = paymentAmountBy(y, null, null, 'total');
        const ex = expenseAmount('custom', y, null, null);
        const net = gross - ex;
        return `<tr><td><b>${y}</b></td><td>${money(gross)}</td><td>${money(ex)}</td><td><b>${money(net)}</b></td></tr>`;
    });
    if (rows.length) {
        rows.push(`<tr class="summaryTotalRow"><td>${expenseYearShowAll ? 'Grand Total (all years)' : 'Total (this view)'}</td><td>${money(tInc)}</td><td>${money(tExp)}</td><td><b>${money(tNet)}</b></td></tr>`);
    }
    yExpBody.innerHTML = rows.join('') || '<tr><td colspan="4">No year data</td></tr>';
    const hint = $('#expenseYearHint');
    if (hint) {
        hint.textContent = expenseYearShowAll
            ? `Showing all ${totalAll} years (2019 → ${new Date().getFullYear()})`
            : `${totalAll} years with data · 10 per page`;
    }
    const btn = $('#expenseYearShowAllBtn');
    if (btn) {
        btn.textContent = expenseYearShowAll ? 'Show 10 years per page' : 'Show all years (start → now)';
        btn.onclick = () => {
            expenseYearShowAll = !expenseYearShowAll;
            expenseYearPage = 1;
            renderExpenseYearComparison();
        };
    }
    const pag = $('#expenseYearPagination');
    if (pag) {
        if (expenseYearShowAll || totalAll <= expenseYearPageSize) {
            pag.innerHTML = expenseYearShowAll ? `<span class="mini">Full timeline · newest first</span>` : (totalAll ? `<span class="mini">Showing all ${totalAll}</span>` : '');
        } else {
            let html = `<button type="button" class="btn embossed" data-ey="prev" ${expenseYearPage<=1?'disabled':''}>‹ Prev</button>`;
            for (let i = 1; i <= totalPages; i++) {
                html += `<button type="button" class="btn embossed ${i===expenseYearPage?'active':''}" data-ey="${i}">${i}</button>`;
            }
            html += `<button type="button" class="btn embossed" data-ey="next" ${expenseYearPage>=totalPages?'disabled':''}>Next ›</button>`;
            html += `<span class="mini" style="margin-left:8px">Page ${expenseYearPage}/${totalPages}</span>`;
            pag.innerHTML = html;
            pag.querySelectorAll('[data-ey]').forEach(b => {
                b.addEventListener('click', () => {
                    const v = b.getAttribute('data-ey');
                    if (v === 'prev') expenseYearPage = Math.max(1, expenseYearPage - 1);
                    else if (v === 'next') expenseYearPage = Math.min(totalPages, expenseYearPage + 1);
                    else expenseYearPage = Number(v) || 1;
                    renderExpenseYearComparison();
                });
            });
        }
    }
}

function initSpendLedgerFilters() {
    const ySel = $('#spendLedgerYear');
    const mSel = $('#spendLedgerMonth');
    if (!ySel || !mSel) return;
    const cy = new Date().getFullYear();
    const cm = String(new Date().getMonth() + 1).padStart(2, '0');
    if (!spendLedgerY) spendLedgerY = String(cy);
    if (!spendLedgerM) spendLedgerM = cm;
    let yh = '';
    for (let y = cy; y >= 2019; y--) yh += `<option value="${y}">${y}</option>`;
    ySel.innerHTML = yh;
    ySel.value = spendLedgerY;
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    mSel.innerHTML = months.map((n, i) => `<option value="${String(i+1).padStart(2,'0')}">${n}</option>`).join('');
    mSel.value = spendLedgerM;
    if (!ySel._bound) {
        ySel._bound = true;
        ySel.addEventListener('change', () => { spendLedgerY = ySel.value; spendLedgerPage = 1; renderSpendLedger(); });
        mSel.addEventListener('change', () => { spendLedgerM = mSel.value; spendLedgerPage = 1; renderSpendLedger(); });
        $('#spendLedgerThisMonthBtn')?.addEventListener('click', () => {
            spendLedgerY = String(new Date().getFullYear());
            spendLedgerM = String(new Date().getMonth() + 1).padStart(2, '0');
            spendLedgerPage = 1;
            ySel.value = spendLedgerY;
            mSel.value = spendLedgerM;
            renderSpendLedger();
        });
    }
}

function renderSpendLedger() {
    const body = $('#expenseBody');
    if (!body) return;
    initSpendLedgerFilters();
    const y = spendLedgerY || String(new Date().getFullYear());
    const m = spendLedgerM || String(new Date().getMonth() + 1).padStart(2, '0');
    const ym = y + '-' + m;
    const rows = active(DB.expenses || [])
        .filter(x => String(x.date || '').slice(0, 7) === ym)
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b._updated || '').localeCompare(String(a._updated || '')));
    const totalPages = Math.max(1, Math.ceil(rows.length / spendLedgerPageSize));
    if (spendLedgerPage > totalPages) spendLedgerPage = totalPages;
    if (spendLedgerPage < 1) spendLedgerPage = 1;
    const slice = rows.slice((spendLedgerPage - 1) * spendLedgerPageSize, spendLedgerPage * spendLedgerPageSize);
    const monthName = (MONTH_NAMES && MONTH_NAMES[Number(m) - 1]) || m;
    const hint = $('#spendLedgerHint');
    if (hint) hint.textContent = `${monthName} ${y} · ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`;
    body.innerHTML = slice.map((x, i) => {
        const sr = (spendLedgerPage - 1) * spendLedgerPageSize + i + 1;
        return `<tr data-exp-id="${x.id}"><td><input type="checkbox" class="spendRowChk" value="${x.id}"></td><td>${sr}</td><td>${fmtDate(x.date)}</td><td>${esc(x.category || 'Other Expense')}</td><td>${esc(x.note || '')}</td><td>${money(x.amount)}</td><td><div class="actions compactActions"><button class="btn embossed" onclick="editExpense('${x.id}')">Edit</button><button class="btn embossed deleteBox" onclick="deleteExpense('${x.id}')">Delete</button></div></td></tr>`;
    }).join('') || `<tr><td colspan="7">No spends for ${monthName} ${y}</td></tr>`;
    const mobE = $('#expenseMobileCards');
    if (mobE) {
        mobE.innerHTML = slice.map(x => `<div class="patientMobileCard">
          <label class="pmTitle" style="display:flex;align-items:center;gap:8px"><input type="checkbox" class="spendRowChk" value="${x.id}"> ${esc(x.category || 'Expense')} · ${money(x.amount)}</label>
          <div class="pmMeta">${fmtDate(x.date)} · ${esc(x.note || '')}</div>
          <div class="pmActions">
            <button class="btn embossed patientMiniBtn" onclick="editExpense('${x.id}')">Edit</button>
            <button class="btn embossed deleteBox patientMiniBtn" onclick="deleteExpense('${x.id}')">Delete</button>
          </div></div>`).join('') || `<div class="mini">No spends for ${monthName} ${y}</div>`;
    }
    const allChk = $('#spendSelectAll');
    if (allChk) {
        allChk.checked = false;
        if (!allChk._bound) {
            allChk._bound = true;
            allChk.addEventListener('change', () => {
                $$('.spendRowChk').forEach(c => { c.checked = allChk.checked; });
                updateSpendSelectedHint();
            });
        }
    }
    $$('.spendRowChk').forEach(c => {
        c.addEventListener('change', updateSpendSelectedHint);
    });
    updateSpendSelectedHint();
    bindSpendBulkActions();
    const pag = $('#spendLedgerPagination');
    if (pag) {
        if (rows.length <= spendLedgerPageSize) {
            pag.innerHTML = rows.length ? `<span class="mini">All ${rows.length} on this page</span>` : '';
        } else {
            let html = `<button type="button" class="btn embossed" data-sl="prev" ${spendLedgerPage<=1?'disabled':''}>‹ Prev</button>`;
            for (let i = 1; i <= totalPages; i++) {
                html += `<button type="button" class="btn embossed ${i===spendLedgerPage?'active':''}" data-sl="${i}">${i}</button>`;
            }
            html += `<button type="button" class="btn embossed" data-sl="next" ${spendLedgerPage>=totalPages?'disabled':''}>Next ›</button>`;
            pag.innerHTML = html;
            pag.querySelectorAll('[data-sl]').forEach(b => {
                b.addEventListener('click', () => {
                    const v = b.getAttribute('data-sl');
                    if (v === 'prev') spendLedgerPage = Math.max(1, spendLedgerPage - 1);
                    else if (v === 'next') spendLedgerPage = Math.min(totalPages, spendLedgerPage + 1);
                    else spendLedgerPage = Number(v) || 1;
                    renderSpendLedger();
                });
            });
        }
    }
}


function totalPaymentsSum() {
    return active(DB.payments || []).reduce((a, x) => a + Number(x.amount || 0), 0);
}
function totalExpensesSum() {
    return active(DB.expenses || []).reduce((a, x) => a + Number(x.amount || 0), 0);
}
function updateGrossIncomeLifetime() {
    const net = totalPaymentsSum() - totalExpensesSum();
    set('grossLifetime', money(net));
    return net;
}
function clearAllExpensesOnce() {
    if (!DB.settings) DB.settings = {};
    if (DB.settings.expensesClearedV58) return 0;
    if (!DB.expenses || !DB.expenses.length) {
        DB.settings = markUpdated({ ...DB.settings, expensesClearedV58: true });
        saveLocal();
        return 0;
    }
    let n = 0;
    DB.expenses.forEach(e => {
        if (!e || e._deleted) return;
        e._deleted = true;
        markUpdated(e);
        if (DB.meta && Array.isArray(DB.meta.deleted)) DB.meta.deleted.push(e.id);
        n++;
    });
    DB.settings = markUpdated({ ...DB.settings, expensesClearedV58: true });
    saveLocal();
    try { syncNow(true); } catch (e) {}
    return n;
}

function renderExpenses() {
    renderSpendLedger();
    const today = isoToday();
    const selY = String(expenseMonthlyYear || 'all');
    const isAll = (selY === 'all' || selY === '');
    set('grossExpensesLifetime', money(totalExpensesSum()));
    updateGrossIncomeLifetime();
    let expM, expY, netM, netY, netD;
    if (isAll) {
        const mm = today.slice(5, 7);
        expM = expenseAmount('custom', today.slice(0, 4), mm, null);
        expY = expenseAmount('total');
        const grossAll = active(DB.payments).reduce((a, x) => a + Number(x.amount || 0), 0);
        netY = grossAll - totalExpensesSum();
        const grossM = active(DB.payments).filter(x => String(x.date || '').slice(0, 7) === today.slice(0, 7)).reduce((a, x) => a + Number(x.amount || 0), 0);
        netM = grossM - expM;
        const grossD = active(DB.payments).filter(x => String(x.date || '') === today).reduce((a, x) => a + Number(x.amount || 0), 0);
        const expD = expenseAmount('custom', today.slice(0, 4), mm, today.slice(8, 10));
        netD = grossD - expD;
        set('expenseToday', money(expD));
    } else {
        const y = selY;
        const mm = today.slice(5, 7);
        expM = expenseAmount('custom', y, mm, null);
        expY = expenseAmount('custom', y, null, null);
        const grossY = active(DB.payments).filter(x => String(x.date || '').slice(0, 4) === y).reduce((a, x) => a + Number(x.amount || 0), 0);
        const grossM = active(DB.payments).filter(x => String(x.date || '').slice(0, 7) === (y + '-' + mm)).reduce((a, x) => a + Number(x.amount || 0), 0);
        netY = grossY - expY;
        netM = grossM - expM;
        if (y === today.slice(0, 4)) {
            const grossD = active(DB.payments).filter(x => String(x.date || '') === today).reduce((a, x) => a + Number(x.amount || 0), 0);
            const expD = expenseAmount('custom', y, mm, today.slice(8, 10));
            netD = grossD - expD;
            set('expenseToday', money(expD));
        } else {
            netD = 0;
            set('expenseToday', money(0));
        }
    }
    set('expenseMonth', money(expM));
    set('expenseYear', money(expY));
    set('netToday', money(netD));
    set('netMonth', money(netM));
    set('netYear', money(netY));
    buildExpenseMonthlyYearSelect();
    renderExpenseMonthlyCompare();
    renderExpenseYearComparison();
}
function saveExpense(e){
    e.preventDefault();
    const id=$('#expenseEditId')?.value; const obj={date:$('#expenseDate').value||isoToday(),category:$('#expenseCategory').value.trim()||'Other Expense',note:$('#expenseNote').value.trim(),amount:Math.max(0,Number($('#expenseAmount').value||0))};
    if(!obj.amount){toast('Enter an expense amount',true);return;}
    if(id){const x=DB.expenses.find(x=>x.id===id); if(x){Object.assign(x,obj);markUpdated(x)}} else {DB.expenses.push(markUpdated({id:uid('exp'),...obj}))}
    $('#expenseForm').reset(); $('#expenseEditId').value=''; saveLocal(); renderExpenses(); syncNow(true); toast(id?'Expense updated':'Expense registered');
}
function editExpense(id){const x=active(DB.expenses||[]).find(x=>x.id===id); if(!x)return; $('#expenseEditId').value=x.id; $('#expenseDate').value=x.date||isoToday(); $('#expenseCategory').value=x.category||''; $('#expenseNote').value=x.note||''; $('#expenseAmount').value=x.amount||0; $('#expenseFormTitle').textContent='Edit Expense'; window.scrollTo({top:document.querySelector('#expenseCard')?.offsetTop||0,behavior:'smooth'});}
function deleteExpense(id){const x=DB.expenses.find(x=>x.id===id); if(!x||!confirm('Delete this expense?'))return; x._deleted=true; markUpdated(x); DB.meta.deleted.push(id); saveLocal(); renderExpenses(); try{renderPaymentSummary();}catch(e){} try{updateGrossIncomeLifetime();}catch(e){} syncNow(true); toast('Expense deleted');}
function clearExpenseForm(){ $('#expenseForm')?.reset(); $('#expenseEditId') && ($('#expenseEditId').value=''); set('expenseFormTitle','Add Expense'); if($('#expenseDate')) $('#expenseDate').value=isoToday(); }

function renderPaymentSummary() {
    const ySel = $('#paymentYearSelect');
    const year = payFilterY || ySel?.value || 'ALL';
    const month = payFilterM || '';
    const day = payFilterD || '';
    const fromEl = $('#payCustomFrom');
    const toEl = $('#payCustomTo');
    const customFrom = fromEl?.value || '';
    const customTo = toEl?.value || '';
    const useCustom = !!(customFrom || customTo);

    let newY, oldY, renY, medY, totY;
    if (useCustom) {
        newY = paymentAmountRange(customFrom || null, customTo || null, 'new');
        oldY = paymentAmountRange(customFrom || null, customTo || null, 'old');
        renY = paymentAmountRange(customFrom || null, customTo || null, 'renewal');
        medY = paymentAmountRange(customFrom || null, customTo || null, null, 'medicine');
        totY = paymentAmountRange(customFrom || null, customTo || null, 'total');
    } else {
        const y = year === 'ALL' ? null : year;
        newY = paymentAmountBy(y, month || null, day || null, 'new');
        oldY = paymentAmountBy(y, month || null, day || null, 'old');
        renY = paymentAmountBy(y, month || null, day || null, 'renewal');
        medY = feeCategoryAmountBy(y, month || null, day || null, 'medicine');
        totY = paymentAmountBy(y, month || null, day || null, 'total');
    }

    // Outstanding = sum of pendingFor across all active patients (ledger gap)
    const outstanding = active(DB.patients).reduce((a, p) => a + pendingFor(p), 0);

    set('paySumNew', money(newY));
        set('paySumRenewal', money(renY));
    set('paySumMedicine', money(medY));
    // Received box removed (was duplicate of Total Collected)
    set('paySumPending', money(outstanding));
    set('paySumTotal', money(totY));

    let label = year === 'ALL' ? 'All years (Till Date)' : `Year ${year}`;
    if (useCustom) {
        label = (customFrom || '…') + ' → ' + (customTo || '…');
    } else if (year !== 'ALL' && month && day) {
        label = `${day}/${month}/${year}`;
    } else if (year !== 'ALL' && month) {
        label = `${MONTH_NAMES[Number(month)-1]} ${year}`;
    }
    set('payYearHint', `Showing: ${label}. All figures from payment ledger.`);
    set('paySumTotalLabel', 'Total Collected');
    set('payMonthTitle', useCustom ? `Breakdown — ${label}` : (year === 'ALL' ? 'Payment by Year — Till Date' : (month && !day ? `Months of ${year}` : `Breakdown — ${label}`)));

    const body = $('#payMonthBody');
    const foot = $('#payMonthFoot');
    const head = $('#payMonthHead');
    if (!body) return;

    const z = (n) => money(n);
    let rowsHtml = '';
    let sumN = 0, sumO = 0, sumR = 0, sumM = 0, sumT = 0;

    if (useCustom) {
        if (head) head.innerHTML = '<tr><th>Period</th><th>New Cases</th><th>Renewal</th><th>Medicine</th><th>Total</th></tr>';
        rowsHtml = `<tr><td>${label}</td><td>${z(newY)}</td><td>${z(renY)}</td><td>${z(medY)}</td><td><b>${z(totY)}</b></td></tr>`;
        sumN = newY; sumO = oldY; sumR = renY; sumM = medY; sumT = totY;
        body.innerHTML = rowsHtml;
        if (foot) foot.innerHTML = `<tr><td>Total</td><td>${money(sumN)}</td><td>${money(sumR)}</td><td>${money(sumM)}</td><td>${money(sumT)}</td></tr>`;
    } else if (year === 'ALL') {
        if (head) head.innerHTML = '<tr><th>Year</th><th>New Cases</th><th>Renewal</th><th>Medicine</th><th>Total</th></tr>';
        const years = new Set();
        active(DB.payments).forEach(x => {
            const yy = String(x.date || '').slice(0, 4);
            if (/^\d{4}$/.test(yy)) years.add(yy);
        });
        const list = [...years].sort((a, b) => Number(b) - Number(a));
        list.forEach(yy => {
            const n = paymentAmountBy(yy, null, null, 'new');
            const o = paymentAmountBy(yy, null, null, 'old');
            const r = paymentAmountBy(yy, null, null, 'renewal');
            const med = feeCategoryAmountBy(yy, null, null, 'medicine');
            const t = paymentAmountBy(yy, null, null, 'total');
            sumN += n; sumO += o; sumR += r; sumM += med; sumT += t;
            rowsHtml += `<tr><td>${yy}</td><td>${z(n)}</td><td>${z(r)}</td><td>${z(med)}</td><td><b>${z(t)}</b></td></tr>`;
        });
        body.innerHTML = rowsHtml || '<tr><td colspan="5">No payments in ledger</td></tr>';
        if (foot) foot.innerHTML = `<tr><td>Grand Total</td><td>${money(sumN)}</td><td>${money(sumR)}</td><td>${money(sumM)}</td><td>${money(sumT)}</td></tr>`;
    } else if (month && !day) {
        if (head) head.innerHTML = '<tr><th>Month</th><th>New Cases</th><th>Renewal</th><th>Medicine</th><th>Total</th></tr>';
        for (let m = 1; m <= 12; m++) {
            const mm = String(m).padStart(2, '0');
            if (month && mm !== String(month).padStart(2, '0')) continue;
            const n = paymentAmountBy(year, mm, null, 'new');
            const o = paymentAmountBy(year, mm, null, 'old');
            const r = paymentAmountBy(year, mm, null, 'renewal');
            const med = feeCategoryAmountBy(year, mm, null, 'medicine');
            const t = paymentAmountBy(year, mm, null, 'total');
            sumN += n; sumO += o; sumR += r; sumM += med; sumT += t;
            rowsHtml += `<tr><td>${MONTH_NAMES[m - 1]}</td><td>${z(n)}</td><td>${z(r)}</td><td>${z(med)}</td><td><b>${z(t)}</b></td></tr>`;
        }
        // if single month filter, still show only that month - if empty months wanted for full year when month empty
        body.innerHTML = rowsHtml || '<tr><td colspan="5">No payments</td></tr>';
        if (foot) foot.innerHTML = `<tr><td>Total</td><td>${money(sumN)}</td><td>${money(sumR)}</td><td>${money(sumM)}</td><td>${money(sumT)}</td></tr>`;
    } else if (!month) {
        // full year month-by-month
        if (head) head.innerHTML = '<tr><th>Month</th><th>New Cases</th><th>Renewal</th><th>Medicine</th><th>Total</th></tr>';
        for (let m = 1; m <= 12; m++) {
            const mm = String(m).padStart(2, '0');
            const n = paymentAmountBy(year, mm, null, 'new');
            const o = paymentAmountBy(year, mm, null, 'old');
            const r = paymentAmountBy(year, mm, null, 'renewal');
            const med = feeCategoryAmountBy(year, mm, null, 'medicine');
            const t = paymentAmountBy(year, mm, null, 'total');
            sumN += n; sumO += o; sumR += r; sumM += med; sumT += t;
            rowsHtml += `<tr><td>${MONTH_NAMES[m - 1]}</td><td>${z(n)}</td><td>${z(r)}</td><td>${z(med)}</td><td><b>${z(t)}</b></td></tr>`;
        }
        body.innerHTML = rowsHtml;
        if (foot) foot.innerHTML = `<tr><td>Total Payment of ${year}</td><td>${money(sumN)}</td><td>${money(sumR)}</td><td>${money(sumM)}</td><td>${money(sumT)}</td></tr>`;
    } else {
        // specific day
        if (head) head.innerHTML = '<tr><th>Date</th><th>New Cases</th><th>Renewal</th><th>Medicine</th><th>Total</th></tr>';
        rowsHtml = `<tr><td>${day}/${month}/${year}</td><td>${z(newY)}</td><td>${z(renY)}</td><td>${z(medY)}</td><td><b>${z(totY)}</b></td></tr>`;
        body.innerHTML = rowsHtml;
        if (foot) foot.innerHTML = `<tr><td>Total</td><td>${money(newY)}</td><td>${money(renY)}</td><td>${money(medY)}</td><td>${money(totY)}</td></tr>`;
    }

    // Monthly payment comparison — single Year dropdown 2019…current
    buildMonthlyYearSelect();
    renderMonthlyPaymentCompare();
    renderYearComparisonTable();
}

function getLedgerYearsDesc() {
    const years = new Set();
    active(DB.payments).forEach(x => {
        const yy = String(x.date || '').slice(0, 4);
        if (/^\d{4}$/.test(yy)) years.add(yy);
    });
    // Always include range 2019 → current so empty years can appear when show-all
    const cy = new Date().getFullYear();
    for (let y = 2019; y <= cy; y++) years.add(String(y));
    return [...years].sort((a, b) => Number(b) - Number(a));
}

function renderYearComparisonTable() {
    const yBody = $('#payYearCompareBody');
    if (!yBody) return;
    const fullList = getLedgerYearsDesc().filter(yy => {
        // When not show-all, only years that have any payment
        if (yearCompareShowAll) return true;
        return paymentAmountBy(yy, null, null, 'total') > 0
            || feeCategoryAmountBy(yy, null, null, 'medicine') > 0;
    });
    // Prefer years with data first if mixed empty — already filtered
    let list = fullList;
    if (yearCompareShowAll) {
        list = getLedgerYearsDesc(); // 2019→now all
    }
    const totalAll = list.length;
    let pageRows = list;
    let totalPages = 1;
    if (!yearCompareShowAll) {
        totalPages = Math.max(1, Math.ceil(list.length / yearComparePageSize));
        if (yearComparePage > totalPages) yearComparePage = totalPages;
        if (yearComparePage < 1) yearComparePage = 1;
        pageRows = list.slice((yearComparePage - 1) * yearComparePageSize, yearComparePage * yearComparePageSize);
    }
    let totalN = 0, totalR = 0, totalMed = 0, totalT = 0;
    // Grand total from full filtered list
    list.forEach(yy => {
        totalN += paymentAmountBy(yy, null, null, 'new');
        totalR += paymentAmountBy(yy, null, null, 'renewal');
        totalMed += feeCategoryAmountBy(yy, null, null, 'medicine');
        totalT += paymentAmountBy(yy, null, null, 'total');
    });
    const rows = pageRows.map(yy => {
        const n = paymentAmountBy(yy, null, null, 'new');
        const r = paymentAmountBy(yy, null, null, 'renewal');
        const med = feeCategoryAmountBy(yy, null, null, 'medicine');
        const t = paymentAmountBy(yy, null, null, 'total');
        return `<tr><td><b>${yy}</b></td><td>${money(n)}</td><td>${money(r)}</td><td>${money(med)}</td><td><b>${money(t)}</b></td></tr>`;
    });
    if (rows.length) {
        rows.push(`<tr class="summaryTotalRow"><td>${yearCompareShowAll ? 'Grand Total (all years)' : 'Total (this view)'}</td><td>${money(totalN)}</td><td>${money(totalR)}</td><td>${money(totalMed)}</td><td><b>${money(totalT)}</b></td></tr>`);
    }
    yBody.innerHTML = rows.join('') || '<tr><td colspan="5">No year data</td></tr>';
    const hint = $('#yearCompareHint');
    if (hint) {
        hint.textContent = yearCompareShowAll
            ? `Showing all ${totalAll} years (2019 → ${new Date().getFullYear()})`
            : `${totalAll} years with data · 10 per page`;
    }
    const btn = $('#yearCompareShowAllBtn');
    if (btn) {
        btn.textContent = yearCompareShowAll ? 'Show 10 years per page' : 'Show all years (start → now)';
        btn.classList.toggle('active', yearCompareShowAll);
        btn.onclick = () => {
            yearCompareShowAll = !yearCompareShowAll;
            yearComparePage = 1;
            renderYearComparisonTable();
        };
    }
    const pag = $('#yearComparePagination');
    if (pag) {
        if (yearCompareShowAll || totalAll <= yearComparePageSize) {
            pag.innerHTML = yearCompareShowAll ? `<span class="mini">Full timeline · newest year first</span>` : (totalAll ? `<span class="mini">Showing all ${totalAll}</span>` : '');
        } else {
            let html = `<button type="button" class="btn embossed" data-yc="prev" ${yearComparePage<=1?'disabled':''}>‹ Prev</button>`;
            for (let i = 1; i <= totalPages; i++) {
                html += `<button type="button" class="btn embossed ${i===yearComparePage?'active':''}" data-yc="${i}">${i}</button>`;
            }
            html += `<button type="button" class="btn embossed" data-yc="next" ${yearComparePage>=totalPages?'disabled':''}>Next ›</button>`;
            html += `<span class="mini" style="margin-left:8px">Page ${yearComparePage}/${totalPages}</span>`;
            pag.innerHTML = html;
            pag.querySelectorAll('[data-yc]').forEach(b => {
                b.addEventListener('click', () => {
                    const v = b.getAttribute('data-yc');
                    if (v === 'prev') yearComparePage = Math.max(1, yearComparePage - 1);
                    else if (v === 'next') yearComparePage = Math.min(totalPages, yearComparePage + 1);
                    else yearComparePage = Number(v) || 1;
                    renderYearComparisonTable();
                });
            });
        }
    }
}

function openEmptyStockDetails() {
    const list = active(DB.medicines).filter(isEmptyStock)
        .sort((a, b) => Number(a.no || 0) - Number(b.no || 0) || String(a.name || '').localeCompare(String(b.name || '')));
    const rows = list.map((m, i) => {
        const canEdit = role !== 'reception' || receptionCanEdit('medicine');
        return `<tr>
          <td>${i + 1}</td>
          <td>${m.no || '—'}</td>
          <td><b>${esc(m.name)}</b></td>
          <td>${esc(m.drawer || '—')}</td>
          <td>${Number(m.quantity || 0)}</td>
          <td>${esc(m.available || '—')}</td>
          <td>${canEdit ? `<button class="btn embossed" onclick="closeModal();openPage('medicines');editMed('${m.id}')">Edit</button>` : '—'}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="7">No empty-stock medicines</td></tr>';
    modal(`Empty stock Medicine — ${list.length}`, `
      <p class="mini">Medicines with quantity 0 or marked Not Available. Data from Medicine interface.</p>
      <div class="tablewrap"><table class="table">
        <thead><tr><th>Sr</th><th>No.</th><th>Name</th><th>Drawer</th><th>Qty</th><th>Available</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="actions" style="margin-top:12px"><button type="button" class="btn embossed primary" onclick="closeModal();openPage('medicines')">Open Medicine page</button></div>
    `);
}


function openReport(kind, type) {
    reportKind = kind;
    reportType = type;
    reportPeriod = 'daily';
    rangeFrom = kind === 'patients' ? patientFromDate : paymentFromDate;
    rangeTo = kind === 'patients' ? patientToDate : paymentToDate;
    $$('.periodBtn').forEach(b => b.classList.toggle('active', b.dataset.period === 'daily'));
    openPage(kind === 'patients' ? 'patients' : 'payments')
}

function patientReportTab() {
    return `<div class="sectionTabs">${['new','old','renewal','total'].map(x=>`<button class="btn ${reportType===x?'active':''}" onclick="openReport('patients','${x}')">${x==='new'?'New Cases':x==='old'?'Old Cases':x==='renewal'?'Renewal Cases':'Total Cases'}</button>`).join('')}</div>`
}

function paymentReportTab() {
    return `<div class="sectionTabs">${['new','old','renewal','total'].map(x=>`<button class="btn ${reportType===x?'active':''}" onclick="openReport('payments','${x}')">${x==='new'?'New Case Payment':x==='old'?'Old Case Payment':x==='renewal'?'Renewal Payment':'Total Payment'}</button>`).join('')}</div>`
}

function renderReportPage() {
    reportKind = 'patients';
    initPatientFilterSelects();
    renderPatientReport();
}

function buildPagination(containerId, page, totalPages, totalItems, pageSize, goFnName) {
    const el = $('#' + containerId);
    if (!el) return;
    if (totalPages <= 1) {
        el.innerHTML = totalItems ? `<span class="pageInfo">${totalItems} item${totalItems===1?'':'s'}</span>` : '';
        return;
    }
    const pages = [];
    const add = (n) => pages.push(n);
    add(1);
    let start = Math.max(2, page - 1);
    let end = Math.min(totalPages - 1, page + 1);
    if (start > 2) pages.push('…');
    for (let i = start; i <= end; i++) add(i);
    if (end < totalPages - 1) pages.push('…');
    if (totalPages > 1) add(totalPages);
    const nums = pages.map(p => {
        if (p === '…') return `<span class="pageEllipsis">…</span>`;
        return `<button type="button" class="pageNum ${p===page?'active':''}" onclick="${goFnName}(${p})" aria-label="Page ${p}" ${p===page?'aria-current="page"':''}>${p}</button>`;
    }).join('');
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, totalItems);
    el.innerHTML = `<button type="button" ${page<=1?'disabled':''} onclick="${goFnName}(${page-1})" aria-label="Previous">‹ Prev</button>${nums}<button type="button" ${page>=totalPages?'disabled':''} onclick="${goFnName}(${page+1})" aria-label="Next">Next ›</button><span class="pageInfo">${from}–${to} of ${totalItems}</span>`;
}

function goMedPage(p) {
    medPage = Math.max(1, p);
    renderMedicines();
}


function isEmptyStock(m) {
    return Number(m.quantity || 0) <= 0 || String(m.available || '').toLowerCase() === 'no';
}

function renderEmptyStockList() {
    const body = $('#emptyStockBody');
    const card = $('#emptyStockCard');
    if (!body) return;
    const list = active(DB.medicines).filter(isEmptyStock)
        .sort((a, b) => Number(a.no || 0) - Number(b.no || 0) || String(a.name).localeCompare(String(b.name)));
    set('medEmptyCount', list.length);
    body.innerHTML = list.map((m, i) => {
        const canEdit = role !== 'reception' || receptionCanEdit('medicine');
        return `<tr>
          <td>${i + 1}</td>
          <td>${m.no || '-'}</td>
          <td>${esc(m.name)}</td>
          <td>${esc(m.drawer || '-')}</td>
          <td>${Number(m.quantity || 0)}</td>
          <td>${esc(m.available || '-')}</td>
          <td>${canEdit ? `<button class="btn embossed" onclick="editMed('${m.id}')">Edit</button>` : '—'}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="7">No empty-stock medicines</td></tr>';
    if (card) {
        card.classList.remove('hidden');
        card.style.display = '';
    }
    set('medEmptyCount', list.length);
}


function openRenewalDueList() {
    const list = listRenewalDuePatients();
    const rows = list.map((p, i) => {
        const due = dueDate(p);
        return `<tr>
          <td>${i + 1}</td>
          <td>${permanentCaseNo(p)}</td>
          <td>${esc(p.title)} ${esc(p.name)}</td>
          <td>${esc(p.mobile || '-')}</td>
          <td>${fmtDate(p.date)}</td>
          <td>${due ? fmtDate(due) : '-'}</td>
          <td>${money(p.renewal || 0)}</td>
          <td><button class="btn embossed" onclick="viewPatientHistory('${p.id}');">View</button></td>
        </tr>`;
    }).join('') || '<tr><td colspan="8">No patients with renewal due</td></tr>';
    modal(`Renewal Due — ${list.length} patient(s)`, `
      <p class="mini">Patients whose renewal date has passed and renewal payment is still unpaid. Case number never changes.</p>
      <div class="tablewrap"><table class="table">
        <thead><tr><th>Sr</th><th>Case No.</th><th>Patient</th><th>Mobile</th><th>Reg. date</th><th>Due date</th><th>Renewal fee</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    `);
}

function openTodayPendingList() {
    const list = listTodayPendingPatients();
    const rows = list.map((p, i) => {
        const pend = pendingFor(p);
        return `<tr>
          <td>${i + 1}</td>
          <td>${permanentCaseNo(p)}</td>
          <td><span class="tag ${p.caseType}">${p.caseType==='new'?'NEW':'OLD'}</span></td>
          <td>${esc(p.title)} ${esc(p.name)}</td>
          <td>${esc(p.mobile || '-')}</td>
          <td>${money(feeTotal(p))}</td>
          <td><span class="payPendingTag">${money(pend)}</span></td>
          <td>${money(paidFor(p.id))}</td>
          <td><button class="btn embossed" onclick="receiveP('${p.id}');closeModal();">Receive</button></td>
        </tr>`;
    }).join('') || '<tr><td colspan="9">No pending payments for today</td></tr>';
    const totalPend = list.reduce((a, p) => a + pendingFor(p), 0);
    modal(`Today's Pending Payment — ${money(totalPend)}`, `
      <p class="mini">Today's queue cases with unpaid balance. Only collected amounts count in income.</p>
      <div class="tablewrap"><table class="table">
        <thead><tr><th>Sr</th><th>Case No.</th><th>Type</th><th>Patient</th><th>Mobile</th><th>Fees</th><th>Pending</th><th>Paid</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    `);
}

function setupKpiClicks() {
    const bind = (id, fn) => {
        const el = $('#' + id);
        if (!el || el._kpiBound) return;
        el._kpiBound = true;
        el.addEventListener('click', fn);
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
    };
    bind('kpiRenewDueClick', openRenewalDueList);
    bind('kpiPendingClick', openTodayPendingList);
    bind('kpiEmptyStockClick', openEmptyStockDetails);
}

function setupPatientsNav() {
    const tog = $('#patientsNavToggle');
    const sub = $('#patientsNavSub');
    if (tog && sub && !tog._bound) {
        tog._bound = true;
        tog.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Toggle patients submenu only — stay on current page (no dashboard jump)
            const willOpen = !sub.classList.contains('open');
            sub.classList.toggle('open', willOpen);
            // close other submenu so sidebar remains scrollable cleanly
            $('#paymentNavSub')?.classList.remove('open');
        });
    }
    $$('.navSubBtn[data-patient-view]').forEach(btn => {
        if (btn._bound) return;
        btn._bound = true;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            patientTypeFilter = btn.getAttribute('data-patient-view') || 'new';
            patientReportPage = 1;
            openPage('patients');
            $$('.navSubBtn').forEach(b => b.classList.toggle('active', b === btn));
            // keep parent active look via sub item; do not force dashboard
            sub?.classList.remove('open');
        });
    });
}

function setupEmptyStockBtn() {
    const bind = () => {
        const btn = $('#emptyStockBtn');
        if (!btn || btn._emptyBound) return;
        btn._emptyBound = true;
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            // ensure medicines page is visible
            if ($('#medicines') && !$('#medicines').classList.contains('active')) {
                openPage('medicines');
            }
            setTimeout(() => {
                renderEmptyStockList();
                const card = $('#emptyStockCard');
                if (card) {
                    card.classList.remove('hidden');
                    card.style.display = '';
                    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else {
                    toast('Empty stock list panel not found', true);
                }
            }, 50);
        });
        $('#emptyStockClose')?.addEventListener('click', () => {
            const card = $('#emptyStockCard');
            if (card) {
                card.classList.add('hidden');
            }
        });
    };
    bind();
}

function renderMedicines() {
    const q = ($('#medSearch')?.value || '').toLowerCase();
    const arr = active(DB.medicines).filter(m => `${m.name} ${m.drawer} ${m.quantity} ${m.available}`.toLowerCase().includes(q)).sort((a, b) => Number(b.no || 0) - Number(a.no || 0) || String(b.name).localeCompare(String(a.name)));
    set('medTotal', active(DB.medicines).length);
    set('medEmptyCount', active(DB.medicines).filter(isEmptyStock).length);
    const totalPages = Math.max(1, Math.ceil(arr.length / medPageSize));
    if (medPage > totalPages) medPage = totalPages;
    const slice = arr.slice((medPage - 1) * medPageSize, medPage * medPageSize);
    const body = $('#medBody');
    if (body) body.innerHTML = slice.map(m => `<tr><td>${m.no||'-'}</td><td>${esc(m.name)}</td><td>${esc(m.drawer)}</td><td>${m.quantity}</td><td>${m.available}</td><td><button class="btn embossed" onclick="editMed('${m.id}')">Edit</button><button class="btn deleteBox embossed" onclick="delMed('${m.id}')">Delete</button></td></tr>`).join('') || '<tr><td colspan="6">No medicines</td></tr>';
    buildPagination('medPagination', medPage, totalPages, arr.length, medPageSize, 'goMedPage');
}

window.goMedPage = goMedPage;


function saveMedicine(e) {
    if (!enforceReceptionEdit('medicineEntry')) return;
    e.preventDefault();
    const d = {
        id: uid('m'),
        no: active(DB.medicines).reduce((m, x) => Math.max(m, Number(x.no) || 0), 0) + 1,
        name: $('#medName').value.trim(),
        drawer: $('#medDrawer').value.trim(),
        quantity: Number($('#medQty').value || 0),
        available: $('#medAvail').value
    };
    markUpdated(d);
    DB.medicines.push(d);
    saveLocal();
    e.target.reset();
    toast('Medicine added');
    syncNow(true)
}

function modal(title, html, submit) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modal').classList.remove('hidden');
    if (submit) $('#modalBody form').onsubmit = submit
}

function closeModal() {
    $('#modal')?.classList.add('hidden')
}


function viewPatientHistory(id) {
    const p = active(DB.patients).find(x => x.id === id);
    if (!p) {
        toast('Patient not found', true);
        return;
    }
    // Entire case family (new + all old follow-ups)
    const family = caseFamily(p);
    const famPays = familyPayments(p);
    const byDate = {};
    famPays.forEach(x => {
        const d = String(x.date || '');
        if (!byDate[d]) byDate[d] = { consultation: 0, medicine: 0, renewal: 0, other: 0, type: '' };
        const cat = x.feeCategory || 'other';
        if (cat === 'consultation' || cat === 'medicine' || cat === 'renewal') byDate[d][cat] += Number(x.amount || 0);
        else byDate[d].other += Number(x.amount || 0);
    });
    family.forEach(v => {
        const d = String(v.date || '');
        if (!byDate[d]) byDate[d] = { consultation: 0, medicine: 0, renewal: 0, other: 0, type: v.caseType || '' };
        if (v.caseType) byDate[d].type = v.caseType;
        const vPaid = paidFor(v.id);
        const vTotal = feeTotal(v);
        byDate[d]._visitId = v.id;
        byDate[d]._visitFees = vTotal;
        if (vTotal > 0 && vPaid < vTotal) {
            byDate[d]._pendingVisit = true;
        }
        if (vTotal <= 0 && vPaid <= 0) {
            byDate[d]._focVisit = true;
        }
    });
    // Newest visit first
    const dates = Object.keys(byDate).sort((a, b) => String(b).localeCompare(String(a)));
    let totalAll = 0, sumCons = 0, sumMed = 0, sumRen = 0;
    const rows = dates.map((d, i) => {
        const g = byDate[d];
        const lineTotal = g.consultation + g.medicine + g.renewal + g.other;
        totalAll += lineTotal;
        sumCons += Number(g.consultation || 0);
        sumMed += Number(g.medicine || 0);
        sumRen += Number(g.renewal || 0);
        const isRenew = g.renewal > 0;
        const visitRow = family.find(v => String(v.date || '') === d) || null;
        const stV = visitRow ? paymentStatusInfo(visitRow) : null;
        const isPendingVisit = stV ? (stV.kind === 'pending' || stV.kind === 'partial') : (!!g._pendingVisit && lineTotal === 0);
        const isFocVisit = stV ? stV.kind === 'foc' : (lineTotal === 0 && !g._pendingVisit);
        const typeTag = g.type ? `<span class="tag ${g.type}" style="margin-left:6px;font-size:10px">${String(g.type).toUpperCase()}</span>` : '';
        const vid = (visitRow && visitRow.id) || g._visitId || '';
        const recvBtn = isPendingVisit && vid
            ? ` <button type="button" class="btn embossed receiveBtn miniAction" onclick="receiveP('${vid}');closeModal()">Receive</button>`
            : (isFocVisit && vid ? ` <button type="button" class="btn embossed miniAction" onclick="editP('${vid}');closeModal()">Add Payment</button>` : '');
        let actionCell;
        if (isFocVisit) actionCell = `<span class="histAction histFoc">FOC</span>${recvBtn}`;
        else if (stV && stV.kind === 'partial') actionCell = `<span class="histAction histPartial">Partial</span> <span class="mini">Due ${money(stV.pending)}</span>${recvBtn}`;
        else if (isPendingVisit) actionCell = `<span class="histAction histPending">Pending</span>${recvBtn}`;
        else actionCell = `<span class="histAction histReceived">Received</span>`;
        return `<tr class="${isRenew ? 'renewRow' : ''}${isPendingVisit ? ' pendingRow' : ''}">
          <td>${i + 1}</td>
          <td>${fmtDate(d)}${typeTag}</td>
          <td>${money(g.consultation)}</td>
          <td>${money(g.medicine)}</td>
          <td>${money(g.renewal)}</td>
          <td>${actionCell}</td>
          <td><b>${isPendingVisit ? money(g._visitFees || 0) + ' due' : money(lineTotal)}</b></td>
        </tr>`;
    }).join('') || '<tr><td colspan="7">No payment visits recorded</td></tr>';
    const html = `<div class="patientDetailCard">
      <div class="detailGrid">
        <div class="dl"><small>Case No.</small><b>${permanentCaseNo(p)}</b></div>
        <div class="dl"><small>Case Type</small><b>${esc(p.caseType || '-')}</b></div>
        <div class="dl full"><small>Patient</small><b>${esc(p.title)} ${esc(p.name)}</b></div>
        <div class="dl"><small>Mobile</small><b>${esc(p.mobile || '-')}</b></div>
        <div class="dl"><small>Age / Gender</small><b>${p.age || '-'} / ${esc(p.gender || '-')}</b></div>
        <div class="dl full"><small>Address</small><b>${esc(p.address || '-')}</b></div>
        <div class="dl"><small>Registration date</small><b>${fmtDate(primaryRegistration(permanentCaseNo(p))?.date || p.date)}</b></div>
        <div class="dl"><small>Total payment till date</small><b style="color:var(--green);font-size:18px">${money(totalAll)}</b>
          <span class="mini"> · ${family.length} visit(s)</span>
        </div>
      </div>
      <h3 style="margin:12px 0 8px;font-size:15px">Visit / payment history</h3>
      <p class="mini">Saari visits (new + follow-up) ek saath. Renewal rows light green. Pending pe Receive button.</p>
      <div class="tablewrap"><table class="table payHistoryTable">
        <thead><tr><th>Sr No.</th><th>Date</th><th>Consultation</th><th>Medicine</th><th>Renewal</th><th>Action</th><th>Total</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr class="summaryBreakRow"><td colspan="2"><b>Category Totals</b></td><td><b>${money(sumCons)}</b></td><td><b>${money(sumMed)}</b></td><td><b>${money(sumRen)}</b></td><td></td><td></td></tr>
          <tr class="summaryTotalRow"><td colspan="6"><b>Grand Total</b></td><td><b>${money(totalAll)}</b></td></tr>
        </tfoot>
      </table></div>
      <div class="histTotalsBar" style="margin-top:12px;display:flex;flex-wrap:wrap;gap:10px">
        <div class="paySummaryBox" style="min-width:150px"><small>Consultation Total</small><b>${money(sumCons)}</b></div>
        <div class="paySummaryBox med" style="min-width:150px"><small>Medicine Total</small><b>${money(sumMed)}</b></div>
        <div class="paySummaryBox renewal" style="min-width:150px"><small>Renewal Total</small><b>${money(sumRen)}</b></div>
        <div class="paySummaryBox total" style="min-width:150px"><small>Grand Total</small><b>${money(totalAll)}</b></div>
      </div>
      <div class="actions" style="margin-top:14px;flex-wrap:wrap">
        <button type="button" class="btn embossed" onclick="editP('${p.id}')">Edit</button>
        <button type="button" class="btn embossed" onclick="closeModal()">Close</button>
      </div>
    </div>`;
    modal(`View — Case #${permanentCaseNo(p)} ${esc(p.title)} ${esc(p.name)}`, html);
}

function editP(id) {
    if (!enforceReceptionEdit('patient')) return;
    const p = active(DB.patients).find(x => x.id === id);
    if (!p) {
        toast('Patient not found', true);
        return;
    }
    closeModal();
    openPage('dashboard');
    // Ensure case no is in 0A format when opening edit
    if (/^\d+$/.test(String(p.caseNo || '').trim())) {
        p.caseNo = normalizeCaseNoInput(p.caseNo);
        markUpdated(p);
        saveLocal();
    }
    setTimeout(() => {
        buildPatientForm(p.caseType || 'new', p);
        const f = $('#patientForm');
        if (f) {
            f.classList.remove('hidden');
            f.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 50);
}

function delP(id) {
    if (!enforceReceptionEdit('patient')) return;
    if (!confirm('Delete this case and all payments linked to it? The case number will stay unused and will not be shifted.')) return;
    const p = DB.patients.find(x => x.id === id);
    if (p) {
        p._deleted = true;
        markUpdated(p);
        DB.meta.deleted.push(id);
        removePatientPayments(id);
        DB.patients = DB.patients.filter(x => x.id !== id);
        saveLocal();
        refreshAllPatientViews();
        toast('Case and linked payments deleted');
        syncNow(true)
    }
}

function docP(id) {
    if (!enforceReceptionEdit('patient')) return;
    const p = active(DB.patients).find(x => x.id === id);
    if (!p) return;
    if (p.received === true && pendingFor(p) <= 0) {
        toast('Fully received — With Doctor locked', true);
        return;
    }
    p.withDoctor = !p.withDoctor;
    markUpdated(p);
    saveLocal();
    renderQueue();
    renderReceptionQueue();
    // no toast popup — status shows in queue
    try { syncNow(true); } catch (e) {}
}

function categoryPaid(patientId, feeCategory) {
    return active(DB.payments).filter(x => x.patientId === patientId && x.feeCategory === feeCategory)
        .reduce((a, x) => a + Number(x.amount || 0), 0);
}

function applyReceiveAmounts(p, amounts, payDate) {
    // amounts: { consultation, medicine, renewal } — amounts being collected NOW (can be partial)
    const date = payDate || (isTodayCase(p) ? isoToday() : (p.date || isoToday()));
    let collected = 0;
    [['consultation', Number(amounts.consultation || 0)],
     ['medicine', Number(amounts.medicine || 0)],
     ['renewal', Number(amounts.renewal || 0)]].forEach(([feeCategory, amt]) => {
        const add = Math.max(0, Number(amt) || 0);
        if (add <= 0) return;
        const pay = {
            id: uid('pay'),
            patientId: p.id,
            caseType: feeCategory === 'renewal' ? 'renewal' : p.caseType,
            date,
            feeCategory,
            amount: add,
            receivedNow: true,
            caseFeePayment: true
        };
        markUpdated(pay);
        DB.payments.push(pay);
        collected += add;
        if (feeCategory === 'renewal' && add > 0) {
            // Next renewal counts from this payment date — update whole case family
            p.lastRenewalDate = date;
            const caseKey = String(permanentCaseNo(p));
            active(DB.patients).forEach(x => {
                if (String(permanentCaseNo(x)) === caseKey) {
                    x.lastRenewalDate = date;
                    markUpdated(x);
                }
            });
        }
    });
    const pend = pendingFor(p);
    if (pend <= 0) {
        p.received = true;
        p.withDoctor = false;
        p.completedAt = new Date().toISOString();
    } else {
        // Partial: keep pending, do not fully complete
        p.received = false;
        p.completedAt = null;
    }
    markUpdated(p);
    return { collected, pending: pendingFor(p) };
}

function receiveP(id) {
    if (!enforceReceptionEdit('paymentEntry')) return;
    const p = active(DB.patients).find(x => x.id === id);
    if (!p) return;
    if (isPaymentLocked(p)) {
        toast('Already fully received — payment locked', true);
        return;
    }
    const consDue = Math.max(0, Number(p.consultation || 0) - categoryPaid(p.id, 'consultation'));
    const medDue = Math.max(0, Number(p.medicine || 0) - categoryPaid(p.id, 'medicine'));
    const showRenewal = !!renewalDue(p);
    const renFee = showRenewal ? Number(p.renewal || 0) : 0;
    const renDue = Math.max(0, renFee - categoryPaid(p.id, 'renewal'));
    const totalDue = consDue + medDue + renDue;
    const renewBlock = showRenewal && renDue > 0
        ? `<label>Renewal (due ${money(renDue)})<input name="renewal" id="recvRenewal" type="number" min="0" step="1" value="${renDue}"></label>`
        : `<input type="hidden" name="renewal" id="recvRenewal" value="0">`;
    const html = `<form class="formgrid" id="receiveForm">
      <label>Date<input name="date" type="date" value="${isTodayCase(p) ? isoToday() : (p.date || isoToday())}" required></label>
      <label>Consultation (due ${money(consDue)})<input name="consultation" id="recvCons" type="number" min="0" step="1" value="${consDue}"></label>
      <label>Medicine (due ${money(medDue)})<input name="medicine" id="recvMed" type="number" min="0" step="1" value="${medDue}"></label>
      ${renewBlock}
      <label class="full partialPendingBox">Partial pending payment (balance)
        <input type="number" id="recvPartialPending" readonly value="${totalDue}" style="font-weight:800;color:#9a3412;background:#fff7ed;border:1px solid #fdba74">
      </label>
      <div class="full actions"><button class="primary embossed" type="submit">Confirm Receive</button></div>
    </form>`;
    modal(`Receive payment — #${p.caseNo} ${esc(p.title)} ${esc(p.name)}`, html, e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        // Cap each field at due so user cannot over-receive category
        const c = Math.min(consDue, Math.max(0, Number(fd.get('consultation') || 0)));
        const m = Math.min(medDue, Math.max(0, Number(fd.get('medicine') || 0)));
        const r = Math.min(renDue, Math.max(0, Number(fd.get('renewal') || 0)));
        const result = applyReceiveAmounts(p, {
            consultation: c,
            medicine: m,
            renewal: r
        }, fd.get('date'));
        saveLocal();
        closeModal();
        refreshAllPatientViews();
        if (result.pending > 0) {
            toast(`Received ${money(result.collected)} · Partial pending ${money(result.pending)}`);
        } else {
            toast('Fully received — case completed');
        }
        try { syncNow(true); } catch (e) {}
    });
    // Live partial pending calculator
    setTimeout(() => {
        const upd = () => {
            const c = Math.min(consDue, Math.max(0, Number($('#recvCons')?.value || 0)));
            const m = Math.min(medDue, Math.max(0, Number($('#recvMed')?.value || 0)));
            const r = Math.min(renDue, Math.max(0, Number($('#recvRenewal')?.value || 0)));
            const bal = Math.max(0, totalDue - c - m - r);
            const el = $('#recvPartialPending');
            if (el) el.value = bal;
        };
        ['recvCons','recvMed','recvRenewal'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', upd);
        });
        upd();
    }, 30);
}

function pendingP(id) {
    if (!enforceReceptionEdit('paymentEntry')) return;
    const p = active(DB.patients).find(x => x.id === id);
    if (!p) return;
    if (p.received === true && pendingFor(p) <= 0) {
        toast('Fully received — cannot mark pending. Use Edit if needed.', true);
        return;
    }
    p.received = false;
    p.withDoctor = false;
    p.completedAt = null;
    markUpdated(p);
    saveLocal();
    renderDashboard();
    renderQueue();
    renderReceptionQueue();
    renderReportPage();
    if ($('#histBody')) renderAppointmentHistory();
    toast('Case marked pending');
    syncNow(true);
}

function payP(id, category) {
    if (!enforceReceptionEdit('paymentEntry')) return;
    const p = active(DB.patients).find(x => x.id === id);
    if (!p) return;
    const cat = category || 'consultation';
    modal('Payment Entry', `<form class="formgrid"><label>Date<input name="date" type="date" value="${isoToday()}"></label><label>Category<select name="feeCategory"><option value="consultation" ${cat==='consultation'?'selected':''}>Consultation</option><option value="medicine" ${cat==='medicine'?'selected':''}>Medicine</option><option value="renewal" ${cat==='renewal'?'selected':''} ${renewalDue(p)?'':'disabled'}>Renewal</option></select></label><label>Amount<input name="amount" type="number" min="0" value="0"></label><input type="hidden" name="patientId" value="${id}"><div class="full actions"><button class="primary">Register Payment</button></div></form>`, e => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        d.id = uid('pay');
        d.caseType = (d.feeCategory === 'renewal') ? 'renewal' : p.caseType;
        d.amount = Number(d.amount || 0);
        markUpdated(d);
        DB.payments.push(d);
        if (d.feeCategory === 'renewal' && d.amount > 0) {
            const payDate = d.date || isoToday();
            p.lastRenewalDate = payDate;
            const caseKey = String(permanentCaseNo(p));
            active(DB.patients).forEach(x => {
                if (String(permanentCaseNo(x)) === caseKey) {
                    x.lastRenewalDate = payDate;
                    markUpdated(x);
                }
            });
        }
        if (pendingFor(p) <= 0) {
            p.received = true;
            p.withDoctor = false;
            p.completedAt = new Date().toISOString();
        } else {
            p.received = false;
            p.completedAt = null;
        }
        markUpdated(p);
        saveLocal();
        closeModal();
        renderDashboard();
        renderQueue();
        renderReceptionQueue();
        renderReportPage();
        toast('Payment registered');
        syncNow(true)
    })
}

function editPay(id) {
    const x = active(DB.payments).find(p => p.id === id);
    if (!x) return;
    const owner = active(DB.patients).find(p => p.id === x.patientId);
    if (owner && isPaymentLocked(owner)) {
        toast('Payment locked after full Received. FOC / Partial still editable.', true);
        return;
    }
    modal('Edit Payment', `<form class="formgrid"><label>Date<input name="date" type="date" value="${x.date}"></label><label>Category<select name="feeCategory"><option value="consultation">Consultation</option><option value="medicine">Medicine</option><option value="renewal">Renewal</option></select></label><label>Amount<input name="amount" type="number" value="${x.amount}"></label><div class="full actions"><button class="primary">Update Payment</button></div></form>`, e => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        Object.assign(x, {
            date: d.date,
            feeCategory: d.feeCategory,
            amount: Number(d.amount || 0)
        });
        markUpdated(x);
        const p = active(DB.patients).find(p => p.id === x.patientId);
        if (p) {
            const pend = pendingFor(p);
            p.received = pend <= 0;
            p.withDoctor = pend <= 0 ? false : p.withDoctor;
            p.completedAt = pend <= 0 ? (p.completedAt || new Date().toISOString()) : null;
            markUpdated(p)
        }
        saveLocal();
        closeModal();
        refreshAllPatientViews();
        toast('Payment updated');
        try { syncNow(true); } catch (e) {}
    })
}

function delPay(id) {
    const x0 = active(DB.payments).find(p => p.id === id);
    const owner0 = x0 && active(DB.patients).find(p => p.id === x0.patientId);
    if (owner0 && isPaymentLocked(owner0)) {
        toast('Payment locked after full Received. FOC / Partial still editable.', true);
        return;
    }
    if (!confirm('Delete this payment?')) return;
    const x = DB.payments.find(p => p.id === id);
    if (x) {
        x._deleted = true;
        markUpdated(x);
        DB.meta.deleted.push(id);
        DB.payments = DB.payments.filter(p => p.id !== id);
        const p = active(DB.patients).find(p => p.id === x.patientId);
        if (p) {
            const pend = pendingFor(p);
            p.received = pend <= 0;
            p.completedAt = pend <= 0 ? (p.completedAt || new Date().toISOString()) : null;
            markUpdated(p)
        }
        saveLocal();
        refreshAllPatientViews();
        try { syncNow(true); } catch (e) {}
    }
}

function editMed(id) {
    const m = active(DB.medicines).find(x => x.id === id);
    if (!m) return;
    modal('Edit Medicine', `<form class="formgrid"><label>Medicine Name<input name="name" value="${esc(m.name)}"></label><label>Drawer<input name="drawer" value="${esc(m.drawer)}"></label><label>Quantity<input name="quantity" type="number" value="${m.quantity}"></label><label>Available<select name="available"><option ${m.available==='Yes'?'selected':''}>Yes</option><option ${m.available==='No'?'selected':''}>No</option></select></label><div class="full actions"><button class="primary">Update Medicine</button></div></form>`, e => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        Object.assign(m, {
            name: d.name,
            drawer: d.drawer,
            quantity: Number(d.quantity || 0),
            available: d.available
        });
        markUpdated(m);
        saveLocal();
        closeModal();
        toast('Medicine updated');
        syncNow(true)
    })
}

function delMed(id) {
    if (!confirm('Delete this medicine?')) return;
    const m = DB.medicines.find(x => x.id === id);
    if (m) {
        m._deleted = true;
        markUpdated(m);
        DB.meta.deleted.push(id);
        DB.medicines = DB.medicines.filter(x => x.id !== id);
        saveLocal();
        syncNow(true)
    }
}

function renderClinic() {
    const c = DB.clinic;
    set('clinicNameText', c.name);
    $('#clinicName') && ($('#clinicName').value = c.name || '');
    $('#clinicAddress') && ($('#clinicAddress').value = c.address || '');
    $('#clinicPhone') && ($('#clinicPhone').value = c.phone || '')
}

function saveClinic(e) {
    e.preventDefault();
    DB.clinic = markUpdated({
        ...DB.clinic,
        name: $('#clinicName').value.trim() || 'Anand Homoeopathy Multi Speciality Clinic',
        address: $('#clinicAddress').value.trim(),
        phone: $('#clinicPhone').value.trim()
    });
    saveLocal();
    toast('Clinic profile updated');
    syncNow(true)
}

const BACKUP_SETTINGS_KEY = 'anandClinicAutoBackupV1';

function loadBackupSettings() {
    try {
        return JSON.parse(localStorage.getItem(BACKUP_SETTINGS_KEY) || '{}') || {};
    } catch {
        return {};
    }
}

function saveBackupSettings(s) {
    localStorage.setItem(BACKUP_SETTINGS_KEY, JSON.stringify(s));
}

function buildBackupPayload(includeReception) {
    const payload = {
        exportedAt: new Date().toISOString(),
        role,
        office: role === 'office' ? DB : null,
        reception: null
    };
    if (role === 'office') {
        payload.office = DB;
        if (includeReception) {
            try {
                const raw = localStorage.getItem('anandClinicV16_reception');
                if (raw) payload.reception = JSON.parse(raw);
            } catch (e) {}
        }
    } else {
        payload.reception = DB;
        try {
            const raw = localStorage.getItem('anandClinicV16_office');
            if (raw) payload.office = JSON.parse(raw);
        } catch (e) {}
    }
    // Always include current role DB as primary for simple import compatibility
    const primary = structuredClone(DB);
    primary._backupMeta = {
        exportedAt: payload.exportedAt,
        role,
        includesReception: !!(payload.reception && role === 'office'),
        includesOffice: !!(payload.office && role === 'reception')
    };
    if (payload.reception && role === 'office') primary._receptionSnapshot = payload.reception;
    if (payload.office && role === 'reception') primary._officeSnapshot = payload.office;
    return primary;
}

function downloadBackupFile(data, filename) {
    const d = JSON.stringify(data, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([d], { type: 'application/json' }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function exportBackup() {
    // Export only downloads a file — does NOT add to Last 5 Full Backups list
    const s = loadBackupSettings();
    const includeRec = role === 'office' && (s.includeReception !== false);
    const data = buildBackupPayload(includeRec);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadBackupFile(data, `anand-clinic-backup-${role}-${stamp}.json`);
    toast('Backup downloaded (not added to Last 5 list)');
}

function manualBackupNow() {
    try { pushLocalFullBackup("Backup Now"); } catch (e) {}

    exportBackup();
}

function runAutoBackup(silent) {
    const s = loadBackupSettings();
    const mins = Number(s.intervalMinutes || 0);
    if (!mins) return;
    const includeRec = role === 'office' && (s.includeReception !== false);
    const data = buildBackupPayload(includeRec);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadBackupFile(data, `anand-auto-backup-${role}-${stamp}.json`);
    s.lastAutoBackup = new Date().toISOString();
    saveBackupSettings(s);
    updateAutoBackupUI();
    if (!silent) toast('Auto backup saved');
}

function startAutoBackupTimer() {
    if (autoBackupTimer) {
        clearInterval(autoBackupTimer);
        autoBackupTimer = null;
    }
    const s = loadBackupSettings();
    const mins = Number(s.intervalMinutes || 0);
    if (mins > 0) {
        autoBackupTimer = setInterval(() => runAutoBackup(true), mins * 60 * 1000);
    }
    updateAutoBackupUI();
}

function updateAutoBackupUI() {
    const s = loadBackupSettings();
    const mins = Number(s.intervalMinutes || 0);
    if ($('#autoBackupInterval')) $('#autoBackupInterval').value = String(mins || 0);
    if ($('#autoBackupIncludeReception')) {
        $('#autoBackupIncludeReception').value = s.includeReception === false ? 'no' : 'yes';
    }
    const labels = { 0: 'Off', 30: 'Every 30 min', 60: 'Every 1 hour', 120: 'Every 2 hours', 180: 'Every 3 hours', 240: 'Every 4 hours' };
    if ($('#autoBackupStatus')) $('#autoBackupStatus').textContent = labels[mins] || (mins ? `Every ${mins} min` : 'Off');
    if ($('#lastAutoBackupTime')) {
        $('#lastAutoBackupTime').textContent = s.lastAutoBackup
            ? new Date(s.lastAutoBackup).toLocaleString()
            : 'Never';
    }
}

function saveAutoBackupSettings() {
    const mins = Number($('#autoBackupInterval')?.value || 0);
    const includeReception = ($('#autoBackupIncludeReception')?.value || 'yes') !== 'no';
    const s = loadBackupSettings();
    s.intervalMinutes = mins;
    s.includeReception = includeReception;
    saveBackupSettings(s);
    startAutoBackupTimer();
    toast(mins ? `Auto backup: every ${mins} minutes` : 'Auto backup turned Off');
}

function formatBackupName(name){
    const s=String(name||'');
    const m=s.match(/clinic-(?:auto|manual)-(\d{8})-(\d{6})(?:-(\d{3}))?\.json$/i);
    if(!m) return s;
    const d=m[1], t=m[2];
    return `${d.slice(6,8)}/${d.slice(4,6)}/${d.slice(0,4)} ${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}`;
}

const LOCAL_BACKUP_KEY = 'anandClinicLocalBackups_v63';

function getLocalBackupList() {
    try { return JSON.parse(localStorage.getItem(LOCAL_BACKUP_KEY) || '[]'); } catch (e) { return []; }
}

function pushLocalFullBackup(tag) {
    try {
        const payload = JSON.parse(JSON.stringify(DB));
        const entry = {
            id: 'lb_' + Date.now(),
            tag: tag || 'Full Backup',
            at: new Date().toISOString(),
            counts: {
                patients: (payload.patients || []).filter(x => !x._deleted).length,
                payments: (payload.payments || []).filter(x => !x._deleted).length
            },
            data: payload
        };
        const list = getLocalBackupList();
        list.unshift(entry);
        localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(list.slice(0, 5)));
        renderLocalBackupList();
        return entry;
    } catch (e) {
        console.warn(e);
        return null;
    }
}

function renderLocalBackupList() {
    const box = $('#localBackupList');
    if (!box) return;
    const list = getLocalBackupList();
    if (!list.length) {
        box.innerHTML = '<div class="mini">No full backups yet. Use <b>Backup Now</b> or <b>Save Safe Server Backup</b> to add entries here (Export only downloads a file).</div>';
        return;
    }
    // list is already newest-first (unshift). Show date & time clearly at top.
    box.innerHTML = list.map((e, i) => {
        const when = e.at ? new Date(e.at).toLocaleString(undefined, {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        }) : '';
        const c = e.counts || {};
        const topMark = i === 0 ? ' <span class="mini" style="color:#137b4c;font-weight:700">(Latest)</span>' : '';
        return `<div class="backupRow">
          <span><b>#${i + 1} ${esc(e.tag || 'Full Backup')}</b>${topMark}
          <small><b>${esc(when)}</b> · ${c.patients || 0} patients · ${c.payments || 0} payments</small></span>
          <button type="button" class="btn embossed" onclick="restoreLocalBackup('${e.id}')">Restore</button>
        </div>`;
    }).join('');
}

function restoreLocalBackup(id) {
    const list = getLocalBackupList();
    const entry = list.find(x => x.id === id);
    if (!entry || !entry.data) { toast('Backup not found', true); return; }
    if (!confirm('Restore this full backup? Current data will merge with backup (safer merge).')) return;
    try {
        mergeLocalRemote(entry.data);
        saveLocal();
        refreshAllPatientViews();
        toast('Local full backup restored');
        try { syncNow(true); } catch (e) {}
    } catch (e) {
        toast('Restore failed', true);
    }
}
window.restoreLocalBackup = restoreLocalBackup;

async function serverBackupNow(){
    // Always keep a local last-5 full snapshot first
    pushLocalFullBackup('Safe Server Backup');
    try {
        await api('/api/backup','POST', DB);
        await refreshBackupList();
        toast('Safe server backup saved (PC folder + last 5 list)');
    } catch (e) {
        toast('Server folder backup unavailable — saved in Last 5 Full Backups on this PC', true);
        renderLocalBackupList();
    }
}
async function refreshBackupList(){
    const box = $('#serverBackupList');
    renderLocalBackupList();
    if (!box) return;
    try {
        const r = await api('/api/backups');
        const list = (r?.backups || []).slice(0, 5);
        box.innerHTML = list.map(n => `<div class="backupRow"><span><b>${esc(formatBackupName(n))}</b><small>${esc(n)}</small></span><button class="btn embossed" onclick="restoreServerBackup('${encodeURIComponent(n)}')">Restore</button></div>`).join('') || '<div class="mini">No server folder backups yet — use Backup Now (saves to Last 5 list).</div>';
    } catch (e) {
        box.innerHTML = '<div class="mini">Server folder offline. Use <b>Last 5 Full Backups</b> below (always works).</div>';
    }
}
async function restoreServerBackup(name){
    if(!confirm('Restore this backup? Newer records are kept and records are merged safely.')) return;
    try{ const r=await fetch((server||location.origin).replace(/\/$/,'')+'/api/backup/'+name); if(!r.ok)throw 0; const data=await r.json(); const merged=await api('/api/restore','POST',data); mergeLocalRemote(merged); saveLocal(); toast('Backup restored successfully'); }
    catch(e){ toast('Restore failed',true); }
}
window.restoreServerBackup=restoreServerBackup;

function setupBackupView() {
    const sel = $('#backupViewSelect');
    if (!sel) return;
    const apply = () => {
        const v = sel.value === 'reception' ? 'reception' : 'office';
        $('#officeBackupPanel')?.classList.toggle('hidden', v !== 'office');
        $('#receptionBackupPanel')?.classList.toggle('hidden', v !== 'reception');
    };
    sel.addEventListener('change', apply);
    apply();
}

function exportReceptionOnlyBackup() {
    try {
        const raw = localStorage.getItem('anandClinicV16_reception');
        if (!raw && role !== 'reception') {
            toast('Reception data not found on this PC. Open Reception app once, then try again.', true);
            return;
        }
        const data = role === 'reception' ? structuredClone(DB) : JSON.parse(raw);
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        downloadBackupFile(data, `anand-clinic-backup-reception-${stamp}.json`);
        toast('Reception backup downloaded');
    } catch (e) {
        toast('Reception backup failed', true);
    }
}

function setupBackupUI() {
    setupBackupView();
    $('#emailBackupBtnOffice')?.addEventListener('click', emailCloudBackup);
    $('#emailBackupBtn')?.addEventListener('click', emailCloudBackup);
    $('#receptionManualBackupBtn')?.addEventListener('click', () => {
        if (role === 'reception') manualBackupNow();
        else exportReceptionOnlyBackup();
    });
    $('#receptionExportBtn')?.addEventListener('click', () => {
        if (role === 'reception') exportBackup();
        else exportReceptionOnlyBackup();
    });
    $('#receptionServerBackupBtn')?.addEventListener('click', serverBackupNow);
    $('#receptionRefreshBackupListBtn')?.addEventListener('click', () => {
        refreshBackupList();
        const src = $('#serverBackupList');
        const dst = $('#receptionServerBackupList');
        if (src && dst) dst.innerHTML = src.innerHTML;
    });
    $('#receptionImportInput')?.addEventListener('change', importBackup);
    $('#manualBackupBtn')?.addEventListener('click', manualBackupNow);
    $('#officeBackupBtn')?.addEventListener('click', () => {
        if (role !== 'office') { toast('Open Office version for Office backup.', true); return; }
        manualBackupNow();
    });
    $('#receptionBackupBtn')?.addEventListener('click', () => {
        if (role === 'reception') manualBackupNow();
        else exportReceptionOnlyBackup();
    });
    $('#serverBackupBtn')?.addEventListener('click', serverBackupNow);
    $('#refreshBackupListBtn')?.addEventListener('click', refreshBackupList);
    refreshBackupList();
    $('#saveAutoBackupBtn')?.addEventListener('click', saveAutoBackupSettings);
    updateAutoBackupUI();
    startAutoBackupTimer();
}

function importBackup(e) {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
        try {
            DB = Object.assign(structuredClone(DEFAULT), JSON.parse(r.result));
            saveLocal();
            toast('Full backup imported');
            syncNow(true)
        } catch {
            toast('Invalid backup file', true)
        }
    };
    r.readAsText(f)
}

function searchPatientRange() {
    patientFilterY = $('#patientYear')?.value || '';
    patientFilterM = $('#patientMonth')?.value || '';
    patientFilterD = $('#patientDay')?.value || '';
    renderPatientReport();
}

function searchPaymentRange() {
    setReportRange($('#paymentFrom')?.value || '', $('#paymentTo')?.value || '');
    reportPeriod = 'custom';
    renderReports()
}

function resetReportRange(kind) {
    if (kind === 'patients') {
        patientFromDate = '';
        patientToDate = '';
        patientFilterY = '';
        patientFilterM = '';
        patientFilterD = '';
        const y = $('#patientYear'), m = $('#patientMonth'), d = $('#patientDay');
        if (y) y.value = '';
        if (m) m.value = '';
        if (d) d.value = '';
        patientTypeFilter = 'total';
        $$('#patientTypeTabs .btn').forEach(b => b.classList.toggle('active', b.dataset.ptype === 'total'));
        renderPatientReport();
        return;
    }
    paymentFromDate = '';
    paymentToDate = '';
    rangeFrom = '';
    rangeTo = '';
    reportPeriod = 'daily';
    renderReportPage();
}

function setupNav() {
    $$('.navBtn').forEach(b => {
        // Parent toggles (Patients / Payment) — NEVER navigate
        if (b.classList.contains('navParent') || !b.dataset.page) {
            b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); };
            return;
        }
        b.onclick = (e) => {
            e.preventDefault();
            openPage(b.dataset.page);
        };
    });
    $('#toggleSide')?.addEventListener('click', () => {
        const side = $('#side');
        const main = document.querySelector('.main');
        side?.classList.toggle('collapsed');
        main?.classList.toggle('sidebar-collapsed');
        // mobile overlay open
        if (window.innerWidth < 900) side?.classList.toggle('open');
    });
    $('#mobileSide')?.addEventListener('click', () => $('#side').classList.toggle('open'));
    initPatientFilterSelects();
    $('#searchPatientRange')?.addEventListener('click', searchPatientRange);
    $('#clearPatientRange')?.addEventListener('click', () => resetReportRange('patients'));
    $('#patientYear')?.addEventListener('change', searchPatientRange);
    $('#patientMonth')?.addEventListener('change', searchPatientRange);
    $('#patientDay')?.addEventListener('change', searchPatientRange);
    $$('#patientTypeTabs .btn').forEach(b => b.addEventListener('click', () => {
        patientTypeFilter = b.dataset.ptype || 'new';
        patientReportPage = 1;
        $$('#patientTypeTabs .btn').forEach(x => x.classList.toggle('active', x === b));
        renderPatientReport();
    }));
    $('#calendarBtn')?.addEventListener('click', () => $('#calendarPanel')?.classList.toggle('hidden'));
    $('#calendarDate')?.addEventListener('change', e => {
        calendarDate = e.target.value || isoToday();
        renderCalendarInfo()
    })
}

function renderReceptionPayment() {
    initPaymentYearSelect();
    renderPaymentSummary();
}

function goReceptionMedPage(p) {
    receptionMedPage = Math.max(1, p);
    renderReceptionMedicines();
}

function renderReceptionMedicines() {
    const b = $('#receptionMedBody');
    if (!b) return;
    const q = ($('#receptionMedSearch')?.value || '').toLowerCase();
    const rows = active(DB.medicines).filter(m => `${m.name} ${m.drawer} ${m.quantity} ${m.available}`.toLowerCase().includes(q)).sort((a, b) => Number(b.no || 0) - Number(a.no || 0));
    const totalPages = Math.max(1, Math.ceil(rows.length / medPageSize));
    if (receptionMedPage > totalPages) receptionMedPage = totalPages;
    const slice = rows.slice((receptionMedPage - 1) * medPageSize, receptionMedPage * medPageSize);
    b.innerHTML = slice.map(m => {
        const actions = receptionCanEdit('medicineEntry') ? `<td><div class="actions compactActions"><button class="btn embossed" onclick="receptionEditMedicine('${m.id}')">Edit</button><button class="btn embossed" onclick="receptionDeleteMedicine('${m.id}')">Delete</button></div></td>` : '';
        return `<tr><td>${m.no||'-'}</td><td>${esc(m.name)}</td><td>${esc(m.drawer)}</td><td>${m.quantity}</td><td>${esc(m.available)}</td>${actions}</tr>`;
    }).join('') || `<tr><td colspan="${receptionCanEdit('medicineEntry')?6:5}">No medicines</td></tr>`;
    buildPagination('receptionMedPagination', receptionMedPage, totalPages, rows.length, medPageSize, 'goReceptionMedPage');
}

window.goReceptionMedPage = goReceptionMedPage;


function receptionPerm(module) {
    const p = DB.settings?.receptionPermissions || {};
    const v = p[module];
    if (v === true) return 'edit';
    if (v === false || v == null) return 'hidden';
    return v;
}
function receptionCanView(module) {
    return role !== 'reception' || ['view','edit'].includes(receptionPerm(module));
}
function receptionCanEdit(module) {
    return role !== 'reception' || receptionPerm(module) === 'edit';
}
function enforceReceptionEdit(module, message='This action is view-only for Reception') {
    if (!receptionCanEdit(module)) {
        toast(message, true);
        return false;
    }
    return true;
}

function receptionAddMedicine(e) {
    e.preventDefault();
    if (!enforceReceptionEdit('medicineEntry')) return;
    const m = {id:uid('m'), no:active(DB.medicines).reduce((mx,x)=>Math.max(mx,Number(x.no)||0),0)+1,
      name:$('#receptionMedName').value.trim(), drawer:$('#receptionMedDrawer').value.trim(),
      quantity:Number($('#receptionMedQuantity').value||0), available:$('#receptionMedAvailable').value, _updated:new Date().toISOString()};
    if (!m.name) return toast('Medicine name is required',true);
    DB.medicines.push(m); saveLocal(); renderReceptionMedicines(); syncNow(true); e.target.reset(); toast('Medicine registered');
}
function receptionEditMedicine(id) {
    if (!enforceReceptionEdit('medicineEntry')) return;
    const m=active(DB.medicines).find(x=>x.id===id); if(!m) return;
    modal('Edit Medicine', `<form id="receptionEditMedForm" class="formgrid"><label>Medicine Name<input name="name" value="${esc(m.name)}" required></label><label>Drawer<input name="drawer" value="${esc(m.drawer||'')}"></label><label>Quantity<input name="quantity" type="number" min="0" value="${Number(m.quantity||0)}"></label><label>Available<select name="available"><option ${m.available==='Yes'?'selected':''}>Yes</option><option ${m.available==='No'?'selected':''}>No</option></select></label><div class="full actions"><button class="btn embossed" type="submit">Update</button></div></form>`);
    $('#receptionEditMedForm')?.addEventListener('submit',e=>{e.preventDefault(); const f=new FormData(e.target); Object.assign(m,{name:f.get('name'),drawer:f.get('drawer'),quantity:Number(f.get('quantity')||0),available:f.get('available'),_updated:new Date().toISOString()}); saveLocal(); closeModal(); renderReceptionMedicines(); syncNow(true); toast('Medicine updated');});
}
function receptionDeleteMedicine(id) {
    if (!enforceReceptionEdit('medicineEntry')) return;
    const m=DB.medicines.find(x=>x.id===id); if(!m) return;
    if(!confirm('Delete this medicine?')) return;
    m._deleted=true; m._updated=new Date().toISOString(); saveLocal(); renderReceptionMedicines(); syncNow(true); toast('Medicine deleted');
}

function renderPermissions() {
    const perms = DB.settings.receptionPermissions || structuredClone(DEFAULT.settings.receptionPermissions);
    if (role === 'reception') {
        const patientView = receptionCanView('patient');
        const paymentView = receptionCanView('payment');
        const medicineView = receptionCanView('medicine');
        const dashOk = receptionCanView('dashboard');
        const allowNewOld = dashOk && receptionCanView('dashNewOldEntry');
        const allowQueue = dashOk && receptionCanView('dashTodayQueue');
        const allowQStatus = dashOk && receptionCanView('dashQueueStatus');
        const allowMore = dashOk && receptionCanView('dashMoreStats');
        $('#newCase')?.toggleAttribute('disabled', !(receptionCanEdit('patient') && allowNewOld));
        $('#oldCase')?.toggleAttribute('disabled', !(receptionCanEdit('patient') && allowNewOld));
        document.querySelector('.hero .actions')?.classList.toggle('hidden', !allowNewOld);
        if (role === 'reception') {
            $('#queueStatusStrip')?.classList.remove('hidden');
        } else {
            $('#queueStatusStrip')?.classList.toggle('hidden', !allowQStatus);
        }
        $('#kpiCommand')?.classList.toggle('hidden', !allowMore);
        $('#kpiMoreWrap')?.classList.toggle('hidden', !allowMore);
        document.querySelector('.card.glassCard') && null;
        const queueCard = document.querySelector('#dashboard .card.glassCard, #dashboard .card');
        // Today's Patient Queue card
        const qCard = Array.from(document.querySelectorAll('#dashboard .card')).find(c => c.querySelector('#queueSearch, .queueTable'));
        qCard?.classList.toggle('hidden', !allowQueue);
        $('#receptionPatientArea')?.classList.toggle('hidden', !patientView);
        document.querySelector('[data-page="payments"]')?.classList.toggle('hidden', !paymentView);
        document.querySelector('[data-page="medicines"]')?.classList.toggle('hidden', !medicineView);
        $('#receptionMedicineEntryCard')?.classList.toggle('hidden', !receptionCanEdit('medicineEntry'));
        document.querySelector('[data-page="dashboard"]')?.classList.toggle('hidden', !dashOk && !patientView);
        document.querySelectorAll('[data-reception-edit]').forEach(el => {
            el.disabled = !receptionCanEdit(el.dataset.receptionEdit);
            el.classList.toggle('viewOnly', el.disabled);
        });
        if (!patientView) closeForm();
        renderReceptionPayment();
        renderReceptionMedicines();
    }
    const ids = ['permPatient','permPayment','permPaymentEntry','permMedicine','permMedicineEntry','permReports','permDashboard','permClinic','permDashNewOld','permDashTodayQueue','permDashQueueStatus','permDashMoreStats','permPayClinic','permPayYearly','permPayIncome','permPaySpend'];
    const modules = ['patient','payment','paymentEntry','medicine','medicineEntry','reports','dashboard','clinic','dashNewOldEntry','dashTodayQueue','dashQueueStatus','dashMoreStats','paymentClinic','paymentYearly','paymentIncome','paymentSpend'];
    ids.forEach((id,i) => { if ($('#'+id)) $('#'+id).value = perms[modules[i]] || 'hidden'; });
}
function savePermissions() {
    const modules = ['patient','payment','paymentEntry','medicine','medicineEntry','reports','dashboard','clinic','dashNewOldEntry','dashTodayQueue','dashQueueStatus','dashMoreStats','paymentClinic','paymentYearly','paymentIncome','paymentSpend'];
    const ids = ['permPatient','permPayment','permPaymentEntry','permMedicine','permMedicineEntry','permReports','permDashboard','permClinic','permDashNewOld','permDashTodayQueue','permDashQueueStatus','permDashMoreStats','permPayClinic','permPayYearly','permPayIncome','permPaySpend'];
    const prev = DB.settings.receptionPermissions || {};
    const receptionPermissions = { ...prev };
    modules.forEach((m,i) => receptionPermissions[m] = $('#'+ids[i])?.value || 'hidden');
    DB.settings = markUpdated({...DB.settings, receptionPermissions});
    saveLocal();
    syncNow(true);
    renderPermissions();
    toast('Reception permissions updated');
}

function importPreviousData(e) {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
        try {
            const incoming = normalizeData(JSON.parse(r.result));
            const merge = (a, b) => {
                const m = new Map();
                [...a, ...b].forEach(x => {
                    if (!x?.id) return;
                    const old = m.get(x.id);
                    if (!old || String(x._updated || '') > String(old._updated || '')) m.set(x.id, x)
                });
                return [...m.values()]
            };
            DB.patients = merge(DB.patients, incoming.patients);
            DB.payments = merge(DB.payments, incoming.payments);
            DB.medicines = merge(DB.medicines, incoming.medicines);
            DB.meta.deleted = [...new Set([...(DB.meta.deleted || []), ...(incoming.meta?.deleted || [])])];
            DB.patients = DB.patients.filter(x => !DB.meta.deleted.includes(x.id));
            DB.payments = DB.payments.filter(x => !DB.meta.deleted.includes(x.id));
            DB.medicines = DB.medicines.filter(x => !DB.meta.deleted.includes(x.id));
            if (String(incoming.clinic?._updated || '') > String(DB.clinic?._updated || '')) DB.clinic = incoming.clinic;
            if (String(incoming.settings?._updated || '') > String(DB.settings?._updated || '')) DB.settings = incoming.settings;
            DB = normalizeData(DB);
            saveLocal();
            syncNow(true);
            toast('Previous data imported and merged safely')
        } catch {
            toast('Invalid previous backup', true)
        }
    };
    r.readAsText(f);
    e.target.value = ''
}

function getAppointmentHistoryRows() {
    let rows = caseRows().slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || Number(b.caseNo) - Number(a.caseNo));
    const q = String(histQuery || '').trim().toLowerCase();
    if (q) {
        const digits = q.replace(/\D/g, '');
        rows = rows.filter(p => {
            const name = `${p.title || ''} ${p.name || ''}`.toLowerCase();
            const mobile = String(p.mobile || '').replace(/\D/g, '');
            const caseNo = String(p.caseNo || '');
            return name.includes(q) || caseNo.includes(q) || (digits && mobile.includes(digits)) || String(p.address || '').toLowerCase().includes(q);
        });
    }
    return rows;
}

function renderAppointmentHistory() {
    const body = $('#histBody');
    const pag = $('#histPagination');
    if (!body) return;
    const rows = getAppointmentHistoryRows();
    const totalPages = Math.max(1, Math.ceil(rows.length / histPageSize));
    if (histPage > totalPages) histPage = totalPages;
    if (histPage < 1) histPage = 1;
    const slice = rows.slice((histPage - 1) * histPageSize, histPage * histPageSize);
    body.innerHTML = slice.map((p, i) => {
        const paid = paidFor(p.id);
        const total = feeTotal(p);
        const pend = pendingFor(p);
        const fully = p.received === true && pend <= 0;
        const status = fully ? '<span class="payReceivedTag">Received</span>' : (pend > 0 && paid > 0 ? '<span class="payPartialTag">Partial</span>' : (pend > 0 ? '<span class="payPendingTag">Pending</span>' : '<span class="payReceivedTag">Received</span>'));
        return `<tr>
          <td><b>${permanentCaseNo(p)}</b></td>
          <td>${fmtDate(p.date)}</td>
          <td><span class="tag ${p.caseType}">${(p.caseType || '').toUpperCase()}</span></td>
          <td>${esc(p.title)} ${esc(p.name)}<div class="mini">${esc(p.mobile || '')}</div></td>
          <td class="amount">${money(total)}</td>
          <td class="amount">${money(paid)}</td>
          <td>${status}${role === 'reception' ? '' : (pend > 0 ? ` <button type="button" class="btn embossed receiveBtn histMiniBtn" onclick="receiveP('${p.id}')" title="Receive pending">Recv</button>` : '')}</td>
          <td><div class="compactActions histActions">
            <button class="btn embossed histMiniBtn" onclick="viewPatientHistory('${p.id}')">View</button>
            ${role === 'reception' ? '' : `<button class="btn embossed histMiniBtn" onclick="editP('${p.id}')">Edit</button>
            <button class="btn embossed deleteBox histMiniBtn" onclick="delP('${p.id}')">Del</button>`}
          </div></td>
        </tr>`;
    }).join('') || '<tr><td colspan="8">No appointments found</td></tr>';
    if (pag) {
        if (rows.length <= histPageSize) {
            pag.innerHTML = `<span class="mini">${rows.length} entries</span>`;
        } else {
            let html = `<button type="button" class="btn embossed" data-hpg="prev" ${histPage<=1?'disabled':''}>‹ Prev</button>`;
            for (let i = 1; i <= totalPages; i++) {
                if (totalPages > 10 && Math.abs(i - histPage) > 2 && i !== 1 && i !== totalPages) {
                    if (i === 2 || i === totalPages - 1) html += `<span class="mini">…</span>`;
                    continue;
                }
                html += `<button type="button" class="btn embossed ${i===histPage?'active':''}" data-hpg="${i}">${i}</button>`;
            }
            html += `<button type="button" class="btn embossed" data-hpg="next" ${histPage>=totalPages?'disabled':''}>Next ›</button>`;
            html += `<span class="mini" style="margin-left:8px">${rows.length} total · page ${histPage}/${totalPages}</span>`;
            pag.innerHTML = html;
            pag.querySelectorAll('[data-hpg]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const v = btn.getAttribute('data-hpg');
                    if (v === 'prev') histPage = Math.max(1, histPage - 1);
                    else if (v === 'next') histPage = Math.min(totalPages, histPage + 1);
                    else histPage = Number(v) || 1;
                    renderAppointmentHistory();
                });
            });
        }
    }
    const hint = $('#histHint');
    if (hint) hint.textContent = histQuery ? `Filtered: "${histQuery}" (${rows.length})` : `Showing all appointments (${rows.length})`;
}

function setupAppointmentHistory() {
    $('#histSearchBtn')?.addEventListener('click', () => {
        histQuery = $('#histSearch')?.value || '';
        histPage = 1;
        renderAppointmentHistory();
    });
    $('#histClearBtn')?.addEventListener('click', () => {
        histQuery = '';
        if ($('#histSearch')) $('#histSearch').value = '';
        histPage = 1;
        renderAppointmentHistory();
    });
    $('#histSearch')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            histQuery = $('#histSearch')?.value || '';
            histPage = 1;
            renderAppointmentHistory();
        }
    });
}

function renderAll() {
    try { clearAllExpensesOnce(); } catch (e) {}
    try { migrateCaseNumbersToPrefixed(); } catch (e) {}
    try { fixLegacyBackdatedUnpaid(); } catch (e) {}
    renderDashboard();
    renderCalendarInfo();
    renderPermissions();
    renderQueue();
    renderMedicines();
    renderClinic();
    if ($('#reportBodyPatients')) { initPatientFilterSelects(); renderPatientReport(); }
    if ($('#payMonthBody') || $('#paymentYearSelect')) {
        initPaymentYearSelect();
        renderPaymentSummary();
        renderExpenses();
    }
    if (role === 'reception') renderReceptionQueue();
    if ($('#histBody')) renderAppointmentHistory();
    set('receptionPayState', DB.settings.receptionPaymentEnabled ? 'ON' : 'OFF');
    if ($('#receptionPayToggle')) $('#receptionPayToggle').checked = !!DB.settings.receptionPaymentEnabled
}
async function forceRefresh() {
    renderAll();
    if (server) {
        await syncNow(true)
    } else {
        toast('Refreshed from local data')
    }
}


function searchPatientsQuery(q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return [];
    const digits = q.replace(/\D/g, '');
    const tokens = q.split(/\s+/).filter(Boolean);
    return caseRows().filter(p => {
        const name = `${p.title || ''} ${p.name || ''}`.toLowerCase();
        const mobile = String(p.mobile || '');
        const mobileDigits = mobile.replace(/\D/g, '');
        const caseNo = String(permanentCaseNo(p) || p.caseNo || '');
        const address = String(p.address || '').toLowerCase();
        const pend = pendingFor(p);
        const last = String(p.date || '');
        const due = (typeof dueDate === 'function' ? dueDate(p) : '') || '';
        const blob = [name, mobile, mobileDigits, caseNo, address, last, due, pend > 0 ? 'pending' : '', (typeof renewalDue === 'function' && renewalDue(p)) ? 'renewal due' : ''].join(' ').toLowerCase();
        if (name.includes(q) || address.includes(q) || caseNo.includes(q)) return true;
        if (digits && mobileDigits.includes(digits)) return true;
        if (mobile.toLowerCase().includes(q)) return true;
        if (q.length >= 4 && last.includes(q)) return true;
        if (tokens.length && tokens.every(t => blob.includes(t))) return true;
        return false;
    }).slice(0, 30);
}

function runGlobalPatientSearch() {
    const input = $('#globalPatientSearch');
    const box = $('#globalSearchResults');
    if (!input || !box) return;
    const q = input.value;
    if (!String(q).trim()) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
    }
    const hits = searchPatientsQuery(q);
    if (!hits.length) {
        box.classList.remove('hidden');
        box.innerHTML = '<div class="gsEmpty">No patient found</div>';
        return;
    }
    box.classList.remove('hidden');
    box.innerHTML = hits.map(p => {
        const pend = pendingFor(p);
        const payLabel = paymentStatusInfo(p).kind === 'foc' ? 'FOC' : (pend > 0 ? (paidFor(p.id) > 0 ? `Partial ${money(pend)}` : `Pending ${money(pend)}`) : 'Received');
        return `<button type="button" class="gsItem" role="option" data-id="${p.id}">
          <span class="gsCase">#${p.caseNo}</span>${esc(p.title)} ${esc(p.name)}
          <span class="gsMeta">${esc(p.mobile || '—')} · ${fmtDate(p.date)} · ${p.caseType || ''} · ${payLabel}</span>
        </button>`;
    }).join('');
    box.querySelectorAll('.gsItem').forEach(btn => {
        btn.addEventListener('click', () => {
            showPatientDetail(btn.dataset.id);
            box.classList.add('hidden');
        });
    });
}

function showPatientDetail(id) {
    if (typeof openPatientProfile === 'function') {
        openPatientProfile(id);
        return;
    }
    const p = active(DB.patients).find(x => x.id === id);
    if (!p) {
        toast('Patient not found', true);
        return;
    }
    // This visit's own fees / pending
    const paid = paidFor(p.id);
    const total = feeTotal(p);
    const pend = pendingFor(p);
    const renew = renewalDue(p);
    // Whole case family (all visits sharing same permanent case no)
    const family = caseFamily(p);
    const famPays = familyPayments(p);
    const famPaidTotal = familyPaidTotal(p);
    let status = 'Pending';
    let statusClass = 'pend';
    if (p.received === true || pend <= 0) {
        status = 'Received';
        statusClass = 'ok';
    } else if (p.withDoctor) {
        status = 'With Doctor';
        statusClass = 'doc';
    }

    // Build visit rows: one row per visit date from family patient rows + their payments
    // Prefer grouping payments by date across family
    const byDate = {};
    famPays.forEach(x => {
        const d = String(x.date || '');
        if (!byDate[d]) byDate[d] = { consultation: 0, medicine: 0, renewal: 0, other: 0, type: '' };
        const cat = x.feeCategory || 'other';
        if (cat === 'consultation' || cat === 'medicine' || cat === 'renewal') byDate[d][cat] += Number(x.amount || 0);
        else byDate[d].other += Number(x.amount || 0);
    });
    // Also include family visit rows that have fees but maybe no payment yet (pending visits)
    family.forEach(v => {
        const d = String(v.date || '');
        if (!byDate[d]) byDate[d] = { consultation: 0, medicine: 0, renewal: 0, other: 0, type: v.caseType || '' };
        // mark type from visit
        if (v.caseType) byDate[d].type = v.caseType;
        // if this visit has unpaid fees, still show the visit date even if no payment rows
        const vPaid = paidFor(v.id);
        const vTotal = feeTotal(v);
        if (vTotal > 0 && vPaid === 0 && !famPays.some(x => x.patientId === v.id)) {
            // show expected amounts as 0 received for visibility
            byDate[d]._pendingVisit = true;
            byDate[d]._visitId = v.id;
            byDate[d]._visitFees = vTotal;
        }
    });
    const dates = Object.keys(byDate).sort((a, b) => String(b).localeCompare(String(a)));
    let histTotal = 0, sumCons = 0, sumMed = 0, sumRen = 0;
    const histRows = dates.map((d, i) => {
        const g = byDate[d];
        const lineTotal = g.consultation + g.medicine + g.renewal + g.other;
        histTotal += lineTotal;
        sumCons += Number(g.consultation || 0);
        sumMed += Number(g.medicine || 0);
        sumRen += Number(g.renewal || 0);
        const isRenew = g.renewal > 0;
        const isPendingVisit = !!g._pendingVisit && lineTotal === 0;
        const actionLabel = isPendingVisit ? 'Pending' : (lineTotal > 0 ? 'Received' : 'Pending');
        const actionClass = isPendingVisit || lineTotal === 0 ? 'histPending' : 'histReceived';
        const typeTag = g.type ? `<span class="tag ${g.type}" style="margin-left:6px;font-size:10px">${String(g.type).toUpperCase()}</span>` : '';
        const recvBtn = isPendingVisit && g._visitId
            ? ` <button type="button" class="btn embossed receiveBtn miniAction" onclick="receiveP('${g._visitId}');closeModal()">Receive</button>`
            : '';
        return `<tr class="${isRenew ? 'renewRow' : ''}${isPendingVisit ? ' pendingRow' : ''}">
          <td>${i + 1}</td>
          <td>${fmtDate(d)}${typeTag}</td>
          <td>${money(g.consultation)}</td>
          <td>${money(g.medicine)}</td>
          <td>${money(g.renewal)}</td>
          <td><span class="histAction ${actionClass}">${actionLabel}</span>${recvBtn}</td>
          <td><b>${isPendingVisit ? money(g._visitFees || 0) + ' due' : money(lineTotal)}</b></td>
        </tr>`;
    }).join('') || '<tr><td colspan="7">No payment records yet</td></tr>';

    const html = `<div class="patientDetailCard">
      <div class="detailGrid">
        <div class="dl"><small>Case No.</small><b>${permanentCaseNo(p)}</b></div>
        <div class="dl"><small>This visit type</small><b>${esc(p.caseType || '-')}</b></div>
        <div class="dl"><small>This visit date</small><b>${fmtDate(p.date)}</b></div>
        <div class="dl"><small>Status (this visit)</small><b><span class="statusPill ${statusClass}">${status}</span></b></div>
        <div class="dl full"><small>Patient</small><b>${esc(p.title)} ${esc(p.name)}</b></div>
        <div class="dl"><small>Age / Gender</small><b>${p.age || '-'} / ${esc(p.gender || '-')}</b></div>
        <div class="dl"><small>Mobile</small><b>${esc(p.mobile || '-')}</b></div>
        <div class="dl full"><small>Address</small><b>${esc(p.address || '-')}</b></div>
        <div class="dl"><small>Ref by</small><b>${esc(p.refBy || '-')}</b></div>
        <div class="dl"><small>Last renewal date</small><b>${p.lastRenewalDate ? fmtDate(p.lastRenewalDate) : '-'}</b></div>
        <div class="dl"><small>This visit — Consultation</small><b>${money(p.consultation)}</b></div>
        <div class="dl"><small>This visit — Medicine</small><b>${money(p.medicine)}</b></div>
        <div class="dl"><small>This visit — Renewal</small><b>${money(p.renewal || 0)}${renew ? ' · Due' : ''}</b></div>
        <div class="dl"><small>This visit fees</small><b>${money(total)}</b></div>
        <div class="dl"><small>This visit paid</small><b>${money(paid)}</b></div>
        <div class="dl"><small>This visit pending</small><b>${pend > 0 ? money(pend) : 'Nil'}</b>
          ${pend > 0 ? ` <button type="button" class="btn embossed receiveBtn miniAction" onclick="receiveP('${p.id}');closeModal()" style="margin-left:8px">Receive</button>` : ''}
        </div>
        <div class="dl full"><small>TOTAL PAYMENT TILL DATE (all visits)</small><b style="color:#137b4c;font-size:18px">${money(famPaidTotal)}</b>
          <span class="mini"> — ${family.length} visit(s) under case #${permanentCaseNo(p)}</span>
        </div>
      </div>
      <div>
        <h3 style="margin:0 0 8px;font-size:15px">Visit / payment history (all visits of this case)</h3>
        <p class="mini">Saari visits (new + follow-up) ek saath. Latest pehle. Renewal rows light green. Pending pe Receive button.</p>
        <div class="tablewrap"><table class="table payHistoryTable">
          <thead><tr>
            <th>Sr No.</th><th>Date</th><th>Consultation</th><th>Medicine</th><th>Renewal</th><th>Action</th><th>Total Payment</th>
          </tr></thead>
          <tbody>${histRows}</tbody>
          <tfoot>
            <tr class="summaryBreakRow"><td colspan="2"><b>Category Totals</b></td><td><b>${money(sumCons)}</b></td><td><b>${money(sumMed)}</b></td><td><b>${money(sumRen)}</b></td><td></td><td></td></tr>
            <tr class="summaryTotalRow"><td colspan="6"><b>Grand Total (all visits)</b></td><td><b>${money(histTotal)}</b></td></tr>
          </tfoot>
        </table></div>
        <div class="histTotalsBar" style="margin-top:12px;display:flex;flex-wrap:wrap;gap:10px">
          <div class="paySummaryBox" style="min-width:150px"><small>Consultation Total</small><b>${money(sumCons)}</b></div>
          <div class="paySummaryBox med" style="min-width:150px"><small>Medicine Total</small><b>${money(sumMed)}</b></div>
          <div class="paySummaryBox renewal" style="min-width:150px"><small>Renewal Total</small><b>${money(sumRen)}</b></div>
          <div class="paySummaryBox total" style="min-width:150px"><small>Grand Total</small><b>${money(histTotal)}</b></div>
        </div>
        ${pend > 0 ? `<div style="margin-top:12px;padding:12px 14px;border-radius:12px;background:linear-gradient(165deg,#fff5f5,#fde8e8);border:1px solid #f0c2c2;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-weight:700;color:#b91c1c">This visit pending: ${money(pend)}</span>
          <button type="button" class="btn embossed receiveBtn" onclick="receiveP('${p.id}');closeModal()">Receive Pending Payment</button>
        </div>` : ''}
        <p class="mini" style="margin-top:10px">${renew ? 'Annual renewal is due for this case.' : 'No renewal due at present.'}${p.withDoctor ? ' Patient is currently with doctor.' : ''}</p>
      </div>
      <div class="actions" style="flex-wrap:wrap">
        <button type="button" class="btn embossed" onclick="editP('${p.id}');closeModal()">Edit</button>
        ${role === 'office' || role === 'reception' ? `${pend > 0 ? `<button type="button" class="btn embossed receiveBtn" onclick="receiveP('${p.id}');closeModal()">Receive</button>` : ''}
        <button type="button" class="btn embossed actNeutral" onclick="pendingP('${p.id}');closeModal()">Pending</button>
        <button type="button" class="btn embossed actNeutral" onclick="docP('${p.id}');closeModal()">With Doctor</button>
        <button type="button" class="btn embossed actNeutral" onclick="payP('${p.id}');">Add Payment</button>` : ''}
      </div>
    </div>`;
    modal(`Patient #${permanentCaseNo(p)} — ${esc(p.title)} ${esc(p.name)}`, html);
}


function setupGlobalPatientSearch() {
    const input = $('#globalPatientSearch');
    const box = $('#globalSearchResults');
    if (!input) return;
    let t = null;
    input.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(runGlobalPatientSearch, 120);
    });
    input.addEventListener('focus', () => {
        if (String(input.value).trim()) runGlobalPatientSearch();
    });
    input.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            box?.classList.add('hidden');
            input.blur();
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            const first = box?.querySelector('.gsItem');
            if (first) first.click();
        }
    });
    document.addEventListener('click', e => {
        if (!e.target.closest('.globalSearchWrap')) box?.classList.add('hidden');
    });
}

function setup() {
    setupNav();
    try { setupKpiCollapse(); } catch(e) {}
    try { document.querySelectorAll('.appVersionBadge').forEach(el => { el.textContent = APP_VERSION; el.title = 'Application ' + APP_VERSION; }); } catch(e) {}
    setupGlobalPatientSearch();
    setupOldAppointmentPanel();
    setupAppointmentHistory();
    setupPaymentView();
    try { connectClinicWebSocket(); } catch (e) {}
    $('#reconnectBtn')?.addEventListener('click', async () => {
        setConn(false, '🟡 Syncing…', null);
        const live = $('#syncLiveBadge');
        if (live) { live.textContent = 'Syncing…'; live.className = 'syncLiveBadge syncing'; }
        try { await syncNow(false); connectClinicWebSocket(); } catch (e) { toast('Reconnect failed', true); }
    });
    setupBackupUI();
    setupEmptyStockBtn();
    setupKpiClicks();
    setupPatientsNav();
    $('#newCase')?.addEventListener('click', () => buildPatientForm('new'));
    $('#oldCase')?.addEventListener('click', () => openOldAppointmentPanel());
    $('#patientForm')?.addEventListener('submit', registerCase);
    $('#patientClose')?.addEventListener('click', closeForm);
    $('#patientDate')?.addEventListener('change', checkRenewal);
    $('#caseNo')?.addEventListener('input', checkRenewal);
    $('#queueSearch')?.addEventListener('input', () => { queuePage = 1; if (role === 'reception') renderReceptionQueue(); else renderQueue(); });
    $('#medSearch')?.addEventListener('input', () => { medPage = 1; renderMedicines(); });
    $('#receptionMedSearch')?.addEventListener('input', () => { receptionMedPage = 1; renderReceptionMedicines(); });
    $('#medicineForm')?.addEventListener('submit', saveMedicine);
    $('#expenseForm')?.addEventListener('submit', saveExpense);
    $('#expenseClearBtn')?.addEventListener('click', clearExpenseForm);
    $('#clinicForm')?.addEventListener('submit', saveClinic);
    $('#exportBtn')?.addEventListener('click', exportBackup);
    $('#importInput')?.addEventListener('change', importBackup);
    $('#importPreviousInput')?.addEventListener('change', importPreviousData);
    ['permPatient','permPayment','permPaymentEntry','permMedicine','permMedicineEntry','permReports','permDashboard','permClinic','permDashNewOld','permDashTodayQueue','permDashQueueStatus','permDashMoreStats','permPayClinic','permPayYearly','permPayIncome','permPaySpend'].forEach(id => $('#' + id)?.addEventListener('change', savePermissions));
    $('#savePermissionsBtn')?.addEventListener('click', savePermissions);
    $('#receptionMedicineForm')?.addEventListener('submit', receptionAddMedicine);
    $('#modal')?.addEventListener('click', e => {
        if (e.target.id === 'modal') closeModal()
    });
    $('#modalClose')?.addEventListener('click', closeModal);
    $('#testConn')?.addEventListener('click', testConn);
    $('#refreshBtn')?.addEventListener('click', forceRefresh);
    if ($('#themeToggle')) $('#themeToggle').textContent = savedTheme === 'dark' ? '☀ Light' : '☾ Dark';
    $('#themeToggle')?.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        localStorage.setItem('anandClinicTheme', next);
        if ($('#themeToggle')) $('#themeToggle').textContent = next === 'dark' ? '☀ Light' : '☾ Dark';
    });
    $('#connectBtn')?.addEventListener('click', async () => {
        server = $('#serverUrl').value.trim().replace(/\/$/, '');
        localStorage.setItem(SERVER_KEY, server);
        await syncNow();
    });
    $('#receptionPayToggle')?.addEventListener('change', () => {
        DB.settings = markUpdated({
            ...DB.settings,
            receptionPaymentEnabled: $('#receptionPayToggle').checked
        });
        saveLocal();
        syncNow(true)
    });
    if (role === 'reception') renderReceptionQueue();
    renderAll();
    setConn(false, server ? 'Checking connection…' : 'Offline mode — no server selected.');
    if (server) syncNow(true);
    setInterval(() => {
        renderAll();
        if (server) syncNow(true)
    }, 2000)
}

function renderReceptionQueue() {
    const b = $('#receptionPatients');
    if (!b) return;
    const q = ($('#queueSearch')?.value || '').toLowerCase();
    let arr = caseRows().filter(isTodayCase).filter(p => p.caseType === 'new' || p.caseType === 'old').filter(p => !q || `${p.caseNo} ${p.name} ${p.mobile}`.toLowerCase().includes(q));
    const { active, done } = splitTodayQueue(arr);
    set('queueCountHint', `${active.length} active · ${done.length} completed today`);

    const rowHtml = (p, i, section) => {
        const withDoc = !!p.withDoctor;
        const stPay = paymentStatusInfo(p);
        const fullyReceived = stPay.kind === 'received' || queueStatus(p) === 'received';
        const pulse = fullyReceived && p.completedAt && (Date.now() - new Date(p.completedAt).getTime() < 8000);
        const renewHighlight = renewalDue(p) && !hasRenewalPayment(p);
        let rowClass = stPay.kind === 'foc' ? 'focRow' : (fullyReceived ? 'receivedRow' : withDoc ? 'doctorRow' : 'pendingRow');
        if (stPay.kind === 'partial') rowClass += ' partialPendingRow';
        if (renewHighlight) rowClass += ' renewDueRow';
        const cons = Number(p.consultation || 0);
        const med = Number(p.medicine || 0);
        const ren = Number(p.renewal || 0);
        const totalCol = cons + med + ren;
        const statusLab = receptionPayStatusLabel(p);
        const payBreak = `<div class="payBreakup"><div>Consultation: <b>${money(cons)}</b></div><div>Medicine: <b>${money(med)}</b></div><div>Renewal: <b>${money(ren)}</b></div></div>`;
        const locked = fullyReceived;
        const dis = locked ? ' disabled' : '';
        const lockCls = locked ? ' actLocked' : '';
        const sr = i + 1;
        const action = section === 'done'
            ? `<span class="mini">Completed</span>`
            : `<div class="actions embossedActions compactActions queueActions"><button class="btn embossed actNeutral${withDoc?' withDocActive':''}${lockCls}" onclick="docP('${p.id}')"${dis}>With Doctor</button></div>`;
        return `<tr class="${rowClass}${pulse?' receivedPulse':''}"><td>${sr}</td><td><b>${permanentCaseNo(p)}</b></td><td>${fmtDate(p.date)}</td><td><span class="tag ${p.caseType}">${p.caseType==='new'?'NEW':'OLD'}</span></td><td><div class="patientMain">${esc(p.title)} ${esc(p.name)}${renewHighlight?' <span class="renewBadge">R</span>':''}</div><div class="mini">${esc(p.mobile || '')}</div></td><td class="payBreakCell">${payBreak}</td><td class="amount totalCollectCell"><b>${money(totalCol)}</b><div class="payStatusUnder">${statusLab}</div></td><td>${action}</td></tr>`;
    };

    const waiting = active.filter(p => queueStatus(p) !== 'doctor').sort((a,b)=>patientEntryTime(a).localeCompare(patientEntryTime(b)));
    const doctor = active.filter(p => queueStatus(p) === 'doctor').sort((a,b)=>patientEntryTime(a).localeCompare(patientEntryTime(b)));
    done.sort((a,b)=>patientCompletedTime(b).localeCompare(patientCompletedTime(a)));
    let html = '';
    if (waiting.length) { html += `<tr class="queueSectionBreak"><td colspan="8">Waiting Today</td></tr>`; waiting.forEach((p,i)=>{ html += rowHtml(p,i,'active'); }); }
    if (doctor.length) { html += `<tr class="queueSectionBreak"><td colspan="8">With Doctor Today</td></tr>`; doctor.forEach((p,i)=>{ html += rowHtml(p,i,'active'); }); }
    if (done.length) {
        html += `<tr class="queueSectionBreak"><td colspan="8">Completed today</td></tr>`;
        done.forEach((p, i) => { html += rowHtml(p, i, 'done'); });
    }
    if (!waiting.length && !doctor.length && !done.length) html = '<tr><td colspan="8">No new or old case entries today</td></tr>';
    b.innerHTML = html;

    // Keep the reception queue as the same single scrollable table; do not
    // render a second card/pagination list below it.
    const mobR = $('#queueMobileCards');
    if (mobR) mobR.innerHTML = '';
    const pag = $('#queuePagination');
    if (pag) pag.innerHTML = `<span class="mini">${active.length} waiting/with doctor · ${done.length} completed</span>`;
}


function emailCloudBackup() {
    try {
        const data = buildBackupPayload(role === 'office');
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const filename = `anand-clinic-backup-${role}-${stamp}.json`;
        downloadBackupFile(data, filename);
        const subject = encodeURIComponent('Anand Clinic Backup ' + stamp);
        const body = encodeURIComponent(
            'Anand Homoeopathy Clinic backup file downloaded as: ' + filename +
            '\n\nAttach this JSON file to this email and send to yourself (Gmail/Drive).\nKeep a copy on pen drive for PC crash recovery.'
        );
        window.location.href = 'mailto:?subject=' + subject + '&body=' + body;
        toast('Backup downloaded — attach the JSON in your email');
    } catch (e) {
        toast('Email backup failed', true);
    }
}


function setupKpiCollapse() {
    // Disabled: all KPI boxes always open (user request)
    const body = $('#kpiMoreBody');
    if (body) {
        body.classList.remove('hidden', 'kpi-collapsed');
        body.classList.add('kpi-open');
        body.style.display = '';
    }
    const wrap = $('#kpiMoreWrap');
    if (wrap) wrap.classList.add('hidden');
    const btn = $('#kpiMoreToggle');
    if (btn) btn.style.display = 'none';
}
window.setupKpiCollapse = setupKpiCollapse;

function setupBillPage(refresh) {
    if ($('#billDate') && !$('#billDate').value) $('#billDate').value = isoToday();
    const sel = $('#billPatientSelect');
    const uniqueRows = () => (typeof billUniquePatients === 'function' ? billUniquePatients() : caseRows());
    if (sel && (refresh || sel.options.length <= 1)) {
        const rows = uniqueRows().slice(0, 1000);
        sel.innerHTML = '<option value="">— Select patient —</option>' + rows.map((p, i) =>
            `<option value="${p.id}">${i + 1}. #${permanentCaseNo(p)} — ${esc(p.title)} ${esc(p.name)} (${esc(p.mobile || '')})</option>`
        ).join('');
    }
    const billSearchEl = $('#billPatientSearch');
    const results = $('#billPatientResults');
    if (billSearchEl && !billSearchEl._billBound) {
        billSearchEl._billBound = true;
        const pickPatient = (id) => {
            if (sel) sel.value = id;
            fillBillFromPatient(id);
            const p = active(DB.patients).find(x => x.id === id);
            if (p) billSearchEl.value = `${p.title || ''} ${p.name || ''}`.trim();
            results?.classList.add('hidden');
        };
        const runSearch = () => {
            if (!results) return;
            const q = (billSearchEl.value || '').trim().toLowerCase();
            let rows = uniqueRows();
            if (q) {
                rows = rows.filter(p => {
                    const blob = `${permanentCaseNo(p)} ${p.caseNo || ''} ${p.title || ''} ${p.name || ''} ${p.mobile || ''}`.toLowerCase();
                    return blob.includes(q);
                });
            }
            rows = rows.slice(0, 40);
            if (!rows.length) {
                results.innerHTML = `<div class="billSearchEmpty">No patient match</div>`;
                results.classList.remove('hidden');
                return;
            }
            results.innerHTML = rows.map((p, i) =>
                `<button type="button" class="billSearchItem" data-pid="${p.id}">
                   <span class="billSrNum">${i + 1}</span>
                   <b>#${permanentCaseNo(p)}</b> ${esc(p.title)} ${esc(p.name)}
                   <span class="mini">${esc(p.mobile || '')}</span>
                 </button>`
            ).join('');
            results.classList.remove('hidden');
            results.querySelectorAll('[data-pid]').forEach(btn => {
                btn.addEventListener('click', () => pickPatient(btn.getAttribute('data-pid')));
            });
        };
        billSearchEl.placeholder = 'Search name / mobile / case — last case on top…';
        billSearchEl.addEventListener('input', runSearch);
        billSearchEl.addEventListener('focus', runSearch);
        document.addEventListener('click', (e) => {
            if (!results) return;
            if (!billSearchEl.contains(e.target) && !results.contains(e.target)) results.classList.add('hidden');
        });
        sel?.addEventListener('change', () => fillBillFromPatient(sel.value));
        const refreshIds = ['billIncConsult','billIncMedicine','billIncRenewal','billIncCourier','billIncMedNames','billConsultAmt','billMedicineAmt','billRenewalAmt','billCourierAmt','billPatientName','billDate','billMedNames','billSkipHeader'];
        refreshIds.forEach(id => {
            const el = $('#' + id);
            if (!el) return;
            el.addEventListener('change', () => renderBillPreview());
            el.addEventListener('input', () => renderBillPreview());
        });
        const medNamesTick = $('#billIncMedNames');
        const medNamesInp = $('#billMedNames');
        if (medNamesTick && medNamesInp) {
            const syncMedNames = () => { medNamesInp.disabled = !medNamesTick.checked; };
            medNamesTick.addEventListener('change', syncMedNames);
            syncMedNames();
        }
        $('#billPreviewBtn')?.addEventListener('click', () => renderBillPreview());
        $('#billPrintFullBtn')?.addEventListener('click', () => printBill('full'));
        $('#billPrintLetterheadBtn')?.addEventListener('click', () => printBill('letterhead'));
    }
    renderBillPreview();
}

function fillBillFromPatient(id) {
    const p = active(DB.patients).find(x => x.id === id);
    if (!p) return;
    const family = (typeof caseFamily === 'function' ? caseFamily(p) : [p]);
    const latest = family.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0] || p;
    if ($('#billPatientName')) $('#billPatientName').value = `${p.title || ''} ${p.name || ''}`.trim();
    if ($('#billCaseNo')) $('#billCaseNo').value = permanentCaseNo(p);
    if ($('#billConsultAmt')) $('#billConsultAmt').value = Number(latest.consultation || 0);
    if ($('#billMedicineAmt')) $('#billMedicineAmt').value = Number(latest.medicine || 0);
    if ($('#billRenewalAmt')) $('#billRenewalAmt').value = Number(latest.renewal || 0);
    if ($('#billDate')) $('#billDate').value = latest.date || p.date || isoToday();
    renderBillPreview();
}

function billLineItems() {
    const items = [];
    if ($('#billIncConsult')?.checked) items.push({ label: 'Consultation Fees', amount: Number($('#billConsultAmt')?.value || 0) });
    if ($('#billIncMedicine')?.checked) items.push({ label: 'Homoeopathic medicine charges', amount: Number($('#billMedicineAmt')?.value || 0) });
    if ($('#billIncRenewal')?.checked) items.push({ label: 'Renewal Fees', amount: Number($('#billRenewalAmt')?.value || 0) });
    if ($('#billIncCourier')?.checked) items.push({ label: 'Courier Charges', amount: Number($('#billCourierAmt')?.value || 0) });
    return items;
}

function buildBillHtml(mode) {
    const name = ($('#billPatientName')?.value || '').trim() || '';
    const caseNo = ($('#billCaseNo')?.value || '').trim() || '';
    const dateStr = fmtDate($('#billDate')?.value || isoToday());
    const items = billLineItems();
    const total = items.reduce((a, x) => a + Number(x.amount || 0), 0);
    const showMedNames = !!$('#billIncMedNames')?.checked;
    const medNames = ($('#billMedNames')?.value || '').trim();
    const skipHeader = !!$('#billSkipHeader')?.checked || mode === 'letterhead';
    let sr = 0;
    const lines = items.map((x) => {
        sr += 1;
        let row = `<tr class="billFeeRow"><td class="billSr">${sr}</td><td class="billLabel">${esc(x.label)}</td><td class="billAmtCell">${money(x.amount)}</td></tr>`;
        if (showMedNames && medNames && /homoeopathic medicine/i.test(x.label)) {
            row += `<tr class="billMedNameRow"><td class="billSr"></td><td class="billMedNames" colspan="1">(${esc(medNames)})</td><td class="billAmtCell"></td></tr>`;
        }
        return row;
    }).join('') || `<tr><td colspan="3" class="mini">No fee lines selected</td></tr>`;

    // Full-width logo banner (transparent bg) — left to right; NO email
    const header = skipHeader ? '' : `
      <div class="billPremHeader">
        <div class="billPremLogoWrap">
          <img src="clinic-bill-logo.png" alt="ANAND Homoeopathy Multi Speciality Clinic" class="billPremLogo">
        </div>
        <div class="billPremDocs">
          <div class="billPremDoc">
            <div class="billPremDocName">DR. ANAND MAKADIYA <span class="billPremDeg">(MD. BHMS)</span></div>
            <div class="billPremDocRole">(HOMOEOPATHIC CONSULTANT)</div>
            <div class="billPremDocReg">Registration No. G-12659</div>
            <div class="billPremMob">Appointment mob: 9687879790</div>
          </div>
          <div class="billPremDoc billPremDocRight">
            <div class="billPremDocName">DR. SUNITA MAKADIYA <span class="billPremDeg">(MD. BHMS)</span></div>
            <div class="billPremDocRole">(HOMOEOPATHIC CONSULTANT)</div>
            <div class="billPremDocReg">Registration No. G-12661</div>
          </div>
        </div>
        <div class="billPremRule"></div>
      </div>`;

    return `
    <div class="billPrintRoot ${skipHeader ? 'billLetterheadMode' : 'billFullMode'}">
      ${header}
      <div class="billMeta billMetaOnPad">
        <div class="billMetaName"><span class="billMetaL">Name :</span> <b>${esc(name || '—')}</b></div>
        <div class="billMetaDate"><span class="billMetaL">Date :</span> <b>${dateStr}</b></div>
      </div>
      ${caseNo ? `<div class="billCaseLine"><span class="billMetaL">Case No.:</span> <b>${esc(caseNo)}</b></div>` : ''}
      <table class="billLines"><colgroup><col class="colSr"><col class="colPart"><col class="colAmt"></colgroup>
        <thead><tr><th class="billSr">Sr</th><th class="billLabel">Particulars</th><th class="billAmtCell">Amount</th></tr></thead>
        <tbody>${lines}</tbody>
        <tfoot><tr><td class="billSr"></td><td class="billLabel">Total</td><td class="billAmtCell">${money(total)}</td></tr></tfoot>
      </table>
      <div class="billStamp">
        <div class="stampRing">
          <div class="stampName">Dr. Anand Makadiya</div>
          <div class="stampDeg">MD, BHMS</div>
          <div class="stampReg">Reg No. G-12659</div>
        </div>
      </div>
      <div class="billPremFooter">
        <div class="billFooterTime">Time : 10 am to 1 pm &nbsp;|&nbsp; 5 pm to 8:30 pm &nbsp;|&nbsp; Monday to Saturday</div>
        <div class="billFooterAddr">FF-01, Rameshwar Residency, Nr. Ghuma Bus stand, Ghuma, Ahmedabad-380058.</div>
        <div class="billGoogleLine">
          <span class="billGoogleIcon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          </span>
          anand homoeopathy multispeciality clinic
        </div>
      </div>
    </div>`;
}

function renderBillPreview() {
    const box = $('#billPreview');
    if (!box) return;
    box.className = 'billSheet billModeFull';
    box.innerHTML = buildBillHtml('full');
}

function checkPrinterThenPrint(printFn) {
    // Browsers cannot reliably detect a physical printer. We open print dialog;
    // if blocked / unavailable we notify the user.
    try {
        if (typeof printFn !== 'function') {
            toast('Print not available', true);
            return;
        }
        printFn();
    } catch (e) {
        toast('Printer connected nahi hai ya print block ho gaya. Printer on karke dubara try karein.', true);
    }
}

function printBill(mode) {
    renderBillPreview();
    const html = buildBillHtml(mode === 'letterhead' ? 'letterhead' : 'full');
    checkPrinterThenPrint(() => {
        const w = window.open('', '_blank', 'noopener,noreferrer,width=800,height=900');
        if (!w) {
            toast('Printer / print window open nahi hua. Pop-up allow karein. Agar printer off hai to use on karein.', true);
            return;
        }
        w.document.write(`<!doctype html><html><head><title>Bill</title>
    <style>
      @page { margin: 10mm; size: A4; }
      * { box-sizing: border-box; }
      body { font-family: Georgia, 'Times New Roman', serif; color: #16304d; margin: 0; padding: 8px; background: #fff; }
      .billPrintRoot { max-width: 190mm; margin: 0 auto; }
      .billLetterheadMode .billPremHeader { display: none !important; }
      .billPremHeader { text-align: center; margin-bottom: 10px; }
      .billPremLogoWrap { width: 100%; background: transparent; }
      .billPremLogo {
        display: block; width: 100%; max-width: 100%; height: auto;
        max-height: 90px; object-fit: contain; object-position: center;
        background: transparent; margin: 0 auto;
      }
      .billPremDocs { display: flex; justify-content: space-between; gap: 16px; margin-top: 10px; text-align: left; }
      .billPremDoc { flex: 1; font-size: 11px; line-height: 1.4; }
      .billPremDocRight { text-align: right; }
      .billPremDocName { font-weight: 700; font-size: 12px; color: #2d5a3d; }
      .billPremDeg { color: #c45c26; font-weight: 600; }
      .billPremDocRole, .billPremDocReg, .billPremMob { font-size: 10px; color: #555; }
      .billPremRule { height: 2px; background: linear-gradient(90deg, #2d5a3d, #c45c26, #1857b7); margin: 10px 0 6px; border-radius: 2px; }
      .billMetaOnPad { display: flex; justify-content: space-between; gap: 16px; margin: 12px 0; font-size: 15px; }
      .billCaseLine { margin-bottom: 10px; font-size: 14px; }
      .billMetaL { color: #5a6a7a; }
      .billLines { width: 100%; border-collapse: collapse; margin-top: 6px; table-layout: fixed; }
      .billLines col.colSr { width: 48px; }
      .billLines col.colPart { width: auto; }
      .billLines col.colAmt { width: 120px; }
      .billLines th, .billLines td { padding: 9px 8px; border-bottom: 1px solid #d0d8e0; vertical-align: top; }
      .billLines th.billSr, .billLines td.billSr { text-align: center; color: #5a6a7a; }
      .billLines th.billLabel, .billLines td.billLabel { text-align: left; }
      .billLines th.billAmtCell, .billLines td.billAmtCell { text-align: right; white-space: nowrap; }
      .billLines tfoot td { font-weight: 800; border-top: 2px solid #16304d; font-size: 16px; }
      .billMedNames { font-size: 11px; color: #5a6a7a; font-style: italic; }
      .billStamp { margin-top: 28px; display: flex; justify-content: flex-end; }
      .stampRing {
        width: 140px; height: 140px; border-radius: 50%;
        border: 3px double #1a4a9a; color: #1a4a9a;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        text-align: center; transform: rotate(-8deg);
        box-shadow: inset 0 0 0 1px #1a4a9a; background: #fff;
        font-family: 'Segoe UI', system-ui, sans-serif;
      }
      .stampName { font-weight: 800; font-size: 12px; }
      .stampDeg, .stampReg { font-size: 11px; margin-top: 3px; }
      .stampReg { font-weight: 700; }
      .billPremFooter { margin-top: 22px; text-align: center; padding-top: 10px; border-top: 1px solid #c5d4e0; }
      .billFooterTime { font-weight: 700; color: #c45c26; font-size: 12px; }
      .billFooterAddr { margin-top: 4px; font-size: 11px; color: #3a4a5a; }
      .billGoogleLine { margin-top: 6px; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 11px; color: #3a4a5a; }
      .billGoogleIcon { display: inline-flex; }
    </style></head><body>${html}<script>
      window.onload=function(){
        try { window.print(); }
        catch(e){ document.body.insertAdjacentHTML('afterbegin','<p style="color:red;font-family:sans-serif">Printer connected nahi hai ya print block ho gaya.</p>'); }
      };
    </script></body></html>`);
        w.document.close();
        toast('Print layout open — printer select karein');
    });
}


window.editP = editP;
window.openPatientProfile = openPatientProfile;
window.showPatientDetail = showPatientDetail;
window.delP = delP;
window.docP = docP;
window.receiveP = receiveP;
window.pendingP = pendingP;
window.payP = payP;
window.editPay = editPay;
window.delPay = delPay;
window.editMed = editMed;
window.editExpense=editExpense;
window.deleteExpense=deleteExpense;
window.delMed = delMed;
window.openPage = openPage;
window.showPatientDetail = showPatientDetail;
window.viewPatientHistory = viewPatientHistory;
window.openReport = openReport;
window.closeModal = closeModal;
window.forceRefresh = forceRefresh;
window.addEventListener('DOMContentLoaded', setup);