
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

const iqamaMinutes = {
    Fajr: 20,
    Dhuhr: 20,
    Asr: 15,
    Maghrib: 15,
    Isha: 10
};

const prayerKeys = Object.keys(prayerNames);
const MAKKAH = {lat:21.4225,lon:39.8262};
const defaultLocation = {
    lat:24.4709,
    lon:39.6122,
    name:"المدينة المنورة"
};

let userLocation = defaultLocation;
let prayerTimes = null;
let qiblaBearing = null;
let currentSurah = null;
let adhanPlayed = {};
let lastDate = "";
let compassHeading = 0;

function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}

function formatTime(date) {
    return new Intl.DateTimeFormat("ar-SA", {
        hour:"2-digit",minute:"2-digit",hour12:true
    }).format(date);
}

function updateClock() {
    const now = new Date();
    $("clock").textContent = now.toLocaleTimeString("en-GB");
    $("gregorianDate").textContent =
        now.toLocaleDateString("ar-SA", {
            weekday:"long",year:"numeric",month:"long",day:"numeric"
        });
    $("hijriDate").textContent =
        new Intl.DateTimeFormat("ar-SA-u-ca-islamic", {
            day:"numeric",month:"long",year:"numeric"
        }).format(now);
}

function rad(v) { return v*Math.PI/180; }
function deg(v) { return v*180/Math.PI; }
function norm(v) { return (v+360)%360; }

function calculateQibla(lat,lon) {
    const p1=rad(lat),p2=rad(MAKKAH.lat);
    const dl=rad(MAKKAH.lon-lon);
    return norm(deg(Math.atan2(
        Math.sin(dl),
        Math.cos(p1)*Math.tan(p2)-Math.sin(p1)*Math.cos(dl)
    )));
}

function sunTime(date,lat,lon,angle,morning) {
    const start = Date.UTC(date.getFullYear(),0,0);
    const day = Math.floor((Date.UTC(
        date.getFullYear(),date.getMonth(),date.getDate()
    )-start)/86400000);

    const g=2*Math.PI/365*(day-1);
    const eq=229.18*(0.000075+
        0.001868*Math.cos(g)-
        0.032077*Math.sin(g)-
        0.014615*Math.cos(2*g)-
        0.040849*Math.sin(2*g));

    const dec=0.006918-
        0.399912*Math.cos(g)+
        0.070257*Math.sin(g)-
        0.006758*Math.cos(2*g)+
        0.000907*Math.sin(2*g)-
        0.002697*Math.cos(3*g)+
        0.00148*Math.sin(3*g);

    const p=rad(lat),a=rad(angle);
    const c=(Math.sin(a)-Math.sin(p)*Math.sin(dec))/
        (Math.cos(p)*Math.cos(dec));

    if(c < -1 || c > 1) return null;

    const h=deg(Math.acos(c));
    const noon=720-4*lon-eq;

    return noon+(morning?-1:1)*4*h;
}

function toDate(minutes,date) {
    const result=new Date(date);
    result.setHours(0,0,0,0);
    result.setMinutes(Math.round(minutes));
    return result;
}

function calculatePrayerTimes(date,lat,lon) {
    const fajr=sunTime(date,lat,lon,-18,true);
    const sunrise=sunTime(date,lat,lon,-0.833,true);
    const sunset=sunTime(date,lat,lon,-0.833,false);
    const isha=sunTime(date,lat,lon,-17,false);

    if([fajr,sunrise,sunset,isha].some(v=>v===null)) return null;

    const noon=(sunrise+sunset)/2;
    const g=2*Math.PI/365*(
        Math.floor((Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())-
        Date.UTC(date.getFullYear(),0,0))/86400000)-1
    );

    const dec=0.006918-
        0.399912*Math.cos(g)+0.070257*Math.sin(g)-
        0.006758*Math.cos(2*g)+0.000907*Math.sin(2*g)-
        0.002697*Math.cos(3*g)+0.00148*Math.sin(3*g);

    const p=rad(lat);
    const angle=Math.atan(1/(1+Math.tan(Math.abs(p-dec))));
    const c=(Math.sin(angle)-Math.sin(p)*Math.sin(dec))/
        (Math.cos(p)*Math.cos(dec));

    const asr=noon+4*deg(Math.acos(Math.max(-1,Math.min(1,c))));

    return {
        Fajr:toDate(fajr,date),
        Sunrise:toDate(sunrise,date),
        Dhuhr:toDate(noon+2,date),
        Asr:toDate(asr,date),
        Maghrib:toDate(sunset,date),
        Isha:toDate(isha,date)
    };
}

