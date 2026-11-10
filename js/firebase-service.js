// js/firebase-service.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

// طبقة الحماية البرمجية: حظر اختصارات فحص العنصر وحفظ السورس
document.addEventListener('keydown', e => {
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['I','J','C'].includes(e.key)) || (e.ctrlKey && ['U','S','P'].includes(e.key))) { 
        e.preventDefault(); 
        return false; 
    }
});

// بيانات الاتصال بقاعدتك التجريبية الجديدة (m3awen-gemini-test)
export const firebaseConfig = {
    apiKey: "AIzaSyAhw6TdEvfcLLIlkk5_6H52jotZTJAHTSg",
    authDomain: "m3awen-gemini-test.firebaseapp.com",
    projectId: "m3awen-gemini-test",
    storageBucket: "m3awen-gemini-test.firebasestorage.app",
    messagingSenderId: "778904506431",
    appId: "1:778904506431:web:8b30044afab818f430a88a"
};

export const app = initializeApp(firebaseConfig);
export const firestoreDB = getFirestore(app);

// وثائق التخزين السحابي المقسمة (8 Shards)
export const SHARD_REFS = {
    config: doc(firestoreDB, "platform_data", "sec_config"),
    members: doc(firestoreDB, "platform_data", "sec_members"),
    library: doc(firestoreDB, "platform_data", "sec_library"),
    jurisdictions: doc(firestoreDB, "platform_data", "sec_jurisdictions"),
    defenses: doc(firestoreDB, "platform_data", "sec_defenses"),
    checklists: doc(firestoreDB, "platform_data", "sec_checklists"),
    forms: doc(firestoreDB, "platform_data", "sec_forms"),
    qayds: doc(firestoreDB, "platform_data", "sec_qayds")
};

export const SUPER_ADMIN_PIN_HASH = "e44f72f8f7c4f0a4b0b9560c028a21261a192a22526a674566039402e232443f";

export async function hashPin(pin) {
    const raw = String(pin || "").trim();
    if (!window.crypto || !window.crypto.subtle) return raw;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function cleanLegalString(str) {
    if (!str) return "";
    return String(str).replace(/\[cite:\s*[\d,\s]+\]/gi, "").trim();
}

export const JUDICIAL_RANK_BADGES = {
    "نائب رئيس هيئة النيابة الإدارية": { badge: "bg-amber-100 text-amber-900 border border-amber-400 font-extrabold", titleGreeting: "معالي المستشار الجليل", icon: "👑" },
    "وكيل عام أول": { badge: "bg-judicial-900 text-judicial-gold border border-judicial-gold font-bold", titleGreeting: "معالي المستشار", icon: "⚜️" },
    "وكيل عام": { badge: "bg-judicial-800 text-judicial-gold border border-judicial-gold/60 font-bold", titleGreeting: "معالي المستشار", icon: "⚜️" },
    "رئيس نيابة إدارية من الفئة (أ)": { badge: "bg-emerald-100 text-emerald-900 border border-emerald-400 font-bold", titleGreeting: "سيادة المستشار", icon: "⚖️" },
    "رئيس نيابة إدارية من الفئة (ب)": { badge: "bg-emerald-50 text-emerald-800 border border-emerald-300 font-bold", titleGreeting: "سيادة المستشار", icon: "⚖️" },
    "وكيل نيابة إدارية من الفئة الممتازة": { badge: "bg-blue-100 text-blue-900 border border-blue-400 font-bold", titleGreeting: "معالي الزميل المستشار", icon: "✒️" },
    "وكيل نيابة إدارية": { badge: "bg-blue-50 text-blue-800 border border-blue-300 font-semibold", titleGreeting: "معالي الزميل المستشار", icon: "✒️" },
    "مساعد نيابة إدارية": { badge: "bg-slate-100 text-slate-800 border border-slate-300 font-semibold", titleGreeting: "معالي الزميل المستشار", icon: "✒️" },
    "معاون نيابة إدارية": { badge: "bg-amber-50 text-amber-800 border border-amber-200 font-semibold", titleGreeting: "معالي الزميل المستشار", icon: "✒️" }
};