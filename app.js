
"use strict";

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
const MAKKAH = { lat: 21.4225, lon: 39.8262 };

let userLocation = null;
let prayerTimes = null;
let qiblaBearing = null;
let currentSurah = null;
let currentAyahs = [];
let compassHeading = 0;

const defaultLocation = {
    lat: 24.4709,
    lon: 39.6122,
    name: "المدينة المنورة"
};

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function formatTime(date) {
    return new Intl.DateTimeFormat("ar-SA", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    }).format(date);
}

function updateClock() {
    const now = new Date();
    $("clock").textContent = now.toLocaleTimeString("en-GB");
    $("gregorianDate").textContent = now.toLocaleDateString("ar-SA", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
    });
    $("hijriDate").textContent = new Intl.DateTimeFormat("ar-SA-u-ca-islamic", {
        day: "numeric",
        month: "long",
        year: "numeric"
    }).format(now);
}

function toRadians(value) {
    return value * Math.PI / 180;
}

function toDegrees(value) {
    return value * 180 / Math.PI;
}

function normalizeAngle(value) {
    return (value + 360) % 360;
}

function calculateQibla(lat, lon) {
    const phi1 = toRadians(lat);
    const phi2 = toRadians(MAKKAH.lat);
    const deltaLambda = toRadians(MAKKAH.lon - lon);

    const y = Math.sin(deltaLambda);
    const x = Math.cos(phi1) * Math.tan(phi2) -
              Math.sin(phi1) * Math.cos(deltaLambda);

    return normalizeAngle(toDegrees(Math.atan2(y, x)));
}

// حساب تقريبي لمواقيت الشمس محلياً دون اتصال
function calculateSunTime(date, lat, lon, angle, isSunrise) {
    const day = Math.floor(
        (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
         Date.UTC(date.getFullYear(), 0, 0)) / 86400000
    );

    const gamma = 2 * Math.PI / 365 * (day - 1);
    const equation = 229.18 * (
        0.000075 + 0.001868 * Math.cos(gamma) -
        0.032077 * Math.sin(gamma) -
        0.014615 * Math.cos(2 * gamma) -
        0.040849 * Math.sin(2 * gamma)
    );

    const declination =
        0.006918 -
        0.399912 * Math.cos(gamma) +
        0.070257 * Math.sin(gamma) -
        0.006758 * Math.cos(2 * gamma) +
        0.000907 * Math.sin(2 * gamma) -
        0.002697 * Math.cos(3 * gamma) +
        0.00148 * Math.sin(3 * gamma);

    const latitude = toRadians(lat);
    const altitude = toRadians(angle);

    const cosHour = (
        Math.sin(altitude) -
        Math.sin(latitude) * Math.sin(declination)
    ) / (
        Math.cos(latitude) * Math.cos(declination)
    );

    if (cosHour < -1 || cosHour > 1) return null;

    const hourAngle = toDegrees(Math.acos(cosHour));
    const noon = 720 - 4 * lon - equation;

    return noon + (isSunrise ? -1 : 1) * 4 * hourAngle;
}

function minutesToDate(minutes, date) {
    if (minutes === null) return null;

    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    result.setMinutes(Math.round(minutes));
    return result;
}

