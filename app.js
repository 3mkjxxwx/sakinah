"use strict";

/* SAKINAH — PART 1 */

const $ = id => document.getElementById(id);

const CITY = "Tabuk";
const COUNTRY = "Saudi Arabia";

const PRAYERS = {
    Fajr: "الفجر",
    Sunrise: "الشروق",
    Dhuhr: "الظهر",
    Asr: "العصر",
    Maghrib: "المغرب",
    Isha: "العشاء"
};

const MAIN_PRAYERS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
const PRAYER_KEYS = Object.keys(PRAYERS);

const BACKGROUNDS = {
    Fajr: "fajr.jpg",
    Sunrise: "sunrise.jpg",
    Dhuhr: "dhuhr.jpg",
    Asr: "asr.jpg",
    Maghrib: "maghrib.jpg",
    Isha: "isha.jpg"
};

const IQAMA_DEFAULTS = {
    Fajr: 20,
    Dhuhr: 20,
    Asr: 15,
    Maghrib: 7,
    Isha: 15
};

let prayerTimes = null;
let currentPrayer = null;
let currentLocation = {
    lat: 28.3838,
    lon: 36.5550,
    name: "تبوك"
};

let iqamaSettings = {
    ...IQAMA_DEFAULTS,
    ...loadJSON("sakina-iqama-settings", {})
};

let iqamaEnd = null;
let lastAdhan = loadJSON("sakina-last-adhan", "");
let qiblaBearing = 0;
let compassHeading = 0;
let readerMode = "surah";

function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
}

function loadJSON(key, fallback) {
    try {
        return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
        return fallback;
    }
}

function saveJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn(error);
    }
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function localDateKey(date = new Date()) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function formatTime(date) {
    return new Intl.DateTimeFormat("ar-SA", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    }).format(date);
}

/* الساعة والتاريخ */

function updateClock() {
    const now = new Date();

    setText("clock", new Intl.DateTimeFormat("ar-SA", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
    }).format(now));

    const gregorian = new Intl.DateTimeFormat("ar-SA", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
    }).format(now);

    setText("gregorianDate", gregorian);

    const hijri = new Intl.DateTimeFormat(
        "ar-SA-u-ca-islamic-umalqura",
        {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric"
        }
    ).format(now);

    setText("hijriDate", hijri);
}

/* مواقيت الصلاة */

function parsePrayerTime(value, date) {
    const match = String(value).match(/(\d{1,2}):(\d{2})/);
    if (!match) return null;

    const result = new Date(date);
    result.setHours(Number(match[1]), Number(match[2]), 0, 0);

    return result;
}

async function fetchPrayerTimes() {
    const date = new Date();

    const dateString = [
        String(date.getDate()).padStart(2, "0"),
        String(date.getMonth() + 1).padStart(2, "0"),
        date.getFullYear()
    ].join("-");

    const url =
        `https://api.aladhan.com/v1/timingsByCity/${dateString}` +
        `?city=${encodeURIComponent(CITY)}` +
        `&country=${encodeURIComponent(COUNTRY)}` +
        `&method=4`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Prayer API error");

        const json = await response.json();

        if (json.code !== 200) {
            throw new Error("Invalid prayer data");
        }

        const result = {};

        for (const key of PRAYER_KEYS) {
            result[key] = parsePrayerTime(
                json.data.timings[key],
                date
            );

            if (!result[key]) {
                throw new Error("Missing prayer " + key);
            }
        }

        prayerTimes = result;

        renderPrayerTimes();
        updateNextPrayer();

        setText("locationLabel", "الموقع: تبوك");
        setText("settingsLocation", "تبوك");

        return true;

    } catch (error) {
        console.error(error);
        setText("locationLabel", "تعذر تحميل المواقيت");
        setText("prayerGrid", "تحقق من اتصال الإنترنت");

        return false;
    }
}

function renderPrayerTimes() {
    const grid = $("prayerGrid");
    if (!grid || !prayerTimes) return;

    grid.innerHTML = PRAYER_KEYS.map(key => `
        <div class="prayer-card" data-prayer="${key}">
            <small>${PRAYERS[key]}</small>
            <strong>${formatTime(prayerTimes[key])}</strong>
            <em>${key === "Sunrise" ? "الشروق" : "موعد الصلاة"}</em>
        </div>
    `).join("");
}

