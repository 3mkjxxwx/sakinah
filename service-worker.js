
const CACHE_NAME = "sakinah-cache-v1";

const APP_FILES = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
];

// تثبيت التطبيق وتخزين ملفاته الأساسية
self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(APP_FILES);
        })
    );

    self.skipWaiting();
});

// تفعيل النسخة الجديدة وحذف التخزين القديم
self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            );
        })
    );

    self.clients.claim();
});

// تحميل الملفات من الإنترنت، واستخدام النسخة المحفوظة عند انقطاعه
self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") return;

    const url = new URL(event.request.url);

    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response && response.ok) {
                    const copy = response.clone();

                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, copy);
                    });
                }

                return response;
            })
            .catch(async () => {
                const cached = await caches.match(event.request);

                if (cached) return cached;

                if (event.request.mode === "navigate") {
                    return caches.match("./index.html");
                }

                return new Response("لا يوجد اتصال بالإنترنت", {
                    status: 503,
                    headers: {
                        "Content-Type": "text/plain; charset=utf-8"
                    }
                });
            })
    );
});
