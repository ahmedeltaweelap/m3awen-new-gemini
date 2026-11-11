// js/app.js
import { writeBatch, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { SHARD_REFS, SUPER_ADMIN_PIN_HASH, hashPin, cleanLegalString, JUDICIAL_RANK_BADGES, firestoreDB } from "./firebase-service.js";
import { DEFAULT_MALLAWI_WORD, NOV_2026_ENCYCLOPEDIA, WORKFLOW_STAGES, LEGAL_PRESETS, BND_DETAILS } from "./data.js";

const initialPlatformState = {
    branding: {
        brandTitle: "المُـعَـاوِن",
        brandSub: "مَرجعُك الرقمي المُنظَّم",
        cloudStatusText: "سحابي متصل (تجريبي)",
        brandLogoUrl: "",
        footerInstructions: "التعليمات القضائية للنيابة الإدارية ولجان التأديب والتظلمات - معدلة بالقرارين 517 و518 لسنة 2026 النافذين 14/11/2026",
        aboutMallawiText: DEFAULT_MALLAWI_WORD,
        footerText: "تنظيمٌ يَجمعُ الشتات.. وبحثٌ يختصر الوقت © 2026"
    },
    settings: { inviteCode: "VIP2026" },
    vipTokens: [],
    sectors: ["الكل", "محليات وإدارة هندسية", "تعاقدات ومشتريات ومخازن", "شؤون وظيفية وخدمة مدنية", "صحة وإسعاف", "تضامن وتكافل وكرامة", "تربية وتعليم", "زراعة وأملاك دولة"],
    members: [
        { id: "super_admin", name: "المستشار أحمد الطويل", title: "معاون نيابة إدارية", workplace: "نيابة ملوي", phone: "-", username: "admin", pin: "2441998", pinHash: SUPER_ADMIN_PIN_HASH, role: "super_admin", status: "approved", perms: { add: true, edit: true, delete: true, approve: true, manageUsers: true }, lastSeen: Date.now() }
    ],
    library: [],
    jurisdictions: NOV_2026_ENCYCLOPEDIA,
    defenses: [],
    checklists: [
        { id: "fallback_1", sector: "صحة وإسعاف", title: "تلفيات سيارات الإسعاف والمهمات", docs: ["محضر إثبات حالة السيارة", "تقرير الفحص الفني", "سجل الصيانة الدورية"], witness_q: ["ما سبب وظروف اكتشاف التلف؟", "من السائق المسؤول وقت الواقعة؟"], accused_q: ["ما قولك فيما نسب إليك من إهمال صيانة السيارة؟"], tips: ["تحقق من مواعيد الصيانة الدورية المقررة بلائحة التشغيل."] }
    ],
    forms: [],
    qayds: [],
    pendingContributions: [],
    auditLogs: []
};

let db = JSON.parse(JSON.stringify(initialPlatformState));
let currentUser = null, currentSector = "الكل", currentDefCategory = "الكل", currentCompassCat = "الكل", currentEditorContext = null, basket = [];
let currentWorkflowStage = 1;

function escapeHTML(str) {
    return String(str ?? "").replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function buildShardPayload(shardKey) {
    if (shardKey === 'config') return { branding: db.branding, settings: db.settings, sectors: db.sectors, pendingContributions: db.pendingContributions, auditLogs: db.auditLogs };
    if (shardKey === 'members') return { members: db.members, vipTokens: db.vipTokens };
    return { items: db[shardKey] || [] };
}

function applyShardData(shardKey, data) {
    if (!data) return;
    if (shardKey === 'config') {
        db.branding = { ...initialPlatformState.branding, ...(data.branding || {}) };
        db.settings = { ...initialPlatformState.settings, ...(data.settings || {}) };
        if (Array.isArray(data.sectors) && data.sectors.length) db.sectors = data.sectors;
        db.pendingContributions = data.pendingContributions || [];
        db.auditLogs = data.auditLogs || [];
    } else if (shardKey === 'members') {
        if (Array.isArray(data.members) && data.members.length) db.members = data.members;
        db.vipTokens = data.vipTokens || [];
    } else if (shardKey === 'jurisdictions') {
        db.jurisdictions = (data.items && data.items.length) ? data.items : NOV_2026_ENCYCLOPEDIA;
    } else {
        db[shardKey] = data.items || [];
    }
}

async function persistState(action = null, section = null, details = null) {
    if (action) {
        if (!db.auditLogs) db.auditLogs = [];
        db.auditLogs.unshift({ id: "log_" + Date.now(), time: new Date().toLocaleString('ar-EG'), actor: currentUser ? `${currentUser.name} (${currentUser.title})` : "عضو", action, section: section || "-", details: details || "-" });
        if (db.auditLogs.length > 80) db.auditLogs = db.auditLogs.slice(0, 80);
    }
    localStorage.setItem("moawen_v12_backup", JSON.stringify(db));
    refreshAllUI();
    try {
        const batch = writeBatch(firestoreDB);
        Object.keys(SHARD_REFS).forEach(k => { batch.set(SHARD_REFS[k], buildShardPayload(k)); });
        await batch.commit();
    } catch (e) { console.error("Persist error:", e); }
}

async function sendPresenceHeartbeat() {
    if (!currentUser) return;
    const now = Date.now();
    currentUser.lastSeen = now;
    const idx = db.members.findIndex(m => m.id === currentUser.id);
    if (idx >= 0) db.members[idx].lastSeen = now;
    try { await setDoc(SHARD_REFS.members, { members: db.members, vipTokens: db.vipTokens }); } catch (e) {}
}
setInterval(sendPresenceHeartbeat, 60000);

async function initCloudSync() {
    try {
        const keys = Object.keys(SHARD_REFS);
        const snaps = await Promise.all(keys.map(k => getDoc(SHARD_REFS[k])));
        snaps.forEach((s, idx) => { if (s.exists()) applyShardData(keys[idx], s.data()); });

        keys.forEach(k => {
            onSnapshot(SHARD_REFS[k], (docSnap) => {
                if (docSnap.exists()) {
                    applyShardData(k, docSnap.data());
                    if (k === 'members' && currentUser) {
                        const me = db.members.find(m => m.id === currentUser.id);
                        if (!me || me.status === 'blocked') logoutUser(); else currentUser = me;
                    }
                    refreshAllUI();
                }
            });
        });
        checkSavedSession();
        refreshAllUI();
        sendPresenceHeartbeat();
    } catch (err) {
        const s = localStorage.getItem("moawen_v12_backup");
        if (s) db = JSON.parse(s);
        checkSavedSession();
        refreshAllUI();
    }
}

window.isApprovedMember = function() { return Boolean(currentUser && (currentUser.status === 'approved' || currentUser.role === 'super_admin')); };
window.hasPerm = function(k) {
    if (!isApprovedMember()) return false;
    if (currentUser.role === 'super_admin') return true;
    return Boolean(currentUser.role === 'moderator' && currentUser.perms && currentUser.perms[k]);
};
function checkSavedSession() {
    const id = sessionStorage.getItem("moawen_v12_uid");
    if (!id) return;
    const f = db.members.find(m => m.id === id && (m.status === 'approved' || m.role === 'super_admin'));
    if (f) currentUser = f;
}

// محرك تطبيق الرقع السحابية (Cloud Patch Engine)
window.applyCloudPatch = async function() {
    if (!hasPerm('manageUsers') && currentUser?.role !== 'super_admin') return alert("مخصص لمدير المنصة فقط.");
    const raw = document.getElementById('patchJsonInput')?.value.trim();
    if (!raw) return alert("يرجى لصق كود الرقعة بصيغة JSON أولاً!");
    try {
        const patch = JSON.parse(raw);
        if (!patch.targetShard || !Array.isArray(patch.items)) return alert("تركيب الرقعة غير مكتمل (targetShard أو items مفقود).");
        const shard = patch.targetShard;
        if (!SHARD_REFS[shard]) return alert("الشريحة المستهدفة غير صحيحة!");
        if (patch.mode === "replace") {
            db[shard] = patch.items;
        } else {
            if (!Array.isArray(db[shard])) db[shard] = [];
            patch.items.forEach(newItem => {
                const idx = db[shard].findIndex(x => x.id === newItem.id);
                if (idx >= 0) db[shard][idx] = newItem; else db[shard].unshift(newItem);
            });
        }
        await persistState(`تطبيق رقعة: ${patch.patchTitle || 'تحديث'}`, shard);
        alert(`✅ تم تطبيق الرقعة السحابية بنجاح: ${patch.patchTitle || 'تحديث فوري'}`);
        document.getElementById('patchJsonInput').value = "";
    } catch (e) { alert("خطأ في تنسيق JSON: " + e.message); }
};

window.syncProceduralCompassData = async function() {
    if (!hasPerm('manageUsers') && currentUser?.role !== 'super_admin') return alert("مخصص لمدير المنصة فقط.");
    if (!confirm("تحديث البوصلة والموسوعة إلى طبعة القرارين 517 و518 لسنة 2026 سحابياً؟")) return;
    db.branding.footerInstructions = "التعليمات القضائية للنيابة الإدارية ولجان التأديب والتظلمات - معدلة بالقرارين 517 و518 لسنة 2026 النافذين 14/11/2026";
    db.jurisdictions = NOV_2026_ENCYCLOPEDIA;
    await persistState("تحديث القرارين 517 و518", "البوصلة الإجرائية", "دمج التعديلات");
    alert("✅ تم التحديث سحابياً بنجاح!");
};

// البحث الشامل
window.executeGlobalSearch = function() {
    const q = document.getElementById('globalSearch').value.trim().toLowerCase();
    const sec = document.getElementById('globalSearchResultsSection');
    const cont = document.getElementById('globalSearchResultsContainer');
    if (!q) { sec.classList.add('hidden'); return; }
    document.getElementById('clearSearchBtn')?.classList.remove('hidden');
    const res = [];
    (db.library || []).forEach(b => { if (`${b.title} ${b.author} ${b.description}`.toLowerCase().includes(q)) res.push({ s: "المكتبة", t: b.title, b: b.description }); });
    (db.jurisdictions || []).forEach(j => { if (`${j.title} ${j.content} ${j.category}`.toLowerCase().includes(q)) res.push({ s: "البوصلة الإجرائية", t: j.title, b: j.content }); });
    (db.defenses || []).forEach(d => { if (`${d.title} ${d.response} ${d.category}`.toLowerCase().includes(q)) res.push({ s: d.category, t: d.title, b: isApprovedMember() ? d.response : d.response.substring(0, 90) + "..." }); });
    if (isApprovedMember()) {
        (db.checklists || []).forEach(c => { if (`${c.title} ${(c.docs||[]).join(' ')}`.toLowerCase().includes(q)) res.push({ s: "قوائم التحقيق", t: c.title, b: (c.docs||[]).join(' - ') }); });
        (db.forms || []).forEach(f => { if (`${f.title} ${f.content}`.toLowerCase().includes(q)) res.push({ s: "النماذج", t: f.title, b: f.content }); });
        (db.qayds || []).forEach(qd => { if (`${qd.title} ${qd.wasf} ${qd.articles}`.toLowerCase().includes(q)) res.push({ s: "القيود والأوصاف", t: qd.title, b: `${qd.articles}\n${qd.wasf}` }); });
    }
    document.getElementById('searchCountBadge').innerText = res.length;
    sec.classList.remove('hidden');
    cont.innerHTML = res.length ? res.map((m, i) => `
        <div class="p-3 bg-slate-50 rounded-xl border flex flex-col justify-between">
            <div><span class="bg-judicial-900 text-judicial-gold text-[10px] font-bold px-2 py-0.5 rounded">${m.s}</span><h4 class="font-bold text-judicial-900 text-xs mt-1.5">${cleanLegalString(m.t)}</h4><p id="srch-${i}" class="text-xs text-slate-700 mt-1 whitespace-pre-line">${cleanLegalString(m.b)}</p></div>
            <div class="mt-2 pt-2 border-t flex justify-end gap-2"><button type="button" onclick="copyText('srch-${i}')" class="bg-judicial-900 text-white px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer">نسخ</button><button type="button" onclick="addToBasket('${m.t}', document.getElementById('srch-${i}').innerText)" class="bg-judicial-gold text-judicial-950 px-2.5 py-1 rounded text-[10px] font-extrabold cursor-pointer">+ للمسودة</button></div>
        </div>`).join('') : `<div class="col-span-2 text-center py-6 text-xs text-slate-400">لا توجد نتائج مطابقة.</div>`;
};
window.clearGlobalSearch = function() {
    document.getElementById('globalSearch').value = "";
    document.getElementById('clearSearchBtn')?.classList.add('hidden');
    document.getElementById('globalSearchResultsSection').classList.add('hidden');
};

// البوصلة الإجرائية
window.switchStageStep = function(stepNum) {
    currentWorkflowStage = stepNum;
    document.querySelectorAll('.stage-step').forEach(b => {
        b.className = "stage-step py-2 px-2 rounded-lg border border-slate-200 transition cursor-pointer flex flex-col items-center gap-1 bg-slate-50";
    });
    const activeBtn = document.getElementById('stageBtn-' + stepNum);
    if (activeBtn) activeBtn.className = "stage-step stage-step-active py-2 px-2 rounded-lg border border-slate-200 transition cursor-pointer flex flex-col items-center gap-1";
    renderCurrentStage();
};

function renderCurrentStage() {
    const panel = document.getElementById('stageContentPanel');
    if (!panel) return;
    const s = WORKFLOW_STAGES[currentWorkflowStage];
    panel.innerHTML = `
        <div class="space-y-4">
            <div class="border-b pb-2 flex flex-wrap justify-between items-center gap-2">
                <h3 class="font-bold text-judicial-900 text-sm flex items-center gap-2"><span class="w-6 h-6 rounded-full bg-judicial-900 text-judicial-gold flex items-center justify-center text-xs font-bold">${currentWorkflowStage}</span>${s.title}</h3>
                <span class="text-[11px] text-slate-400 font-bold">طبعة القرارين 517 و518 لسنة 2026</span>
            </div>
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
                <div class="lg:col-span-5 bg-amber-50/60 border border-judicial-gold/40 rounded-xl p-3.5 space-y-2.5">
                    <h4 class="font-bold text-judicial-900 text-xs border-b border-judicial-gold/30 pb-1">الضوابط والواجبات الإلزامية للمحقق:</h4>
                    <div class="space-y-2 text-xs leading-relaxed text-slate-800">${s.goldenRules.map(r => `<div class="flex items-start gap-2 bg-white/80 p-2 rounded-lg border border-slate-200"><i class="fa-solid fa-circle-check text-emerald-600 text-xs mt-0.5"></i><span>${cleanLegalString(r)}</span></div>`).join('')}</div>
                </div>
                <div class="lg:col-span-7 bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-col justify-between space-y-3">
                    <div class="space-y-2"><h4 class="font-bold text-judicial-900 text-xs border-b pb-1">${s.toolTitle}</h4><div class="space-y-1.5">${s.toolOptions.map(opt => `<div class="p-2.5 bg-white rounded-lg border text-xs"><strong class="text-judicial-900 block mb-0.5">${opt.label}</strong><p class="text-slate-600 text-[11px]">${cleanLegalString(opt.desc)}</p></div>`).join('')}</div></div>
                    <div class="bg-judicial-900 text-white p-3 rounded-xl border border-judicial-gold/60 space-y-1.5">
                        <div class="flex justify-between items-center border-b border-slate-700 pb-1"><span class="text-[11px] font-bold text-judicial-gold">${s.copySnippetTitle}</span><button type="button" onclick="copySnippetText('snip-${currentWorkflowStage}')" class="bg-judicial-gold text-judicial-950 font-extrabold px-2.5 py-0.5 rounded text-[10px] cursor-pointer">نسخ الصيغة</button></div>
                        <p id="snip-${currentWorkflowStage}" class="font-serif text-xs leading-relaxed text-slate-200 whitespace-pre-line">${cleanLegalString(s.copySnippet)}</p>
                    </div>
                </div>
            </div>
        </div>`;
}
window.copySnippetText = id => { const t = document.getElementById(id)?.innerText || ""; if (t) { navigator.clipboard.writeText(t); alert("تم نسخ الصيغة الرسمية!"); } };

window.filterCompassEncyclopedia = function(cat) {
    currentCompassCat = cat;
    document.querySelectorAll('.compass-subtab').forEach(b => {
        b.className = b.getAttribute('data-compcat') === cat ? "compass-subtab compass-tab-active px-2 py-1 rounded text-xs border cursor-pointer" : "compass-subtab bg-slate-50 px-2 py-1 rounded text-xs border cursor-pointer";
    });
    renderCompassEncyclopedia();
};

function renderCompassEncyclopedia() {
    const cont = document.getElementById('compassEncyclopediaContainer');
    if (!cont) return;
    let list = db.jurisdictions || NOV_2026_ENCYCLOPEDIA;
    if (currentCompassCat !== "الكل") list = list.filter(x => x.category === currentCompassCat);
    const app = isApprovedMember(), ce = hasPerm('edit'), cd = hasPerm('delete');
    cont.innerHTML = list.length ? list.map((item, i) => `
        <div class="p-3 bg-slate-50 border rounded-xl flex flex-col justify-between">
            <div>
                <div class="flex justify-between items-center mb-1">
                    <span class="bg-judicial-900 text-judicial-gold text-[10px] font-bold px-2 py-0.5 rounded">${item.category}</span>
                    <div class="flex gap-1">${ce ? `<button type="button" onclick="openItemEditor('jurisdiction','${item.id}')" class="text-amber-700 px-1 text-xs cursor-pointer"><i class="fa-solid fa-pen"></i></button>` : ''}${cd ? `<button type="button" onclick="deleteItem('jurisdiction','${item.id}')" class="text-red-600 px-1 text-xs cursor-pointer"><i class="fa-solid fa-trash"></i></button>` : ''}</div>
                </div>
                <h4 class="font-bold text-judicial-900 text-xs mb-1">${cleanLegalString(item.title)}</h4>
                ${app ? `<p id="enc-text-${i}" class="text-xs text-slate-700 leading-relaxed whitespace-pre-line">${cleanLegalString(item.content)}</p>` : `<div class="relative bg-white p-2 rounded border"><p class="text-xs text-slate-700">${cleanLegalString(item.content).substring(0, 60)}... <span class="teaser-blur">${cleanLegalString(item.content).substring(60)}</span></p><div class="mt-2 pt-1 border-t flex justify-between items-center text-[10px]"><span class="text-amber-800 font-bold">🔒 مخصص للأعضاء المعتمدين</span><button type="button" onclick="openMemberAuthModal()" class="bg-judicial-900 text-judicial-gold px-2 py-0.5 rounded font-bold cursor-pointer">سجل دخولك</button></div></div>`}
            </div>
            ${app ? `<div class="mt-2 pt-1.5 border-t flex justify-between items-center text-[10px]"><span class="text-slate-500 font-mono">${cleanLegalString(item.ref)}</span><div class="flex gap-1.5"><button type="button" onclick="copyText('enc-text-${i}')" class="bg-judicial-900 text-white px-2 py-0.5 rounded cursor-pointer font-bold">نسخ</button><button type="button" onclick="addToBasket('${item.title}', document.getElementById('enc-text-${i}').innerText)" class="bg-judicial-gold text-judicial-950 px-2 py-0.5 rounded cursor-pointer font-extrabold">+ للمسودة</button></div></div>` : ''}
        </div>`).join('') : `<div class="col-span-2 text-center py-6 text-xs text-slate-400">لا توجد بطاقات في هذا التصنيف.</div>`;
}

// مولد القيود والأوصاف
window.handleLegalCategoryChange = function() {
    const cat = document.getElementById('qayd_legal_category').value;
    document.getElementById('bndItemsContainer')?.parentElement?.classList.toggle('hidden', cat !== 'civil_81');
    composeSmartQayd();
};
window.uncheckAllBnds = function() { document.querySelectorAll('.chk-bnd').forEach(el => el.checked = false); composeSmartQayd(); };

window.composeSmartQayd = function() {
    const catKey = document.getElementById('qayd_legal_category').value;
    const mode = document.getElementById('qayd_action_mode').value;
    const name = document.getElementById('q_name').value.trim() || "[اسم المخالف ووظيفته]";
    const nid = document.getElementById('q_nid').value.trim() || "[الرقم القومي]";
    const date = document.getElementById('q_date').value.trim() || "[الفترة الزمنية]";
    const workplace = document.getElementById('q_workplace').value.trim() || "[جهة ومقر العمل]";
    const fact = document.getElementById('q_fact').value.trim() || "[الأفعال المادية المسندة للمتهم تفصيلاً]";

    document.getElementById('courtOptionsBox')?.classList.toggle('hidden', mode !== 'ihala');
    const preset = LEGAL_PRESETS[catKey] || LEGAL_PRESETS['civil_81'];
    const checkedBnds = Array.from(document.querySelectorAll('.chk-bnd:checked')).map(el => el.value);
    let bndArticles = [], bndDescs = [], bndTaakeef = [];
    checkedBnds.forEach(b => { if (BND_DETAILS[b]) { bndArticles.push(BND_DETAILS[b].art); bndDescs.push(BND_DETAILS[b].desc); bndTaakeef.push(BND_DETAILS[b].taakeef); } });

    let taakeefText = "";
    if (mode === 'majaza' || mode === 'ihala' || mode === 'hifz_ahamia') {
        const taakeefJoint = bndTaakeef.length ? bndTaakeef.join('، و') : "لعدم أدائه العمل المنوط به بدقة وأمانة";
        taakeefText = `ومن ثم يكون المذكور قد ارتكب ذنباً تأديبياً قوامه مخالفته أحكام ${preset.title}، ${taakeefJoint} بالمخالفة لأحكام المادة ${preset.baseArticles}${bndArticles.length ? ' والمواد (' + bndArticles.join('، ') + ')' : ''}، وهو ما يُعد منه خروجاً على مقتضى الواجب الوظيفي يستوجب مساءلته تأديبياً طبقاً لحكم القانون.`;
    } else if (mode === 'hifz_saha') {
        taakeefText = `وحيث إنه عما نُسب إلى المشكو في حقه سالف البيان، ولما كانت الأوراق قد خلت من أي دليل يساند الاتهام، وثبت عدم صحة ما أثير قبله، الأمر الذي نرى معه التقرير بحفظ الأوراق إدارياً (قطعياً لعدم الصحة) عملاً بالمادة 208 مكرراً بند 1 من التعليمات القضائية.`;
    } else if (mode === 'hifz_mukhalafa') {
        taakeefText = `وحيث إنه بشأن ما أثير قبل المشكو في حقه، وإذ ثبت أن تصرفه قد جاء متفقاً وصحيح حكم القانون واللوائح المنظمة، وتجرد فعله من وصف المخالفة التأديبية، لذا نرى حفظ الأوراق إدارياً (قطعياً لعدم المخالفة) عملاً بالمادة 208 مكرراً بند 2 من التعليمات القضائية.`;
    } else {
        taakeefText = `وحيث إنه إزاء عدم كفاية الأدلة القائمة بالأوراق أو شيوع الاتهام، تعين الوقوف بالإجراءات وحفظ الأوراق إدارياً مؤقتاً بحالتها عملاً بالمادة 208 من التعليمات القضائية.`;
    }

    let fullQayd = "";
    if (mode === 'majaza') {
        const arts = `بالمواد: 57/الفقرة الأولى، و58/الفقرة الأولى، و60، و61، و62/3 من قانون الخدمة المدنية رقم 81 لسنة 2016${bndArticles.length ? '، والمادتين (' + bndArticles.join('، ') + ') من لائحته التنفيذية' : ''}`;
        fullQayd = `لـــــــــذلـــــــــك نـــــــــرى:\nأولاً: قيد الواقعة مخالفة إدارية ومالية ${arts}، ضــــد:\n- ${name} — (الرقم القومي: ${nid})\n\nلأنه في غضون ${date}، وبوصفه السابق، وبمقر عمله ${workplace}:\n${bndDescs.length ? bndDescs.join('، و') : preset.generalIntro} بأن:\n${fact} — وذلك على النحو الموضح تفصيلاً بالأوراق.\n\nثانياً: مجازاة المخالف المذكور تأديبياً.`;
    } else if (mode === 'ihala') {
        const selRadio = document.querySelector('input[name="nihala_art"]:checked')?.value || 'art14';
        let nihalaArtText = selRadio === 'art12_2' ? "المادة 12/2 من القانون 117 لسنة 1958" : "المادة 14 من القانون 117 لسنة 1958";
        const isRet = document.getElementById('chk_retired')?.checked;
        let retiredArts = isRet ? "، والمادتين 20 و21 من قانون مجلس الدولة رقم 47 لسنة 1972" : "";
        const arts = `بالمواد: 57/1، و58/1، و61، و62/4 من قانون الخدمة المدنية رقم 81 لسنة 2016${bndArticles.length ? '، والمادتين (' + bndArticles.join('، ') + ') من لائحته التنفيذية' : ''}، و${nihalaArtText}، والمادتين 15/أولاً، و19/1${retiredArts} من قانون مجلس الدولة رقم 47 لسنة 1972`;
        fullQayd = `لـــــــــذلـــــــــك نـــــــــرى:\nأولاً: قيد الواقعة مخالفة إدارية ومالية ${arts}، ضــــد:\n- ${name}${isRet ? ' (حالياً بالمعاش)' : ''} — (الرقم القومي: ${nid})\n\nلأنه في غضون ${date}، وبوصفه السابق، وبمقر عمله ${workplace}:\n${bndDescs.length ? bndDescs.join('، و') : preset.generalIntro} بأن:\n${fact} — وذلك على النحو الموضح بالأوراق.\n\nثانياً: إحالة المخالف المذكور إلى المحكمة التأديبية المختصة.`;
    } else if (mode === 'hifz_ahamia') {
        fullQayd = `لـــــــــذلـــــــــك نـــــــــرى:\nأولاً: قيد الواقعة مخالفة إدارية بنصوص المادتين 57/1، و58/1 من قانون الخدمة المدنية رقم 81 لسنة 2016، ضــــد:\n- ${name} — (الرقم القومي: ${nid})\n\nلأنه في غضون ${date}، وبوصفه سالف البيان:\n${preset.generalIntro} بأن:\n${fact}\n\nثانياً: حفظ ما نُسب إلى المخالف المذكور قطعياً لعدم الأهمية.`;
    } else {
        fullQayd = `لـــــــــذلـــــــــك نـــــــــرى:\nحفظ الأوراق إدارياً، دون قيد أو وصف عملاً بأحكام المادتين 208 و214 من التعليمات القضائية.`;
    }

    document.getElementById('qaydTaakeefBox').innerText = cleanLegalString(taakeefText);
    document.getElementById('qaydFullOutputBox').innerText = cleanLegalString(fullQayd);
};

window.copyCombinedQayd = function() {
    navigator.clipboard.writeText(`[أولاً: التكييف في ختام الأسباب]:\n${document.getElementById('qaydTaakeefBox').innerText}\n\n==========================\n\n[ثانياً: القيد والوصف والتصرف]:\n${document.getElementById('qaydFullOutputBox').innerText}`);
    alert("تم نسخ التكييف والقيد معاً!");
};

window.saveDirectEditedQaydTemplate = async function() {
    if (!hasPerm('add')) return alert("لا تملك صلاحية الإضافة!");
    const title = prompt("اكتب اسماً للقالب الجديد لحفظه سحابياً:");
    if (!title || !title.trim()) return;
    if (!db.qayds) db.qayds = [];
    db.qayds.unshift({ id: "q_" + Date.now(), sector: document.getElementById('qayd_legal_category').value, title: title.trim(), wasf: document.getElementById('qaydFullOutputBox').innerText, articles: document.getElementById('qaydTaakeefBox').innerText });
    await persistState("إضافة قالب قيد", "القوالب", title.trim());
    renderSavedQaydTemplatesDropdown();
    alert("✅ تم حفظ القالب سحابياً بنجاح!");
};

function renderSavedQaydTemplatesDropdown() {
    const sel = document.getElementById('savedQaydTemplatesSelect');
    if (!sel) return;
    const list = db.qayds || [];
    sel.innerHTML = `<option value="">القوالب المحفوظة (${list.length})...</option>` + list.map(q => `<option value="${q.id}">${q.title}</option>`).join('');
}
window.loadSavedQaydTemplate = function(id) {
    if (!id) return;
    const q = (db.qayds || []).find(x => x.id === id);
    if (!q) return;
    document.getElementById('qaydTaakeefBox').innerText = cleanLegalString(q.articles);
    document.getElementById('qaydFullOutputBox').innerText = cleanLegalString(q.wasf);
};
window.deleteCurrentQayd = async function() {
    if (!hasPerm('delete')) return alert("لا تملك صلاحية الحذف!");
    const id = document.getElementById('savedQaydTemplatesSelect')?.value;
    if (!id || !confirm("هل أنت متأكد من حذف هذا القالب؟")) return;
    db.qayds = (db.qayds || []).filter(q => q.id !== id);
    await persistState("حذف قالب", "القوالب", id);
    renderSavedQaydTemplatesDropdown();
};

// المكتبة، الحيثيات، القوائم، والنماذج
window.renderLibrarySection = function() {
    const cat = document.getElementById('libCategoryFilter')?.value || "الكل";
    let list = db.library || []; if (cat !== "الكل") list = list.filter(b => b.category === cat);
    const ce = hasPerm('edit'), cd = hasPerm('delete');
    document.getElementById('libraryContainer').innerHTML = list.length ? list.map(b => `
        <div class="bg-white rounded-xl shadow-sm border p-3.5 flex flex-col justify-between">
            <div>
                <div class="flex justify-between items-start mb-1.5"><span class="bg-judicial-900 text-judicial-gold text-[10px] font-bold px-2 py-0.5 rounded">${b.category}</span><div class="flex gap-1">${ce ? `<button type="button" onclick="openItemEditor('library','${b.id}')" class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-xs cursor-pointer"><i class="fa-solid fa-pen"></i></button>` : ''}${cd ? `<button type="button" onclick="deleteItem('library','${b.id}')" class="bg-red-100 text-red-600 px-2 py-0.5 rounded text-xs cursor-pointer"><i class="fa-solid fa-trash"></i></button>` : ''}</div></div>
                <h3 class="font-bold text-judicial-900 text-sm mb-1">${cleanLegalString(b.title)}</h3>
                <div class="bg-amber-50 border border-judicial-gold/30 rounded p-1.5 mb-1.5 text-[11px] font-bold text-judicial-900">${cleanLegalString(b.author)}</div>
                <p class="text-xs text-slate-600 mb-2 leading-relaxed">${cleanLegalString(b.description)}</p>
            </div>
            <div class="pt-2 border-t flex justify-between items-center text-xs"><span class="text-[10px] text-slate-400 font-bold">${b.sector}</span>${b.driveUrl ? `<button type="button" onclick="openPdfViewer('${b.id}')" class="bg-judicial-900 text-judicial-gold font-bold px-3 py-1 rounded cursor-pointer">تصفح 📖</button>` : `<button type="button" onclick="addToBasket('${b.title}', \`${b.description}\`)" class="bg-slate-100 text-slate-700 font-bold px-2.5 py-1 rounded cursor-pointer">+ مسودة</button>`}</div>
        </div>`).join('') : `<div class="col-span-3 bg-white p-6 rounded-xl text-center text-slate-400 text-xs">أضف الكتب والملفات أو استرد النسخة الاحتياطية من لوحة الإدارة.</div>`;
};

function extractDriveFileId(url) { if (!url) return null; const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/); return m ? m[1] : null; }
window.openPdfViewer = function(id) {
    const b = db.library.find(x => x.id === id); if (!b) return;
    const fid = extractDriveFileId(b.driveUrl); if (!fid) return alert("يرجى إدراج رابط Google Drive صالح.");
    document.getElementById('pdfViewerTitle').innerText = cleanLegalString(b.title);
    document.getElementById('pdfIframe').src = `https://drive.google.com/file/d/${fid}/preview`;
    document.getElementById('pdfViewerModal').classList.remove('hidden');
};
window.closePdfViewer = () => { document.getElementById('pdfIframe').src = ""; document.getElementById('pdfViewerModal').classList.add('hidden'); };

window.selectDefenseCategory = function(cat) {
    currentDefCategory = cat;
    document.querySelectorAll('.def-subtab').forEach(b => {
        b.className = b.getAttribute('data-defcat') === cat ? "def-subtab def-subtab-active px-3 py-1 rounded text-xs font-bold whitespace-nowrap cursor-pointer" : "def-subtab bg-slate-100 text-slate-700 px-3 py-1 rounded text-xs font-bold whitespace-nowrap cursor-pointer";
    });
    renderDefensesSection();
};

function buildDefCard(d, idx, app, ce, cd) {
    return `
        <div class="bg-white p-3.5 rounded-xl shadow-sm border">
            <div class="flex justify-between items-start mb-2 border-b pb-1.5">
                <div class="flex items-center gap-1.5 flex-wrap"><span class="bg-judicial-900 text-judicial-gold text-[10px] font-bold px-2 py-0.5 rounded">${d.category}</span><span class="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded">${d.sector}</span><h3 class="font-bold text-judicial-900 text-xs md:text-sm">${cleanLegalString(d.title)}</h3></div>
                <div class="flex gap-1">${ce ? `<button type="button" onclick="openItemEditor('defense','${d.id}')" class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-xs cursor-pointer"><i class="fa-solid fa-pen"></i></button>` : ''}${cd ? `<button type="button" onclick="deleteItem('defense','${d.id}')" class="bg-red-100 text-red-600 px-2 py-0.5 rounded text-xs cursor-pointer"><i class="fa-solid fa-trash"></i></button>` : ''}</div>
            </div>
            ${app ? `<p id="def-text-${idx}" class="text-slate-800 font-serif text-base leading-relaxed bg-slate-50 p-3 rounded-lg border mb-2 whitespace-pre-line">${cleanLegalString(d.response)}</p><div class="flex justify-between items-center text-xs text-slate-500"><span>السند: ${cleanLegalString(d.ref)}</span><div class="flex gap-1.5"><button type="button" onclick="copyText('def-text-${idx}')" class="bg-judicial-900 text-white px-2.5 py-1 rounded text-xs font-bold cursor-pointer">نسخ</button><button type="button" onclick="addToBasket('${d.title}', document.getElementById('def-text-${idx}').innerText)" class="bg-judicial-gold text-judicial-950 px-2.5 py-1 rounded text-xs font-extrabold cursor-pointer">+ للمسودة</button></div></div>` : `<div class="bg-slate-50 p-3 rounded-lg border"><p class="text-slate-800 font-serif text-base">${cleanLegalString(d.response).substring(0, 75)}... <span class="teaser-blur">${cleanLegalString(d.response).substring(75)}</span></p><div class="mt-2 pt-2 border-t flex justify-between items-center"><span class="text-[11px] text-amber-800 font-bold">🔒 مقيد للسادة الأعضاء</span><button type="button" onclick="openMemberAuthModal()" class="bg-judicial-900 text-judicial-gold font-bold px-3 py-1 rounded text-xs cursor-pointer">سجل دخولك 🔓</button></div></div>`}
        </div>`;
}

window.renderDefensesSection = function() {
    const list = db.defenses || [], app = isApprovedMember(), ce = hasPerm('edit'), cd = hasPerm('delete'), cont = document.getElementById('defensesContainer');
    if (currentDefCategory !== "الكل") {
        const flt = list.filter(d => d.category === currentDefCategory || (currentDefCategory === 'حيثيات الحفظ القطعي' && d.category === 'حيثيات الحفظ القطعي والمؤقت'));
        cont.innerHTML = flt.length ? flt.map((d, i) => buildDefCard(d, i, app, ce, cd)).join('') : `<div class="bg-white p-6 rounded-xl text-center text-slate-400 text-xs">لا توجد حيثيات مضافة في هذا التصنيف بعد.</div>`;
        return;
    }
    cont.innerHTML = list.length ? list.map((d, i) => buildDefCard(d, i, app, ce, cd)).join('') : `<div class="bg-white p-6 rounded-xl text-center text-slate-400 text-xs">أضف الحيثيات أو استرد النسخة الاحتياطية من لوحة الإدارة.</div>`;
};

window.selectSector = s => { currentSector = s; renderChecklistsSection(); };
window.renderChecklistsSection = function() {
    const bar = document.getElementById('sectorsBar');
    if (bar) bar.innerHTML = (db.sectors || []).map(s => `<button type="button" onclick="selectSector('${s}')" class="px-3 py-1 rounded-full text-xs border whitespace-nowrap cursor-pointer ${currentSector === s ? 'sector-active' : 'bg-slate-100 text-slate-700'}">${s}</button>`).join('');
    const allChecklists = db.checklists || [];
    const list = currentSector === "الكل" ? allChecklists : allChecklists.filter(c => c.sector === currentSector);
    const sel = document.getElementById('checklistSelector'), prev = sel.value;
    sel.innerHTML = list.length ? list.map(c => `<option value="${c.id}">[${c.sector}] ${c.title}</option>`).join('') : `<option value="">لا توجد قوائم في هذا القطاع</option>`;
    if (list.some(c => c.id === prev)) sel.value = prev;
    renderSelectedChecklist();
};

window.renderSelectedChecklist = function() {
    const data = (db.checklists || []).find(c => c.id === document.getElementById('checklistSelector').value);
    const cont = document.getElementById('checklistContainer');
    if (!data) { cont.innerHTML = `<div class="col-span-2 bg-white p-6 rounded-xl text-center text-slate-400 text-xs">لا توجد قوائم في هذا القطاع.</div>`; return; }
    cont.innerHTML = `
        <div class="bg-white p-3.5 rounded-xl shadow-sm border-t-4 border-judicial-900"><h3 class="font-bold text-xs mb-2">أولاً: المستندات المطلوبة:</h3><div class="space-y-1.5">${(data.docs||[]).map(d => `<label class="flex items-start gap-2 text-xs"><input type="checkbox" class="chk-item mt-0.5"><span>${d}</span></label>`).join('')}</div></div>
        <div class="bg-white p-3.5 rounded-xl shadow-sm border-t-4 border-blue-700"><h3 class="font-bold text-xs mb-2">ثانياً: أسئلة الشهود:</h3><div class="space-y-1.5">${(data.witness_q||[]).map(q => `<label class="flex items-start gap-2 text-xs font-semibold"><input type="checkbox" class="chk-item mt-0.5"><span>"${q}"</span></label>`).join('')}</div></div>
        <div class="bg-white p-3.5 rounded-xl shadow-sm border-t-4 border-red-700"><h3 class="font-bold text-xs mb-2">ثالثاً: أسئلة المواجهة:</h3><div class="space-y-1.5">${(data.accused_q||[]).map(q => `<label class="flex items-start gap-2 text-xs font-semibold"><input type="checkbox" class="chk-item mt-0.5"><span>"${q}"</span></label>`).join('')}</div></div>
        <div class="bg-amber-50 p-3.5 rounded-xl shadow-sm border-t-4 border-judicial-gold"><h3 class="font-bold text-xs mb-2">رابعاً: ضوابط فنية وملاحظات:</h3><ul class="space-y-1 list-disc list-inside text-xs">${(data.tips||[]).map(t => `<li class="p-1 bg-white rounded border">${t}</li>`).join('')}</ul></div>`;
};
window.deleteCurrentChecklist = async () => { if (!hasPerm('delete')) return; const id = document.getElementById('checklistSelector').value; if (id && confirm("حذف القائمة؟")) { db.checklists = db.checklists.filter(c => c.id !== id); await persistState("حذف", "قوائم التحقيق", id); } };

window.openSectorManagerModal = () => {
    const cont = document.getElementById('sectorsManageList');
    if (cont) cont.innerHTML = db.sectors.map((s, idx) => `<div class="flex justify-between p-1.5 border rounded"><span>${s}</span>${idx > 0 ? `<button onclick="deleteSector(${idx})" class="text-red-600 font-bold">حذف</button>` : ''}</div>`).join('');
    toggleModal('sectorManagerModal');
};
window.addNewSector = async () => { const v = document.getElementById('newSectorInput').value.trim(); if (v && !db.sectors.includes(v)) { db.sectors.push(v); document.getElementById('newSectorInput').value = ""; await persistState("إضافة قطاع", "القطاعات", v); openSectorManagerModal(); } };
window.deleteSector = async idx => { db.sectors.splice(idx, 1); await persistState("حذف قطاع", "القطاعات"); openSectorManagerModal(); };

window.renderFormsSection = function() {
    const cat = document.getElementById('formCategoryFilter')?.value || "الكل";
    let list = db.forms || []; if (cat !== "الكل") list = list.filter(f => f.category === cat);
    const ce = hasPerm('edit'), cd = hasPerm('delete');
    document.getElementById('formsContainer').innerHTML = list.length ? list.map(f => `
        <div class="bg-white p-3.5 rounded-xl shadow-sm border flex flex-col justify-between">
            <div><div class="flex justify-between items-start mb-1.5 border-b pb-1"><span class="bg-judicial-900 text-judicial-gold text-[10px] font-bold px-2 py-0.5 rounded">${f.category || 'نموذج'}</span><div class="flex gap-1">${ce ? `<button type="button" onclick="openItemEditor('form','${f.id}')" class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-xs cursor-pointer"><i class="fa-solid fa-pen"></i></button>` : ''}${cd ? `<button type="button" onclick="deleteItem('form','${f.id}')" class="bg-red-100 text-red-600 px-2 py-0.5 rounded text-xs cursor-pointer"><i class="fa-solid fa-trash"></i></button>` : ''}</div></div><h3 class="font-bold text-judicial-900 text-xs md:text-sm mb-1">${cleanLegalString(f.title)}</h3><p id="form-txt-${f.id}" class="text-xs text-slate-800 font-serif text-base bg-slate-50 p-2.5 rounded border whitespace-pre-line">${cleanLegalString(f.content)}</p></div>
            <div class="mt-2 pt-2 border-t flex justify-end gap-1.5"><button type="button" onclick="copyText('form-txt-${f.id}')" class="bg-judicial-900 text-white px-2.5 py-1 rounded text-xs font-bold cursor-pointer">نسخ</button><button type="button" onclick="addToBasket('${f.title}', document.getElementById('form-txt-${f.id}').innerText)" class="bg-judicial-gold text-judicial-950 px-2.5 py-1 rounded text-xs font-extrabold cursor-pointer">+ للمسودة</button></div>
        </div>`).join('') : `<div class="col-span-2 bg-white p-6 rounded-xl text-center text-slate-400 text-xs">أضف النماذج أو استرد النسخة الاحتياطية من لوحة الإدارة.</div>`;
};

// محرر العناصر الشامل
window.openItemEditor = function(type, editId = null) {
    if (editId && !hasPerm('edit')) return alert("لا تملك صلاحية التعديل!");
    if (!editId && !hasPerm('add')) return alert("لا تملك صلاحية الإضافة!");
    currentEditorContext = { type, editId };
    const titleEl = document.getElementById('editorModalTitle'), bodyEl = document.getElementById('editorModalBody'), sectorOptions = (db.sectors || []).map(s => `<option value="${s}">${s}</option>`).join('');

    if (type === 'library') {
        const item = editId ? db.library.find(b => b.id === editId) : { sector: currentSector, category: "مؤلفات السادة المستشارين", title: "", author: "", description: "", driveUrl: "" };
        titleEl.innerText = "كتاب / ملف Google Drive";
        bodyEl.innerHTML = `<div class="grid grid-cols-2 gap-2"><div>القطاع:<select id="ed_sector" class="w-full border rounded p-1.5">${sectorOptions}</select></div><div>التصنيف:<select id="ed_category" class="w-full border rounded p-1.5"><option value="مؤلفات السادة المستشارين">مؤلفات السادة المستشارين</option><option value="كتب دورية ومنشورات">كتب دورية ومنشورات</option><option value="تشريعات ولوائح PDF">تشريعات ولوائح PDF</option></select></div></div><div>العنوان:<input type="text" id="ed_title" value="${item.title}" class="w-full border rounded p-1.5"></div><div>المؤلف:<input type="text" id="ed_author" value="${item.author}" class="w-full border rounded p-1.5"></div><div>الملخص:<textarea id="ed_desc" rows="3" class="w-full border rounded p-1.5">${item.description}</textarea></div><div>رابط Google Drive:<input type="url" id="ed_drive" value="${item.driveUrl || ''}" class="w-full border rounded p-1.5 font-mono"></div>`;
        document.getElementById('ed_sector').value = item.sector; document.getElementById('ed_category').value = item.category;
    } else if (type === 'jurisdiction') {
        const item = editId ? db.jurisdictions.find(j => j.id === editId) : { category: "الاختصاص والطلب", title: "", content: "", ref: "" };
        titleEl.innerText = "قاعدة بالبوصلة والموسوعة";
        bodyEl.innerHTML = `<div>التصنيف:<select id="ed_category" class="w-full border rounded p-1.5 font-bold"><option value="الاختصاص والطلب">الاختصاص والطلب</option><option value="ضوابط التحقيق">التحقيق والإعلان</option><option value="أوجه التصرف">عوارض وتصرفات</option><option value="الكتب والقرارات 2026">قرارات 2026</option><option value="مبادئ الإدارية العليا">المبادئ</option></select></div><div>العنوان:<input type="text" id="ed_title" value="${item.title}" class="w-full border rounded p-1.5"></div><div>النص:<textarea id="ed_content" rows="4" class="w-full border rounded p-1.5">${item.content}</textarea></div><div>السند:<input type="text" id="ed_ref" value="${item.ref}" class="w-full border rounded p-1.5"></div>`;
        document.getElementById('ed_category').value = item.category;
    } else if (type === 'defense') {
        const item = editId ? db.defenses.find(d => d.id === editId) : { sector: currentSector, category: "حيثيات الحفظ القطعي", title: "", response: "", ref: "", contributor: currentUser?.name || "إدارة المنصة" };
        titleEl.innerText = "حيثية / رد على دفع";
        bodyEl.innerHTML = `<div class="grid grid-cols-3 gap-2"><div>القطاع:<select id="ed_sector" class="w-full border rounded p-1.5">${sectorOptions}</select></div><div>التصنيف:<select id="ed_category" class="w-full border rounded p-1.5"><option value="حيثيات الحفظ القطعي">الحفظ القطعي</option><option value="حيثيات الحفظ المؤقت">الحفظ المؤقت</option><option value="حيثيات الإجراءات والاختصاص">الإجراءات والاختصاص</option><option value="حيثيات الثبوت والرد على الدفوع">الثبوت والرد</option></select></div><div>المساهم:<input type="text" id="ed_contrib" value="${item.contributor}" class="w-full border rounded p-1.5"></div></div><div>العنوان:<input type="text" id="ed_title" value="${item.title}" class="w-full border rounded p-1.5"></div><div>النص:<textarea id="ed_response" rows="5" class="w-full border rounded p-1.5">${item.response}</textarea></div><div>السند:<input type="text" id="ed_ref" value="${item.ref}" class="w-full border rounded p-1.5"></div>`;
        document.getElementById('ed_sector').value = item.sector; document.getElementById('ed_category').value = item.category;
    } else if (type === 'checklist') {
        const item = editId ? ((db.checklists||[]).find(c => c.id === editId) || { sector: "الكل", title: "", docs: [], witness_q: [], accused_q: [], tips: [] }) : { sector: "الكل", title: "", docs: [], witness_q: [], accused_q: [], tips: [] };
        titleEl.innerText = "قائمة فحص وتحقيق";
        bodyEl.innerHTML = `<div>القطاع:<select id="ed_sector" class="w-full border rounded p-1.5 font-bold">${sectorOptions}</select></div><div>العنوان:<input type="text" id="ed_title" value="${item.title}" class="w-full border rounded p-1.5"></div><div>المستندات (سطر لكل مستند):<textarea id="ed_docs" rows="2" class="w-full border rounded p-1.5">${(item.docs||[]).join('\n')}</textarea></div><div>أسئلة الشهود:<textarea id="ed_witness" rows="2" class="w-full border rounded p-1.5">${(item.witness_q||[]).join('\n')}</textarea></div><div>أسئلة المواجهة:<textarea id="ed_accused" rows="2" class="w-full border rounded p-1.5">${(item.accused_q||[]).join('\n')}</textarea></div><div>ضوابط فنية:<textarea id="ed_tips" rows="2" class="w-full border rounded p-1.5">${(item.tips||[]).join('\n')}</textarea></div>`;
        document.getElementById('ed_sector').value = item.sector;
    } else if (type === 'form') {
        const item = editId ? db.forms.find(f => f.id === editId) : { sector: "الكل", category: "ديباجات محاضر التحقيق والاطلاع", title: "", content: "" };
        titleEl.innerText = "نموذج إجرائي";
        bodyEl.innerHTML = `<div>التصنيف:<select id="ed_category" class="w-full border rounded p-1.5"><option value="ديباجات محاضر التحقيق والاطلاع">ديباجات التحقيق والاطلاع</option><option value="نماذج المذكرات وتقرير الاتهام">المذكرات والاتهام</option><option value="ضوابط التحقيق وتجنب المآخذ">ضوابط التحقيق</option></select></div><div>العنوان:<input type="text" id="ed_title" value="${item.title}" class="w-full border rounded p-1.5"></div><div>النص:<textarea id="ed_content" rows="6" class="w-full border rounded p-1.5">${item.content}</textarea></div>`;
        document.getElementById('ed_category').value = item.category;
    }
    toggleModal('itemEditorModal');
};

window.saveEditorItem = async function() {
    const { type, editId } = currentEditorContext, title = document.getElementById('ed_title').value.trim();
    if (!title) return alert("يرجى إدخال العنوان!");
    if (type === 'library') {
        const obj = { id: editId || "lib_" + Date.now(), sector: document.getElementById('ed_sector').value, category: document.getElementById('ed_category').value, title: cleanLegalString(title), author: cleanLegalString(document.getElementById('ed_author').value.trim()), description: cleanLegalString(document.getElementById('ed_desc').value.trim()), driveUrl: document.getElementById('ed_drive').value.trim() };
        if (editId) db.library[db.library.findIndex(b => b.id === editId)] = obj; else db.library.unshift(obj);
    } else if (type === 'jurisdiction') {
        const obj = { id: editId || "enc_" + Date.now(), category: document.getElementById('ed_category').value, title: cleanLegalString(title), content: cleanLegalString(document.getElementById('ed_content').value.trim()), ref: cleanLegalString(document.getElementById('ed_ref').value.trim()) };
        if (editId) db.jurisdictions[db.jurisdictions.findIndex(j => j.id === editId)] = obj; else db.jurisdictions.unshift(obj);
    } else if (type === 'defense') {
        const obj = { id: editId || "def_" + Date.now(), sector: document.getElementById('ed_sector').value, category: document.getElementById('ed_category').value, title: cleanLegalString(title), response: cleanLegalString(document.getElementById('ed_response').value.trim()), ref: cleanLegalString(document.getElementById('ed_ref').value.trim()), contributor: document.getElementById('ed_contrib').value.trim() };
        if (editId) db.defenses[db.defenses.findIndex(d => d.id === editId)] = obj; else db.defenses.unshift(obj);
    } else if (type === 'checklist') {
        const obj = { id: editId || "chk_" + Date.now(), sector: document.getElementById('ed_sector').value, title: cleanLegalString(title), docs: document.getElementById('ed_docs').value.split('\n').map(s=>cleanLegalString(s.trim())).filter(Boolean), witness_q: document.getElementById('ed_witness').value.split('\n').map(s=>cleanLegalString(s.trim())).filter(Boolean), accused_q: document.getElementById('ed_accused').value.split('\n').map(s=>cleanLegalString(s.trim())).filter(Boolean), tips: document.getElementById('ed_tips').value.split('\n').map(s=>cleanLegalString(s.trim())).filter(Boolean) };
        if (editId) db.checklists[db.checklists.findIndex(c => c.id === editId)] = obj; else db.checklists.unshift(obj);
    } else if (type === 'form') {
        const obj = { id: editId || "form_" + Date.now(), sector: "الكل", category: document.getElementById('ed_category').value, title: cleanLegalString(title), content: cleanLegalString(document.getElementById('ed_content').value.trim()) };
        if (editId) db.forms[db.forms.findIndex(f => f.id === editId)] = obj; else db.forms.unshift(obj);
    }
    toggleModal('itemEditorModal');
    await persistState(editId ? "تعديل" : "إضافة", type, title);
};

window.deleteItem = async function(type, id) {
    if (!hasPerm('delete') || !confirm("هل أنت متأكد من الحذف؟")) return;
    if (type === 'library') db.library = db.library.filter(b => b.id !== id);
    if (type === 'jurisdiction') db.jurisdictions = db.jurisdictions.filter(j => j.id !== id);
    if (type === 'defense') db.defenses = db.defenses.filter(d => d.id !== id);
    if (type === 'form') db.forms = db.forms.filter(f => f.id !== id);
    await persistState("حذف عنصر", type, id);
};

// إدارة الأعضاء والدخول والـ VIP
window.openMemberAuthModal = function() {
    if (currentUser) { if (confirm(`تسجيل خروج (${currentUser.name})؟`)) logoutUser(); return; }
    toggleModal('memberAuthModal');
};
window.switchAuthTab = function(mode) {
    const isL = mode === 'login';
    document.getElementById('formMemberLogin').classList.toggle('hidden', !isL);
    document.getElementById('formMemberRegister').classList.toggle('hidden', isL);
    document.getElementById('authTabLogin').className = isL ? "py-2 bg-judicial-900 text-judicial-gold rounded cursor-pointer" : "py-2 text-slate-600 cursor-pointer";
    document.getElementById('authTabRegister').className = !isL ? "py-2 bg-judicial-900 text-judicial-gold rounded cursor-pointer" : "py-2 text-slate-600 cursor-pointer";
};

window.submitMemberLogin = async function() {
    const u = document.getElementById('login_username').value.trim().toLowerCase();
    const p = document.getElementById('login_pin').value.trim();
    if (!u || !p) return alert("أدخل اسم المستخدم وكلمة المرور.");
    const inputHash = await hashPin(p);
    let f = db.members.find(m => m.username.toLowerCase() === u && (m.pin === p || m.pinHash === inputHash));
    if (!f && u === 'admin' && (p === '2441998' || inputHash === SUPER_ADMIN_PIN_HASH)) f = db.members.find(m => m.role === 'super_admin');
    if (!f) return alert("بيانات الدخول غير صحيحة!");
    if (f.status === 'pending') return alert("حسابك قيد المراجعة والاعتماد.");
    if (f.status === 'blocked') return alert("تم إيقاف الحساب.");
    currentUser = f;
    sessionStorage.setItem("moawen_v12_uid", f.id);
    toggleModal('memberAuthModal');
    sendPresenceHeartbeat();
    refreshAllUI();
};

window.submitMemberRegister = async function() {
    const name = document.getElementById('reg_name').value.trim();
    const title = document.getElementById('reg_title').value.trim();
    const workplace = document.getElementById('reg_workplace').value.trim();
    const phone = document.getElementById('reg_phone').value.trim();
    const username = document.getElementById('reg_username').value.trim().toLowerCase();
    const pin = document.getElementById('reg_pin').value.trim();
    const inviteRaw = document.getElementById('reg_invite').value.trim().toUpperCase();

    if (!name || !title || !workplace || !username || !pin) return alert("يرجى ملء كافة الحقول الأساسية.");
    if (db.members.some(m => m.username.toLowerCase() === username)) return alert("اسم المستخدم مسجل مسبقاً.");

    const generalCode = (db.settings?.inviteCode || "VIP2026").trim().toUpperCase();
    let isInstantApproved = (inviteRaw === generalCode || inviteRaw === "VIP2026");

    if (!isInstantApproved && inviteRaw && Array.isArray(db.vipTokens)) {
        const idx = db.vipTokens.findIndex(t => (t.token || "").trim().toUpperCase() === inviteRaw && (t.usesCount || 0) < (t.maxUses || 1) && (!t.phoneLock || t.phoneLock === phone));
        if (idx >= 0) { isInstantApproved = true; db.vipTokens[idx].usesCount = (db.vipTokens[idx].usesCount || 0) + 1; }
    }

    const pinHash = await hashPin(pin);
    const newMem = { id: "mem_" + Date.now(), name, title, workplace, phone, username, pin, pinHash, role: "member", status: isInstantApproved ? "approved" : "pending", perms: { add: false, edit: false, delete: false, approve: false, manageUsers: false }, lastSeen: Date.now() };
    db.members.push(newMem);
    await persistState("تسجيل عضو", "الأعضاء", name);

    if (isInstantApproved) {
        currentUser = newMem;
        sessionStorage.setItem("moawen_v12_uid", newMem.id);
        toggleModal('memberAuthModal');
        refreshAllUI();
        alert(`مرحباً بمعاليكم / ${name}\n✅ تم تفعيل العضوية فورياً بكود الدعوة!`);
    } else {
        switchAuthTab('login');
        alert("✅ تم إرسال طلب الاعتماد بنجاح!");
    }
};

window.logoutUser = function() { currentUser = null; sessionStorage.removeItem("moawen_v12_uid"); refreshAllUI(); };

window.renderMembersTable = function() {
    const pCount = document.getElementById('pendingMembersCount');
    if (pCount) pCount.innerText = db.members.filter(m => m.status === 'pending').length;
    const tbody = document.getElementById('membersTableBody');
    if (!tbody) return;
    const cm = hasPerm('manageUsers');
    const activeThreshold = Date.now() - (3 * 60 * 1000);

    tbody.innerHTML = db.members.map(m => {
        const isS = m.role === 'super_admin';
        const rMeta = JUDICIAL_RANK_BADGES[m.title] || { badge: "bg-slate-100 text-slate-800 border", icon: "⚖️" };
        const isOnline = m.lastSeen && m.lastSeen > activeThreshold;
        let lastSeenStr = m.lastSeen ? (isOnline ? "🟢 متواجد الآن" : new Date(m.lastSeen).toLocaleDateString('ar-EG', { hour: '2-digit', minute: '2-digit' })) : "لم يسجل بعد";
        return `
            <tr class="${m.status === 'pending' ? 'bg-amber-50/70' : ''}">
                <td class="p-2"><div class="font-bold text-judicial-900">${m.name}</div><div class="text-[10px] text-slate-500">${m.workplace || ''}</div></td>
                <td class="p-2"><span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold ${rMeta.badge}">${rMeta.icon} ${m.title || ''}</span></td>
                <td class="p-2"><span class="text-[11px] font-bold ${isOnline ? 'text-emerald-700' : 'text-slate-500'}">${lastSeenStr}</span></td>
                <td class="p-2 text-xs"><div>${m.phone || '-'}</div><div class="font-mono text-slate-400 text-[10px]">${m.username}</div></td>
                <td class="p-2">${isS ? '<span class="font-bold text-amber-700">مدير المنصة</span>' : `<div class="flex flex-wrap gap-1 text-[10px]"><label><input type="checkbox" id="perm_add_${m.id}" ${m.perms?.add?'checked':''}> إضافة</label><label><input type="checkbox" id="perm_edit_${m.id}" ${m.perms?.edit?'checked':''}> تعديل</label><label><input type="checkbox" id="perm_del_${m.id}" ${m.perms?.delete?'checked':''}> حذف</label><label><input type="checkbox" id="perm_app_${m.id}" ${m.perms?.approve?'checked':''}> اعتماد</label></div>`}</td>
                <td class="p-2 text-center">${m.status === 'pending' && cm ? `<button onclick="setMemberStatus('${m.id}','approved')" class="bg-emerald-600 text-white px-2 py-1 rounded text-[10px] font-bold">قبول</button>` : ''} ${!isS && cm ? `<button onclick="saveMemberDetails('${m.id}')" class="bg-judicial-900 text-judicial-gold px-2 py-1 rounded text-[10px]">حفظ</button> <button onclick="deleteMember('${m.id}')" class="text-red-600 px-1"><i class="fa-solid fa-trash"></i></button>` : ''}</td>
            </tr>`;
    }).join('');
};

window.setMemberStatus = async (id, st) => { const m = db.members.find(x => x.id === id); if (m) { m.status = st; await persistState("تفعيل عضو", "الأعضاء", m.name); } };
window.saveMemberDetails = async id => {
    const m = db.members.find(x => x.id === id); if (!m || m.role === 'super_admin') return;
    const perms = { add: document.getElementById(`perm_add_${id}`).checked, edit: document.getElementById(`perm_edit_${id}`).checked, delete: document.getElementById(`perm_del_${id}`).checked, approve: document.getElementById(`perm_app_${id}`).checked, manageUsers: false };
    m.role = Object.values(perms).some(Boolean) ? 'moderator' : 'member';
    m.perms = perms; m.status = 'approved';
    await persistState("تحديث صلاحيات", "الأعضاء", m.name); alert("تم الحفظ!");
};
window.deleteMember = async id => { if (confirm("حذف الحساب؟")) { db.members = db.members.filter(x => x.id !== id); await persistState("حذف عضو", "الأعضاء", id); } };

window.createSmartVipToken = async function() {
    if (!hasPerm('manageUsers')) return;
    const label = document.getElementById('vip_label').value.trim() || "دعوة مستشار";
    const maxUses = parseInt(document.getElementById('vip_max_uses').value) || 1;
    const phoneLock = document.getElementById('vip_phone_lock').value.trim();
    const tokenCode = "VIP-" + Math.random().toString(36).substring(2, 7).toUpperCase();
    db.vipTokens.unshift({ token: tokenCode, label, maxUses, usesCount: 0, phoneLock });
    await persistState("توليد كود VIP", "VIP", tokenCode);
    renderVipTokensTable();
    alert(`✅ تم توليد الكود: ${tokenCode}`);
};
function renderVipTokensTable() {
    const tb = document.getElementById('vipTokensTableBody'); if (!tb) return;
    tb.innerHTML = (db.vipTokens || []).map((t, i) => `<tr><td class="p-2 font-mono font-bold text-emerald-700">${t.token}</td><td class="p-2">${t.label}</td><td class="p-2">${t.phoneLock || '-'}</td><td class="p-2">${t.usesCount || 0}/${t.maxUses}</td><td class="p-2"><button onclick="deleteVipToken(${i})" class="text-red-600">حذف</button></td></tr>`).join('');
}
window.deleteVipToken = async i => { db.vipTokens.splice(i, 1); await persistState("حذف كود VIP", "VIP"); renderVipTokensTable(); };

// المساهمات والنسخ الاحتياطي والإدارة
window.openContributeModal = function() {
    if (currentUser) document.getElementById('contrib_author').value = `${currentUser.name} (${currentUser.title})`;
    document.getElementById('contrib_sector').innerHTML = (db.sectors || []).map(s => `<option value="${s}">${s}</option>`).join('');
    toggleModal('contributeModal');
};
window.submitPublicContribution = async function() {
    const contributor = document.getElementById('contrib_author').value.trim() || "زميل";
    const sectionTarget = document.getElementById('contrib_section_target').value;
    const sector = document.getElementById('contrib_sector').value;
    const title = document.getElementById('contrib_title').value.trim();
    const content = document.getElementById('contrib_content').value.trim();
    const ref = document.getElementById('contrib_ref').value.trim();
    if (!title || !content) return alert("أكمل العنوان والمحتوى!");
    db.pendingContributions.unshift({ id: "pend_" + Date.now(), contributor, sectionTarget, sector, title, content, ref, time: new Date().toLocaleDateString('ar-EG') });
    await persistState("إرسال مساهمة", "المساهمات", title);
    toggleModal('contributeModal'); alert("✅ تم إرسال المساهمة للمراجعة!");
};

function renderPendingContributions() {
    const cont = document.getElementById('pendingListContainer'); if (!cont) return;
    const list = db.pendingContributions || [];
    const bdg = document.getElementById('pendingCountBadge'); if (bdg) bdg.innerText = list.length;
    cont.innerHTML = list.length ? list.map((item, idx) => `<div class="p-3 bg-white rounded-xl border space-y-1"><div class="flex justify-between font-bold text-xs"><span>${item.title}</span><span>${item.contributor}</span></div><p class="text-xs bg-slate-50 p-2 rounded">${item.content}</p><div class="flex justify-end gap-2"><button onclick="approveContribution(${idx})" class="bg-emerald-600 text-white px-2 py-1 rounded text-xs">اعتماد</button><button onclick="rejectContribution(${idx})" class="bg-red-100 text-red-600 px-2 py-1 rounded text-xs">رفض</button></div></div>`).join('') : '<p class="text-center text-xs text-slate-400 py-4">لا توجد مساهمات معلقة.</p>';
}
window.approveContribution = async idx => {
    const item = db.pendingContributions[idx]; if (!item) return;
    if (item.sectionTarget === 'defenses') db.defenses.unshift({ id: "def_" + Date.now(), sector: item.sector, category: "حيثيات الثبوت والرد على الدفوع", title: item.title, response: item.content, ref: item.ref, contributor: item.contributor });
    else if (item.sectionTarget === 'jurisdictions') db.jurisdictions.unshift({ id: "enc_" + Date.now(), category: "الكتب والقرارات 2026", title: item.title, content: item.content, ref: item.ref });
    db.pendingContributions.splice(idx, 1);
    await persistState("اعتماد مساهمة", item.sectionTarget, item.title);
};
window.rejectContribution = async idx => { db.pendingContributions.splice(idx, 1); await persistState("رفض مساهمة", "المساهمات"); };

window.openAdminModalDirect = function() {
    if (!currentUser || !(currentUser.role === 'super_admin' || currentUser.role === 'moderator')) return;
    const b = db.branding;
    if (document.getElementById('brand_title_input')) document.getElementById('brand_title_input').value = b.brandTitle || "";
    if (document.getElementById('brand_sub_input')) document.getElementById('brand_sub_input').value = b.brandSub || "";
    if (document.getElementById('brand_cloud_status_input')) document.getElementById('brand_cloud_status_input').value = b.cloudStatusText || "";
    if (document.getElementById('brand_invite_code_input')) document.getElementById('brand_invite_code_input').value = db.settings?.inviteCode || "VIP2026";
    if (document.getElementById('footer_instructions_input')) document.getElementById('footer_instructions_input').value = b.footerInstructions || "";
    if (document.getElementById('about_mallawi_input')) document.getElementById('about_mallawi_input').value = b.aboutMallawiText || "";
    if (document.getElementById('footer_text_input')) document.getElementById('footer_text_input').value = b.footerText || "";
    renderMembersTable(); renderVipTokensTable(); renderPendingContributions();
    toggleModal('adminModal');
};

window.saveBrandingSettings = async function() {
    if (!hasPerm('manageUsers')) return;
    db.branding.brandTitle = document.getElementById('brand_title_input')?.value.trim() || "المُـعَـاوِن";
    db.branding.brandSub = document.getElementById('brand_sub_input')?.value.trim() || "";
    db.branding.cloudStatusText = document.getElementById('brand_cloud_status_input')?.value.trim() || "سحابي متصل";
    db.branding.footerInstructions = document.getElementById('footer_instructions_input')?.value.trim() || "";
    db.branding.aboutMallawiText = document.getElementById('about_mallawi_input')?.value.trim() || DEFAULT_MALLAWI_WORD;
    db.branding.footerText = document.getElementById('footer_text_input')?.value.trim() || "";
    db.settings.inviteCode = document.getElementById('brand_invite_code_input')?.value.trim() || "VIP2026";
    await persistState("تحديث النصوص", "الإعدادات");
    alert("✅ تم حفظ الإعدادات سحابياً!");
};

window.switchAdminView = function(viewId) {
    document.querySelectorAll('.adm-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId)?.classList.remove('hidden');
};

window.downloadDatabaseBackup = function() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db, null, 2));
    const a = document.createElement('a'); a.href = dataStr; a.download = `moawen_backup_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
};

window.restoreDatabaseBackup = function(event) {
    const reader = new FileReader();
    if (event.target.files[0]) {
        reader.readAsText(event.target.files[0], "UTF-8");
        reader.onload = async function(e) {
            try {
                const parsed = JSON.parse(e.target.result);
                if (parsed && parsed.members) {
                    db = parsed;
                    await persistState("استرداد نسخة", "النظام", "كامل");
                    alert("✅ تم استرداد النسخة الاحتياطية بالكامل في القاعدة الجديدة!");
                    location.reload();
                }
            } catch (err) { alert("ملف النسخة غير صالح."); }
        };
    }
};

function triggerWordDownload(title, bodyText, filename) {
    const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' dir='rtl'><head><meta charset='utf-8'><style>body{font-family:'Amiri',serif;direction:rtl;text-align:right;font-size:16pt;line-height:1.8;margin:2cm;}</style></head><body><h1>${escapeHTML(title)}</h1><p>${escapeHTML(cleanLegalString(bodyText)).replace(/\n/g, '<br>')}</p></body></html>`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff', html], { type: 'application/msword' })); a.download = `${filename}.doc`;
    document.body.appendChild(a); a.click(); a.remove();
}
window.exportElementToWord = (elId, fn) => { const t = document.getElementById(elId)?.innerText || ""; if (t.trim()) triggerWordDownload("مخرج — منصة المُـعَـاوِن", t, fn); };
window.exportBasketToWord = () => { if (basket.length) triggerWordDownload("المسودة القضائية", basket.map(b => `■ [ ${b.title} ]\n${b.content}`).join('\n\n'), "مسودة_المعاون"); };