/* الصلاة القادمة ومضى على الأذان */

function getPrayerState() {
    if (!prayerTimes) return null;

    const now = new Date();

    for (const key of MAIN_PRAYERS) {
        const time = prayerTimes[key];
        const elapsed = now - time;

        if (elapsed >= 0 && elapsed < 60 * 60000) {
            return {
                type: "elapsed",
                key,
                time
            };
        }

        if (time > now) {
            return {
                type: "next",
                key,
                time
            };
        }
    }

    const tomorrow = new Date(prayerTimes.Fajr);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return {
        type: "next",
        key: "Fajr",
        time: tomorrow
    };
}

function updateNextPrayer() {
    if (!prayerTimes) return;

    const state = getPrayerState();
    if (!state) return;

    if (state.type === "elapsed") {
        const elapsed = new Date() - state.time;
        const mins = Math.floor(elapsed / 60000);

        setText("nextPrayerName", PRAYERS[state.key]);

        setText(
            "countdown",
            `مضى على أذان ${PRAYERS[state.key]} ${mins} دقيقة`
        );

    } else {
        const remaining = state.time - new Date();

        const hours = Math.floor(remaining / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);

        setText("nextPrayerName", PRAYERS[state.key]);

        setText(
            "countdown",
            [hours, minutes, seconds]
                .map(v => String(v).padStart(2, "0"))
                .join(":")
        );
    }

    currentPrayer = state.key;

    document.querySelectorAll(".prayer-card").forEach(card => {
        card.classList.toggle(
            "active",
            card.dataset.prayer === state.key
        );
    });

    updatePrayerBackground(state.key);
}

/* الخلفيات */

function updatePrayerBackground(key) {
    const hero = $("prayerHero");
    if (!hero) return;

    hero.style.backgroundImage =
        `linear-gradient(rgba(8,11,9,.35),rgba(8,11,9,.60)),url("./images/${BACKGROUNDS[key]}")`;

    hero.style.backgroundSize = "cover";
    hero.style.backgroundPosition = "center";
    hero.style.backgroundRepeat = "no-repeat";
}

/* التنقل */

function showPage(page) {
    const id = page.endsWith("Page") ? page : page + "Page";

    document.querySelectorAll(".page").forEach(element => {
        element.classList.toggle("active", element.id === id);
    });

    document.querySelectorAll(".nav-item").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.page === id
        );
    });

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

function setupNavigation() {
    document.addEventListener("click", event => {
        const button = event.target.closest("[data-page]");
        if (button) showPage(button.dataset.page);
    });

    $("settingsShortcut")?.addEventListener("click", () => {
        showPage("settingsPage");
    });

    $("locationButton")?.addEventListener("click", requestLocation);
    $("settingsLocationButton")?.addEventListener("click", requestLocation);
}

function requestLocation() {
    alert("المواقيت محسوبة حالياً لمدينة تبوك.");
}

/* SAKINAH — PART 2 */

/* القرآن الكريم */

const SURAH_NAMES = [
"الفاتحة","البقرة","آل عمران","النساء","المائدة","الأنعام",
"الأعراف","الأنفال","التوبة","يونس","هود","يوسف","الرعد",
"إبراهيم","الحجر","النحل","الإسراء","الكهف","مريم","طه",
"الأنبياء","الحج","المؤمنون","النور","الفرقان","الشعراء",
"النمل","القصص","العنكبوت","الروم","لقمان","السجدة",
"الأحزاب","سبأ","فاطر","يس","الصافات","ص","الزمر","غافر",
"فصلت","الشورى","الزخرف","الدخان","الجاثية","الأحقاف",
"محمد","الفتح","الحجرات","ق","الذاريات","الطور","النجم",
"القمر","الرحمن","الواقعة","الحديد","المجادلة","الحشر",
"الممتحنة","الصف","الجمعة","المنافقون","التغابن","الطلاق",
"التحريم","الملك","القلم","الحاقة","المعارج","نوح","الجن",
"المزمل","المدثر","القيامة","الإنسان","المرسلات","النبأ",
"النازعات","عبس","التكوير","الانفطار","المطففين","الانشقاق",
"البروج","الطارق","الأعلى","الغاشية","الفجر","البلد",
"الشمس","الليل","الضحى","الشرح","التين","العلق","القدر",
"البينة","الزلزلة","العاديات","القارعة","التكاثر","العصر",
"الهمزة","الفيل","قريش","الماعون","الكوثر","الكافرون",
"النصر","المسد","الإخلاص","الفلق","الناس"
];