function calculatePrayerTimes(date, lat, lon) {
    const fajr = calculateSunTime(date, lat, lon, -18, true);
    const sunrise = calculateSunTime(date, lat, lon, -0.833, true);
    const sunset = calculateSunTime(date, lat, lon, -0.833, false);
    const isha = calculateSunTime(date, lat, lon, -17, false);
    const noon = (sunrise + sunset) / 2;

    if ([fajr, sunrise, sunset, isha].some(v => v === null)) {
        return null;
    }

    // طريقة حساب العصر: معامل الظل 1
    const gamma = 2 * Math.PI / 365 * (
        Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000)
    );

    const declination =
        0.006918 -
        0.399912 * Math.cos(gamma) +
        0.070257 * Math.sin(gamma) -
        0.006758 * Math.cos(2 * gamma) +
        0.000907 * Math.sin(2 * gamma) -
        0.002697 * Math.cos(3 * gamma) +
        0.00148 * Math.sin(3 * gamma);

    const latRad = toRadians(lat);
    const angle = Math.atan(
        1 / (1 + Math.tan(Math.abs(latRad - declination)))
    );

    const cosHour = (
        Math.sin(angle) -
        Math.sin(latRad) * Math.sin(declination)
    ) / (
        Math.cos(latRad) * Math.cos(declination)
    );

    const asrHour = toDegrees(Math.acos(
        Math.max(-1, Math.min(1, cosHour))
    ));

    const asr = noon + 4 * asrHour;

    return {
        Fajr: minutesToDate(fajr, date),
        Sunrise: minutesToDate(sunrise, date),
        Dhuhr: minutesToDate(noon + 2, date),
        Asr: minutesToDate(asr, date),
        Maghrib: minutesToDate(sunset, date),
        Isha: minutesToDate(isha, date)
    };
}

function getNextPrayer() {
    const now = new Date();
    const today = calculatePrayerTimes(now, userLocation.lat, userLocation.lon);

    if (!today) return null;

    for (const key of prayerKeys) {
        if (key === "Sunrise") continue;
        if (today[key] > now) {
            return { key, date: today[key] };
        }
    }

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const nextDay = calculatePrayerTimes(
        tomorrow, userLocation.lat, userLocation.lon
    );

    return nextDay ? { key: "Fajr", date: nextDay.Fajr } : null;
}

function renderPrayers() {
    prayerTimes = calculatePrayerTimes(
        new Date(), userLocation.lat, userLocation.lon
    );

    if (!prayerTimes) return;

    $("prayerGrid").innerHTML = prayerKeys.map(key => `
        <div class="prayer-card" data-prayer="${key}">
            <small>${prayerNames[key]}</small>
            <strong>${formatTime(prayerTimes[key])}</strong>
            <em>${key === "Sunrise" ? "الشروق" : "موعد الصلاة"}</em>
        </div>
    `).join("");

    updateNextPrayer();
}

function updateNextPrayer() {
    const next = getNextPrayer();
    if (!next) return;

    $("nextPrayerName").textContent = prayerNames[next.key];

    const remaining = Math.max(0, next.date - new Date());
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    $("countdown").textContent = [
        hours, minutes, seconds
    ].map(v => String(v).padStart(2, "0")).join(":");

    document.querySelectorAll(".prayer-card").forEach(card => {
        card.classList.toggle(
            "active",
            card.dataset.prayer === next.key
        );
    });
}

function saveLocation() {
    localStorage.setItem("sakina-location", JSON.stringify(userLocation));
}

function setLocation(location) {
    userLocation = location;
    saveLocation();

    $("locationLabel").textContent = "الموقع: " + location.name;
    $("settingsLocation").textContent = location.name;

    qiblaBearing = calculateQibla(location.lat, location.lon);
    $("qiblaDegree").textContent = Math.round(qiblaBearing) + "°";
    $("qiblaDirection").textContent = "اتجاه القبلة من الشمال الحقيقي";

    renderPrayers();
}

function requestLocation() {
    if (!navigator.geolocation) {
        alert("جهازك لا يدعم تحديد الموقع.");
        return;
    }

    navigator.geolocation.getCurrentPosition(
        position => {
            setLocation({
                lat: position.coords.latitude,
                lon: position.coords.longitude,
                name: "موقعك الحالي"
            });
        },
        () => alert("تعذر تحديد الموقع. تحقق من صلاحيات الموقع والاتصال الآمن."),
        { enableHighAccuracy: true, timeout: 15000 }
    );
}

// التنقل بين الصفحات
function showPage(pageId) {
    document.querySelectorAll(".page").forEach(page => {
        page.classList.toggle("active", page.id === pageId);
    });

    document.querySelectorAll(".nav-item").forEach(button => {
        button.classList.toggle("active", button.dataset.page === pageId);
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.page));
});

$("settingsShortcut").addEventListener("click", () => showPage("settingsPage"));
$("locationButton").addEventListener("click", requestLocation);
$("settingsLocationButton").addEventListener("click", requestLocation);