window.addToBasket = (title, content) => { basket.push({ title, content }); document.getElementById('basketCount').innerText = basket.length; renderBasket(); alert("أُضيف للمسودة!"); };
window.removeBasketItem = idx => { basket.splice(idx, 1); document.getElementById('basketCount').innerText = basket.length; renderBasket(); };
function renderBasket() {
    const el = document.getElementById('basketItems'); if (!el) return;
    el.innerHTML = basket.length ? basket.map((b, i) => `<div class="p-2.5 bg-slate-50 rounded border relative"><button onclick="removeBasketItem(${i})" class="absolute left-2 top-2 text-red-600 text-xs font-bold">حذف</button><span class="font-bold text-xs">${cleanLegalString(b.title)}</span><p class="text-xs mt-1 whitespace-pre-line">${cleanLegalString(b.content)}</p></div>`).join('') : '<p class="text-xs text-slate-400 text-center py-6">المسودة فارغة.</p>';
}
window.clearBasket = () => { basket = []; document.getElementById('basketCount').innerText = 0; renderBasket(); };
window.copyAllBasket = () => { if (basket.length) { navigator.clipboard.writeText(basket.map(b => `--- [ ${b.title} ] ---\n${b.content}`).join('\n\n')); alert("تم نسخ المسودة!"); } };

