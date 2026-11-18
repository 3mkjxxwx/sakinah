
"use strict";

// ======================================
// SAKINAH - التطبيق الرئيسي
// ======================================

const $ = id => document.getElementById(id);

const prayerNames = {
    Fajr: "الفجر",
    Sunrise: "الشروق",
    Dhuhr: "الظهر",
    Asr: "العصر",
    Maghrib: "المغرب",
    Isha: "العشاء"
};

const prayerKeys = Object.keys(prayerNames);
const iqamaKeys = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

const escapeHTML = text => String(text).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
}[char]));

function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function load(key, fallback = null) {
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : JSON.parse(value);
    } catch {
        return fallback;
    }
}

// ======================================
// التاريخ والساعة
// ======================================

function updateClock() {
    const now = new Date();

    $("clock").textContent = now.toLocaleTimeString("ar-SA", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
    });

    $("gregDate").textContent = now.toLocaleDateString("ar-SA", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
    });

    $("hijriDate").textContent = new Intl.DateTimeFormat(
        "ar-SA-u-ca-islamic-umalqura",
        {
            day: "numeric",
            month: "long",
            year: "numeric"
        }
    ).format(now);
}

// ======================================
// الموقع ومواقيت الصلاة
// ======================================

let coordinates = null;
let timings = {};
let currentPrayer = null;
let notificationTimer = null;
let lastAlerts = {};

function requestLocation() {
    if (!navigator.geolocation) {
        $("locationLabel").textContent = "الموقع غير مدعوم";
        return;
    }

    $("locationLabel").textContent = "جارٍ تحديد موقعك...";

    navigator.geolocation.getCurrentPosition(
        async position => {
            coordinates = {
                lat: position.coords.latitude,
                lon: position.coords.longitude
            };

            save("sakinaLocation", coordinates);
            await loadPrayer();
        },
        () => {
            $("locationLabel").textContent =
                "تعذر تحديد موقعك. اسمح بالوصول للموقع.";
        },
        {
            enableHighAccuracy: true,
            timeout: 15000
        }
    );
}

async function loadPrayer() {
    if (!coordinates) return;

    try {
        const url = new URL(
            "https://api.aladhan.com/v1/timings"
        );

        url.searchParams.set("latitude", coordinates.lat);
        url.searchParams.set("longitude", coordinates.lon);
        url.searchParams.set("method", "4");

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("Prayer API error");
        }

        const result = await response.json();

        if (result.code !== 200) {
            throw new Error("Prayer data error");
        }

        timings = result.data.timings;

        $("locationLabel").textContent =
            result.data.meta.timezone || "تم تحديد الموقع";

        renderPrayers();
        updateCountdown();

    } catch (error) {
        console.error(error);

        $("locationLabel").textContent =
            "تعذر تحميل مواقيت الصلاة";

        $("prayerGrid").textContent =
            "تحقق من اتصال الإنترنت وحاول مجدداً";
    }
}

function parsePrayerTime(value, date = new Date()) {
    const match = String(value).match(/^(\d{1,2}):(\d{2})/);

    if (!match) return null;

    const result = new Date(date);

    result.setHours(
        Number(match[1]),
        Number(match[2]),
        0,
        0
    );

    return result;
}

function formatTime(value) {
    const date = parsePrayerTime(value);

    if (!date) return "--:--";

    return date.toLocaleTimeString("ar-SA", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    });
}

function renderPrayers() {
    $("prayerGrid").innerHTML = prayerKeys.map(key => `
        <div class="prayer-card" id="prayer-${key}">
            <small>${prayerNames[key]}</small>
            <strong>${formatTime(timings[key])}</strong>
            ${key === "Sunrise" ? "<em>الشروق</em>" : ""}
        </div>
    `).join("");
}