function getNextPrayer() {
    const now=new Date();
    const times=calculatePrayerTimes(
        now,userLocation.lat,userLocation.lon
    );
    if(!times) return null;

    for(const key of ["Fajr","Dhuhr","Asr","Maghrib","Isha"]) {
        if(times[key]>now) return {key,date:times[key]};
    }

    const tomorrow=new Date(now);
    tomorrow.setDate(tomorrow.getDate()+1);
    const next=calculatePrayerTimes(
        tomorrow,userLocation.lat,userLocation.lon
    );

    return next ? {key:"Fajr",date:next.Fajr}:null;
}

function renderPrayers() {
    prayerTimes=calculatePrayerTimes(
        new Date(),userLocation.lat,userLocation.lon
    );
    if(!prayerTimes) return;

    $("prayerGrid").innerHTML=prayerKeys.map(key=>`
        <div class="prayer-card" data-prayer="${key}">
            <small>${prayerNames[key]}</small>
            <strong>${formatTime(prayerTimes[key])}</strong>
            <em>${key==="Sunrise"?"الشروق":"موعد الصلاة"}</em>
        </div>
    `).join("");
}

function updateIqama(key,prayerDate) {
    const box=$("iqamaBox");
    const now=new Date();
    const end=new Date(
        prayerDate.getTime()+iqamaMinutes[key]*60000
    );
    const remaining=end-now;

    if(remaining<=0) {
        box.hidden=true;
        return;
    }

    box.hidden=false;

    $("iqamaCountdown").textContent=[
        Math.floor(remaining/60000),
        Math.floor((remaining%60000)/1000)
    ].map(v=>String(v).padStart(2,"0")).join(":");
}

function updateNextPrayer() {
    const now=new Date();
    const next=getNextPrayer();
    if(!next) return;

    $("nextPrayerName").textContent=prayerNames[next.key];
    $("nextPrayerLabel").textContent="الصلاة القادمة";

    const remaining=Math.max(0,next.date-now);
    $("countdown").textContent=[
        Math.floor(remaining/3600000),
        Math.floor(remaining%3600000/60000),
        Math.floor(remaining%60000/1000)
    ].map(v=>String(v).padStart(2,"0")).join(":");

    const hero=$("prayerHero");
    hero.dataset.prayer=next.key;

    document.querySelectorAll(".prayer-card").forEach(card=>{
        card.classList.toggle("active",card.dataset.prayer===next.key);
    });

    // متابعة الإقامة بعد الأذان
    for(const key of Object.keys(iqamaMinutes)) {
        const date=prayerTimes?.[key];
        if(date && now>=date && now<new Date(
            date.getTime()+iqamaMinutes[key]*60000
        )) {
            updateIqama(key,date);
            return;
        }
    }

    boxHideIqama();
}

function boxHideIqama() {
    $("iqamaBox").hidden=true;
}

function playAdhan(key) {
    const audio=$("adhanAudio");
    audio.currentTime=0;
    audio.play().then(()=>{
        $("adhanStatus").textContent=
            "يُرفع الآن أذان "+prayerNames[key];
    }).catch(()=>{
        $("adhanStatus").textContent=
            "اضغط تجربة الأذان لتفعيل الصوت أولاً.";
    });
}

function checkAdhan() {
    const now=new Date();
    const keyDate=todayKey();

    if(lastDate!==keyDate) {
        lastDate=keyDate;
        adhanPlayed={};
        renderPrayers();
    }

    for(const key of Object.keys(iqamaMinutes)) {
        const time=prayerTimes?.[key];
        if(!time) continue;

        const difference=Math.abs(now-time);

        if(difference<1000 && !adhanPlayed[key]) {
            adhanPlayed[key]=true;
            playAdhan(key);
            notifyPrayer(key);
        }
    }
}