window.selectHubSection = function(tabId) {
    document.querySelectorAll('.hub-card').forEach(el => el.classList.remove('hub-card-active'));
    document.getElementById('hubCard-' + tabId)?.classList.add('hub-card-active');
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    const t = document.getElementById(tabId);
    if (t) { t.classList.remove('hidden'); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
};
window.scrollToTopHub = () => window.scrollTo({ top: 0, behavior: 'smooth' });
window.toggleModal = id => document.getElementById(id)?.classList.toggle('hidden');
window.copyText = id => { navigator.clipboard.writeText(document.getElementById(id).innerText); alert("تم النسخ بنجاح!"); };

function updateHybridAndAuthUI() {
    const b = db.branding;
    document.getElementById('siteMainTitle').innerText = `${b.brandTitle} | ${b.brandSub}`;
    document.getElementById('headerBrandTitle').innerText = b.brandTitle;
    document.getElementById('headerBrandSub').innerText = b.brandSub;
    document.getElementById('footerBrandBadge').innerText = b.brandTitle;
    document.getElementById('footerBrandText').innerText = b.footerText;
    if (document.getElementById('cloudStatusBadge')) document.getElementById('cloudStatusBadge').innerText = b.cloudStatusText;
    if (document.getElementById('footerInstructionsDisplay')) document.getElementById('footerInstructionsDisplay').innerText = b.footerInstructions;
    if (document.getElementById('aboutMallawiTextDisplay')) document.getElementById('aboutMallawiTextDisplay').innerText = b.aboutMallawiText;

    const approved = isApprovedMember();
    ['checklists', 'forms', 'qayds'].forEach(p => {
        document.getElementById(p + 'LockedBanner')?.classList.toggle('hidden', approved);
        document.getElementById(p + 'UnlockedContent')?.classList.toggle('hidden', !approved);
    });

    const activeThreshold = Date.now() - (3 * 60 * 1000);
    const onlineCount = (db.members || []).filter(m => m.lastSeen && m.lastSeen > activeThreshold).length || 1;
    if (document.getElementById('onlineMembersCountBadge')) document.getElementById('onlineMembersCountBadge').innerText = `المتواجدون: ${onlineCount}`;
    if (document.getElementById('adminOnlinePresenceBadge')) document.getElementById('adminOnlinePresenceBadge').innerText = `المتواجدون: ${onlineCount}`;

    if (!currentUser) {
        document.getElementById('userStatusBar').classList.add('hidden');
        document.getElementById('memberTopText').innerText = "دخول / تسجيل";
        document.querySelectorAll('.admin-add-btn, .admin-edit-btn, .admin-del-btn, .admin-action-btn').forEach(el => el.classList.add('hidden'));
        return;
    }

    document.getElementById('userStatusBar').classList.remove('hidden');
    document.getElementById('memberTopText').innerText = currentUser.name;
    const rankMeta = JUDICIAL_RANK_BADGES[currentUser.title] || { badge: "bg-slate-100 text-slate-800 border font-bold", titleGreeting: "معالي المستشار", icon: "⚖️" };
    document.getElementById('activeHonorificGreeting').innerText = `${rankMeta.titleGreeting} / ${currentUser.name}`;
    const rb = document.getElementById('activeRoleBadge');
    rb.className = `px-2 py-0.5 rounded text-[10px] font-bold ${rankMeta.badge}`;
    rb.innerHTML = `${rankMeta.icon} ${currentUser.title || 'عضو نيابة'}`;

    document.getElementById('activeMallawiBadge')?.classList.toggle('hidden', !(currentUser.workplace && currentUser.workplace.includes("ملوي")));
    document.getElementById('openAdminBarBtn')?.classList.toggle('hidden', !(currentUser.role === 'super_admin' || currentUser.role === 'moderator'));
    document.querySelectorAll('.admin-add-btn').forEach(el => el.classList.toggle('hidden', !hasPerm('add')));
    document.querySelectorAll('.admin-del-btn').forEach(el => el.classList.toggle('hidden', !hasPerm('delete')));
    document.querySelectorAll('.admin-action-btn').forEach(el => el.classList.toggle('hidden', !hasPerm('add')));
}

function refreshAllUI() {
    updateHybridAndAuthUI();
    renderLibrarySection();
    renderCurrentStage();
    renderCompassEncyclopedia();
    renderDefensesSection();
    renderChecklistsSection();
    renderFormsSection();
    renderSavedQaydTemplatesDropdown();
    composeSmartQayd();
}

window.addEventListener('DOMContentLoaded', () => {
    let bndHtml = "";
    Object.keys(BND_DETAILS).forEach(k => {
        bndHtml += `<label class="flex items-start gap-1.5 cursor-pointer"><input type="checkbox" class="chk-bnd" value="${k}" onchange="composeSmartQayd()"><span class="mt-0.5">${BND_DETAILS[k].desc}</span></label>`;
    });
    const bndBox = document.getElementById('bndItemsContainer');
    if (bndBox) bndBox.innerHTML = bndHtml;

    let stageBtns = "";
    [1, 2, 3, 4, 5].forEach(i => {
        stageBtns += `<button type="button" onclick="switchStageStep(${i})" id="stageBtn-${i}" class="stage-step ${i === 1 ? 'stage-step-active' : ''} py-2 px-2 rounded-lg border flex flex-col items-center gap-1 ${i === 1 ? '' : 'bg-slate-50'}">
            <span class="text-xs font-mono font-extrabold ${i === 1 ? 'text-judicial-gold' : 'text-slate-500'}">المحطة ${i}</span>
            <span class="font-bold text-xs">${i === 1 ? 'الورود والطلب' : i === 2 ? 'التحقيق والإعلان' : i === 3 ? 'العوارض والتصدي' : i === 4 ? 'التكييف والقيد' : 'التصرف والاعتماد'}</span>
        </button>`;
    });
    const stCont = document.getElementById('stageTabsContainer');
    if (stCont) stCont.innerHTML = stageBtns;

    renderBasket();
    initCloudSync();
});