function updateCountdown() {
    if (!timings.Fajr) return;

    const now = new Date();

    const keys = [
        "Fajr",
        "Dhuhr",
        "Asr",
        "Maghrib",
        "Isha"
    ];

    let upcoming = null;

    for (const key of keys) {
        const date = parsePrayerTime(timings[key]);

        if (date && date > now) {
            upcoming = { key, date };
            break;
        }
    }

    if (!upcoming) {
        const date = parsePrayerTime(timings.Fajr);

        if (!date) return;

        date.setDate(date.getDate() + 1);

        upcoming = {
            key: "Fajr",
            date
        };
    }

    currentPrayer = upcoming.key;

    const diff = Math.max(0, upcoming.date - now);

    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor(diff % 3600000 / 60000);
    const seconds = Math.floor(diff % 60000 / 1000);

    $("nextName").textContent = prayerNames[upcoming.key];

    $("countdown").textContent = [
        hours,
        minutes,
        seconds
    ].map(x => String(x).padStart(2, "0")).join(":");

    document.querySelectorAll(".prayer-card").forEach(card => {
        card.classList.remove("active");
    });

    $("prayer-" + upcoming.key)?.classList.add("active");

    checkAlerts();
}

// ======================================
// القرآن الكريم - TANZIL UTHMANI
// ======================================

const QURAN_SOURCE =
    "https://raw.githubusercontent.com/dotquran/corpus/main/processed/uthmani/quran-uthmani.json";

const QURAN_ATTRIBUTION =
    "Tanzil Quran Text (Uthmani, Version 1.1) - Copyright © Tanzil Project - CC BY 3.0";

let quranData = null;
let surahs = [];
let currentQuranTab = "surahTab";

// بدايات الأجزاء الثلاثين
const juzStarts = [
    [1, 1],
    [2, 142],
    [2, 253],
    [3, 93],
    [4, 24],
    [4, 148],
    [5, 82],
    [6, 111],
    [7, 88],
    [8, 41],
    [9, 93],
    [11, 6],
    [12, 53],
    [15, 1],
    [17, 1],
    [18, 75],
    [21, 1],
    [23, 1],
    [25, 21],
    [27, 56],
    [29, 46],
    [33, 31],
    [36, 28],
    [39, 32],
    [41, 47],
    [46, 1],
    [51, 31],
    [58, 1],
    [67, 1],
    [78, 1]
];

function arabicNumber(number) {
    return new Intl.NumberFormat("ar-SA").format(number);
}