// القرآن
const surahNames = [
"الفاتحة","البقرة","آل عمران","النساء","المائدة","الأنعام","الأعراف","الأنفال","التوبة","يونس",
"هود","يوسف","الرعد","إبراهيم","الحجر","النحل","الإسراء","الكهف","مريم","طه",
"الأنبياء","الحج","المؤمنون","النور","الفرقان","الشعراء","النمل","القصص","العنكبوت","الروم",
"لقمان","السجدة","الأحزاب","سبأ","فاطر","يس","الصافات","ص","الزمر","غافر",
"فصلت","الشورى","الزخرف","الدخان","الجاثية","الأحقاف","محمد","الفتح","الحجرات","ق",
"الذاريات","الطور","النجم","القمر","الرحمن","الواقعة","الحديد","المجادلة","الحشر","الممتحنة",
"الصف","الجمعة","المنافقون","التغابن","الطلاق","التحريم","الملك","القلم","الحاقة","المعارج",
"نوح","الجن","المزمل","المدثر","القيامة","الإنسان","المرسلات","النبأ","النازعات","عبس",
"التكوير","الانفطار","المطففين","الانشقاق","البروج","الطارق","الأعلى","الغاشية","الفجر","البلد",
"الشمس","الليل","الضحى","الشرح","التين","العلق","القدر","البينة","الزلزلة","العاديات",
"القارعة","التكاثر","العصر","الهمزة","الفيل","قريش","الماعون","الكوثر","الكافرون","النصر",
"المسد","الإخلاص","الفلق","الناس"
];

function renderSurahs() {
    $("surahList").innerHTML = surahNames.map((name, index) => `
        <button data-surah="${index + 1}">
            ${index + 1}. ${name}
            <small>السورة رقم ${index + 1}</small>
        </button>
    `).join("");

    $("surahList").querySelectorAll("button").forEach(button => {
        button.addEventListener("click", () => {
            openSurah(Number(button.dataset.surah));
        });
    });
}

function renderJuz() {
    $("juzList").innerHTML = Array.from({ length: 30 }, (_, i) => `
        <button data-juz="${i + 1}">
            الجزء ${i + 1}
            <small>الجزء رقم ${i + 1} — يتطلب تحميل بيانات المصحف</small>
        </button>
    `).join("");

    $("juzList").querySelectorAll("button").forEach(button => {
        button.addEventListener("click", () => {
            alert("تصفح الأجزاء الكامل يحتاج إلى فهرس آيات محلي.");
        });
    });
}

async function fetchSurah(number) {
    const cached = localStorage.getItem("sakina-surah-" + number);
    if (cached) {
        try { return JSON.parse(cached); } catch (_) {}
    }

    const response = await fetch(
        `https://api.alquran.cloud/v1/surah/${number}/quran-uthmani`
    );

    if (!response.ok) throw new Error("تعذر تحميل السورة");
    const result = await response.json();

    if (result.code !== 200) throw new Error("بيانات السورة غير متاحة");

    localStorage.setItem(
        "sakina-surah-" + number,
        JSON.stringify(result.data)
    );

    return result.data;
}

async function openSurah(number) {
    currentSurah = number;
    $("readerPanel").hidden = false;
    $("surahList").hidden = true;
    $("juzList").hidden = true;
    $("readerTitle").textContent = surahNames[number - 1];
    $("quranText").textContent = "";
    $("quranLoading").textContent = "جاري تحميل السورة...";
    $("basmala").hidden = number === 1 || number === 9;

    try {
        const data = await fetchSurah(number);
        currentAyahs = data.ayahs || [];

        $("quranText").innerHTML = currentAyahs.map(ayah => `
            <span>${escapeHTML(ayah.text)}
                <span class="ayah-mark">۞
                    <span class="ayah-number">${ayah.numberInSurah}</span>
                </span>
            </span>
        `).join(" ");

        $("quranLoading").textContent = "";
    } catch (error) {
        $("quranLoading").textContent =
            "تعذر تحميل السورة. اتصل بالإنترنت وحاول مجدداً.";
    }
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#39;"
    })[char]);
}

