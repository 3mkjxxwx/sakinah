
"use strict";

// ======================================
// SAKINAH — APP.JS
// Improved Edition
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

const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
}[char]));

function save(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.error("Storage error:", error);
    }
}

function load(key, fallback = null) {
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : JSON.parse(value);
    } catch {
        return fallback;
    }
}

function todayKey() {
    const date = new Date();
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function normalizeArabic(value) {
    return String(value)
        .replace(/[\u064B-\u065F\u0670]/g, "")
        .replace(/[إأآا]/g, "ا")
        .replace(/ى/g, "ي")
        .replace(/ة/g, "ه")
        .trim();
}

// ======================================
// CLOCK & DATES
// ======================================

function updateClock() {
    const now = new Date();

    if ($("clock")) {
        $("clock").textContent = now.toLocaleTimeString("ar-SA", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true
        });
    }

    if ($("gregDate")) {
        $("gregDate").textContent = now.toLocaleDateString("ar-SA", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric"
        });
    }

    if ($("hijriDate")) {
        try {
            $("hijriDate").textContent = new Intl.DateTimeFormat(
                "ar-SA-u-ca-islamic-umalqura",
                {
                    day: "numeric",
                    month: "long",
                    year: "numeric"
                }
            ).format(now);
        } catch {
            $("hijriDate").textContent = "التاريخ الهجري";
        }
    }
}

// ======================================
// LOCATION
// ======================================

let coordinates = null;
let timings = {};
let prayerTimezone = null;
let currentPrayer = null;

let notificationTimer = null;
let countdownTimer = null;
let clockTimer = null;
let dailyRefreshTimer = null;

let lastAlerts = load("sakinaLastAlerts", {});

let locationRequestInProgress = false;

function requestLocation() {
    if (!navigator.geolocation) {
        if ($("locationLabel")) {
            $("locationLabel").textContent =
                "المتصفح لا يدعم تحديد الموقع";
        }
        return;
    }

    if (locationRequestInProgress) return;

    locationRequestInProgress = true;

    if ($("locationLabel")) {
        $("locationLabel").textContent =
            "جارٍ تحديد موقعك...";
    }

    navigator.geolocation.getCurrentPosition(
        async position => {
            locationRequestInProgress = false;

            coordinates = {
                lat: position.coords.latitude,
                lon: position.coords.longitude
            };

            save("sakinaLocation", coordinates);

            await loadPrayer();
        },

        error => {
            locationRequestInProgress = false;

            console.error("Location error:", error);

            const messages = {
                1: "اسمح للتطبيق بالوصول إلى موقعك",
                2: "تعذر تحديد موقعك حالياً",
                3: "انتهت مهلة تحديد الموقع"
            };

            if ($("locationLabel")) {
                $("locationLabel").textContent =
                    messages[error.code] || "تعذر تحديد الموقع";
            }
        },

        {
            enableHighAccuracy: true,
            timeout: 20000,
            maximumAge: 300000
        }
    );
}

// ======================================
// PRAYER TIMES
// ======================================