function renderSurahs() {
    const list = $("surahList");
    if (!list) return;

    list.innerHTML = SURAH_NAMES.map((name, index) => `
        <button type="button" data-surah="${index + 1}">
            ${index + 1}. ${name}
        </button>
    `).join("");
}

function renderJuz() {
    const list = $("juzList");
    if (!list) return;

    list.innerHTML = Array.from({ length: 30 }, (_, index) => `
        <button type="button" data-juz="${index + 1}">
            الجزء ${index + 1}
        </button>
    `).join("");
}

function quranTab(tab) {
    const showSurahs = tab === "surahTab";

    $("surahList").hidden = !showSurahs;
    $("juzList").hidden = showSurahs;

    $("surahTab").classList.toggle("selected", showSurahs);
    $("juzTab").classList.toggle("selected", !showSurahs);

    $("quranSearch").value = "";
    $("quranSearch").placeholder =
        showSurahs ? "ابحث عن سورة..." : "ابحث عن جزء...";
}

function filterQuran() {
    const query = $("quranSearch").value.trim();

    const list = $("juzList").hidden
        ? $("surahList")
        : $("juzList");

    list.querySelectorAll("button").forEach(button => {
        button.hidden = !button.textContent.includes(query);
    });
}

function showReader(title, mode) {
    $("readerPanel").hidden = false;

    setText("readerTitle", title);
    setText("quranText", "جارٍ تحميل القرآن الكريم...");

    readerMode = mode;

    $("surahList").hidden = true;
    $("juzList").hidden = true;
    $("surahTab").hidden = true;
    $("juzTab").hidden = true;
    $("quranSearch").hidden = true;
}

function hideReader() {
    $("readerPanel").hidden = true;

    $("surahTab").hidden = false;
    $("juzTab").hidden = false;
    $("quranSearch").hidden = false;

    $("surahList").hidden = readerMode !== "surah";
    $("juzList").hidden = readerMode !== "juz";
}

async function openSurah(number) {
    if (number < 1 || number > 114) return;

    readerMode = "surah";
    showReader(SURAH_NAMES[number - 1], "surah");

    $("basmala").hidden = true;

    try {
        const response = await fetch(
            `https://api.alquran.cloud/v1/surah/${number}/quran-uthmani`
        );

        if (!response.ok) throw new Error("Quran API error");

        const json = await response.json();

        if (json.code !== 200) throw new Error("Invalid data");

        if (number !== 1 && number !== 9) {
            $("basmala").hidden = false;
        }

        $("quranText").innerHTML = json.data.ayahs.map(ayah => `
            <span class="ayah">
                ${escapeHTML(ayah.text)}
                <span class="ayah-circle">${ayah.numberInSurah}</span>
            </span>
        `).join(" ");

    } catch (error) {
        console.error(error);
        setText("quranText", "تعذر تحميل السورة.");
    }
}

async function openJuz(number) {
    if (number < 1 || number > 30) return;

    readerMode = "juz";
    showReader("الجزء " + number, "juz");

    $("basmala").hidden = true;

    try {
        const response = await fetch(
            `https://api.alquran.cloud/v1/juz/${number}/quran-uthmani`
        );

        if (!response.ok) throw new Error("Juz API error");

        const json = await response.json();

        if (json.code !== 200) throw new Error("Invalid data");

        const groups = {};

        json.data.ayahs.forEach(ayah => {
            const name = ayah.surah.name;

            if (!groups[name]) groups[name] = [];

            groups[name].push(ayah);
        });

        $("quranText").innerHTML = Object.entries(groups).map(
            ([name, ayahs]) => `
                <section>
                    <h3>${escapeHTML(name)}</h3>
                    ${ayahs.map(ayah => `
                        <span class="ayah">
                            ${escapeHTML(ayah.text)}
                            <span class="ayah-circle">
                                ${ayah.numberInSurah}
                            </span>
                        </span>
                    `).join(" ")}
                </section>
            `
        ).join("");

    } catch (error) {
        console.error(error);
        setText("quranText", "تعذر تحميل الجزء.");
    }
}