function notifyPrayer(key) {
    if(!("Notification" in window)) return;
    if(Notification.permission==="granted") {
        new Notification("حان الآن وقت صلاة "+prayerNames[key],{
            body:"تقبل الله طاعتكم",
            icon:"./icons/icon-192.png"
        });
    }
}

$("testAdhan").addEventListener("click",()=>{
    playAdhan("Maghrib");
});

$("stopAdhan").addEventListener("click",()=>{
    const audio=$("adhanAudio");
    audio.pause();
    audio.currentTime=0;
    $("adhanStatus").textContent="تم إيقاف الأذان.";
});

$("notificationPermission").addEventListener("click",async()=>{
    if(!("Notification" in window)) {
        alert("المتصفح لا يدعم الإشعارات.");
        return;
    }
    const permission=await Notification.requestPermission();
    $("adhanStatus").textContent=permission==="granted"
        ?"تم السماح بالإشعارات."
        :"لم يتم السماح بالإشعارات.";
});

function setLocation(location) {
    userLocation=location;
    localStorage.setItem("sakina-location",JSON.stringify(location));

    $("locationLabel").textContent="الموقع: "+location.name;
    $("settingsLocation").textContent=location.name;

    qiblaBearing=calculateQibla(location.lat,location.lon);
    $("qiblaDegree").textContent=Math.round(qiblaBearing)+"°";
    $("qiblaDirection").textContent="اتجاه القبلة من الشمال الحقيقي";

    renderPrayers();
    updateNextPrayer();
}

function requestLocation() {
    if(!navigator.geolocation) {
        alert("جهازك لا يدعم تحديد الموقع.");
        return;
    }

    navigator.geolocation.getCurrentPosition(position=>{
        setLocation({
            lat:position.coords.latitude,
            lon:position.coords.longitude,
            name:"موقعك الحالي"
        });
    },()=>{
        alert("تعذر تحديد الموقع. تحقق من صلاحيات الموقع.");
    },{enableHighAccuracy:true,timeout:15000});
}

function showPage(id) {
    document.querySelectorAll(".page").forEach(page=>{
        page.classList.toggle("active",page.id===id);
    });
    document.querySelectorAll(".nav-item").forEach(button=>{
        button.classList.toggle("active",button.dataset.page===id);
    });
    window.scrollTo({top:0,behavior:"smooth"});
}

document.querySelectorAll("[data-page]").forEach(button=>{
    button.addEventListener("click",()=>showPage(button.dataset.page));
});

$("settingsShortcut").addEventListener("click",()=>showPage("settingsPage"));
$("locationButton").addEventListener("click",requestLocation);
$("settingsLocationButton").addEventListener("click",requestLocation);

