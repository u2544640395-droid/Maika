// --- CONFIGURATION ---
const SUPABASE_URL = 'https://ezlwdyvpyerxgrrvxdwl.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6bHdkeXZweWVyeGdycnZ4ZHdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2ODMzNjAsImV4cCI6MjA4MTI1OTM2MH0.6ZFmMAF5rzZ6-XP5Owae-v_SEEnySUScPAyXqRHDiiA';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- STATE ---
let role = 'client';
let map = null, carMarker = null;
let gpsInterval = null;
let selectedVehicleType = 'standard';

// --- INIT & ONBOARDING (CORRECTION ICI) ---
function initApp() {
    // On force l'affichage du splash screen si pas d'onboarding
    const hasOnboarded = localStorage.getItem('maika_onboarded');
    
    if (!hasOnboarded) {
        // Mode Première visite : On affiche l'onboarding
        const onboardEl = document.getElementById('onboarding');
        if(onboardEl) onboardEl.classList.remove('hidden');
    } else {
        // Déjà vu : On lance l'app
        nav('splashScreen');
        setTimeout(() => nav('loginScreen'), 2000);
    }
}

// Fonction rendue globale et robuste
window.finishOnboarding = function() {
    console.log("Onboarding terminé");
    localStorage.setItem('maika_onboarded', 'true');
    
    // Disparition forcée
    const el = document.getElementById('onboarding');
    if(el) {
        el.style.opacity = '0';
        setTimeout(() => {
            el.style.display = 'none'; // On le retire du flux
            nav('loginScreen');
        }, 500);
    } else {
        nav('loginScreen');
    }
};

// --- NAVIGATION ---
function nav(screenId) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(screenId);
    if(target) target.classList.add('active');
}

// --- AUTH SYSTEM ---
window.toggleDriverMode = function() {
    role = role === 'client' ? 'driver' : 'client';
    const txt = document.getElementById('driverModeText');
    if(role === 'driver') {
        txt.innerText = "Mode Prestataire : ACTIF";
        txt.classList.add('text-green-400');
    } else {
        txt.innerText = "Passer en mode Prestataire";
        txt.classList.remove('text-green-400');
    }
};

window.authLogin = async function() {
    const phone = document.getElementById('phoneInput').value;
    if(phone.length < 5) return toast("Numéro trop court");
    const btn = document.querySelector('#loginScreen button');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    
    const email = phone.replace(/\D/g,'') + (role==='driver' ? '@driver.mk' : '@client.mk');
    const password = 'password123';

    let { error } = await db.auth.signInWithPassword({ email, password });
    if(error) await db.auth.signUp({ email, password });

    btn.innerHTML = originalText;
    if(role === 'driver') { nav('driverScreen'); refreshRequests(); } else { nav('homeScreen'); }
};

// --- MAP & SEARCH SYSTEM ---
window.openMapMode = function() {
    nav('mapScreen');
    setTimeout(initMap, 100);
};

function initMap() {
    if(map) return;
    map = L.map('map-view', { zoomControl: false }).setView([-18.8792, 47.5079], 14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap', subdomains: 'abcd', maxZoom: 19
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

// Recherche Adresse
let searchTimer;
window.searchAddress = async function(query) {
    const resultsDiv = document.getElementById('searchResults');
    if (query.length < 3) { resultsDiv.style.display = 'none'; return; }

    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${query}+Antananarivo+Madagascar&limit=5`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            
            resultsDiv.innerHTML = '';
            if (data.length > 0) {
                resultsDiv.style.display = 'block';
                data.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'search-item';
                    div.innerText = item.display_name.split(',')[0] + ", " + (item.display_name.split(',')[1] || '');
                    div.onclick = () => { selectAddress(item.lat, item.lon, div.innerText); };
                    resultsDiv.appendChild(div);
                });
            }
        } catch (e) { console.error(e); }
    }, 500);
};

function selectAddress(lat, lon, name) {
    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.style.display = 'none';
    document.getElementById('destInput').value = name;
    map.setView([lat, lon], 16);
    document.getElementById('addressBadge').innerText = name;
}

async function reverseGeocode() {
    const center = map.getCenter();
    if (document.activeElement === document.getElementById('destInput')) return;
    
    document.getElementById('destInput').value = "Position carte...";
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${center.lat}&lon=${center.lng}`);
        const data = await res.json();
        const cleanAddr = data.address.road || data.address.suburb || "Point repère";
        document.getElementById('destInput').value = cleanAddr;
        document.getElementById('addressBadge').innerText = cleanAddr;
    } catch(e) { document.getElementById('destInput').value = "Position GPS"; }
}