/* الأذكار */

const AZKAR = {
    morning: {
        title: "أذكار الصباح",
        items: [
            ["آية الكرسي",1,"اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ..."],
            ["الإخلاص",3,"قُلْ هُوَ اللَّهُ أَحَدٌ"],
            ["الفلق",3,"قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ"],
            ["الناس",3,"قُلْ أَعُوذُ بِرَبِّ النَّاسِ"],
            ["سيد الاستغفار",1,"اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ بِذَنْبِي فَاغْفِرْ لِي."],
            ["أصبحنا وأصبح الملك لله",1,"أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ."],
            ["رضيت بالله رباً",3,"رَضِيتُ بِاللَّهِ رَبًّا، وَبِالْإِسْلَامِ دِينًا، وَبِمُحَمَّدٍ ﷺ نَبِيًّا."],
            ["بسم الله الذي لا يضر",3,"بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ."],
            ["سبحان الله وبحمده",100,"سُبْحَانَ اللَّهِ وَبِحَمْدِهِ."]
        ]
    },

    evening: {
        title: "أذكار المساء",
        items: [
            ["آية الكرسي",1,"اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ..."],
            ["الإخلاص",3,"قُلْ هُوَ اللَّهُ أَحَدٌ"],
            ["الفلق",3,"قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ"],
            ["الناس",3,"قُلْ أَعُوذُ بِرَبِّ النَّاسِ"],
            ["أمسينا وأمسى الملك لله",1,"أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ."],
            ["رضيت بالله رباً",3,"رَضِيتُ بِاللَّهِ رَبًّا، وَبِالْإِسْلَامِ دِينًا، وَبِمُحَمَّدٍ ﷺ نَبِيًّا."],
            ["سبحان الله وبحمده",100,"سُبْحَانَ اللَّهِ وَبِحَمْدِهِ."]
        ]
    },

    after: {
        title: "أذكار بعد الصلاة",
        items: [
            ["أستغفر الله",3,"أَسْتَغْفِرُ اللَّهَ."],
            ["اللهم أنت السلام",1,"اللَّهُمَّ أَنْتَ السَّلَامُ وَمِنْكَ السَّلَامُ تَبَارَكْتَ يَا ذَا الْجَلَالِ وَالْإِكْرَامِ."],
            ["التسبيح",33,"سُبْحَانَ اللَّهِ."],
            ["التحميد",33,"الْحَمْدُ لِلَّهِ."],
            ["التكبير",33,"اللَّهُ أَكْبَرُ."]
        ]
    },

    sleep: {
        title: "أذكار النوم",
        items: [
            ["آية الكرسي",1,"اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ..."],
            ["الإخلاص والفلق والناس",3,"قُلْ هُوَ اللَّهُ أَحَدٌ، وقُلْ أَعُوذُ بِرَبِّ الْفَلَقِ، وقُلْ أَعُوذُ بِرَبِّ النَّاسِ."],
            ["باسمك اللهم أموت وأحيا",1,"بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا."],
            ["سبحان الله",33,"سُبْحَانَ اللَّهِ."],
            ["الحمد لله",33,"الْحَمْدُ لِلَّهِ."],
            ["الله أكبر",34,"اللَّهُ أَكْبَرُ."]
        ]
    },

    wake: {
        title: "أذكار الاستيقاظ",
        items: [
            ["الحمد لله الذي أحيانا",1,"الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ."]
        ]
    },

    daily: {
        title: "أذكار متنوعة",
        items: [
            ["سبحان الله وبحمده",100,"سُبْحَانَ اللَّهِ وَبِحَمْدِهِ."],
            ["لا حول ولا قوة إلا بالله",100,"لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ."],
            ["أستغفر الله وأتوب إليه",100,"أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ."],
            ["الصلاة على النبي ﷺ",10,"اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ."]
        ]
    },

    sayyid: {
        title: "سيد الاستغفار",
        items: [
            ["سيد الاستغفار",1,"اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ بِذَنْبِي فَاغْفِرْ لِي، فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ."]
        ]
    },

    ruqya: {
        title: "الرقية الشرعية",
        items: [
            ["الفاتحة",7,"بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ. الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ..."],
            ["آية الكرسي",1,"اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ..."],
            ["آخر آيتين من البقرة",1,"آمَنَ الرَّسُولُ بِمَا أُنْزِلَ إِلَيْهِ مِنْ رَبِّهِ وَالْمُؤْمِنُونَ..."],
            ["الإخلاص",3,"قُلْ هُوَ اللَّهُ أَحَدٌ."],
            ["الفلق",3,"قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ."],
            ["الناس",3,"قُلْ أَعُوذُ بِرَبِّ النَّاسِ."]
        ]
    }
};

