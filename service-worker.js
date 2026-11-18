
"use strict";

const CACHE_NAME = "sakina-v3";

const APP_FILES = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/ayah-divider.png",
    "./sounds/adhan.mp3",
    "./images/fajr.jpg",
    "./images/sunrise.jpg",
    "./images/dhuhr.jpg",
    "./images/asr.jpg",
    "./images/maghrib.jpg",
    "./images/isha.jpg"
];

self.addEventListener("install",event=>{
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache=>{
            await Promise.all(
                APP_FILES.map(async file=>{
                    try {
                        await cache.add(file);
                    } catch(error) {
                        console.warn("تعذر تخزين:",file);
                    }
                })
            );
        })
    );
    self.skipWaiting();
});

self.addEventListener("activate",event=>{
    event.waitUntil(
        caches.keys().then(keys=>Promise.all(
            keys.filter(key=>key!==CACHE_NAME)
                .map(key=>caches.delete(key))
        ))
    );
    self.clients.claim();
});

self.addEventListener("fetch",event=>{
    if(event.request.method!=="GET") return;

    const url=new URL(event.request.url);
    if(url.origin!==self.location.origin) return;

    event.respondWith(
        caches.match(event.request).then(cached=>{
            if(cached) return cached;

            return fetch(event.request).then(response=>{
                if(response.ok&&response.type==="basic") {
                    const copy=response.clone();
                    caches.open(CACHE_NAME).then(cache=>{
                        cache.put(event.request,copy);
                    });
                }
                return response;
            }).catch(()=>{
                if(event.request.mode==="navigate") {
                    return caches.match("./index.html");
                }
                    return new Response("",{status:503});
            });
        })
    );
});