// القرآن
const surahNames=[
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

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g,c=>({
        "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    })[c]);
}

async function fetchSurah(number) {
    const cache="sakina-surah-"+number;
    const saved=localStorage.getItem(cache);
    if(saved) return JSON.parse(saved);

    const response=await fetch(
        `https://api.alquran.cloud/v1/surah/${number}/quran-uthmani`
    );
    if(!response.ok) throw Error("Quran unavailable");

    const result=await response.json();
    if(result.code!==200) throw Error("Quran unavailable");

    localStorage.setItem(cache,JSON.stringify(result.data));
    return result.data;
}

function renderSurahs() {
    $("surahList").innerHTML=surahNames.map((name,i)=>`
        <button data-surah="${i+1}">
            ${i+1}. ${name}
            <small>السورة رقم ${i+1}</small>
        </button>
    `).join("");

    $("surahList").querySelectorAll("button").forEach(button=>{
        button.addEventListener("click",()=>openSurah(+button.dataset.surah));
    });
}

function renderJuz() {
    $("juzList").innerHTML=Array.from({length:30},(_,i)=>`
        <button data-juz="${i+1}">
            الجزء ${i+1}
            <small>الجزء رقم ${i+1}</small>
        </button>
    `).join("");
    $("juzList").querySelectorAll("button").forEach(button=>{
        button.addEventListener("click",()=>{
            alert("فهرس الأجزاء يحتاج إلى بيانات المصحف.");
        });
    });
}

async function openSurah(number) {
    currentSurah=number;
    $("readerPanel").hidden=false;
    $("surahList").hidden=true;
    $("juzList").hidden=true;
    $("readerTitle").textContent=surahNames[number-1];
    $("quranText").textContent="";
    $("quranLoading").textContent="جاري تحميل السورة...";
    $("basmala").hidden=number===1||number===9;

    try {
        const data=await fetchSurah(number);
        $("quranText").innerHTML=data.ayahs.map(ayah=>`
            ${escapeHTML(ayah.text)}
            <span class="ayah-mark">
                <span class="ayah-number">${ayah.numberInSurah}</span>
            </span>
        `).join(" ");
        $("quranLoading").textContent="";
    } catch {
        $("quranLoading").textContent="تعذر تحميل السورة. تحقق من الإنترنت.";
    }
}

$("surahTab").addEventListener("click",()=>{
    $("surahList").hidden=false;
    $("juzList").hidden=true;
    $("readerPanel").hidden=true;
});

$("juzTab").addEventListener("click",()=>{
    $("surahList").hidden=true;
    $("juzList").hidden=false;
    $("readerPanel").hidden=true;
});

$("backToSurahs").addEventListener("click",()=>{
    $("readerPanel").hidden=true;
    $("surahList").hidden=false;
});

$("quranSearch").addEventListener("input",event=>{
    const query=event.target.value.trim();
    $("surahList").querySelectorAll("button").forEach(button=>{
        button.hidden=!button.textContent.includes(query);
    });
});

$("downloadQuran").addEventListener("click",async()=>{
    if(!currentSurah) return;
    try {
        await fetchSurah(currentSurah);
        alert("تم حفظ السورة.");
    } catch {
        alert("تعذر الحفظ. اتصل بالإنترنت.");
    }
});

// الأذكار
const adhkar=[
    {title:"أذكار الصباح",items:[
        ["أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ",1,"ذكر الصباح"],
        ["سُبْحَانَ اللَّهِ وَبِحَمْدِهِ",100,"التسبيح"],
        ["أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ",100,"الاستغفار"]
    ]},
    {title:"أذكار المساء",items:[
        ["أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ",1,"ذكر المساء"],
        ["سُبْحَانَ اللَّهِ وَبِحَمْدِهِ",100,"التسبيح"],
        ["أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ",100,"الاستغفار"]
    ]},
    {title:"أذكار عامة",items:[
        ["سُبْحَانَ اللَّهِ",33,"التسبيح"],
        ["الْحَمْدُ لِلَّهِ",33,"التحميد"],
        ["اللَّهُ أَكْبَرُ",34,"التكبير"]
    ]}
];

function renderAdhkar() {
    $("adhkarContainer").innerHTML=adhkar.map((group,g)=>`
        <div class="section">
            <h3>${group.title}</h3>
            ${group.items.map((item,i)=>`
                <div class="zikr-card">
                    <p class="zikr-text">${item[0]}</p>
                    <p class="muted">${item[2]}</p>
                    <p>المتبقي: <strong id="zikr-${g}-${i}">${item[1]}</strong></p>
                    <button class="count-btn" data-group="${g}"
                    data-index="${i}" data-count="${item[1]}">تسبيح</button>
                </div>
            `).join("")}
        </div>
    `).join("");

    $("adhkarContainer").querySelectorAll(".count-btn").forEach(button=>{
        button.addEventListener("click",()=>{
            const id=`zikr-${button.dataset.group}-${button.dataset.index}`;
            const count=$(id);
            count.textContent=Math.max(0,+count.textContent-1);
            if(+count.textContent===0) button.disabled=true;
        });
    });
}

// القبلة
function updateCompass(heading) {
    compassHeading=heading;
    if(qiblaBearing===null) return;
    $("compassNeedle").style.transform=
        `rotate(${qiblaBearing-heading}deg)`;
    $("compassStatus").textContent="البوصلة تعمل — اتبع اتجاه السهم";
}

async function enableCompass() {
    if(!userLocation) {
        alert("حدد موقعك أولاً.");
        return;
    }

    if(typeof DeviceOrientationEvent==="undefined") {
        $("compassStatus").textContent="المستشعر غير مدعوم.";
        return;
    }

    if(typeof DeviceOrientationEvent.requestPermission==="function") {
        try {
            const permission=await DeviceOrientationEvent.requestPermission();
            if(permission!=="granted") return;
        } catch {
            $("compassStatus").textContent="تعذر تشغيل البوصلة.";
            return;
        }
    }

    window.addEventListener("deviceorientation",event=>{
        let heading=null;
        if(typeof event.webkitCompassHeading==="number") {
            heading=event.webkitCompassHeading;
        } else if(event.absolute&&typeof event.alpha==="number") {
            heading=360-event.alpha;
        }
        if(heading!==null) updateCompass(norm(heading));
    },true);

    $("compassStatus").textContent="بانتظار مستشعر الاتجاه...";
}

$("enableCompass").addEventListener("click",enableCompass);

// متابعة الصلاة
function trackerKey() {
    return "sakina-tracker-"+todayKey();
}

function renderTracker() {
    const saved=JSON.parse(localStorage.getItem(trackerKey())||"{}");
    const names=["Fajr","Dhuhr","Asr","Maghrib","Isha"];

    $("trackerList").innerHTML=names.map(name=>`
        <label class="tracker-row">
            <span>${prayerNames[name]}</span>
            <input type="checkbox" data-track="${name}"
            ${saved[name]?"checked":""}>
        </label>
    `).join("");

    $("trackerList").querySelectorAll("input").forEach(input=>{
        input.addEventListener("change",()=>{
            const data=JSON.parse(localStorage.getItem(trackerKey())||"{}");
            data[input.dataset.track]=input.checked;
            localStorage.setItem(trackerKey(),JSON.stringify(data));
            updateTrackerProgress();
        });
    });

    updateTrackerProgress();
}

function updateTrackerProgress() {
    const checks=[...$("trackerList").querySelectorAll("input")];
    const done=checks.filter(input=>input.checked).length;
    $("progressText").textContent=`${done} من 5 صلوات`;
    $("progressBar").style.width=(done/5*100)+"%";
}

$("resetTracker").addEventListener("click",()=>{
    if(!confirm("هل تريد إعادة تعيين متابعة اليوم؟")) return;
    localStorage.removeItem(trackerKey());
    renderTracker();
});

// الآية اليومية
const dailyVerses=[
    ["إِنَّ مَعَ الْعُسْرِ يُسْرًا","الشرح - ٦"],
    ["فَاذْكُرُونِي أَذْكُرْكُمْ","البقرة - ١٥٢"],
    ["وَهُوَ مَعَكُمْ أَيْنَ مَا كُنْتُمْ","الحديد - ٤"],
    ["إِنَّ اللَّهَ مَعَ الصَّابِرِينَ","البقرة - ١٥٣"],
    ["وَمَا تَوْفِيقِي إِلَّا بِاللَّهِ","هود - ٨٨"]
];

function renderDailyVerse() {
    const verse=dailyVerses[new Date().getDate()%dailyVerses.length];
    $("dailyVerse").textContent=verse[0];
    $("dailyVerseRef").textContent="سورة "+verse[1];
}

// تحديث الكاش
$("cacheApp").addEventListener("click",async()=>{
    try {
        const registration=await navigator.serviceWorker.ready;
        await registration.update();
        $("offlineStatus").textContent="تم فحص تحديث التطبيق.";
    } catch {
        $("offlineStatus").textContent="تعذر تحديث الملفات.";
    }
});

function init() {
    try {
        const saved=JSON.parse(localStorage.getItem("sakina-location"));
        if(saved) userLocation=saved;
    } catch {}

    setLocation(userLocation);
    renderSurahs();
    renderJuz();
    renderAdhkar();
    renderTracker();
    renderDailyVerse();
    updateClock();

    setInterval(()=>{
        updateClock();
        updateNextPrayer();
        checkAdhan();
    },1000);
}

if("serviceWorker" in navigator && location.protocol!=="file:") {
    window.addEventListener("load",()=>{
        navigator.serviceWorker.register("./service-worker.js")
            .catch(console.error);
    });
}

init();