function showAzkar(category) {
    const group = AZKAR[category];
    const container = $("azkarResults");

    if (!group || !container) return;

    container.innerHTML = `
        <section class="section">
            <h3>${escapeHTML(group.title)}</h3>

            ${group.items.map((item, index) => `
                <article class="zikr-card">
                    <h3>${escapeHTML(item[0])}</h3>
                    <p class="zikr-text">${escapeHTML(item[2])}</p>
                    <p class="muted">عدد التكرار: ${item[1]}</p>
                    <p>المتبقي:
                        <strong id="zikrCount${index}">${item[1]}</strong>
                    </p>
                    <button type="button" class="count-btn" data-count="${index}">
                        تسبيح
                    </button>
                </article>
            `).join("")}
        </section>
    `;

    container.querySelectorAll("[data-count]").forEach(button => {
        button.addEventListener("click", () => {
            const index = Number(button.dataset.count);
            const counter = $(`zikrCount${index}`);

            const value = Math.max(
                0,
                Number(counter.textContent) - 1
            );

            counter.textContent = value;

            if (value === 0) {
                button.disabled = true;
                button.textContent = "اكتمل الذكر";
            }
        });
    });
}

/* آية للتدبر */

const VERSES = [
    ["إِنَّ مَعَ الْعُسْرِ يُسْرًا", "الشرح - ٦"],
    ["فَاذْكُرُونِي أَذْكُرْكُمْ", "البقرة - ١٥٢"],
    ["وَهُوَ مَعَكُمْ أَيْنَ مَا كُنْتُمْ", "الحديد - ٤"],
    ["إِنَّ اللَّهَ مَعَ الصَّابِرِينَ", "البقرة - ١٥٣"],
    ["وَمَا تَوْفِيقِي إِلَّا بِاللَّهِ", "هود - ٨٨"],
    ["أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ", "الرعد - ٢٨"]
];

function newVerse() {
    const verse = VERSES[
        Math.floor(Math.random() * VERSES.length)
    ];

    setText("dailyVerse", verse[0]);
    setText("dailyVerseRef", "سورة " + verse[1]);
}

/* SAKINAH — PART 3 */

/* القبلة */

function calculateQiblaBearing(lat, lon) {
    const rad = Math.PI / 180;
    const deg = 180 / Math.PI;

    const p1 = lat * rad;
    const p2 = 21.4225 * rad;
    const dl = (39.8262 - lon) * rad;

    const angle = Math.atan2(
        Math.sin(dl),
        Math.cos(p1) * Math.tan(p2) -
        Math.sin(p1) * Math.cos(dl)
    );

    return (angle * deg + 360) % 360;
}

function calculateQibla() {
    qiblaBearing = calculateQiblaBearing(
        currentLocation.lat,
        currentLocation.lon
    );

    setText("qiblaDegree", Math.round(qiblaBearing) + "°");
    updateCompass();
}

function updateCompass() {
    const needle = $("compassNeedle");
    if (!needle) return;

    needle.style.transform =
        `rotate(${qiblaBearing - compassHeading}deg)`;
}