$("surahTab").addEventListener("click", () => {
    $("surahList").hidden = false;
    $("juzList").hidden = true;
    $("readerPanel").hidden = true;
});

$("juzTab").addEventListener("click", () => {
    $("surahList").hidden = true;
    $("juzList").hidden = false;
    $("readerPanel").hidden = true;
});

$("backToSurahs").addEventListener("click", () => {
    $("readerPanel").hidden = true;
    $("surahList").hidden = false;
});

$("quranSearch").addEventListener("input", event => {
    const query = event.target.value.trim();
    $("surahList").querySelectorAll("button").forEach(button => {
        button.hidden = !button.textContent.includes(query);
    });
});

$("downloadQuran").addEventListener("click", async () => {
    if (!currentSurah) return;
    try {
        await fetchSurah(currentSurah);
        alert("تم حفظ السورة على جهازك للقراءة دون إنترنت.");
    } catch (_) {
        alert("تعذر الحفظ. اتصل بالإنترنت أولاً.");
    }
});

// الأذكار
const adhkar = [
    {
        title: "أذكار الصباح",
        items: [
            ["أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ", 1, "ذكر الصباح"],
            ["سُبْحَانَ اللَّهِ وَبِحَمْدِهِ", 100, "من قالها مئة مرة"],
            ["أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ", 100, "الاستغفار"]
        ]
    },
    {
        title: "أذكار المساء",
        items: [
            ["أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ", 1, "ذكر المساء"],
            ["سُبْحَانَ اللَّهِ وَبِحَمْدِهِ", 100, "من قالها مئة مرة"],
            ["أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ", 100, "الاستغفار"]
        ]
    },
    {
        title: "أذكار عامة",
        items: [
            ["سُبْحَانَ اللَّهِ", 33, "التسبيح"],
            ["الْحَمْدُ لِلَّهِ", 33, "التحميد"],
            ["اللَّهُ أَكْبَرُ", 34, "التكبير"]
        ]
    }
];

function renderAdhkar() {
    $("adhkarContainer").innerHTML = adhkar.map((group, groupIndex) => `
        <div class="section">
            <h3>${group.title}</h3>
            ${group.items.map((item, index) => `
                <div class="zikr-card">
                    <p class="zikr-text">${item[0]}</p>
                    <p class="muted">${item[2]}</p>
                    <p>المتبقي: <strong id="zikr-${groupIndex}-${index}">${item[1]}</strong></p>
                    <button class="count-btn"
                        data-group="${groupIndex}"
                        data-index="${index}"
                        data-count="${item[1]}">تسبيح</button>
                </div>
            `).join("")}
        </div>
    `).join("");

    $("adhkarContainer").querySelectorAll(".count-btn").forEach(button => {
        button.addEventListener("click", () => {
            const id = `zikr-${button.dataset.group}-${button.dataset.index}`;
            const count = $(id);
            const next = Math.max(0, Number(count.textContent) - 1);
            count.textContent = next;
            if (next === 0) button.disabled = true;
        });
    });
}

// البوصلة
function updateCompass(heading) {
    compassHeading = heading;
    if (qiblaBearing === null) return;

    const rotation = qiblaBearing - heading;
    $("compassNeedle").style.transform = `rotate(${rotation}deg)`;
    $("compassStatus").textContent = "البوصلة تعمل — اتبع اتجاه السهم";
}

async function enableCompass() {
    if (!userLocation) {
        alert("حدد موقعك أولاً.");
        return;
    }

    if (typeof DeviceOrientationEvent === "undefined") {
        $("compassStatus").textContent = "هذا الجهاز لا يدعم مستشعر الاتجاه.";
        return;
    }

    if (typeof DeviceOrientationEvent.requestPermission === "function") {
        try {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission !== "granted") {
                $("compassStatus").textContent = "لم يتم السماح باستخدام المستشعر.";
                return;
            }
        } catch (_) {
            $("compassStatus").textContent = "تعذر تشغيل مستشعر الاتجاه.";
            return;
        }
    }

    window.addEventListener("deviceorientationabsolute", handleOrientation, true);
    window.addEventListener("deviceorientation", handleOrientation, true);
    $("compassStatus").textContent = "بانتظار قراءة مستشعر الاتجاه...";
}