// --- VEHICLE SELECTION ---
window.selectVehicle = function(type) {
    selectedVehicleType = type;
    document.querySelectorAll('.vehicle-card').forEach(el => el.classList.remove('selected'));
    document.getElementById('veh-' + type).classList.add('selected');
};

// --- RIDE LOGIC ---
window.createRequest = async function() {
    const dest = document.getElementById('destInput').value;
    const btn = document.getElementById('btnRequest');
    
    if(dest.includes("...")) return toast("Précisez la destination");
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i> Recherche...';
    
    const { data: { user } } = await db.auth.getUser();
    const { data, error } = await db.from('rides').insert([{
        client_id: user.id,
        destination_address: dest,
        vehicle_type_requested: selectedVehicleType,
        service_type: 'course',
        status: 'pending'
    }]).select();

    if(!error) {
        const rideId = data[0].id;
        toast("Recherche de " + selectedVehicleType + "...");
        subscribeToRide(rideId);
    } else {
        toast("Erreur réseau");
        btn.innerText = "COMMANDER";
    }
};

function subscribeToRide(rideId) {
    db.channel('ride-'+rideId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` }, payload => {
        const ride = payload.new;
        if(ride.status === 'accepted') {
            document.getElementById('orderSheet').classList.remove('open');
            document.getElementById('trackingSheet').classList.add('open');
            document.getElementById('mapPin').classList.add('hidden');
            toast("Prestataire en route !");
        }
        if(ride.driver_lat) updateCar(ride.driver_lat, ride.driver_lng);
    })
    .subscribe();
}

function updateCar(lat, lng) {
    if(!carMarker) {
        const carIcon = L.divIcon({
            html: '<div style="font-size:24px; color:#10b981; filter:drop-shadow(0 0 10px #10b981); transition:all 1s;"><i class="fas fa-car-side"></i></div>',
            className: 'bg-transparent', iconSize: [30,30]
        });
        carMarker = L.marker([lat, lng], {icon: carIcon}).addTo(map);
        const group = new L.featureGroup([carMarker, L.marker(map.getCenter())]);
        map.fitBounds(group.getBounds(), {padding: [50, 50]});
    }
    carMarker.setLatLng([lat, lng]);
}

// --- DRIVER ---
window.refreshRequests = async function() {
    const list = document.getElementById('requestList');
    list.innerHTML = '<div class="text-center mt-10"><i class="fas fa-spinner fa-spin"></i></div>';
    const { data } = await db.from('rides').select('*').eq('status', 'pending').order('created_at', {ascending:false});
    list.innerHTML = "";
    if(!data.length) list.innerHTML = "<div class='text-center opacity-50 mt-10'>Aucune demande...</div>";
    data.forEach(r => {
        const typeIcon = r.vehicle_type_requested === 'moto' ? 'motorcycle' : 'car';
        const item = document.createElement('div');
        item.className = "glass p-4 rounded-xl mb-3 border-l-4 border-indigo-500 animate-pulse";
        item.innerHTML = `
            <div class="flex justify-between items-start">
                <div>
                    <h3 class="font-bold text-lg">${r.destination_address}</h3>
                    <span class="text-xs bg-indigo-500/20 px-2 py-1 rounded text-indigo-300 uppercase"><i class="fas fa-${typeIcon} mr-1"></i> ${r.vehicle_type_requested || 'Standard'}</span>
                </div>
                <button onclick="acceptRide('${r.id}')" class="bg-indigo-600 px-4 py-2 rounded-lg font-bold text-sm shadow-lg">ACCEPTER</button>
            </div>
        `;
        list.appendChild(item);
    });
};

window.acceptRide = async function(rideId) {
    const { data: { user } } = await db.auth.getUser();
    await db.from('rides').update({ status: 'accepted', driver_id: user.id }).eq('id', rideId);
    toast("Course acceptée ! GPS Démarré.");
    startGPS(rideId);
    document.getElementById('requestList').innerHTML = `<div class="glass p-6 rounded-xl text-center border-2 border-green-500"><h2 class="text-2xl font-bold text-green-400 mb-2">EN ROUTE</h2><p class="text-sm text-gray-400">Position partagée</p><button onclick="stopGPS()" class="mt-6 w-full glass py-3 text-red-400 font-bold rounded-xl">TERMINER</button></div>`;
};

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

window.stopGPS = function() { clearInterval(gpsInterval); nav('driverScreen'); refreshRequests(); toast("Course terminée"); };
window.cancelRide = function() { nav('homeScreen'); toast("Course annulée"); };
window.toast = function(msg) { const el = document.getElementById('toast'); document.getElementById('toastMsg').innerText = msg; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3000); };
window.logout = function() { localStorage.removeItem('maika_onboarded'); location.reload(); }; // Reset pour tester l'onboarding

// Launch
initApp();