async function enableCompass() {
    try {
        if (
            typeof DeviceOrientationEvent !== "undefined" &&
            typeof DeviceOrientationEvent.requestPermission === "function"
        ) {
            const permission =
                await DeviceOrientationEvent.requestPermission();

            if (permission !== "granted") {
                throw new Error("Permission denied");
            }
        }

        window.addEventListener(
            "deviceorientation",
            event => {
                let heading = null;

                if (typeof event.webkitCompassHeading === "number") {
                    heading = event.webkitCompassHeading;
                } else if (typeof event.alpha === "number") {
                    heading = 360 - event.alpha;
                }

                if (heading === null) return;

                compassHeading = (heading + 360) % 360;
                updateCompass();
            },
            true
        );

        setText("compassStatus", "تم تشغيل البوصلة.");

    } catch (error) {
        console.error(error);
        setText("compassStatus", "تعذر تشغيل البوصلة.");
    }
}

/* العبادات اليومية */

const TRACKER_ITEMS = [
    "صلاة الفجر",
    "صلاة الظهر",
    "صلاة العصر",
    "صلاة المغرب",
    "صلاة العشاء",
    "أذكار الصباح",
    "أذكار المساء",
    "قراءة القرآن"
];

function trackerStorageKey() {
    return "sakina-tracker-" + localDateKey();
}

function renderTracker() {
    const container = $("trackerList");
    if (!container) return;

    const saved = loadJSON(trackerStorageKey(), {});

    container.innerHTML = TRACKER_ITEMS.map((item, index) => `
        <label class="tracker-row">
            <span>${item}</span>
            <input type="checkbox"
                data-tracker="${index}"
                ${saved[index] ? "checked" : ""}>
        </label>
    `).join("");

    container.querySelectorAll("[data-tracker]").forEach(input => {
        input.addEventListener("change", () => {
            const data = loadJSON(trackerStorageKey(), {});
            data[input.dataset.tracker] = input.checked;

            saveJSON(trackerStorageKey(), data);
            updateTracker();
        });
    });

    updateTracker();
}

function updateTracker() {
    const container = $("trackerList");
    if (!container) return;

    const inputs = [
        ...container.querySelectorAll("[data-tracker]")
    ];

    const done = inputs.filter(input => input.checked).length;
    const total = TRACKER_ITEMS.length;

    setText("progressText", `${done} من ${total} عبادات`);

    const bar = $("progressBar");
    if (bar) bar.style.width = `${done / total * 100}%`;
}

function resetTracker() {
    if (!confirm("هل تريد إعادة تعيين عبادات اليوم؟")) return;

    localStorage.removeItem(trackerStorageKey());
    renderTracker();
}

/* الإقامة */

function renderIqamaSettings() {
    const container = $("iqamaSettings");
    if (!container) return;

    container.innerHTML = MAIN_PRAYERS.map(key => `
        <label class="iqama-setting">
            <span>${PRAYERS[key]}</span>
            <input
                type="number"
                min="0"
                max="90"
                data-iqama="${key}"
                value="${iqamaSettings[key]}"
            >
        </label>
    `).join("");

    container.querySelectorAll("[data-iqama]").forEach(input => {
        input.addEventListener("change", () => {
            const key = input.dataset.iqama;

            iqamaSettings[key] = Math.max(
                0,
                Math.min(90, Number(input.value) || 0)
            );

            saveJSON("sakina-iqama-settings", iqamaSettings);
            updateIqamaCountdown();
        });
    });
}

function calculateIqama(key, prayerDate) {
    return new Date(
        prayerDate.getTime() +
        iqamaSettings[key] * 60000
    );
}

