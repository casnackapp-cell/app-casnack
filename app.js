/**
 * CASNACK UI Interaction Logic
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
    projectId: "app-casnack",
    appId: "1:280170226374:web:39348ad041516c324aedc7",
    storageBucket: "app-casnack.firebasestorage.app",
    apiKey: "AIzaSyAnL2sRGsQoKs2ycqY4TnNtX7_PObvn7aw",
    authDomain: "app-casnack.firebaseapp.com",
    messagingSenderId: "280170226374",
    measurementId: "G-174LS201Y2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

document.addEventListener('DOMContentLoaded', () => {
    // ---- Page Navigation ----
    const navButtons = document.querySelectorAll('.nav-btn');
    const pageViews = document.querySelectorAll('.page-view');
    const pcPageTitle = document.getElementById('pc-page-title');

    const pageTitles = {
        'dashboard': 'Inicio',
        'snacks': 'Snacks',
        'casinos': 'Casinos',
        'delivery': 'Entregas',
        'reports': 'Reportes de Consumo'
    };

    function switchPage(targetId) {
        // Update valid buttons
        navButtons.forEach(btn => {
            if (btn.dataset.target === targetId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Update view
        pageViews.forEach(view => {
            if (view.id === targetId) {
                view.classList.add('active');
                // Optional: trigger enter animation
                view.style.animation = 'none';
                view.offsetHeight; /* trigger reflow */
                view.style.animation = null;
            } else {
                view.classList.remove('active');
            }
        });

        // Update PC title
        if (pcPageTitle && pageTitles[targetId]) {
            pcPageTitle.textContent = pageTitles[targetId];
        }
    }

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target;
            if (target) switchPage(target);
        });
    });

    // ---- Theme Toggle ----
    const themeToggleBtns = document.querySelectorAll('.theme-toggle');
    const body = document.body;

    // Check local storage for theme
    const savedTheme = localStorage.getItem('casnack-theme') || 'dark-mode';
    body.className = savedTheme;
    updateThemeIcons(savedTheme);

    themeToggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (body.classList.contains('dark-mode')) {
                body.classList.remove('dark-mode');
                body.classList.add('light-mode');
                localStorage.setItem('casnack-theme', 'light-mode');
                updateThemeIcons('light-mode');
            } else {
                body.classList.remove('light-mode');
                body.classList.add('dark-mode');
                localStorage.setItem('casnack-theme', 'dark-mode');
                updateThemeIcons('dark-mode');
            }
        });
    });

    function updateThemeIcons(theme) {
        themeToggleBtns.forEach(btn => {
            const icon = btn.querySelector('.theme-icon');
            if (icon) {
                icon.textContent = theme === 'dark-mode' ? 'light_mode' : 'dark_mode';
            }
        });
    }

    // FAB Menú eliminado.

    // ---- Universal List Item Interactions (Event Delegation) ----
    document.addEventListener('click', (e) => {
        // Handle Moving Up
        if (e.target.closest('.icon-btn-small[title="Subir"]')) {
            const currentItem = e.target.closest('.list-item');
            const previousItem = currentItem?.previousElementSibling;

            if (previousItem && !previousItem.classList.contains('form-card')) {
                const container = currentItem.parentNode;
                currentItem.style.transform = 'translateY(-10px)';
                previousItem.style.transform = 'translateY(10px)';
                setTimeout(() => {
                    currentItem.style.transform = '';
                    previousItem.style.transform = '';
                    container.insertBefore(currentItem, previousItem);
                }, 200);
            }
        }

        // Handle Moving Down
        if (e.target.closest('.icon-btn-small[title="Bajar"]')) {
            const currentItem = e.target.closest('.list-item');
            const nextItem = currentItem?.nextElementSibling;

            if (nextItem) {
                const container = currentItem.parentNode;
                currentItem.style.transform = 'translateY(10px)';
                nextItem.style.transform = 'translateY(-10px)';
                setTimeout(() => {
                    currentItem.style.transform = '';
                    nextItem.style.transform = '';
                    container.insertBefore(currentItem, nextItem.nextElementSibling);
                }, 200);
            }
        }

        // Handle Deletion
        if (e.target.closest('.btn-delete')) {
            const currentItem = e.target.closest('.list-item');
            if (currentItem) {
                currentItem.style.transform = 'scale(0.9)';
                currentItem.style.opacity = '0';
                setTimeout(() => {
                    currentItem.remove();
                }, 300);
            }
        }
    });

    // ---- Form Submission Logic: Guardar Casino & Snack ----

    // Guardar Casino
    const btnSaveCasino = document.getElementById('btn-save-casino');
    const inputCasinoName = document.getElementById('casino-name-input');
    const inputCasinoAddr = document.getElementById('casino-addr-input');
    const inputCasinoBarrio = document.getElementById('casino-barrio-input');
    const inputCasinoSnacks = document.getElementById('casino-snacks-input');

    if (btnSaveCasino) {
        btnSaveCasino.addEventListener('click', async () => {
            const name = inputCasinoName.value.trim() || 'Nuevo Casino';
            const addr = inputCasinoAddr.value.trim() || 'Sin dirección';
            const barrio = inputCasinoBarrio.value.trim() || 'Desconocido';
            const qty = inputCasinoSnacks.value.trim() || '0';

            try {
                // Deshabilitar boton mientras guarda
                btnSaveCasino.disabled = true;
                btnSaveCasino.innerHTML = '<span class="material-icons-round rotate-anim">sync</span> Guardando...';

                await addDoc(collection(db, "casinos"), {
                    nombre: name,
                    direccion: addr,
                    barrio: barrio,
                    snackEstandar: qty,
                    fechaCreacion: new Date()
                });

                // Ocultar modal y limpiar inputs
                document.getElementById('add-casino-form').style.display = 'none';
                inputCasinoName.value = '';
                inputCasinoAddr.value = '';
                inputCasinoBarrio.value = '';
                inputCasinoSnacks.value = '';

            } catch (error) {
                console.error("Error al guardar el casino: ", error);
                alert("Hubo un error al guardar. Revisa la consola.");
            } finally {
                btnSaveCasino.disabled = false;
                btnSaveCasino.innerHTML = 'Guardar Casino';
            }
        });
    }

    // ---- Lectura de Casinos en tiempo real desde Firebase ----
    const casinosListContainer = document.querySelector('#casinos .list-container');
    const addCasinoFormCard = document.getElementById('add-casino-form');

    // Quitar mocks estaticos iniciales: (Eliminamos el renderizado de mocks que había antes)
    const existingMocks = casinosListContainer.querySelectorAll('.list-item');
    existingMocks.forEach(item => item.remove());

    onSnapshot(collection(db, "casinos"), (snapshot) => {
        // Limpiamos la lista cada vez que haya un cambio, exceptuando el form
        const currentItems = casinosListContainer.querySelectorAll('.list-item');
        currentItems.forEach(item => item.remove());

        snapshot.forEach((doc) => {
            const casinoData = doc.data();
            const newCasinoHTML = `
                <div class="glass-card list-item interactive" style="animation: fadeIn var(--transition-smooth);" data-id="${doc.id}">
                    <div class="item-info casino-info w-full">
                        <div class="icon-circle bg-blue"><span class="material-icons-round text-blue">casino</span></div>
                        <div class="casino-details w-full">
                            <p class="item-title text-lg">${casinoData.nombre}</p>
                            <div class="casino-meta">
                                <p class="item-desc"><span class="material-icons-round text-small text-muted">location_on</span> ${casinoData.direccion}</p>
                                <p class="item-desc"><span class="material-icons-round text-small text-muted">map</span> Barrio ${casinoData.barrio}</p>
                            </div>
                        </div>
                    </div>
                    <div class="item-trailing flex-row">
                        <div class="text-right mr-large hide-on-mobile">
                            <p class="item-title font-display">${casinoData.snackEstandar}</p>
                            <p class="item-desc text-muted">Snacks Estandar</p>
                        </div>
                        <div class="action-controls mr-small">
                            <button class="icon-btn-small btn-edit" title="Editar Casino"><span class="material-icons-round text-small">edit</span></button>
                            <button class="icon-btn-small btn-delete" title="Eliminar Casino"><span class="material-icons-round text-small">delete</span></button>
                        </div>
                        <div class="order-controls">
                            <button class="icon-btn-small" title="Subir"><span class="material-icons-round">keyboard_arrow_up</span></button>
                            <button class="icon-btn-small" title="Bajar"><span class="material-icons-round">keyboard_arrow_down</span></button>
                        </div>
                    </div>
                </div>
            `;
            // Apendizar a la lista de casinos después del form
            addCasinoFormCard.insertAdjacentHTML('afterend', newCasinoHTML);
        });
    });

    // Guardar Snack
    const btnSaveSnack = document.getElementById('btn-save-snack');
    const inputSnackName = document.getElementById('snack-name-input');
    const inputSnackPrecio = document.getElementById('snack-precio-input');

    if (btnSaveSnack) {
        btnSaveSnack.addEventListener('click', async () => {
            const name = inputSnackName.value.trim() || 'Nuevo Snack';
            const precio = inputSnackPrecio.value.trim() || '0';

            try {
                // Deshabilitar boton mientras guarda
                btnSaveSnack.disabled = true;
                btnSaveSnack.innerHTML = '<span class="material-icons-round rotate-anim">sync</span> Guardando...';

                await addDoc(collection(db, "snacks"), {
                    nombre: name,
                    precio: Number(precio),
                    fechaCreacion: new Date()
                });

                // Ocultar modal y limpiar inputs
                document.getElementById('add-snack-form').style.display = 'none';
                inputSnackName.value = '';
                inputSnackPrecio.value = '';

            } catch (error) {
                console.error("Error al guardar el snack: ", error);
                alert("Hubo un error al guardar el snack. Revisa la consola.");
            } finally {
                btnSaveSnack.disabled = false;
                btnSaveSnack.innerHTML = 'Guardar Snack';
            }
        });
    }

    // ---- Lectura de Snacks en tiempo real desde Firebase ----
    const snacksListContainer = document.querySelector('#snacks .list-container');
    const addSnackFormCard = document.getElementById('add-snack-form');

    // Quitar mocks estaticos iniciales
    const existingSnackMocks = snacksListContainer.querySelectorAll('.list-item');
    existingSnackMocks.forEach(item => item.remove());

    onSnapshot(collection(db, "snacks"), (snapshot) => {
        // Limpiamos la lista cada vez que haya un cambio, exceptuando el form
        const currentItems = snacksListContainer.querySelectorAll('.list-item');
        currentItems.forEach(item => item.remove());

        snapshot.forEach((doc) => {
            const snackData = doc.data();
            const newSnackHTML = `
                <div class="glass-card list-item interactive" style="animation: fadeIn var(--transition-smooth);" data-id="${doc.id}">
                    <div class="item-info casino-info w-full">
                        <div class="icon-circle bg-orange"><span class="material-icons-round text-orange">cookie</span></div>
                        <div class="casino-details w-full">
                            <p class="item-title text-lg">${snackData.nombre}</p>
                            <div class="casino-meta">
                                <p class="item-desc"><span class="material-icons-round text-small text-muted">sell</span> Precio de Venta</p>
                            </div>
                        </div>
                    </div>
                    <div class="item-trailing flex-row">
                        <div class="text-right mr-large hide-on-mobile">
                            <p class="item-title font-display">$${Number(snackData.precio).toLocaleString('es-CO')}</p>
                            <p class="item-desc text-muted">COP</p>
                        </div>
                        <div class="action-controls mr-small">
                            <button class="icon-btn-small btn-edit" title="Editar Snack"><span class="material-icons-round text-small">edit</span></button>
                            <button class="icon-btn-small btn-delete" title="Eliminar Snack"><span class="material-icons-round text-small">delete</span></button>
                        </div>
                        <div class="order-controls">
                            <button class="icon-btn-small" title="Subir"><span class="material-icons-round">keyboard_arrow_up</span></button>
                            <button class="icon-btn-small" title="Bajar"><span class="material-icons-round">keyboard_arrow_down</span></button>
                        </div>
                    </div>
                </div>
            `;
            // Apendizar a la lista de snacks después del form
            addSnackFormCard.insertAdjacentHTML('afterend', newSnackHTML);
        });
    });

    // ---- Easter Egg Logic ----
    const logoWrappers = document.querySelectorAll('.logo-wrapper, .mobile-logo-wrapper');
    const easterEggOverlay = document.getElementById('easter-egg-overlay');

    if (easterEggOverlay) {
        logoWrappers.forEach(wrapper => {
            wrapper.addEventListener('click', () => {
                if (easterEggOverlay.classList.contains('active')) return;

                easterEggOverlay.classList.add('active');

                // Generar monedas cayendo una por una (fichas)
                const totalDuration = 1800; // 1.8 segundos total
                const spawnInterval = 100; // Cada 100ms sale una nueva moneda

                let coinInterval = setInterval(() => {
                    const coin = document.createElement('div');
                    coin.classList.add('easter-egg-coin');
                    coin.innerHTML = '<span class="material-icons-round">monetization_on</span>';

                    // Variables aleatorias para la trayectoria de cada moneda
                    const randomX = (Math.random() - 0.5) * 300; // Trayectoria menos amplia (-150px a 150px)
                    const randomY = (Math.random() * -120) - 100; // Salto hacia arriba
                    const randomRotation = (Math.random() * 1080) + 360; // Giros

                    coin.style.setProperty('--tx', `${randomX}px`);
                    coin.style.setProperty('--ty', `${randomY}px`);
                    coin.style.setProperty('--tr', `${randomRotation}deg`);

                    // Asegurarnos de que no haya delay aleatorio adicional, nacen instantaneamente en su turno
                    coin.style.animationDelay = `0s`;

                    easterEggOverlay.appendChild(coin);
                }, spawnInterval);

                // Auto-cerrar después de la animación de rebote y fuente de monedas (1.8s)
                setTimeout(() => {
                    clearInterval(coinInterval);
                    easterEggOverlay.classList.remove('active');
                    // Limpiar las monedas del DOM de forma suave
                    setTimeout(() => {
                        document.querySelectorAll('.easter-egg-coin').forEach(c => c.remove());
                    }, 250); // Mismo tiempo de la transicion css de opacity
                }, totalDuration);
            });
        });

        // El usuario me pidio que no se pueda salir haciendo click, asique quitamos el listener para forzar el cierre manual.
    }
});