function handleOrientation(event) {
    let heading = null;

    if (typeof event.webkitCompassHeading === "number") {
        heading = event.webkitCompassHeading;
    } else if (event.absolute && typeof event.alpha === "number") {
        heading = 360 - event.alpha;
    }

    if (heading !== null) updateCompass(normalizeAngle(heading));
}

$("enableCompass").addEventListener("click", enableCompass);

// متابعة الصلاة
function renderTracker() {
    const key = "sakina-tracker-" + todayKey();
    const saved = JSON.parse(localStorage.getItem(key) || "{}");

    const names = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

    $("trackerList").innerHTML = names.map(name => `
        <label class="tracker-row">
            <span>${prayerNames[name]}</span>
            <input type="checkbox" data-track="${name}" ${saved[name] ? "checked" : ""}>
        </label>
    `).join("");

    $("trackerList").querySelectorAll("input").forEach(input => {
        input.addEventListener("change", () => {
            const current = JSON.parse(localStorage.getItem(key) || "{}");
            current[input.dataset.track] = input.checked;
            localStorage.setItem(key, JSON.stringify(current));
            updateTrackerProgress();
        });
    });

    updateTrackerProgress();
}

function updateTrackerProgress() {
    const checks = [...$("trackerList").querySelectorAll("input")];
    const done = checks.filter(input => input.checked).length;

    $("progressText").textContent = `${done} من 5 صلوات`;
    $("progressBar").style.width = `${done / 5 * 100}%`;
}

$("resetTracker").addEventListener("click", () => {
    if (!confirm("هل تريد إعادة تعيين متابعة اليوم؟")) return;
    localStorage.removeItem("sakina-tracker-" + todayKey());
    renderTracker();
});

// الملفات دون إنترنت
$("cacheApp").addEventListener("click", async () => {
    if (!("serviceWorker" in navigator)) {
        alert("متصفحك لا يدعم هذه الخاصية.");
        return;
    }

    try {
        const registration = await navigator.serviceWorker.ready;
        await registration.update();
        $("offlineStatus").textContent = "تم فحص تحديث ملفات التطبيق.";
    } catch (_) {
        $("offlineStatus").textContent = "تعذر تحديث الملفات.";
    }
});

// آية اليوم
const dailyVerses = [
    ["إِنَّ مَعَ الْعُسْرِ يُسْرًا", "الشرح - ٦"],
    ["فَاذْكُرُونِي أَذْكُرْكُمْ", "البقرة - ١٥٢"],
    ["وَهُوَ مَعَكُمْ أَيْنَ مَا كُنْتُمْ", "الحديد - ٤"],
    ["إِنَّ اللَّهَ مَعَ الصَّابِرِينَ", "البقرة - ١٥٣"],
    ["وَمَا تَوْفِيقِي إِلَّا بِاللَّهِ", "هود - ٨٨"]
];

function renderDailyVerse() {
    const verse = dailyVerses[new Date().getDate() % dailyVerses.length];
    $("dailyVerse").textContent = verse[0];
    $("dailyVerseRef").textContent = "سورة " + verse[1];
}

function init() {
    const saved = localStorage.getItem("sakina-location");
    let location = defaultLocation;

    if (saved) {
        try { location = JSON.parse(saved); } catch (_) {}
    }

    setLocation(location);
    renderSurahs();
    renderJuz();
    renderAdhkar();
    renderTracker();
    renderDailyVerse();
    updateClock();

    setInterval(() => {
        updateClock();
        updateNextPrayer();

        if (new Date().getHours() === 0 &&
            new Date().getMinutes() === 0 &&
            new Date().getSeconds() < 2) {
            renderPrayers();
            renderTracker();
        }
    }, 1000);
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./service-worker.js")
            .catch(error => console.error("Service Worker:", error));
    });
}

init();