function updateIqamaCountdown() {
    if (!prayerTimes) return;

    const now = new Date();
    let active = null;

    for (const key of MAIN_PRAYERS) {
        const start = prayerTimes[key];
        const end = calculateIqama(key, start);

        if (now >= start && now < end) {
            active = { key, end };
            break;
        }
    }

    if (!active) {
        setText("iqamaPrayer", "لا توجد إقامة قريبة");
        setText("iqamaCountdown", "--:--");
        setText("iqamaStatus", "يتم حساب الإقامة بعد الأذان.");
        return;
    }

    const remaining = active.end - now;

    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    setText(
        "iqamaPrayer",
        "إقامة صلاة " + PRAYERS[active.key]
    );

    setText(
        "iqamaCountdown",
        `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    );

    setText(
        "iqamaStatus",
        "الوقت المتبقي للإقامة التقديرية"
    );
}

/* الأذان */

function playAdhan(key) {
    const audio = $("adhanAudio");
    if (!audio) return;

    audio.src = "./sound/adhan.mp3";
    audio.currentTime = 0;

    audio.play().catch(error => {
        console.warn("تعذر تشغيل الأذان:", error);
        setText(
            "notificationStatus",
            "تعذر تشغيل الأذان تلقائياً. تأكد من السماح بالصوت."
        );
    });
}

function stopAdhan() {
    const audio = $("adhanAudio");
    if (!audio) return;

    audio.pause();
    audio.currentTime = 0;

    setText("iqamaStatus", "تم إيقاف الأذان.");
}

function sendPrayerNotification(key) {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    new Notification("سكينة - حان وقت الصلاة", {
        body: "حان الآن وقت صلاة " + PRAYERS[key],
        icon: "./icons/icon-192.png",
        tag: "prayer-" + key
    });
}

function checkPrayerAlerts() {
    if (!prayerTimes) return;

    const now = new Date();
    const today = localDateKey();

    for (const key of MAIN_PRAYERS) {
        const prayer = prayerTimes[key];
        const alertKey = today + "-" + key;

        const difference = now - prayer;

        if (
            difference >= 0 &&
            difference < 2000 &&
            lastAdhan !== alertKey
        ) {
            lastAdhan = alertKey;

            saveJSON("sakina-last-adhan", lastAdhan);

            playAdhan(key);
            sendPrayerNotification(key);
        }
    }
}

/* الإشعارات */

async function enableNotifications() {
    if (!("Notification" in window)) {
        setText("notificationStatus", "متصفحك لا يدعم الإشعارات.");
        return;
    }

    try {
        const permission = await Notification.requestPermission();

        setText(
            "notificationStatus",
            permission === "granted"
                ? "تم تفعيل الإشعارات."
                : "لم يتم السماح بالإشعارات."
        );

    } catch (error) {
        console.error(error);
        setText("notificationStatus", "تعذر تفعيل الإشعارات.");
    }
}

/* ربط الأزرار */

function setupButtons() {
    setupNavigation();

    $("surahTab")?.addEventListener(
        "click",
        () => quranTab("surahTab")
    );

    $("juzTab")?.addEventListener(
        "click",
        () => quranTab("juzTab")
    );

    $("quranSearch")?.addEventListener(
        "input",
        filterQuran
    );

    $("backToSurahs")?.addEventListener(
        "click",
        hideReader
    );

    $("surahList")?.addEventListener("click", event => {
        const button = event.target.closest("[data-surah]");
        if (button) openSurah(Number(button.dataset.surah));
    });

    $("juzList")?.addEventListener("click", event => {
        const button = event.target.closest("[data-juz]");
        if (button) openJuz(Number(button.dataset.juz));
    });

    document.addEventListener("click", event => {
        const button = event.target.closest("[data-azkar]");
        if (button) showAzkar(button.dataset.azkar);
    });

    $("enableCompass")?.addEventListener(
        "click",
        enableCompass
    );

    $("enableNotifications")?.addEventListener(
        "click",
        enableNotifications
    );

    $("stopAdhan")?.addEventListener(
        "click",
        stopAdhan
    );

    $("resetTracker")?.addEventListener(
        "click",
        resetTracker
    );

    $("cacheApp")?.addEventListener("click", async () => {
        try {
            if ("serviceWorker" in navigator) {
                const registrations =
                    await navigator.serviceWorker.getRegistrations();

                for (const registration of registrations) {
                    await registration.update();
                }
            }

            setText("offlineStatus", "تم تحديث ملفات التطبيق.");
            location.reload();

        } catch (error) {
            console.error(error);
            setText("offlineStatus", "تعذر تحديث الملفات.");
        }
    });
}

/* تشغيل التطبيق */

async function init() {
    setupButtons();

    updateClock();

    renderSurahs();
    renderJuz();
    renderTracker();
    renderIqamaSettings();

    calculateQibla();
    newVerse();

    await fetchPrayerTimes();

    updateIqamaCountdown();

    setInterval(() => {
        updateClock();
        updateNextPrayer();
        updateIqamaCountdown();
        checkPrayerAlerts();
    }, 1000);

    setInterval(fetchPrayerTimes, 60 * 60 * 1000);

    console.log("SAKINAH READY");
}

document.addEventListener("DOMContentLoaded", init);
