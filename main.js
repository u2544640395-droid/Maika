// --- CONFIGURATION ---
const SUPABASE_URL = 'https://ezlwdyvpyerxgrrvxdwl.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6bHdkeXZweWVyeGdycnZ4ZHdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2ODMzNjAsImV4cCI6MjA4MTI1OTM2MH0.6ZFmMAF5rzZ6-XP5Owae-v_SEEnySUScPAyXqRHDiiA';
// On suppose que supabase est chargé via le CDN dans index.html
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- STATE ---
let role = 'client';
let map = null, carMarker = null;
let gpsInterval = null;

// --- NAVIGATION SYSTEM ---
function nav(screenId) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

// Init
setTimeout(() => nav('loginScreen'), 2000);

// --- AUTH SYSTEM ---
function toggleDriverMode() {
    role = role === 'client' ? 'driver' : 'client';
    const txt = document.getElementById('driverModeText');
    if(role === 'driver') {
        txt.innerText = "Mode Prestataire : ACTIF";
        txt.classList.add('text-green-400');
    } else {
        txt.innerText = "Passer en mode Prestataire";
        txt.classList.remove('text-green-400');
    }
}

async function authLogin() {
    const phone = document.getElementById('phoneInput').value;
    if(phone.length < 5) return toast("Numéro trop court");
    
    const btn = document.querySelector('#loginScreen button');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    
    // Auth Simplifiée pour MVP
    const email = phone.replace(/\D/g,'') + (role==='driver' ? '@driver.mk' : '@client.mk');
    const password = 'password123';

    let { error } = await db.auth.signInWithPassword({ email, password });
    if(error) await db.auth.signUp({ email, password });

    btn.innerHTML = originalText;
    
    if(role === 'driver') {
        nav('driverScreen');
        refreshRequests();
    } else {
        nav('homeScreen');
    }
}

// --- MAP SYSTEM ---
function openMapMode() {
    nav('mapScreen');
    setTimeout(initMap, 100);
}

function initMap() {
    if(map) return;
    map = L.map('map-view', { zoomControl: false }).setView([-18.8792, 47.5079], 14);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    let timer;
    map.on('movestart', () => {
        document.getElementById('mapPin').classList.add('hovering');
        document.getElementById('addressBadge').innerText = "Sélection...";
    });
    
    map.on('moveend', () => {
        document.getElementById('mapPin').classList.remove('hovering');
        clearTimeout(timer);
        timer = setTimeout(reverseGeocode, 600);
    });
}

async function reverseGeocode() {
    const center = map.getCenter();
    document.getElementById('destInput').value = "Chargement...";
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${center.lat}&lon=${center.lng}`);
        const data = await res.json();
        const cleanAddr = data.address.road || data.address.suburb || "Position repère";
        document.getElementById('destInput').value = cleanAddr;
        document.getElementById('addressBadge').innerText = cleanAddr;
    } catch(e) {
        document.getElementById('destInput').value = "Position GPS";
    }
}

// --- RIDE LOGIC ---
async function createRequest() {
    const dest = document.getElementById('destInput').value;
    const btn = document.getElementById('btnRequest');
    
    if(dest.includes("Chargement")) return toast("Attendez la localisation...");
    
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i> Recherche...';
    
    const { data: { user } } = await db.auth.getUser();
    const { data, error } = await db.from('rides').insert([{
        client_id: user.id,
        destination_address: dest,
        service_type: 'course',
        status: 'pending'
    }]).select();

    if(!error) {
        const rideId = data[0].id;
        toast("Recherche de véhicule...");
        subscribeToRide(rideId);
    } else {
        toast("Erreur réseau");
        btn.innerText = "Trouver un véhicule";
    }
}

function subscribeToRide(rideId) {
    db.channel('ride-'+rideId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` }, payload => {
        const ride = payload.new;
        if(ride.status === 'accepted') {
            document.getElementById('orderSheet').classList.remove('open');
            document.getElementById('trackingSheet').classList.add('open');
            document.getElementById('mapPin').classList.add('hidden');
            toast("Un véhicule arrive !");
        }
        if(ride.driver_lat) updateCar(ride.driver_lat, ride.driver_lng);
    })
    .subscribe();
}

function updateCar(lat, lng) {
    if(!carMarker) {
        const carIcon = L.divIcon({
            html: '<div style="font-size:24px; color:#10b981; filter:drop-shadow(0 0 10px #10b981)"><i class="fas fa-car-side"></i></div>',
            className: 'bg-transparent', iconSize: [30,30]
        });
        carMarker = L.marker([lat, lng], {icon: carIcon}).addTo(map);
    }
    carMarker.setLatLng([lat, lng]);
    map.flyTo([lat, lng], 16);
}

// --- DRIVER LOGIC ---
async function refreshRequests() {
    const list = document.getElementById('requestList');
    list.innerHTML = '<div class="text-center mt-10"><i class="fas fa-spinner fa-spin"></i></div>';
    
    const { data } = await db.from('rides').select('*').eq('status', 'pending').order('created_at', {ascending:false});
    list.innerHTML = "";
    if(!data.length) list.innerHTML = "<div class='text-center opacity-50 mt-10'>Aucune demande...</div>";
    
    data.forEach(r => {
        const item = document.createElement('div');
        item.className = "glass p-4 rounded-xl mb-3 border-l-4 border-indigo-500 animate-pulse";
        item.innerHTML = `
            <div class="flex justify-between items-start">
                <div>
                    <h3 class="font-bold text-lg">${r.destination_address}</h3>
                    <span class="text-xs bg-indigo-500/20 px-2 py-1 rounded text-indigo-300">VTC Immédiat</span>
                </div>
                <button onclick="acceptRide('${r.id}')" class="bg-indigo-600 px-4 py-2 rounded-lg font-bold text-sm shadow-lg">ACCEPTER</button>
            </div>
        `;
        list.appendChild(item);
    });
}

async function acceptRide(rideId) {
    const { data: { user } } = await db.auth.getUser();
    await db.from('rides').update({ status: 'accepted', driver_id: user.id }).eq('id', rideId);
    
    toast("Course acceptée ! GPS Démarré.");
    startGPS(rideId);
    
    document.getElementById('requestList').innerHTML = `
        <div class="glass p-6 rounded-xl text-center border-2 border-green-500">
            <h2 class="text-2xl font-bold text-green-400 mb-2">COURSE EN COURS</h2>
            <p class="text-sm text-gray-400">Position diffusée au client</p>
            <button onclick="stopGPS()" class="mt-6 w-full glass py-3 text-red-400 font-bold rounded-xl">TERMINER</button>
        </div>
    `;
}

// --- GPS ---
function startGPS(rideId) {
    if(!navigator.geolocation) return;
    const status = document.getElementById('gpsStatus');
    gpsInterval = setInterval(() => {
        navigator.geolocation.getCurrentPosition(pos => {
            const { latitude, longitude } = pos.coords;
            status.innerText = `GPS: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
            status.classList.add('text-green-400');
            db.from('rides').update({ driver_lat: latitude, driver_lng: longitude }).eq('id', rideId).then();
        }, err => console.error(err), { enableHighAccuracy: true });
    }, 3000);
}

function stopGPS() {
    clearInterval(gpsInterval);
    nav('driverScreen');
    refreshRequests();
    toast("Course terminée");
}

function cancelRide() {
    nav('homeScreen');
    toast("Course annulée");
}

function toast(msg) {
    const el = document.getElementById('toast');
    document.getElementById('toastMsg').innerText = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
}

function logout() { location.reload(); }