// تحميل المصحف كاملاً
async function loadSurahs() {
    try {
        $("surahList").textContent =
            "جارٍ تحميل القرآن الكريم...";

        const response = await fetch(QURAN_SOURCE, {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error("تعذر الاتصال بمصدر القرآن");
        }

        const data = await response.json();

        if (
            !Array.isArray(data.surahs) ||
            data.surahs.length !== 114
        ) {
            throw new Error("بيانات المصحف غير مكتملة");
        }

        quranData = data;
        surahs = data.surahs;

        renderSurahs();
        renderJuz();

    } catch (error) {
        console.error("Tanzil Quran error:", error);

        $("surahList").textContent =
            "تعذر تحميل المصحف. تحقق من الإنترنت ثم أعد تحميل الصفحة.";

        $("juzList").textContent =
            "تعذر تحميل الأجزاء.";
    }
}

// عرض فهرس السور
function renderSurahs() {
    $("surahList").innerHTML = surahs.map(s => {
        const count = s.ayahs.filter(a => a.number > 0).length;

        return `
            <button onclick="readSurah(${s.number})">
                ${s.number}. ${escapeHTML(s.name)}
                <small>
                    ${count} آية · ${escapeHTML(s.loc || "")}
                </small>
            </button>
        `;
    }).join("");
}

// عرض فهرس الأجزاء
function renderJuz() {
    $("juzList").innerHTML = Array.from(
        { length: 30 },
        (_, index) => `
            <button onclick="readJuz(${index + 1})">
                الجزء ${index + 1}
                <small>الجزء ${index + 1} من القرآن</small>
            </button>
        `
    ).join("");
}

// التبديل بين السور والأجزاء
function quranTab(tab) {
    currentQuranTab = tab;

    $("surahTab").hidden = tab !== "surahTab";
    $("juzTab").hidden = tab !== "juzTab";

    $("quranSearch").value = "";

    filterQuran();
}

// البحث
function filterQuran() {
    const query = $("quranSearch").value.trim();

    if (currentQuranTab === "surahTab") {
        const filtered = surahs.filter(s =>
            s.name.includes(query) ||
            String(s.number) === query
        );

        $("surahList").innerHTML = filtered.map(s => {
            const count = s.ayahs.filter(a => a.number > 0).length;

            return `
                <button onclick="readSurah(${s.number})">
                    ${s.number}. ${escapeHTML(s.name)}
                    <small>${count} آية</small>
                </button>
            `;
        }).join("") || "<p>لا توجد نتائج</p>";

    } else {
        const filtered = Array.from(
            { length: 30 },
            (_, i) => i + 1
        ).filter(n =>
            String(n).includes(query) ||
            ("الجزء " + n).includes(query)
        );

        $("juzList").innerHTML = filtered.map(n => `
            <button onclick="readJuz(${n})">
                الجزء ${n}
                <small>الجزء ${n} من القرآن</small>
            </button>
        `).join("") || "<p>لا توجد نتائج</p>";
    }
}

// استخراج جميع الآيات بترتيب المصحف
function getAllQuranAyahs() {
    if (!quranData) return [];

    const all = [];

    for (const surah of surahs) {
        for (const ayah of surah.ayahs) {
            if (Number(ayah.number) > 0) {
                all.push({
                    surahNumber: surah.number,
                    surahName: surah.name,
                    number: ayah.number,
                    text: ayah.text
                });
            }
        }
    }

    return all;
}

// عرض الآيات دون تعديل نصها
function renderQuranAyahs(ayahs) {
    return ayahs.map(ayah => `
        <span class="ayah">${escapeHTML(ayah.text)}</span>
        <span class="ayah-mark">
            ۞ ${arabicNumber(ayah.number)}
        </span>
    `).join(" ");
}

// إضافة مصدر القرآن
function addQuranAttribution(reader) {
    const oldCredit = reader.querySelector(".quran-source");

    if (oldCredit) {
        oldCredit.remove();
    }

    const credit = document.createElement("p");

    credit.className = "quran-source";

    credit.style.cssText =
        "font-size:12px;text-align:center;opacity:.7;margin-top:25px;line-height:2";

    const sourceLink = document.createElement("a");

    sourceLink.href = "https://tanzil.net";
    sourceLink.target = "_blank";
    sourceLink.rel = "noopener noreferrer";
    sourceLink.textContent = "Tanzil.net";

    credit.append(
        document.createTextNode(QURAN_ATTRIBUTION + " — "),
        sourceLink
    );

    reader.appendChild(credit);
}

// ======================================
// عرض السورة أو الجزء - إصلاح البسملة
// ======================================

function loadQuranText(title, ayahs, surahNumber = null) {
    const reader = $("reader");
    const titleBox = $("readerTitle");
    const ayahsBox = $("ayahs");
    const basmalaBox = $("basmala");

    if (!reader || !titleBox || !ayahsBox || !basmalaBox) {
        console.error("Quran reader elements are missing");
        alert("تأكد من وجود عناصر قارئ القرآن في HTML");
        return;
    }

    if (!Array.isArray(ayahs) || ayahs.length === 0) {
        ayahsBox.textContent = "لا توجد آيات للعرض";
        basmalaBox.hidden = true;
        return;
    }

    reader.hidden = false;
    titleBox.textContent = title;

    // إخفاء البسملة القديمة قبل فتح أي سورة
    basmalaBox.hidden = true;
    basmalaBox.textContent = "";

    // البحث عن البسملة المنفصلة ذات الرقم صفر
    const separateBasmala = ayahs.find(
        ayah => Number(ayah.number) === 0
    );

    // استبعاد جميع العناصر التي رقمها صفر من نص الآيات
    let displayAyahs = ayahs.filter(
        ayah => Number(ayah.number) > 0
    );

    // الفاتحة: البسملة هي الآية الأولى
    if (Number(surahNumber) === 1) {
        const firstAyah = displayAyahs.find(
            ayah => Number(ayah.number) === 1
        );

        if (firstAyah) {
            basmalaBox.hidden = false;

            basmalaBox.innerHTML = `
                ${escapeHTML(firstAyah.text)}
                <span class="ayah-mark">۞ ١</span>
            `;

            displayAyahs = displayAyahs.filter(
                ayah => Number(ayah.number) !== 1
            );
        }
    }

    // بقية السور عدا التوبة
    else if (
        surahNumber !== null &&
        Number(surahNumber) !== 9 &&
        separateBasmala
    ) {
        basmalaBox.hidden = false;
        basmalaBox.textContent = separateBasmala.text;
    }

    // عرض الآيات الأصلية دون تعديل نصها
    ayahsBox.innerHTML = renderQuranAyahs(displayAyahs);

    addQuranAttribution(reader);

    reader.scrollIntoView({
        behavior: "smooth"
    });
}

// فتح سورة
function readSurah(number) {
    if (!quranData) {
        alert("انتظر حتى يكتمل تحميل القرآن");
        return;
    }

    const surah = surahs.find(
        s => s.number === number
    );

    if (!surah) {
        alert("تعذر العثور على السورة");
        return;
    }

    loadQuranText(
        surah.name,
        surah.ayahs,
        number
    );
}

// فتح جزء
function readJuz(number) {
    if (!quranData) {
        alert("انتظر حتى يكتمل تحميل القرآن");
        return;
    }

    if (
        !Number.isInteger(number) ||
        number < 1 ||
        number > 30
    ) {
        return;
    }

    const allAyahs = getAllQuranAyahs();

    const [startSurah, startAyah] =
        juzStarts[number - 1];

    const startIndex = allAyahs.findIndex(a =>
        a.surahNumber === startSurah &&
        a.number === startAyah
    );

    if (startIndex === -1) {
        alert("تعذر تحديد بداية الجزء");
        return;
    }

    let endIndex = allAyahs.length;

    if (number < 30) {
        const [nextSurah, nextAyah] =
            juzStarts[number];

        const nextIndex = allAyahs.findIndex(a =>
            a.surahNumber === nextSurah &&
            a.number === nextAyah
        );

        if (nextIndex !== -1) {
            endIndex = nextIndex;
        }
    }

    const juzAyahs = allAyahs.slice(
        startIndex,
        endIndex
    );

    loadQuranText(
        "الجزء " + number,
        juzAyahs,
        null
    );
}

// إغلاق القارئ
function closeReader() {
    $("reader").hidden = true;

    $("quranPage").scrollIntoView({
        behavior: "smooth"
    });
}

// ======================================
// الأذكار
// ======================================

const azkar = {
    morning: [
        {
            text: "أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ",
            count: 1,
            source: "من أذكار الصباح"
        },
        {
            text: "سُبْحَانَ اللَّهِ وَبِحَمْدِهِ",
            count: 100,
            source: "صحيح مسلم"
        },
        {
            text: "رَضِيتُ بِاللَّهِ رَبًّا، وَبِالْإِسْلَامِ دِينًا، وَبِمُحَمَّدٍ ﷺ نَبِيًّا",
            count: 3,
            source: "أبو داود والترمذي"
        },
        {
            text: "اللَّهُمَّ بِكَ أَصْبَحْنَا، وَبِكَ أَمْسَيْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ، وَإِلَيْكَ النُّشُورُ",
            count: 1,
            source: "الترمذي"
        },
        {
            text: "اللَّهُمَّ عَافِنِي فِي بَدَنِي، اللَّهُمَّ عَافِنِي فِي سَمْعِي، اللَّهُمَّ عَافِنِي فِي بَصَرِي، لَا إِلَٰهَ إِلَّا أَنْتَ",
            count: 3,
            source: "أبو داود"
        }
    ],

    evening: [
        {
            text: "أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ",
            count: 1,
            source: "من أذكار المساء"
        },
        {
            text: "سُبْحَانَ اللَّهِ وَبِحَمْدِهِ",
            count: 100,
            source: "صحيح مسلم"
        },
        {
            text: "رَضِيتُ بِاللَّهِ رَبًّا، وَبِالْإِسْلَامِ دِينًا، وَبِمُحَمَّدٍ ﷺ نَبِيًّا",
            count: 3,
            source: "أبو داود والترمذي"
        },
        {
            text: "اللَّهُمَّ بِكَ أَمْسَيْنَا، وَبِكَ أَصْبَحْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ، وَإِلَيْكَ الْمَصِيرُ",
            count: 1,
            source: "الترمذي"
        }
    ],

    after: [
        {
            text: "أَسْتَغْفِرُ اللَّهَ",
            count: 3,
            source: "صحيح مسلم"
        },
        {
            text: "اللَّهُمَّ أَنْتَ السَّلَامُ وَمِنْكَ السَّلَامُ، تَبَارَكْتَ يَا ذَا الْجَلَالِ وَالْإِكْرَامِ",
            count: 1,
            source: "صحيح مسلم"
        },
        {
            text: "سُبْحَانَ اللَّهِ",
            count: 33,
            source: "صحيح مسلم"
        },
        {
            text: "الْحَمْدُ لِلَّهِ",
            count: 33,
            source: "صحيح مسلم"
        },
        {
            text: "اللَّهُ أَكْبَرُ",
            count: 33,
            source: "صحيح مسلم"
        },
        {
            text: "لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ",
            count: 1,
            source: "صحيح مسلم"
        }
    ],

    sleep: [
        {
            text: "بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا",
            count: 1,
            source: "صحيح البخاري"
        },
        {
            text: "سُبْحَانَ اللَّهِ",
            count: 33,
            source: "صحيح البخاري"
        },
        {
            text: "الْحَمْدُ لِلَّهِ",
            count: 33,
            source: "صحيح البخاري"
        },
        {
            text: "اللَّهُ أَكْبَرُ",
            count: 34,
            source: "صحيح البخاري"
        }
    ],

    wake: [
        {
            text: "الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ",
            count: 1,
            source: "صحيح البخاري"
        }
    ],

    daily: [
        {
            text: "سُبْحَانَ اللَّهِ وَبِحَمْدِهِ، سُبْحَانَ اللَّهِ الْعَظِيمِ",
            count: 1,
            source: "صحيح البخاري ومسلم"
        },
        {
            text: "لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ",
            count: 1,
            source: "صحيح البخاري ومسلم"
        },
        {
            text: "اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ",
            count: 10,
            source: "الصلاة على النبي ﷺ"
        }
    ],

    sayyid: [
        {
            text: "اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَٰهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ بِذَنْبِي، فَاغْفِرْ لِي، فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ",
            count: 1,
            source: "صحيح البخاري"
        }
    ],

    ruqya: [
        {
            text: "سُورَةُ الْفَاتِحَةِ",
            count: 1,
            source: "القرآن الكريم"
        },
        {
            text: "آيَةُ الْكُرْسِيِّ",
            count: 1,
            source: "البقرة: 255"
        },
        {
            text: "قُلْ هُوَ اللَّهُ أَحَدٌ",
            count: 3,
            source: "سورة الإخلاص"
        },
        {
            text: "قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ",
            count: 3,
            source: "سورة الفلق"
        },
        {
            text: "قُلْ أَعُوذُ بِرَبِّ النَّاسِ",
            count: 3,
            source: "سورة الناس"
        }
    ]
};

const azkarTitles = {
    morning: "أذكار الصباح",
    evening: "أذكار المساء",
    after: "أذكار بعد الصلاة",
    sleep: "أذكار النوم",
    wake: "أذكار الاستيقاظ",
    daily: "أذكار متنوعة",
    sayyid: "سيد الاستغفار",
    ruqya: "الرقية الشرعية"
};

function showAzkar(type) {
    const list = azkar[type];

    if (!list) return;

    $("azkarResults").innerHTML = `
        <h3>${azkarTitles[type]}</h3>

        ${list.map((item, index) => `
            <div class="zikr-card">
                <p class="zikr-text">
                    ${escapeHTML(item.text)}
                </p>

                <p class="muted">
                    ${escapeHTML(item.source)}
                </p>

                <p>التكرار المطلوب: ${item.count}</p>

                <button class="count-btn"
                    onclick="countZikr(this, ${item.count})">
                    اضغط للتسبيح · 0 / ${item.count}
                </button>
            </div>
        `).join("")}
    `;

    $("azkarResults").scrollIntoView({
        behavior: "smooth"
    });
}

function countZikr(button, max) {
    let count = Number(button.dataset.count || 0);

    if (count >= max) return;

    count++;

    button.dataset.count = count;

    if (count >= max) {
        button.textContent = "اكتمل الذكر";
        button.disabled = true;
    } else {
        button.textContent =
            `اضغط للتسبيح · ${count} / ${max}`;
    }
}

// ======================================
// القبلة
// ======================================

function calculateQibla() {
    if (!coordinates) {
        alert("حدد موقعك أولاً");
        requestLocation();
        return;
    }

    const rad = Math.PI / 180;

    const lat = coordinates.lat * rad;
    const lon = coordinates.lon * rad;

    const kaabaLat = 21.4225 * rad;
    const kaabaLon = 39.8262 * rad;

    const y = Math.sin(kaabaLon - lon);

    const x =
        Math.cos(lat) * Math.tan(kaabaLat) -
        Math.sin(lat) * Math.cos(kaabaLon - lon);

    const degree =
        (Math.atan2(y, x) / rad + 360) % 360;

    const degreeElement = $("qiblaDegree");
    const directionElement = $("qiblaDirection");

    if (degreeElement) {
        degreeElement.textContent =
            Math.round(degree) + "°";
    }

    if (directionElement) {
        directionElement.textContent =
            "الزاوية من اتجاه الشمال الحقيقي";
    }
}

// ======================================
// آيات للتدبر
// ======================================

const verses = [
    ["أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ", "الرعد: 28"],
    ["فَإِنَّ مَعَ الْعُسْرِ يُسْرًا", "الشرح: 5"],
    ["وَقُلْ رَبِّ زِدْنِي عِلْمًا", "طه: 114"],
    ["إِنَّ اللَّهَ مَعَ الصَّابِرِينَ", "البقرة: 153"],
    ["إِنَّ مَعَ الْعُسْرِ يُسْرًا", "الشرح: 6"],
    ["وَهُوَ مَعَكُمْ أَيْنَ مَا كُنْتُمْ", "الحديد: 4"]
];

function newVerse() {
    const verse = verses[
        Math.floor(Math.random() * verses.length)
    ];

    $("dailyVerse").textContent = verse[0];
    $("dailyVerseRef").textContent = verse[1];
}

// ======================================
// العبادات اليومية
// ======================================

const trackerItems = [
    "صلاة الفجر",
    "صلاة الظهر",
    "صلاة العصر",
    "صلاة المغرب",
    "صلاة العشاء",
    "أذكار الصباح",
    "أذكار المساء",
    "قراءة القرآن"
];

function renderTracker() {
    const saved = load("sakinaChecks", []);

    $("trackerItems").innerHTML =
        trackerItems.map((item, index) => `
            <label class="tracker-row">
                ${item}

                <input type="checkbox"
                    ${saved.includes(index) ? "checked" : ""}
                    onchange="saveCheck(${index}, this.checked)">
            </label>
        `).join("");

    updateProgress();
}

function saveCheck(index, checked) {
    let saved = load("sakinaChecks", []);

    saved = checked
        ? [...new Set([...saved, index])]
        : saved.filter(x => x !== index);

    save("sakinaChecks", saved);

    updateProgress();
}

function updateProgress() {
    const saved = load("sakinaChecks", []);

    const count = saved.length;

    const percentage =
        count / trackerItems.length * 100;

    $("progressText").textContent =
        `${count} / ${trackerItems.length}`;

    $("progressBar").style.width =
        percentage + "%";
}

// ======================================
// الإقامة
// ======================================

function setupIqama() {
    const saved = load("sakinaIqama", {});

    $("iqamaSettings").innerHTML =
        iqamaKeys.map(key => `
            <label class="iqama-setting">
                ${prayerNames[key]}

                <input type="time"
                    id="iq-${key}"
                    value="${escapeHTML(saved[key] || "")}">
            </label>
        `).join("");
}

function saveIqama() {
    const data = {};

    iqamaKeys.forEach(key => {
        data[key] = $("iq-" + key).value;
    });

    save("sakinaIqama", data);

    alert("تم حفظ أوقات الإقامة");
}

// ======================================
// الإشعارات
// ======================================

function enableNotifications() {
    if (!("Notification" in window)) {
        alert("المتصفح لا يدعم الإشعارات");
        return;
    }

    Notification.requestPermission().then(permission => {
        if (permission === "granted") {
            alert(
                "تم السماح بالإشعارات. ستعمل التنبيهات أثناء تشغيل التطبيق."
            );

            startAlerts();
        } else {
            alert("لم يتم السماح بالإشعارات");
        }
    });
}

function checkAlerts() {
    if (!timings.Fajr) return;

    const now = new Date();

    const today = now.toDateString();

    const settings = [
        ["Fajr", "الفجر"],
        ["Dhuhr", "الظهر"],
        ["Asr", "العصر"],
        ["Maghrib", "المغرب"],
        ["Isha", "العشاء"]
    ];

    if ($("prayerAlerts")?.checked) {
        settings.forEach(([key, name]) => {
            const date = parsePrayerTime(timings[key]);

            if (!date) return;

            if (Math.abs(now - date) < 30000) {
                const alertKey = today + key;

                if (!lastAlerts[alertKey]) {
                    notify("حان وقت صلاة " + name);

                    lastAlerts[alertKey] = true;
                }
            }
        });
    }

    const hour = now.getHours();
    const minute = now.getMinutes();

    if (
        minute === 0 &&
        hour === 7 &&
        $("morningAlert")?.checked
    ) {
        sendDailyAlert("morning", today);
    }

    if (
        minute === 0 &&
        hour === 17 &&
        $("eveningAlert")?.checked
    ) {
        sendDailyAlert("evening", today);
    }
}

function sendDailyAlert(type, today) {
    const key = today + type;

    if (lastAlerts[key]) return;

    notify(
        type === "morning"
            ? "حان وقت أذكار الصباح"
            : "حان وقت أذكار المساء"
    );

    lastAlerts[key] = true;
}

function notify(message) {
    if (
        "Notification" in window &&
        Notification.permission === "granted"
    ) {
        new Notification("سَكِينَة | SAKINAH", {
            body: message
        });
    }
}

function startAlerts() {
    if (notificationTimer) {
        clearInterval(notificationTimer);
    }

    notificationTimer = setInterval(
        checkAlerts,
        15000
    );

    checkAlerts();
}

// ======================================
// التنقل بين الصفحات
// ======================================

function showPage(page) {
    const pages = [
        "home",
        "quran",
        "azkar",
        "qibla",
        "tracker",
        "settings"
    ];

    if (!pages.includes(page)) return;

    pages.forEach(name => {
        const pageElement = $(name + "Page");

        if (pageElement) {
            pageElement.classList.toggle(
                "active",
                name === page
            );
        }
    });

    document.querySelectorAll(".nav-item").forEach(item => {
        item.classList.toggle(
            "active",
            item.dataset.page === page
        );
    });

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });

    if (page === "tracker") {
        renderTracker();
    }

    if (page === "settings") {
        setupIqama();
    }
}

// ======================================
// تشغيل التطبيق
// ======================================

function initializeApp() {
    updateClock();

    setInterval(updateClock, 1000);

    renderTracker();
    setupIqama();

    loadSurahs();

    $("prayerAlerts").checked =
        load("prayerAlerts", false);

    $("morningAlert").checked =
        load("morningAlert", false);

    $("eveningAlert").checked =
        load("eveningAlert", false);

    [
        "prayerAlerts",
        "morningAlert",
        "eveningAlert"
    ].forEach(id => {
        $(id).addEventListener("change", () => {
            save(id, $(id).checked);
        });
    });

    coordinates = load("sakinaLocation");

    if (coordinates) {
        loadPrayer();
    } else {
        requestLocation();
    }

    startAlerts();
}

document.addEventListener(
    "DOMContentLoaded",
    initializeApp
);