async function loadPrayer() {
    if (!coordinates) return;

    if ($("locationLabel")) {
        $("locationLabel").textContent =
            "جارٍ تحميل مواقيت الصلاة...";
    }

    try {
        const url = new URL(
            "https://api.aladhan.com/v1/timings"
        );

        url.searchParams.set("latitude", coordinates.lat);
        url.searchParams.set("longitude", coordinates.lon);
        url.searchParams.set("method", "4");

        const response = await fetch(url, {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error("Prayer API response error");
        }

        const result = await response.json();

        if (
            result.code !== 200 ||
            !result.data ||
            !result.data.timings
        ) {
            throw new Error("Invalid prayer data");
        }

        const receivedTimings = result.data.timings;

        for (const key of prayerKeys) {
            if (!receivedTimings[key]) {
                throw new Error("Missing prayer: " + key);
            }
        }

        timings = receivedTimings;

        prayerTimezone = result.data.meta?.timezone || null;

        save("sakinaTimings", {
            timings,
            timezone: prayerTimezone,
            date: todayKey()
        });

        if ($("locationLabel")) {
            $("locationLabel").textContent =
                prayerTimezone || "تم تحديد موقعك بنجاح";
        }

        renderPrayers();
        updateCountdown();
        updateIqamaCountdown();

        startCountdown();
        startAlerts();

    } catch (error) {
        console.error("Prayer loading error:", error);

        if ($("locationLabel")) {
            $("locationLabel").textContent =
                "تعذر تحميل المواقيت";
        }

        if ($("prayerGrid")) {
            $("prayerGrid").textContent =
                "تحقق من الإنترنت وحاول تحديث المواقيت.";
        }

        // استخدام آخر مواقيت محفوظة إن وجدت
        const cached = load("sakinaTimings");

        if (cached?.timings?.Fajr) {
            timings = cached.timings;
            prayerTimezone = cached.timezone || null;

            renderPrayers();
            updateCountdown();
            startCountdown();
        }
    }
}

// ======================================
// TIME UTILITIES
// ======================================

function parsePrayerTime(value, baseDate = new Date()) {
    if (!value) return null;

    const match = String(value).match(/^(\d{1,2}):(\d{2})/);

    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);

    if (
        hours < 0 || hours > 23 ||
        minutes < 0 || minutes > 59
    ) {
        return null;
    }

    const date = new Date(baseDate);

    date.setHours(hours, minutes, 0, 0);

    return date;
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

function formatDuration(milliseconds) {
    const seconds = Math.max(
        0,
        Math.floor(milliseconds / 1000)
    );

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    return [hours, minutes, remainingSeconds]
        .map(value => String(value).padStart(2, "0"))
        .join(":");
}

// ======================================
// PRAYER CARDS
// ======================================

function renderPrayers() {
    if (!timings?.Fajr || !$("prayerGrid")) return;

    $("prayerGrid").innerHTML = prayerKeys.map(key => `
        <div class="prayer-card" id="prayer-${key}">
            <small>${prayerNames[key]}</small>
            <strong>${formatTime(timings[key])}</strong>

            ${key === "Sunrise" ? "<em>الشروق</em>" : ""}

            <div class="iqama-countdown" id="iqama-${key}"></div>
        </div>
    `).join("");

    updateCountdown();
    updateIqamaCountdown();
}

// ======================================
// NEXT PRAYER
// ======================================

function getUpcomingPrayer() {
    if (!timings?.Fajr) return null;

    const now = new Date();

    const keys = [
        "Fajr",
        "Dhuhr",
        "Asr",
        "Maghrib",
        "Isha"
    ];

    for (const key of keys) {
        const date = parsePrayerTime(timings[key], now);

        if (date && date > now) {
            return { key, date };
        }
    }

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const fajrTomorrow = parsePrayerTime(
        timings.Fajr,
        tomorrow
    );

    return fajrTomorrow
        ? { key: "Fajr", date: fajrTomorrow }
        : null;
}

function updateCountdown() {
    const upcoming = getUpcomingPrayer();

    if (!upcoming) return;

    currentPrayer = upcoming.key;

    if ($("nextName")) {
        $("nextName").textContent =
            prayerNames[upcoming.key];
    }

    if ($("countdown")) {
        $("countdown").textContent = formatDuration(
            upcoming.date.getTime() - Date.now()
        );
    }

    document.querySelectorAll(".prayer-card").forEach(card => {
        card.classList.toggle(
            "active",
            card.id === "prayer-" + upcoming.key
        );
    });
}

function startCountdown() {
    if (countdownTimer !== null) {
        clearInterval(countdownTimer);
    }

    updateCountdown();

    countdownTimer = setInterval(() => {
        updateCountdown();
        updateIqamaCountdown();
    }, 1000);
}

// ======================================
// IQAMA COUNTDOWN
// ======================================

function updateIqamaCountdown() {
    const saved = load("sakinaIqama", {});
    const now = new Date();

    let nextIqama = null;

    for (const key of iqamaKeys) {
        const value = saved[key];

        const element = $("iqama-" + key);

        if (!element) continue;

        if (!value) {
            element.textContent = "";
            continue;
        }

        const date = parsePrayerTime(value, now);

        if (!date) {
            element.textContent = "";
            continue;
        }

        if (date > now && (!nextIqama || date < nextIqama.date)) {
            nextIqama = { key, date };
        }

        element.textContent = "";
    }

    if (nextIqama) {
        const element = $("iqama-" + nextIqama.key);

        if (element) {
            element.textContent =
                "الإقامة بعد " +
                formatDuration(nextIqama.date - now);
        }
    }
}

// ======================================
// ADHAN AUDIO
// ======================================

const adhanAudio = new Audio("./audio/adhan.mp3");

adhanAudio.preload = "auto";
adhanAudio.volume = 1;

let adhanUnlocked = false;

async function playAdhan() {
    if (!$("adhanSound")?.checked) return;

    try {
        adhanAudio.pause();
        adhanAudio.currentTime = 0;

        await adhanAudio.play();

        adhanUnlocked = true;

        if ($("notificationStatus")) {
            $("notificationStatus").textContent =
                "يعمل صوت الأذان.";
        }

    } catch (error) {
        console.warn("Adhan playback error:", error);

        if ($("notificationStatus")) {
            $("notificationStatus").textContent =
                "اضغط تجربة صوت الأذان للسماح بتشغيله.";
        }
    }
}

async function testAdhanSound() {
    try {
        adhanAudio.pause();
        adhanAudio.currentTime = 0;

        await adhanAudio.play();

        adhanUnlocked = true;

        if ($("notificationStatus")) {
            $("notificationStatus").textContent =
                "تم تشغيل صوت الأذان بنجاح.";
        }

    } catch (error) {
        console.error("Adhan test error:", error);

        if ($("notificationStatus")) {
            $("notificationStatus").textContent =
                "تعذر تشغيل الصوت. تحقق من audio/adhan.mp3.";
        }
    }
}

// ======================================
// QURAN DATA
// ======================================

const QURAN_SOURCE =
    "https://raw.githubusercontent.com/dotquran/corpus/main/processed/uthmani/quran-uthmani.json";

const QURAN_ATTRIBUTION =
    "Tanzil Quran Text (Uthmani, Version 1.1) - Copyright © Tanzil Project - CC BY 3.0";

let quranData = null;
let surahs = [];
let currentQuranTab = "surahTab";
let quranLoading = false;

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

// ======================================
// LOAD QURAN
// ======================================

async function loadSurahs() {
    if (quranLoading) return;

    quranLoading = true;

    if ($("surahList")) {
        $("surahList").textContent =
            "جارٍ تحميل القرآن الكريم...";
    }

    try {
        const response = await fetch(QURAN_SOURCE);

        if (!response.ok) {
            throw new Error("Quran source unavailable");
        }

        const data = await response.json();

        if (
            !Array.isArray(data.surahs) ||
            data.surahs.length !== 114
        ) {
            throw new Error("Incomplete Quran data");
        }

        quranData = data;
        surahs = data.surahs;

        renderSurahs();
        renderJuz();

    } catch (error) {
        console.error("Quran loading error:", error);

        if ($("surahList")) {
            $("surahList").innerHTML = `
                <p>تعذر تحميل المصحف حالياً.</p>
                <button class="outline-btn" onclick="loadSurahs()">
                    إعادة المحاولة
                </button>
            `;
        }

        if ($("juzList")) {
            $("juzList").textContent =
                "تعذر تحميل الأجزاء.";
        }

    } finally {
        quranLoading = false;
    }
}

// ======================================
// SURAH INDEX
// ======================================

function renderSurahs() {
    if (!$("surahList")) return;

    $("surahList").innerHTML = surahs.map(s => {
        const count = s.ayahs.filter(
            ayah => Number(ayah.number) > 0
        ).length;

        return `
            <button onclick="readSurah(${Number(s.number)})">
                ${arabicNumber(s.number)}. ${escapeHTML(s.name)}
                <small>
                    ${arabicNumber(count)} آية ·
                    ${escapeHTML(s.loc || "")}
                </small>
            </button>
        `;
    }).join("");
}

// ======================================
// JUZ INDEX
// ======================================

function renderJuz() {
    if (!$("juzList")) return;

    $("juzList").innerHTML = Array.from(
        { length: 30 },
        (_, index) => `
            <button onclick="readJuz(${index + 1})">
                الجزء ${arabicNumber(index + 1)}
                <small>الجزء ${arabicNumber(index + 1)} من القرآن</small>
            </button>
        `
    ).join("");
}

// ======================================
// QURAN TABS
// ======================================

function quranTab(tab) {
    if (!["surahTab", "juzTab"].includes(tab)) return;

    currentQuranTab = tab;

    $("surahTab").hidden = tab !== "surahTab";
    $("juzTab").hidden = tab !== "juzTab";

    if ($("quranSearch")) {
        $("quranSearch").value = "";
    }

    filterQuran();
}

// ======================================
// QURAN SEARCH
// ======================================

function filterQuran() {
    if (!quranData) return;

    const query = normalizeArabic(
        $("quranSearch")?.value || ""
    );

    if (currentQuranTab === "surahTab") {
        const filtered = surahs.filter(s => {
            return (
                normalizeArabic(s.name).includes(query) ||
                String(s.number) === query
            );
        });

        $("surahList").innerHTML = filtered.map(s => {
            const count = s.ayahs.filter(
                a => Number(a.number) > 0
            ).length;

            return `
                <button onclick="readSurah(${Number(s.number)})">
                    ${arabicNumber(s.number)}. ${escapeHTML(s.name)}
                    <small>${arabicNumber(count)} آية</small>
                </button>
            `;
        }).join("") || "<p>لا توجد نتائج</p>";

    } else {
        const filtered = Array.from(
            { length: 30 },
            (_, index) => index + 1
        ).filter(number => {
            return (
                String(number) === query ||
                normalizeArabic("الجزء " + number).includes(query)
            );
        });

        $("juzList").innerHTML = filtered.map(number => `
            <button onclick="readJuz(${number})">
                الجزء ${arabicNumber(number)}
                <small>الجزء ${arabicNumber(number)} من القرآن</small>
            </button>
        `).join("") || "<p>لا توجد نتائج</p>";
    }
}

// ======================================
// ALL QURAN AYAHS
// ======================================

function getAllQuranAyahs() {
    if (!quranData) return [];

    const all = [];

    for (const surah of surahs) {
        for (const ayah of surah.ayahs) {
            if (Number(ayah.number) > 0) {
                all.push({
                    surahNumber: Number(surah.number),
                    surahName: surah.name,
                    number: Number(ayah.number),
                    text: ayah.text
                });
            }
        }
    }

    return all;
}

// ======================================
// AYAH MARK
// ======================================

function renderAyahMark(number) {
    return `
        <span class="ayah-mark" aria-label="رقم الآية ${number}">
            ۝<span class="ayah-number">${arabicNumber(number)}</span>
        </span>
    `;
}

function renderQuranAyahs(ayahs) {
    return ayahs.map(ayah => `
        <span class="ayah">${escapeHTML(ayah.text)}</span>
        ${renderAyahMark(ayah.number)}
    `).join(" ");
}

// ======================================
// QURAN ATTRIBUTION
// ======================================

function addQuranAttribution(reader) {
    const oldCredit = reader.querySelector(".quran-source");

    if (oldCredit) oldCredit.remove();

    const credit = document.createElement("p");

    credit.className = "quran-source";

    credit.style.cssText =
        "font-size:12px;text-align:center;opacity:.7;margin-top:25px;line-height:2";

    const link = document.createElement("a");

    link.href = "https://tanzil.net";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Tanzil.net";

    credit.append(
        document.createTextNode(QURAN_ATTRIBUTION + " — "),
        link
    );

    reader.appendChild(credit);
}

// ======================================
// QURAN READER
// ======================================

function loadQuranText(title, ayahs, surahNumber = null) {
    const reader = $("reader");
    const titleBox = $("readerTitle");
    const ayahsBox = $("ayahs");
    const basmalaBox = $("basmala");

    if (!reader || !titleBox || !ayahsBox || !basmalaBox) {
        console.error("Quran reader elements are missing");
        return;
    }

    if (!Array.isArray(ayahs) || ayahs.length === 0) {
        ayahsBox.textContent = "لا توجد آيات للعرض";
        basmalaBox.hidden = true;
        return;
    }

    reader.hidden = false;
    titleBox.textContent = title;

    basmalaBox.hidden = true;
    basmalaBox.textContent = "";

    const separateBasmala = ayahs.find(
        ayah => Number(ayah.number) === 0
    );

    let displayAyahs = ayahs.filter(
        ayah => Number(ayah.number) > 0
    );

    if (Number(surahNumber) === 1) {
        const firstAyah = displayAyahs.find(
            ayah => Number(ayah.number) === 1
        );

        if (firstAyah) {
            basmalaBox.hidden = false;
            basmalaBox.textContent = firstAyah.text;

            displayAyahs = displayAyahs.filter(
                ayah => Number(ayah.number) !== 1
            );
        }
    } else if (
        surahNumber !== null &&
        Number(surahNumber) !== 9 &&
        separateBasmala
    ) {
        basmalaBox.hidden = false;
        basmalaBox.textContent = separateBasmala.text;
    }

    ayahsBox.innerHTML = renderQuranAyahs(displayAyahs);

    addQuranAttribution(reader);

    reader.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

// ======================================
// OPEN SURAH
// ======================================

function readSurah(number) {
    if (!quranData) {
        alert("انتظر حتى يكتمل تحميل القرآن");
        return;
    }

    const surah = surahs.find(
        s => Number(s.number) === Number(number)
    );

    if (!surah) {
        alert("تعذر العثور على السورة");
        return;
    }

    loadQuranText(
        surah.name,
        surah.ayahs,
        Number(number)
    );
}

// ======================================
// OPEN JUZ
// ======================================

function readJuz(number) {
    if (!quranData) {
        alert("انتظر حتى يكتمل تحميل القرآن");
        return;
    }

    if (
        !Number.isInteger(number) ||
        number < 1 ||
        number > 30
    ) return;

    const allAyahs = getAllQuranAyahs();

    const [startSurah, startAyah] =
        juzStarts[number - 1];

    const startIndex = allAyahs.findIndex(ayah =>
        ayah.surahNumber === startSurah &&
        ayah.number === startAyah
    );

    if (startIndex === -1) {
        alert("تعذر تحديد بداية الجزء");
        return;
    }

    let endIndex = allAyahs.length;

    if (number < 30) {
        const [nextSurah, nextAyah] =
            juzStarts[number];

        const nextIndex = allAyahs.findIndex(ayah =>
            ayah.surahNumber === nextSurah &&
            ayah.number === nextAyah
        );

        if (nextIndex !== -1) {
            endIndex = nextIndex;
        }
    }

    loadQuranText(
        "الجزء " + arabicNumber(number),
        allAyahs.slice(startIndex, endIndex),
        null
    );
}

// ======================================
// CLOSE QURAN READER
// ======================================

function closeReader() {
    if (!$("reader")) return;

    $("reader").hidden = true;

    $("quranPage")?.scrollIntoView({
        behavior: "smooth"
    });
}

// ======================================
// AZKAR DATABASE
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
            text: "آيَةُ الْكُرْسِيِّ: اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ ۚ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ ۚ لَهُ مَا فِي السَّمَاوَاتِ وَمَا فِي الْأَرْضِ ۗ مَنْ ذَا الَّذِي يَشْفَعُ عِنْدَهُ إِلَّا بِإِذْنِهِ ۚ يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ ۖ وَلَا يُحِيطُونَ بِشَيْءٍ مِنْ عِلْمِهِ إِلَّا بِمَا شَاءَ ۚ وَسِعَ كُرْسِيُّهُ السَّمَاوَاتِ وَالْأَرْضَ ۖ وَلَا يَئُودُهُ حِفْظُهُمَا ۚ وَهُوَ الْعَلِيُّ الْعَظِيمُ",
            count: 1,
            source: "سورة البقرة: 255"
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
            source: "صحيح مسلم - إتمام المئة"
        },
        {
            text: "قُلْ هُوَ اللَّهُ أَحَدٌ",
            count: 1,
            source: "سورة الإخلاص"
        },
        {
            text: "قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ",
            count: 1,
            source: "سورة الفلق"
        },
        {
            text: "قُلْ أَعُوذُ بِرَبِّ النَّاسِ",
            count: 1,
            source: "سورة الناس"
        },
        {
            text: "لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، يُحْيِي وَيُمِيتُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ",
            count: 10,
            source: "يقال بعد الفجر والمغرب"
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

// ======================================
// AZKAR COUNTER STORAGE
// ======================================

function getZikrStorageKey(type) {
    return "sakinaAzkar_" + todayKey() + "_" + type;
}

function getZikrCounts(type) {
    return load(getZikrStorageKey(type), {});
}

// ======================================
// SHOW AZKAR
// ======================================

function showAzkar(type) {
    const list = azkar[type];

    if (!list || !$("azkarResults")) return;

    const counts = getZikrCounts(type);

    $("azkarResults").innerHTML = `
        <h3>${azkarTitles[type]}</h3>

        ${list.map((item, index) => {
            const count = Math.min(
                Number(counts[index] || 0),
                item.count
            );

            const completed = count >= item.count;

            return `
                <div class="zikr-card">
                    <p class="zikr-text">
                        ${escapeHTML(item.text)}
                    </p>

                    <p class="muted">
                        ${escapeHTML(item.source)}
                    </p>

                    <p>التكرار المطلوب: ${arabicNumber(item.count)}</p>

                    <button
                        class="count-btn"
                        data-count="${count}"
                        ${completed ? "disabled" : ""}
                        onclick="countZikr(this, ${item.count}, '${type}', ${index})"
                    >
                        ${completed
                            ? "اكتمل الذكر"
                            : `اضغط للتسبيح · ${arabicNumber(count)} / ${arabicNumber(item.count)}`
                        }
                    </button>
                </div>
            `;
        }).join("")}
    `;

    $("azkarResults").scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

// ======================================
// COUNT ZIKR
// ======================================

function countZikr(button, max, type, index) {
    let count = Number(button.dataset.count || 0);

    if (count >= max) return;

    count++;

    button.dataset.count = count;

    const counts = getZikrCounts(type);

    counts[index] = count;

    save(getZikrStorageKey(type), counts);

    if (count >= max) {
        button.textContent = "اكتمل الذكر";
        button.disabled = true;
    } else {
        button.textContent =
            `اضغط للتسبيح · ${arabicNumber(count)} / ${arabicNumber(max)}`;
    }
}

// ======================================
// QIBLA
// ======================================

let qiblaBearing = null;
let deviceHeading = null;
let orientationListening = false;

function calculateQibla() {
    if (!coordinates) {
        if ($("qiblaDirection")) {
            $("qiblaDirection").textContent =
                "حدد موقعك أولاً لحساب اتجاه القبلة";
        }

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

    qiblaBearing =
        (Math.atan2(y, x) / rad + 360) % 360;

    if ($("qiblaDegree")) {
        $("qiblaDegree").textContent =
            Math.round(qiblaBearing) + "°";
    }

    if ($("qiblaDirection")) {
        $("qiblaDirection").textContent =
            "اتجاه القبلة من الشمال الحقيقي";
    }

    startCompass();
}

// ======================================
// DEVICE COMPASS
// ======================================

async function startCompass() {
    if (!qiblaBearing) return;

    if (!("DeviceOrientationEvent" in window)) {
        if ($("qiblaDirection")) {
            $("qiblaDirection").textContent =
                "جهازك لا يدعم البوصلة الإلكترونية";
        }
        return;
    }

    try {
        if (
            typeof DeviceOrientationEvent.requestPermission === "function"
        ) {
            const permission =
                await DeviceOrientationEvent.requestPermission();

            if (permission !== "granted") {
                throw new Error("Compass permission denied");
            }
        }

        if (!orientationListening) {
            window.addEventListener(
                "deviceorientation",
                handleOrientation,
                true
            );

            orientationListening = true;
        }

        if ($("qiblaDirection")) {
            $("qiblaDirection").textContent =
                "حرّك جهازك حتى يتجه السهم نحو القبلة";
        }

    } catch (error) {
        console.warn("Compass error:", error);

        if ($("qiblaDirection")) {
            $("qiblaDirection").textContent =
                "تعذر تشغيل البوصلة. تحقق من صلاحية المستشعر.";
        }
    }
}

function handleOrientation(event) {
    let heading = null;

    if (typeof event.webkitCompassHeading === "number") {
        heading = event.webkitCompassHeading;
    } else if (typeof event.alpha === "number") {
        heading = (360 - event.alpha) % 360;
    }

    if (heading === null) return;

    deviceHeading = heading;

    const relativeAngle =
        (qiblaBearing - deviceHeading + 360) % 360;

    const icon = document.querySelector(".qibla-icon");

    if (icon) {
        icon.style.transform =
            `rotate(${relativeAngle}deg)`;
    }

    if ($("qiblaDirection")) {
        $("qiblaDirection").textContent =
            "القبلة على زاوية " +
            Math.round(qiblaBearing) +
            "° من الشمال الحقيقي";
    }
}

// ======================================
// DAILY VERSES
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

    if ($("dailyVerse")) {
        $("dailyVerse").textContent = verse[0];
    }

    if ($("dailyVerseRef")) {
        $("dailyVerseRef").textContent = verse[1];
    }
}

// ======================================
// DAILY TRACKER
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

function getTrackerData() {
    const saved = load("sakinaDailyTracker", null);

    if (!saved || saved.date !== todayKey()) {
        return {
            date: todayKey(),
            checks: []
        };
    }

    return saved;
}

function renderTracker() {
    if (!$("trackerItems")) return;

    const saved = getTrackerData();

    $("trackerItems").innerHTML =
        trackerItems.map((item, index) => `
            <label class="tracker-row">
                ${item}

                <input
                    type="checkbox"
                    ${saved.checks.includes(index) ? "checked" : ""}
                    onchange="saveCheck(${index}, this.checked)"
                >
            </label>
        `).join("");

    updateProgress();
}

function saveCheck(index, checked) {
    const data = getTrackerData();

    data.checks = checked
        ? [...new Set([...data.checks, index])]
        : data.checks.filter(value => value !== index);

    save("sakinaDailyTracker", data);

    updateProgress();
}

function updateProgress() {
    const data = getTrackerData();

    const count = data.checks.length;

    const percentage =
        count / trackerItems.length * 100;

    if ($("progressText")) {
        $("progressText").textContent =
            `${arabicNumber(count)} / ${arabicNumber(trackerItems.length)}`;
    }

    if ($("progressBar")) {
        $("progressBar").style.width =
            percentage + "%";
    }
}

// ======================================
// IQAMA SETTINGS
// ======================================

function setupIqama() {
    if (!$("iqamaSettings")) return;

    const saved = load("sakinaIqama", {});

    $("iqamaSettings").innerHTML =
        iqamaKeys.map(key => `
            <label class="iqama-setting">
                ${prayerNames[key]}

                <input
                    type="time"
                    id="iq-${key}"
                    value="${escapeHTML(saved[key] || "")}"
                >
            </label>
        `).join("");
}

function saveIqama() {
    const data = {};

    iqamaKeys.forEach(key => {
        const element = $("iq-" + key);
        data[key] = element ? element.value : "";
    });

    save("sakinaIqama", data);

    updateIqamaCountdown();

    alert("تم حفظ أوقات الإقامة");
}

// ======================================
// NOTIFICATIONS
// ======================================

function enableNotifications() {
    if (!("Notification" in window)) {
        alert("المتصفح لا يدعم الإشعارات");
        return;
    }

    if (!window.isSecureContext) {
        if ($("notificationStatus")) {
            $("notificationStatus").textContent =
                "الإشعارات تحتاج HTTPS أو localhost.";
        }
        return;
    }

    Notification.requestPermission().then(permission => {
        if (permission === "granted") {
            if ($("notificationStatus")) {
                $("notificationStatus").textContent =
                    "تم السماح بالإشعارات.";
            }

            startAlerts();
        } else {
            if ($("notificationStatus")) {
                $("notificationStatus").textContent =
                    "لم يتم السماح بالإشعارات.";
            }
        }
    }).catch(error => {
        console.error("Notification permission error:", error);
    });
}

// ======================================
// ALERT STORAGE
// ======================================

function hasAlert(key) {
    return Boolean(lastAlerts[key]);
}

function markAlert(key) {
    lastAlerts[key] = true;
    save("sakinaLastAlerts", lastAlerts);
}

// ======================================
// CHECK PRAYER ALERTS
// ======================================

function checkAlerts() {
    if (!timings?.Fajr) return;

    const now = new Date();
    const today = todayKey();

    const prayers = [
        ["Fajr", "الفجر"],
        ["Dhuhr", "الظهر"],
        ["Asr", "العصر"],
        ["Maghrib", "المغرب"],
        ["Isha", "العشاء"]
    ];

    prayers.forEach(([key, name]) => {
        const date = parsePrayerTime(timings[key], now);

        if (!date) return;

        const difference = Math.abs(now.getTime() - date.getTime());

        if (difference > 35000) return;

        const alertKey = today + "_" + key;

        if (hasAlert(alertKey)) return;

        markAlert(alertKey);

        if ($("prayerAlerts")?.checked) {
            notify("حان وقت صلاة " + name);
        }

        if ($("adhanSound")?.checked) {
            playAdhan();
        }
    });

    // Sunrise
    if ($("sunriseAlert")?.checked) {
        const sunrise = parsePrayerTime(timings.Sunrise, now);

        if (sunrise) {
            const difference = Math.abs(now - sunrise);

            if (difference <= 35000) {
                const key = today + "_Sunrise";

                if (!hasAlert(key)) {
                    markAlert(key);
                    notify("حان وقت الشروق");
                }
            }
        }
    }

    // Morning azkar
    if (
        $("morningAlert")?.checked &&
        now.getHours() >= 7 &&
        now.getHours() < 10
    ) {
        sendDailyAlert("morning", today);
    }

    // Evening azkar
    if (
        $("eveningAlert")?.checked &&
        now.getHours() >= 17 &&
        now.getHours() < 20
    ) {
        sendDailyAlert("evening", today);
    }
}

// ======================================
// DAILY ALERTS
// ======================================

function sendDailyAlert(type, today) {
    const key = today + "_" + type;

    if (hasAlert(key)) return;

    notify(
        type === "morning"
            ? "حان وقت أذكار الصباح"
            : "حان وقت أذكار المساء"
    );

    markAlert(key);
}

// ======================================
// SEND NOTIFICATION
// ======================================

function notify(message) {
    if (
        "Notification" in window &&
        Notification.permission === "granted"
    ) {
        try {
            const notification = new Notification(
                "سَكِينَة | SAKINAH",
                {
                    body: message,
                    icon: "./icons/icon-192.png",
                    tag: "sakina-" + todayKey() + "-" + Date.now()
                }
            );

            notification.onclick = () => {
                window.focus();
                notification.close();
            };

        } catch (error) {
            console.error("Notification error:", error);
        }
    }
}

// ======================================
// START ALERTS
// ======================================

function startAlerts() {
    if (notificationTimer !== null) {
        clearInterval(notificationTimer);
    }

    checkAlerts();

    notificationTimer = setInterval(
        checkAlerts,
        5000
    );
}

// ======================================
// ALERT SETTINGS
// ======================================

function setupAlertSettings() {
    const settings = [
        "prayerAlerts",
        "sunriseAlert",
        "morningAlert",
        "eveningAlert",
        "adhanSound"
    ];

    settings.forEach(id => {
        const element = $(id);

        if (!element) return;

        element.checked = load(id, element.checked);

        element.addEventListener("change", () => {
            save(id, element.checked);
        });
    });
}

// ======================================
// PAGE NAVIGATION
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
        const element = $(name + "Page");

        if (element) {
            element.classList.toggle(
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

    if (page === "qibla" && coordinates) {
        calculateQibla();
    }
}

// ======================================
// DAILY REFRESH
// ======================================

function scheduleDailyRefresh() {
    if (dailyRefreshTimer !== null) {
        clearInterval(dailyRefreshTimer);
    }

    let lastDate = todayKey();

    dailyRefreshTimer = setInterval(() => {
        const currentDate = todayKey();

        if (currentDate !== lastDate) {
            lastDate = currentDate;

            lastAlerts = {};

            save("sakinaLastAlerts", lastAlerts);

            updateClock();
            renderTracker();

            if (coordinates) {
                loadPrayer();
            }
        }
    }, 30000);
}

// ======================================
// VISIBILITY CHANGE
// ======================================

document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
        updateClock();
        updateCountdown();
        updateIqamaCountdown();
        checkAlerts();

        if (coordinates && timings?.Fajr) {
            const cached = load("sakinaTimings");

            if (cached?.date !== todayKey()) {
                loadPrayer();
            }
        }
    }
});

// ======================================
// ONLINE / OFFLINE
// ======================================

window.addEventListener("online", () => {
    if (coordinates) {
        loadPrayer();
    }

    if ($("locationLabel")) {
        $("locationLabel").textContent =
            "عاد الاتصال بالإنترنت";
    }
});

window.addEventListener("offline", () => {
    if ($("locationLabel")) {
        $("locationLabel").textContent =
            "أنت غير متصل بالإنترنت";
    }
});

// ======================================
// INITIALIZE APPLICATION
// ======================================

function initializeApp() {
    updateClock();

    if (clockTimer !== null) {
        clearInterval(clockTimer);
    }

    clockTimer = setInterval(updateClock, 1000);

    renderTracker();
    setupIqama();
    setupAlertSettings();

    loadSurahs();

    coordinates = load("sakinaLocation");

    const cached = load("sakinaTimings");

    if (
        cached?.timings?.Fajr &&
        cached.date === todayKey()
    ) {
        timings = cached.timings;
        prayerTimezone = cached.timezone || null;

        renderPrayers();
        startCountdown();
    }

    if (coordinates) {
        loadPrayer();
    } else {
        requestLocation();
    }

    startAlerts();
    scheduleDailyRefresh();

    newVerse();
}

document.addEventListener(
    "DOMContentLoaded",
    initializeApp
);
