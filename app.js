/**
 * CASNACK Dashboard — Lógica de Interacción y Firebase
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
    getFirestore, collection, addDoc, onSnapshot,
    doc, deleteDoc, updateDoc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ---- Firebase Configuration ----
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

// ---- Utilidad: Escapar HTML para prevenir XSS ----
function escapeHTML(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
}

// ---- Utilidad: SweetAlert con tema actual ----
function swalTheme() {
    const dark = document.body.classList.contains('dark-mode');
    return {
        background: dark ? '#1e0b35' : '#ffffff',
        color: dark ? '#f8fafc' : '#111827'
    };
}

document.addEventListener('DOMContentLoaded', () => {

    // ========== NAVEGACIÓN ==========
    const navButtons = document.querySelectorAll('.nav-btn');
    const pageViews = document.querySelectorAll('.page-view');
    const pcPageTitle = document.getElementById('pc-page-title');

    const pageTitles = {
        'dashboard': 'Inicio',
        'snacks': 'Snacks',
        'casinos': 'Casinos',
        'delivery': 'Entregas',
        'contactos': 'Contactos',
        'reports': 'Reportes de Consumo'
    };

    function switchPage(targetId) {
        navButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.target === targetId);
        });
        pageViews.forEach(view => {
            if (view.id === targetId) {
                view.classList.add('active');
                view.style.animation = 'none';
                view.offsetHeight; /* trigger reflow */
                view.style.animation = null;
            } else {
                view.classList.remove('active');
            }
        });
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

    // ========== CAMBIO DE TEMA ==========
    const themeToggleBtns = document.querySelectorAll('.theme-toggle');
    const body = document.body;

    const savedTheme = localStorage.getItem('casnack-theme') || 'dark-mode';
    body.className = savedTheme;
    updateThemeIcons(savedTheme);

    themeToggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const newTheme = body.classList.contains('dark-mode') ? 'light-mode' : 'dark-mode';
            body.className = newTheme;
            localStorage.setItem('casnack-theme', newTheme);
            updateThemeIcons(newTheme);
        });
    });

    function updateThemeIcons(theme) {
        themeToggleBtns.forEach(btn => {
            const icon = btn.querySelector('.theme-icon');
            if (icon) icon.textContent = theme === 'dark-mode' ? 'light_mode' : 'dark_mode';
        });
    }

    // ========== ESTADO DE EDICIÓN ==========
    let editingCasinoId = null;
    let editingSnackId = null;
    const casinosDataMap = new Map();
    const snacksDataMap = new Map();

    // ========== REFERENCIAS DOM ==========
    const casinosListContainer = document.getElementById('casinos-list');
    const snacksListContainer = document.getElementById('snacks-list');
    const addCasinoFormCard = document.getElementById('add-casino-form');
    const addSnackFormCard = document.getElementById('add-snack-form');
    const casinoFormTitle = document.getElementById('casino-form-title');
    const snackFormTitle = document.getElementById('snack-form-title');

    const btnSaveCasino = document.getElementById('btn-save-casino');
    const btnCancelCasino = document.getElementById('btn-cancel-casino');
    const inputCasinoName = document.getElementById('casino-name-input');
    const inputCasinoAddr = document.getElementById('casino-addr-input');
    const inputCasinoBarrio = document.getElementById('casino-barrio-input');
    const inputCasinoSnacks = document.getElementById('casino-snacks-input');

    const btnSaveSnack = document.getElementById('btn-save-snack');
    const btnCancelSnack = document.getElementById('btn-cancel-snack');
    const inputSnackName = document.getElementById('snack-name-input');
    const inputSnackPrecio = document.getElementById('snack-precio-input');

    const btnAddCasino = document.getElementById('btn-add-casino');
    const btnAddSnack = document.getElementById('btn-add-snack');

    // ========== FUNCIONES DE RESET DE FORMULARIOS ==========
    function resetCasinoForm() {
        editingCasinoId = null;
        inputCasinoName.value = '';
        inputCasinoAddr.value = '';
        inputCasinoBarrio.value = '';
        inputCasinoSnacks.value = '';
        const inputCasinoActivo = document.getElementById('casino-activo-input');
        if (inputCasinoActivo) inputCasinoActivo.checked = true;
        if (casinoFormTitle) casinoFormTitle.textContent = 'Registrar Nuevo Casino';
        if (btnSaveCasino) btnSaveCasino.innerHTML = 'Guardar Casino';
        addCasinoFormCard.style.display = 'none';
    }

    function resetSnackForm() {
        editingSnackId = null;
        inputSnackName.value = '';
        inputSnackPrecio.value = '';
        if (snackFormTitle) snackFormTitle.textContent = 'Registrar Nuevo Snack';
        if (btnSaveSnack) btnSaveSnack.innerHTML = 'Guardar Snack';
        addSnackFormCard.style.display = 'none';
    }

    // ---- Botones Cancelar ----
    if (btnCancelCasino) btnCancelCasino.addEventListener('click', resetCasinoForm);
    if (btnCancelSnack) btnCancelSnack.addEventListener('click', resetSnackForm);

    // ---- Botones Agregar (resetean modo edición y abren formulario limpio) ----
    if (btnAddCasino) {
        btnAddCasino.addEventListener('click', () => {
            resetCasinoForm();
            addCasinoFormCard.style.display = 'block';
            addCasinoFormCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }
    if (btnAddSnack) {
        btnAddSnack.addEventListener('click', () => {
            resetSnackForm();
            addSnackFormCard.style.display = 'block';
            addSnackFormCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }

    // ========== DELEGACIÓN DE EVENTOS ==========
    document.addEventListener('click', (e) => {

        // ---- EDITAR ----
        if (e.target.closest('.btn-edit')) {
            const currentItem = e.target.closest('.list-item');
            if (!currentItem) return;
            const docId = currentItem.dataset.id;
            const isCasino = currentItem.closest('#casinos');
            const isSnack = currentItem.closest('#snacks');

            if (isCasino && docId) {
                const data = casinosDataMap.get(docId);
                if (data) {
                    editingCasinoId = docId;
                    inputCasinoName.value = data.nombre || '';
                    inputCasinoAddr.value = data.direccion || '';
                    inputCasinoBarrio.value = data.barrio || '';
                    inputCasinoSnacks.value = data.snackEstandar || '';
                    const inputCasinoActivo = document.getElementById('casino-activo-input');
                    if (inputCasinoActivo) inputCasinoActivo.checked = data.activo !== false;
                    if (casinoFormTitle) casinoFormTitle.textContent = 'Editar Casino';
                    if (btnSaveCasino) btnSaveCasino.innerHTML = 'Actualizar Casino';
                    addCasinoFormCard.style.display = 'block';
                    addCasinoFormCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            } else if (isSnack && docId) {
                const data = snacksDataMap.get(docId);
                if (data) {
                    editingSnackId = docId;
                    inputSnackName.value = data.nombre || '';
                    inputSnackPrecio.value = data.precio || '';
                    if (snackFormTitle) snackFormTitle.textContent = 'Editar Snack';
                    if (btnSaveSnack) btnSaveSnack.innerHTML = 'Actualizar Snack';
                    addSnackFormCard.style.display = 'block';
                    addSnackFormCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        }

        // ---- SUBIR (reordenar en Firebase) ----
        if (e.target.closest('.icon-btn-small[title="Subir"]')) {
            const currentItem = e.target.closest('.list-item');
            if (!currentItem) return;
            const previousItem = currentItem.previousElementSibling;

            if (previousItem && previousItem.classList.contains('list-item')) {
                const currentId = currentItem.dataset.id;
                const prevId = previousItem.dataset.id;
                const currentOrden = Number(currentItem.dataset.orden);
                const prevOrden = Number(previousItem.dataset.orden);
                const collectionName = currentItem.closest('#casinos') ? 'casinos' : 'snacks';

                // Animación visual
                currentItem.style.transform = 'translateY(-10px)';
                previousItem.style.transform = 'translateY(10px)';
                setTimeout(() => {
                    currentItem.style.transform = '';
                    previousItem.style.transform = '';
                }, 200);

                // Intercambiar orden en Firebase (persiste al recargar)
                Promise.all([
                    updateDoc(doc(db, collectionName, currentId), { orden: prevOrden }),
                    updateDoc(doc(db, collectionName, prevId), { orden: currentOrden })
                ]).catch(err => console.error("Error al reordenar:", err));
            }
        }

        // ---- BAJAR (reordenar en Firebase) ----
        if (e.target.closest('.icon-btn-small[title="Bajar"]')) {
            const currentItem = e.target.closest('.list-item');
            if (!currentItem) return;
            const nextItem = currentItem.nextElementSibling;

            if (nextItem && nextItem.classList.contains('list-item')) {
                const currentId = currentItem.dataset.id;
                const nextId = nextItem.dataset.id;
                const currentOrden = Number(currentItem.dataset.orden);
                const nextOrden = Number(nextItem.dataset.orden);
                const collectionName = currentItem.closest('#casinos') ? 'casinos' : 'snacks';

                currentItem.style.transform = 'translateY(10px)';
                nextItem.style.transform = 'translateY(-10px)';
                setTimeout(() => {
                    currentItem.style.transform = '';
                    nextItem.style.transform = '';
                }, 200);

                Promise.all([
                    updateDoc(doc(db, collectionName, currentId), { orden: nextOrden }),
                    updateDoc(doc(db, collectionName, nextId), { orden: currentOrden })
                ]).catch(err => console.error("Error al reordenar:", err));
            }
        }

        // ---- ELIMINAR ----
        if (e.target.closest('.btn-delete')) {
            const currentItem = e.target.closest('.list-item');
            if (!currentItem) return;
            const isCasino = currentItem.closest('#casinos');
            const isSnack = currentItem.closest('#snacks');
            const docId = currentItem.dataset.id;

            const itemType = isCasino ? "Casino" : (isSnack ? "Snack" : "Elemento");
            const titleElement = currentItem.querySelector('.item-title');
            const itemName = titleElement ? titleElement.textContent : itemType;

            Swal.fire({
                title: `¿Eliminar ${itemType}?`,
                text: `Estás a punto de eliminar "${itemName}". Esta acción no se puede deshacer.`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#ef4444',
                cancelButtonColor: '#4b5563',
                confirmButtonText: 'Sí, eliminar',
                cancelButtonText: 'Cancelar',
                ...swalTheme(),
                customClass: { popup: 'glass-card border-subtle' }
            }).then((result) => {
                if (result.isConfirmed) {
                    if (docId) {
                        const collName = isCasino ? "casinos" : (isSnack ? "snacks" : null);
                        if (collName) {
                            deleteDoc(doc(db, collName, docId)).catch(err => console.error("Error eliminando:", err));
                        }
                    }
                    Swal.fire({
                        icon: 'success',
                        title: '¡Eliminado!',
                        text: `El ${itemType.toLowerCase()} ha sido eliminado.`,
                        timer: 1500,
                        showConfirmButton: false,
                        ...swalTheme()
                    });
                }
            });
        }
    });

    // ========== GUARDAR CASINO ==========
    if (btnSaveCasino) {
        btnSaveCasino.addEventListener('click', async () => {
            const name = inputCasinoName.value.trim();
            const addr = inputCasinoAddr.value.trim();
            const barrio = inputCasinoBarrio.value.trim();
            const qty = inputCasinoSnacks.value.trim();
            const inputCasinoActivo = document.getElementById('casino-activo-input');
            const isActivo = inputCasinoActivo ? inputCasinoActivo.checked : true;

            if (!name) {
                Swal.fire({ title: 'Campo requerido', text: 'El nombre del casino es obligatorio.', icon: 'warning', ...swalTheme() });
                return;
            }

            try {
                btnSaveCasino.disabled = true;
                btnSaveCasino.innerHTML = '<span class="material-icons-round rotate-anim">sync</span> Guardando...';

                if (editingCasinoId) {
                    await updateDoc(doc(db, "casinos", editingCasinoId), {
                        nombre: name,
                        direccion: addr || 'Sin dirección',
                        barrio: barrio || 'Desconocido',
                        snackEstandar: qty || '0',
                        activo: isActivo
                    });

                    // Si hay una semana activa, actualizar entrega
                    try {
                        const semanaActivaSnap = await getDoc(doc(db, "config", "semanaActiva"));
                        if (semanaActivaSnap.exists() && isActivo) {
                            const entregaRef = doc(db, "config", "semanaActiva", "entregas", editingCasinoId);
                            const entregaSnap = await getDoc(entregaRef);
                            // Solo se crea en pendiente si no existe
                            if (!entregaSnap.exists()) {
                                await setDoc(entregaRef, {
                                    casinoId: editingCasinoId,
                                    casinoNombre: name,
                                    estado: 'pendiente',
                                    fechaEntrega: null,
                                    receptorNombre: '',
                                    receptorWhatsapp: '',
                                    totalCobro: 0
                                });
                            } else {
                                // Si ya existe actualiza su nombre al nuevo por si acaso
                                await updateDoc(entregaRef, { casinoNombre: name });
                            }
                        } else if (semanaActivaSnap.exists() && !isActivo) {
                            // Opcional: Si se pasa a inactivo, podríamos borrarlo de las entregas pendientes actuales si no ha sido entregado.
                            const entregaRef = doc(db, "config", "semanaActiva", "entregas", editingCasinoId);
                            const entregaSnap = await getDoc(entregaRef);
                            if (entregaSnap.exists() && entregaSnap.data().estado !== 'entregado') {
                                await deleteDoc(entregaRef);
                            }
                        }
                    } catch (e) { console.error("Error gestionando entrega de semana activa", e); }

                    Swal.fire({ icon: 'success', title: '¡Actualizado!', text: 'Casino actualizado correctamente.', timer: 1500, showConfirmButton: false, ...swalTheme() });
                } else {
                    const newCasinoRef = await addDoc(collection(db, "casinos"), {
                        nombre: name,
                        direccion: addr || 'Sin dirección',
                        barrio: barrio || 'Desconocido',
                        snackEstandar: qty || '0',
                        activo: isActivo,
                        orden: Date.now(),
                        fechaCreacion: new Date()
                    });

                    try {
                        const semanaActivaSnap = await getDoc(doc(db, "config", "semanaActiva"));
                        if (semanaActivaSnap.exists() && isActivo) {
                            await setDoc(doc(db, "config", "semanaActiva", "entregas", newCasinoRef.id), {
                                casinoId: newCasinoRef.id,
                                casinoNombre: name,
                                estado: 'pendiente',
                                fechaEntrega: null,
                                receptorNombre: '',
                                receptorWhatsapp: '',
                                totalCobro: 0
                            });
                        }
                    } catch (e) { console.error("Error agregando a entregas de semana activa", e); }

                    Swal.fire({ icon: 'success', title: '¡Guardado!', text: 'Casino registrado correctamente.', timer: 1500, showConfirmButton: false, ...swalTheme() });
                }

                resetCasinoForm();
            } catch (error) {
                console.error("Error al guardar el casino:", error);
                Swal.fire({ title: 'Error', text: 'Hubo un error al guardar. Revisa la consola.', icon: 'error', ...swalTheme() });
            } finally {
                btnSaveCasino.disabled = false;
                if (editingCasinoId) btnSaveCasino.innerHTML = 'Actualizar Casino';
                else btnSaveCasino.innerHTML = 'Guardar Casino';
            }
        });
    }

    // ========== GUARDAR SNACK ==========
    if (btnSaveSnack) {
        btnSaveSnack.addEventListener('click', async () => {
            const name = inputSnackName.value.trim();
            const precio = inputSnackPrecio.value.trim();

            if (!name) {
                Swal.fire({ title: 'Campo requerido', text: 'El nombre del snack es obligatorio.', icon: 'warning', ...swalTheme() });
                return;
            }

            try {
                btnSaveSnack.disabled = true;
                btnSaveSnack.innerHTML = '<span class="material-icons-round rotate-anim">sync</span> Guardando...';

                if (editingSnackId) {
                    await updateDoc(doc(db, "snacks", editingSnackId), {
                        nombre: name,
                        precio: Number(precio) || 0
                    });
                    Swal.fire({ icon: 'success', title: '¡Actualizado!', text: 'Snack actualizado correctamente.', timer: 1500, showConfirmButton: false, ...swalTheme() });
                } else {
                    await addDoc(collection(db, "snacks"), {
                        nombre: name,
                        precio: Number(precio) || 0,
                        orden: Date.now(),
                        fechaCreacion: new Date()
                    });
                    Swal.fire({ icon: 'success', title: '¡Guardado!', text: 'Snack registrado correctamente.', timer: 1500, showConfirmButton: false, ...swalTheme() });
                }

                resetSnackForm();
            } catch (error) {
                console.error("Error al guardar el snack:", error);
                Swal.fire({ title: 'Error', text: 'Hubo un error al guardar el snack. Revisa la consola.', icon: 'error', ...swalTheme() });
            } finally {
                btnSaveSnack.disabled = false;
                if (editingSnackId) btnSaveSnack.innerHTML = 'Actualizar Snack';
                else btnSaveSnack.innerHTML = 'Guardar Snack';
            }
        });
    }

    // ========== LECTURA EN TIEMPO REAL: CASINOS ==========
    onSnapshot(collection(db, "casinos"), (snapshot) => {
        const docs = [];
        casinosDataMap.clear();

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            casinosDataMap.set(docSnap.id, data);
            docs.push({ id: docSnap.id, ...data });
        });

        // Ordenar por campo 'orden' ascendente; docs sin 'orden' van al final
        docs.sort((a, b) => (a.orden || Infinity) - (b.orden || Infinity));

        casinosListContainer.innerHTML = '';

        docs.forEach((casino) => {
            const isInactive = casino.activo === false;
            const inactiveBadge = isInactive ? `<span class="badge-inactive">INACTIVO</span>` : '';
            const inactiveClass = isInactive ? 'casino-inactivo' : '';
            const html = `
                <div class="glass-card list-item interactive ${inactiveClass}" style="animation: fadeIn var(--transition-smooth);" data-id="${casino.id}" data-orden="${casino.orden || 0}">
                    <div class="item-info casino-info w-full">
                        <div class="icon-circle bg-blue"><span class="material-icons-round text-blue">casino</span></div>
                        <div class="casino-details w-full">
                            <p class="item-title text-lg">${escapeHTML(casino.nombre)} ${inactiveBadge}</p>
                            <div class="casino-meta">
                                <p class="item-desc"><span class="material-icons-round text-small text-muted">location_on</span> ${escapeHTML(casino.direccion)}</p>
                                <p class="item-desc"><span class="material-icons-round text-small text-muted">map</span> Barrio ${escapeHTML(casino.barrio)}</p>
                            </div>
                        </div>
                    </div>
                    <div class="item-trailing flex-row">
                        <div class="text-right mr-large hide-on-mobile">
                            <p class="item-title font-display">${escapeHTML(casino.snackEstandar)}</p>
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
            casinosListContainer.insertAdjacentHTML('beforeend', html);
        });
    });

    // ========== LECTURA EN TIEMPO REAL: SNACKS ==========
    onSnapshot(collection(db, "snacks"), (snapshot) => {
        const docs = [];
        snacksDataMap.clear();

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            snacksDataMap.set(docSnap.id, data);
            docs.push({ id: docSnap.id, ...data });
        });

        docs.sort((a, b) => (a.orden || Infinity) - (b.orden || Infinity));

        snacksListContainer.innerHTML = '';

        docs.forEach((snack) => {
            const html = `
                <div class="glass-card list-item interactive" style="animation: fadeIn var(--transition-smooth);" data-id="${snack.id}" data-orden="${snack.orden || 0}">
                    <div class="item-info casino-info w-full">
                        <div class="icon-circle bg-orange"><span class="material-icons-round text-orange">cookie</span></div>
                        <div class="casino-details w-full">
                            <p class="item-title text-lg">${escapeHTML(snack.nombre)}</p>
                            <div class="casino-meta">
                                <p class="item-desc"><span class="material-icons-round text-small text-muted">sell</span> Precio de Venta</p>
                            </div>
                        </div>
                    </div>
                    <div class="item-trailing flex-row">
                        <div class="text-right mr-large hide-on-mobile">
                            <p class="item-title font-display">$${Number(snack.precio).toLocaleString('es-CO')}</p>
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
            snacksListContainer.insertAdjacentHTML('beforeend', html);
        });
    });

    // ========== EASTER EGG ==========
    const logoWrappers = document.querySelectorAll('.logo-wrapper, .mobile-logo-wrapper');
    const easterEggOverlay = document.getElementById('easter-egg-overlay');

    if (easterEggOverlay) {
        logoWrappers.forEach(wrapper => {
            wrapper.addEventListener('click', () => {
                if (easterEggOverlay.classList.contains('active')) return;
                easterEggOverlay.classList.add('active');

                const totalDuration = 1800;
                const spawnInterval = 100;

                let coinInterval = setInterval(() => {
                    const coin = document.createElement('div');
                    coin.classList.add('easter-egg-coin');
                    coin.innerHTML = '<span class="material-icons-round">monetization_on</span>';

                    const randomX = (Math.random() - 0.5) * 300;
                    const randomY = (Math.random() * -120) - 100;
                    const randomRotation = (Math.random() * 1080) + 360;

                    coin.style.setProperty('--tx', `${randomX}px`);
                    coin.style.setProperty('--ty', `${randomY}px`);
                    coin.style.setProperty('--tr', `${randomRotation}deg`);
                    coin.style.animationDelay = `0s`;

                    easterEggOverlay.appendChild(coin);
                }, spawnInterval);

                setTimeout(() => {
                    clearInterval(coinInterval);
                    easterEggOverlay.classList.remove('active');
                    setTimeout(() => {
                        document.querySelectorAll('.easter-egg-coin').forEach(c => c.remove());
                    }, 250);
                }, totalDuration);
            });
        });
    }
});
