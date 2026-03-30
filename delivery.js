/**
 * CASNACK — Sistema de Entregas Semanales
 * Módulo: Semana activa, Entregas, WhatsApp, Factura PDF, Historial
 */

import { getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
    getFirestore, collection, doc, getDoc, setDoc, getDocs,
    addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const db = getFirestore(getApp());

// ---- Utilidades ----
function escapeHTML(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
}
function formatCOP(n) { return '$' + Number(n).toLocaleString('es-CO'); }
function swalTheme() {
    const dark = document.body.classList.contains('dark-mode');
    return { background: dark ? '#1e0b35' : '#ffffff', color: dark ? '#f8fafc' : '#111827' };
}
function getWeekId(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${d.getFullYear()}-S${String(weekNum).padStart(2, '0')}`;
}
function formatDate(date) {
    const d = date instanceof Date ? date : (date?.toDate ? date.toDate() : new Date(date));
    return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatTime(date) {
    const d = date instanceof Date ? date : (date?.toDate ? date.toDate() : new Date(date));
    return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// ---- Estado Global ----
let semanaActiva = null; // doc data from config/semanaActiva
let entregasMap = new Map(); // casinoId -> entrega data
let casinosCache = []; // from casinos collection
let snacksCache = new Map(); // id -> snack data
let contactosCache = []; // array of {id, nombre, whatsapp}
let snacksSemanaAnterior = []; // IDs of last week snacks
let currentEntregaCasinoId = null; // for the delivery modal

// ---- DOM refs ----
const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {

    // ---- Load caches from existing onSnapshot in app.js via DOM ----
    // We use our own listeners here for delivery-specific data

    // Listen to casinos
    onSnapshot(collection(db, "casinos"), snap => {
        casinosCache = [];
        snap.forEach(d => casinosCache.push({ id: d.id, ...d.data() }));
        casinosCache.sort((a, b) => (a.orden || Infinity) - (b.orden || Infinity));
        renderDeliveryList();
        renderDashboard();
    });

    // Listen to snacks
    onSnapshot(collection(db, "snacks"), snap => {
        snacksCache.clear();
        snap.forEach(d => snacksCache.set(d.id, { id: d.id, ...d.data() }));
    });

    // Listen to contactos
    onSnapshot(collection(db, "contactos"), snap => {
        contactosCache = [];
        snap.forEach(d => contactosCache.push({ id: d.id, ...d.data() }));
        updateContactosDatalist();
        renderContactos();
    });

    // Listen to semana activa
    onSnapshot(doc(db, "config", "semanaActiva"), docSnap => {
        if (docSnap.exists()) {
            semanaActiva = docSnap.data();
        } else {
            semanaActiva = null;
        }
        renderDashboard();
        renderDeliveryState();
    });

    // Listen to entregas subcollection
    onSnapshot(collection(db, "config", "semanaActiva", "entregas"), snap => {
        entregasMap.clear();
        snap.forEach(d => entregasMap.set(d.id, { id: d.id, ...d.data() }));
        renderDeliveryList();
        renderDashboard();
        // Auto-scan: limpiar entregas huérfanas (casinos eliminados o inactivos)
        limpiarEntregasHuerfanas();
    });

    // ---- BUTTON: Configurar Semana ----
    $('btn-config-semana')?.addEventListener('click', openSnackSelectionModal);
    $('btn-cambiar-snacks')?.addEventListener('click', async () => {
        const result = await Swal.fire({
            title: '¿Cambiar los snacks?',
            text: 'Se descartará la selección actual y podrás elegir nuevos snacks.',
            icon: 'question', showCancelButton: true,
            confirmButtonText: 'Sí, cambiar',
            cancelButtonText: 'Cancelar', ...swalTheme()
        });
        if (result.isConfirmed) {
            // Delete entregas subcollection
            const entregasSnap = await getDocs(collection(db, "config", "semanaActiva", "entregas"));
            for (const d of entregasSnap.docs) await deleteDoc(d.ref);
            // Delete semana activa
            await deleteDoc(doc(db, "config", "semanaActiva"));
            openSnackSelectionModal();
        }
    });
    $('btn-nueva-semana')?.addEventListener('click', async () => {
        const result = await Swal.fire({
            title: '¿Iniciar nueva semana?',
            text: 'Se archivará la semana actual y podrás elegir nuevos snacks.',
            icon: 'question', showCancelButton: true,
            confirmButtonText: 'Sí, nueva semana',
            cancelButtonText: 'Cancelar', ...swalTheme()
        });
        if (result.isConfirmed) {
            await archivarSemana();
            openSnackSelectionModal();
        }
    });

    // ---- BUTTON: Ir a entregas ----
    $('btn-ir-entregas')?.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.target === 'delivery'));
        document.querySelectorAll('.page-view').forEach(v => v.classList.toggle('active', v.id === 'delivery'));
        const t = $('pc-page-title'); if (t) t.textContent = 'Entregas';
    });
    $('btn-delivery-go-dash')?.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.target === 'dashboard'));
        document.querySelectorAll('.page-view').forEach(v => v.classList.toggle('active', v.id === 'dashboard'));
        const t = $('pc-page-title'); if (t) t.textContent = 'Inicio';
    });

    // ---- MODAL: Selección de Snacks ----
    $('modal-seleccion-close')?.addEventListener('click', closeSelectionModal);
    $('btn-cancelar-seleccion')?.addEventListener('click', closeSelectionModal);
    $('btn-confirmar-seleccion')?.addEventListener('click', confirmarSeleccionSemana);

    // ---- MODAL: Entrega ----
    $('modal-entrega-close')?.addEventListener('click', closeEntregaModal);
    $('btn-cancelar-entrega')?.addEventListener('click', closeEntregaModal);
    $('btn-confirmar-entrega')?.addEventListener('click', confirmarEntrega);

    // Auto-fill WhatsApp when selecting a known contact
    $('entrega-receptor-nombre')?.addEventListener('input', (e) => {
        const nombre = e.target.value.trim();
        const contacto = contactosCache.find(c => c.nombre.toLowerCase() === nombre.toLowerCase());
        if (contacto) {
            $('entrega-receptor-whatsapp').value = contacto.whatsapp || '';
        }
    });

    // ---- BUTTON: Factura semanal (dashboard + entregas) ----
    $('btn-factura-semanal')?.addEventListener('click', generarFacturaSemanal);
    $('btn-factura-entregas')?.addEventListener('click', generarFacturaSemanal);

    // ---- BUTTON: Nueva semana (entregas) ----
    $('btn-nueva-semana-entregas')?.addEventListener('click', async () => {
        const result = await Swal.fire({
            title: '¿Iniciar nueva semana?',
            text: 'Se archivará la semana actual y podrás elegir nuevos snacks.',
            icon: 'question', showCancelButton: true,
            confirmButtonText: 'Sí, nueva semana',
            cancelButtonText: 'Cancelar', ...swalTheme()
        });
        if (result.isConfirmed) {
            await archivarSemana();
            openSnackSelectionModal();
        }
    });

    // ---- SEARCH: Filtrar casinos en entregas ----
    $('delivery-search')?.addEventListener('input', () => renderDeliveryList());

    // ---- BUTTON: Cargar historial ----
    $('btn-cargar-historial')?.addEventListener('click', cargarHistorial);

    // ---- Delegation for delivery buttons ----
    document.addEventListener('click', (e) => {
        if (e.target.closest('.btn-entregar-pedido')) {
            const casinoId = e.target.closest('.btn-entregar-pedido').dataset.casinoId;
            openEntregaModal(casinoId);
        }
        if (e.target.closest('.btn-editar-cantidad')) {
            const casinoId = e.target.closest('.btn-editar-cantidad').dataset.casinoId;
            editarCantidadCasino(casinoId);
        }
        if (e.target.closest('.btn-deshacer-entrega')) {
            const casinoId = e.target.closest('.btn-deshacer-entrega').dataset.casinoId;
            deshacerEntrega(casinoId);
        }
        if (e.target.closest('.btn-editar-contacto')) {
            const contactId = e.target.closest('.btn-editar-contacto').dataset.contactId;
            editarContacto(contactId);
        }
        if (e.target.closest('.delivery-card-header')) {
            const header = e.target.closest('.delivery-card-header');
            const casinoId = header.dataset.toggle;
            if (casinoId) {
                const detail = $('del-detail-' + casinoId);
                if (detail) {
                    const isOpen = detail.style.display !== 'none';
                    detail.style.display = isOpen ? 'none' : '';
                    const icon = header.querySelector('.dash-expand-icon');
                    if (icon) icon.textContent = isOpen ? 'expand_more' : 'expand_less';
                }
            }
        }
        if (e.target.closest('.btn-eliminar-contacto')) {
            const contactId = e.target.closest('.btn-eliminar-contacto').dataset.contactId;
            eliminarContacto(contactId);
        }
        // ---- Snacks Extras ----
        if (e.target.closest('.btn-agregar-extra')) {
            const casinoId = e.target.closest('.btn-agregar-extra').dataset.casinoId;
            openExtraSnackModal(casinoId);
        }
        if (e.target.closest('.btn-extra-delete')) {
            const casinoId = e.target.closest('.btn-extra-delete').dataset.casinoId;
            const snackId = e.target.closest('.btn-extra-delete').dataset.snackId;
            eliminarSnackExtra(casinoId, snackId);
        }
    });

    // ---- Modal Snack Extra Events ----
    $('modal-extra-close')?.addEventListener('click', closeExtraSnackModal);
    $('btn-cancelar-extra')?.addEventListener('click', closeExtraSnackModal);
    $('extra-snack-select')?.addEventListener('change', actualizarTotalExtra);
    $('extra-snack-cantidad')?.addEventListener('input', actualizarTotalExtra);
    $('btn-confirmar-extra')?.addEventListener('click', confirmarSnackExtra);
});

// ==================== AUTO-SCAN: LIMPIEZA DE ENTREGAS HUÉRFANAS ====================
// Se ejecuta automáticamente cuando cambian las entregas o los casinos.
// Detecta entregas que apuntan a casinos eliminados o desactivados y las elimina.
let cleanupRunning = false; // Evita ejecuciones concurrentes
async function limpiarEntregasHuerfanas() {
    if (cleanupRunning || !semanaActiva || entregasMap.size === 0 || casinosCache.length === 0) return;
    cleanupRunning = true;
    try {
        // Set de IDs de casinos que actualmente existen y están activos
        const activeCasinoIds = new Set(
            casinosCache.filter(c => c.activo !== false).map(c => c.id)
        );

        const borrarPromises = [];
        entregasMap.forEach((entrega, casinoId) => {
            // Si el casino ya no existe o fue desactivado, y la entrega NO está marcada como entregada
            if (!activeCasinoIds.has(casinoId) && entrega.estado !== 'entregado') {
                console.log(`[Auto-Scan] Limpiando entrega huérfana: ${entrega.casinoNombre || casinoId}`);
                borrarPromises.push(
                    deleteDoc(doc(db, "config", "semanaActiva", "entregas", casinoId))
                );
            }
        });

        if (borrarPromises.length > 0) {
            await Promise.all(borrarPromises);
            // El onSnapshot se encargará de actualizar la UI automáticamente
        }
    } catch (err) {
        console.error("[Auto-Scan] Error limpiando entregas huérfanas:", err);
    } finally {
        cleanupRunning = false;
    }
}

// ==================== DASHBOARD ====================
function renderDashboard() {
    const noWeek = $('dashboard-no-week');
    const active = $('dashboard-active');
    if (!noWeek || !active) return;

    if (!semanaActiva) {
        noWeek.style.display = '';
        active.style.display = 'none';
        return;
    }

    noWeek.style.display = 'none';
    active.style.display = '';

    // Week label
    $('dash-semana-label').textContent = semanaActiva.semanaId || '--';

    // Rango de fechas de la semana actual
    let dateRangeStr = '';
    if (semanaActiva.fechaInicio) {
        const d = semanaActiva.fechaInicio.toDate ? semanaActiva.fechaInicio.toDate() : new Date(semanaActiva.fechaInicio);
        const day = d.getDay();
        const diffMonday = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.setDate(diffMonday));
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);

        const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        const mStr = `${String(monday.getDate()).padStart(2, '0')} ${months[monday.getMonth()]}`;
        const sStr = `${String(sunday.getDate()).padStart(2, '0')} ${months[sunday.getMonth()]} ${sunday.getFullYear()}`;
        dateRangeStr = `Del ${mStr} al ${sStr}`;
    }
    const datesEl = $('dash-semana-dates');
    if (datesEl) {
        datesEl.textContent = dateRangeStr;
        datesEl.style.display = dateRangeStr ? '' : 'none';
    }

    // Entregas progress
    // Solo contamos los casinos que tienen un documento en entregasMap (es decir, los que participaron esta semana)
    const totalCasinos = entregasMap.size;
    let entregados = 0;
    let totalDinero = 0;
    entregasMap.forEach(e => {
        if (e.estado === 'entregado') {
            entregados++;
            totalDinero += e.totalCobro || 0;
        }
    });
    $('dash-entregas-label').textContent = `${entregados} / ${totalCasinos}`;
    $('dash-total-label').textContent = formatCOP(totalDinero);

    // Snacks list
    const snacksList = $('dash-snacks-list');
    if (snacksList && semanaActiva.snacksSeleccionados) {
        snacksList.innerHTML = '';
        const snacksPlaneados = casinosCache.reduce((acc, c) => acc + Number(c.snackEstandar || 0), 0);

        semanaActiva.snacksSeleccionados.forEach(s => {
            snacksList.innerHTML += `
                <div class="dash-snack-chip">
                    <span class="material-icons-round">cookie</span>
                    <span>${escapeHTML(s.nombre)}</span>
                    <span class="chip-price">${snacksPlaneados} unidades</span>
                </div>`;
        });
    }

    // Show invoice button when all delivered
    // Asegurarse de que totalCasinos contemplado coincida con entregasMap
    const allDone = totalCasinos > 0 && entregados === totalCasinos;
    const btnFactura = $('btn-factura-semanal');
    const btnNueva = $('btn-nueva-semana');
    const btnIr = $('btn-ir-entregas');
    const btnCambiarSnacks = $('btn-cambiar-snacks');
    if (btnFactura) btnFactura.style.display = allDone ? '' : 'none';
    if (btnNueva) btnNueva.style.display = allDone ? '' : 'none';
    if (btnIr) btnIr.style.display = allDone ? 'none' : '';
    // Show "Cambiar Snacks" only when 0 deliveries done
    if (btnCambiarSnacks) btnCambiarSnacks.style.display = entregados === 0 ? '' : 'none';
}

// ==================== DELIVERY STATE ====================
function renderDeliveryState() {
    const noWeek = $('delivery-no-week');
    const active = $('delivery-active');
    if (!noWeek || !active) return;

    if (!semanaActiva) {
        noWeek.style.display = '';
        active.style.display = 'none';
    } else {
        noWeek.style.display = 'none';
        active.style.display = '';
        renderDeliveryList();
    }
}

// ==================== DELIVERY LIST ====================
function renderDeliveryList() {
    if (!semanaActiva) return;
    const list = $('delivery-list');
    const totalsGrid = $('delivery-totals-grid');
    const progressBar = $('delivery-progress-bar');
    const progressText = $('delivery-progress-text');
    if (!list) return;

    const snacksSeleccionados = semanaActiva.snacksSeleccionados || [];
    // Trabajamos solo con los casinos involucrados en esta semana
    const activeCasinos = casinosCache.filter(c => entregasMap.has(c.id));
    const totalCasinos = activeCasinos.length;
    let entregados = 0;

    // Calculate grand totals
    const grandTotals = {};
    snacksSeleccionados.forEach(s => {
        grandTotals[s.nombre] = { cantidad: 0, precio: s.precio, subtotal: 0 };
    });

    activeCasinos.forEach(casino => {
        const entrega = entregasMap.get(casino.id);
        // Use custom quantity if set, otherwise use casino standard
        const qty = (entrega?.cantidadCustom != null) ? Number(entrega.cantidadCustom) : (Number(casino.snackEstandar) || 0);
        snacksSeleccionados.forEach(s => {
            grandTotals[s.nombre].cantidad += qty;
            grandTotals[s.nombre].subtotal += qty * s.precio;
        });

        // Agregar extras al total
        const extras = entrega?.snacksExtras || [];
        extras.forEach(extra => {
            if (grandTotals[extra.snackNombre]) {
                grandTotals[extra.snackNombre].cantidad += extra.cantidad;
                grandTotals[extra.snackNombre].subtotal += extra.subtotal;
            }
        });

        if (entrega?.estado === 'entregado') entregados++;
    });

    // Progress
    const pct = totalCasinos > 0 ? (entregados / totalCasinos * 100) : 0;
    if (progressBar) progressBar.style.width = pct + '%';
    if (progressText) progressText.textContent = `${entregados} de ${totalCasinos}`;

    // Show factura/nueva semana buttons when all done
    const allDone = totalCasinos > 0 && entregados === totalCasinos;
    const bottomActions = $('delivery-bottom-actions');
    if (bottomActions) bottomActions.style.display = allDone ? '' : 'none';

    // Totals grid
    if (totalsGrid) {
        let grandTotal = 0;
        totalsGrid.innerHTML = '';
        Object.entries(grandTotals).forEach(([nombre, data]) => {
            grandTotal += data.subtotal;
            totalsGrid.innerHTML += `
                <div class="total-item">
                    <span class="total-name">${escapeHTML(nombre)}</span>
                    <span class="total-qty">${data.cantidad} uds</span>
                    <span class="total-price">${formatCOP(data.subtotal)}</span>
                </div>`;
        });
        totalsGrid.innerHTML += `
            <div class="total-item total-grand">
                <span class="total-name"><strong>GRAN TOTAL</strong></span>
                <span class="total-qty"></span>
                <span class="total-price"><strong>${formatCOP(grandTotal)}</strong></span>
            </div>`;
    }

    // Casino list — pendientes arriba, entregados abajo
    list.innerHTML = '';
    const searchInput = $('delivery-search');
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';

    let filteredCasinos = activeCasinos;
    if (searchTerm) {
        filteredCasinos = activeCasinos.filter(c => c.nombre.toLowerCase().includes(searchTerm));
    }

    const pendientes = filteredCasinos.filter(c => entregasMap.get(c.id)?.estado !== 'entregado');
    const entregadosList = filteredCasinos.filter(c => entregasMap.get(c.id)?.estado === 'entregado');
    const sortedCasinos = [...pendientes, ...entregadosList];

    let separatorInserted = false;
    sortedCasinos.forEach((casino) => {
        const entrega = entregasMap.get(casino.id);
        const isDelivered = entrega?.estado === 'entregado';
        const originalIndex = casinosCache.indexOf(casino);

        // Insert separator before first delivered item
        if (isDelivered && !separatorInserted && pendientes.length > 0) {
            separatorInserted = true;
            list.innerHTML += `<div class="delivery-separator"><span class="material-icons-round">check_circle</span> Entregas Completadas</div>`;
        }

        const qtyOriginal = Number(casino.snackEstandar) || 0;
        const qty = (entrega?.cantidadCustom != null) ? Number(entrega.cantidadCustom) : qtyOriginal;
        const isCustom = entrega?.cantidadCustom != null && Number(entrega.cantidadCustom) !== qtyOriginal;
        const statusClass = isDelivered ? 'status-delivered' : 'status-pending';
        const statusIcon = isDelivered ? 'check_circle' : 'pending';
        const statusText = isDelivered ? 'Entregado' : 'Pendiente';

        // Snacks estándar
        let snacksHTML = '';
        let casinoTotal = 0;
        snacksSeleccionados.forEach(s => {
            const sub = qty * s.precio;
            casinoTotal += sub;
            snacksHTML += `<div class="delivery-snack-row">
                <span>${escapeHTML(s.nombre)}</span>
                <span>${qty} uds</span>
                <span>${formatCOP(sub)}</span>
            </div>`;
        });

        // Snacks Extras
        const extras = entrega?.snacksExtras || [];
        let extrasHTML = '';
        let extrasTotal = 0;
        if (extras.length > 0) {
            extrasHTML = `<div class="snacks-extra-section">
                <div class="snacks-extra-title">
                    <span class="material-icons-round">add_circle</span>
                    <span>Snacks Adicionales</span>
                </div>`;
            extras.forEach(extra => {
                extrasTotal += extra.subtotal || 0;
                extrasHTML += `<div class="snack-extra-item">
                    <span class="snack-extra-name">${escapeHTML(extra.snackNombre)}</span>
                    <span class="snack-extra-qty">${extra.cantidad} uds</span>
                    <span class="snack-extra-price">${formatCOP(extra.subtotal)}</span>
                    <div class="snack-extra-actions">
                        <button class="btn-extra-action btn-extra-delete delete"
                            data-casino-id="${casino.id}"
                            data-snack-id="${extra.snackId}"
                            title="Eliminar extra">
                            <span class="material-icons-round">delete</span>
                        </button>
                    </div>
                </div>`;
            });
            extrasHTML += `</div>`;
        }

        // Botón agregar extra (solo si no está entregado)
        const btnAgregarExtra = !isDelivered ? `
            <button class="btn-agregar-extra" data-casino-id="${casino.id}">
                <span class="material-icons-round">add_circle</span> Agregar Snack Extra
            </button>
        ` : '';

        const qtyLabel = isCustom
            ? `<span class="badge-custom-qty">Modificado: ${qty} uds <span class="text-muted">(estándar: ${qtyOriginal})</span></span>`
            : '';

        let actionsHTML = '';
        if (isDelivered) {
            actionsHTML = `<div class="entrega-info-done">
                <p><span class="material-icons-round text-small">person</span> ${escapeHTML(entrega.receptorNombre)}</p>
                <p><span class="material-icons-round text-small">schedule</span> ${entrega.fechaEntrega ? formatDate(entrega.fechaEntrega) + ' ' + formatTime(entrega.fechaEntrega) : '--'}</p>
            </div>
            <button class="btn-outline-red btn-deshacer-entrega" data-casino-id="${casino.id}">
                <span class="material-icons-round">undo</span> Deshacer
            </button>`;
        } else {
            actionsHTML = `<button class="btn-outline btn-editar-cantidad" data-casino-id="${casino.id}">
                <span class="material-icons-round">edit</span> Cambiar Cantidad
            </button>
            <button class="btn-primary btn-entregar-pedido" data-casino-id="${casino.id}">
                <span class="material-icons-round">delivery_dining</span> Entregar Pedido
            </button>`;
        }

        const totalConExtras = casinoTotal + extrasTotal;

        list.innerHTML += `
            <div class="glass-card delivery-card ${statusClass}" data-casino-id="${casino.id}">
                <div class="delivery-card-header" data-toggle="${casino.id}" style="cursor: pointer; align-items: center;">
                    <div class="delivery-order">#${originalIndex + 1}</div>
                    <div class="delivery-casino-info">
                        <p class="item-title text-lg">${escapeHTML(casino.nombre)}</p>
                        <p class="item-desc"><span class="material-icons-round text-small text-muted">location_on</span> ${escapeHTML(casino.direccion)} — ${escapeHTML(casino.barrio)}</p>
                        ${qtyLabel}
                    </div>
                    <div class="delivery-status ${statusClass}" style="display:flex; align-items:center; gap:4px;">
                        <span class="material-icons-round" style="flex-shrink:0;">${statusIcon}</span>
                        <span>${statusText}</span>
                        <span class="material-icons-round dash-expand-icon" style="margin-left: 8px; opacity: 0.5;">expand_more</span>
                    </div>
                </div>
                <div id="del-detail-${casino.id}" style="display:none; padding-top: 10px; border-top: 1px solid var(--border-subtle); margin-top: 10px;">
                    <div class="delivery-snacks-table">
                        <div class="delivery-snack-row delivery-snack-header">
                            <span>Snack</span><span>Cantidad</span><span>Subtotal</span>
                        </div>
                        ${snacksHTML}
                        <div class="delivery-snack-row delivery-snack-total">
                            <span><strong>Total Estándar</strong></span><span></span><span><strong>${formatCOP(casinoTotal)}</strong></span>
                        </div>
                    </div>
                    ${extrasHTML}
                    ${btnAgregarExtra}
                    <div class="delivery-snack-row delivery-snack-total" style="margin-top: 10px; background: rgba(139, 92, 246, 0.15); border-top: 2px solid var(--color-primary);">
                        <span><strong>TOTAL FINAL</strong></span><span></span><span><strong style="color: var(--color-primary);">${formatCOP(totalConExtras)}</strong></span>
                    </div>
                    <div class="delivery-card-actions" style="margin-top: 16px;">${actionsHTML}</div>
                </div>
            </div>`;
    });
}

// ==================== EDITAR CANTIDAD POR CASINO ====================
async function editarCantidadCasino(casinoId) {
    const casino = casinosCache.find(c => c.id === casinoId);
    if (!casino) return;
    const entrega = entregasMap.get(casinoId);
    const currentQty = (entrega?.cantidadCustom != null) ? entrega.cantidadCustom : (Number(casino.snackEstandar) || 0);

    const { value, isConfirmed } = await Swal.fire({
        title: `Cambiar Cantidad`,
        html: `<p>Casino: <strong>${escapeHTML(casino.nombre)}</strong></p><p>Cantidad estándar: <strong>${casino.snackEstandar} uds</strong> por tipo de snack</p><p>Escribe la nueva cantidad general:</p>`,
        input: 'number',
        inputValue: currentQty,
        inputAttributes: { min: 0, step: 1 },
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        inputValidator: v => { if (v === '' || v == null || Number(v) < 0) return 'Escribe una cantidad válida'; },
        ...swalTheme()
    });

    if (!isConfirmed) return;

    try {
        await updateDoc(doc(db, "config", "semanaActiva", "entregas", casinoId), {
            cantidadCustom: Number(value)
        });
        Swal.fire({ icon: 'success', title: 'Cantidad Actualizada', text: `${casino.nombre}: ${value} unidades por tipo.`, timer: 1500, showConfirmButton: false, ...swalTheme() });
    } catch (err) {
        console.error(err);
        Swal.fire({ title: 'Error', text: 'No se pudo actualizar.', icon: 'error', ...swalTheme() });
    }
}

// ==================== SNACK SELECTION MODAL ====================
async function openSnackSelectionModal() {
    // Load last week snacks
    try {
        const histSnap = await getDocs(collection(db, "historial"));
        const weeks = [];
        histSnap.forEach(d => weeks.push(d.data()));
        weeks.sort((a, b) => (b.fechaArchivo?.seconds || 0) - (a.fechaArchivo?.seconds || 0));
        if (weeks.length > 0 && weeks[0].snacksSeleccionados) {
            snacksSemanaAnterior = weeks[0].snacksSeleccionados.map(s => s.id);
        }
    } catch (e) { console.log("No history yet"); }

    const grid = $('snack-selection-grid');
    if (!grid) return;
    grid.innerHTML = '';

    snacksCache.forEach((snack, id) => {
        const usedLastWeek = snacksSemanaAnterior.includes(id);
        grid.innerHTML += `
            <label class="snack-select-card glass-card" data-snack-id="${id}">
                <input type="checkbox" class="snack-checkbox" value="${id}" ${snacksCache.size <= 5 ? 'checked' : ''}>
                <div class="snack-select-info">
                    <span class="material-icons-round snack-select-icon">cookie</span>
                    <span class="snack-select-name">${escapeHTML(snack.nombre)}</span>
                    <span class="snack-select-price">${formatCOP(snack.precio)}/ud</span>
                    ${usedLastWeek ? '<span class="badge-used">Usado semana pasada</span>' : ''}
                </div>
                <span class="material-icons-round snack-check-mark">check_circle</span>
            </label>`;
    });

    // Event: checkbox changes
    grid.querySelectorAll('.snack-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            const checked = grid.querySelectorAll('.snack-checkbox:checked').length;
            $('seleccion-count').textContent = checked;
            $('btn-confirmar-seleccion').disabled = checked !== 5;

            // Visual feedback
            grid.querySelectorAll('.snack-select-card').forEach(card => {
                const inp = card.querySelector('.snack-checkbox');
                card.classList.toggle('selected', inp.checked);
            });

            // Disable unchecked if 5 selected
            grid.querySelectorAll('.snack-checkbox').forEach(c => {
                if (!c.checked) c.disabled = checked >= 5;
            });
        });
    });

    // Initial state
    const initChecked = grid.querySelectorAll('.snack-checkbox:checked').length;
    $('seleccion-count').textContent = initChecked;
    $('btn-confirmar-seleccion').disabled = initChecked !== 5;
    grid.querySelectorAll('.snack-select-card').forEach(card => {
        const inp = card.querySelector('.snack-checkbox');
        card.classList.toggle('selected', inp.checked);
    });

    $('modal-seleccion-semana').classList.add('active');
}

function closeSelectionModal() {
    $('modal-seleccion-semana').classList.remove('active');
}

async function confirmarSeleccionSemana() {
    const grid = $('snack-selection-grid');
    const selectedIds = [];
    grid.querySelectorAll('.snack-checkbox:checked').forEach(cb => selectedIds.push(cb.value));

    if (selectedIds.length !== 5) {
        Swal.fire({ title: 'Error', text: 'Debes seleccionar exactamente 5 snacks.', icon: 'error', ...swalTheme() });
        return;
    }

    const snacksSeleccionados = selectedIds.map(id => {
        const s = snacksCache.get(id);
        return { id, nombre: s.nombre, precio: s.precio };
    });

    try {
        await setDoc(doc(db, "config", "semanaActiva"), {
            semanaId: getWeekId(),
            snacksSeleccionados,
            estado: 'activa',
            fechaInicio: new Date()
        });

        // Create pending delivery for each casino that is ACTIVE
        const createPromises = casinosCache
            .filter(c => c.activo !== false)
            .map(casino => {
                return setDoc(doc(db, "config", "semanaActiva", "entregas", casino.id), {
                    casinoId: casino.id,
                    casinoNombre: casino.nombre,
                    estado: 'pendiente',
                    fechaEntrega: null,
                    receptorNombre: '',
                    receptorWhatsapp: '',
                    totalCobro: 0
                });
            });

        await Promise.all(createPromises);

        closeSelectionModal();
        Swal.fire({ icon: 'success', title: '¡Semana Configurada!', text: 'Los snacks han sido seleccionados. Ve a Entregas para empezar a repartir.', timer: 2000, showConfirmButton: false, ...swalTheme() });
    } catch (err) {
        console.error(err);
        Swal.fire({ title: 'Error', text: 'No se pudo configurar la semana.', icon: 'error', ...swalTheme() });
    }
}

// ==================== ENTREGA MODAL ====================
function openEntregaModal(casinoId) {
    currentEntregaCasinoId = casinoId;
    const casino = casinosCache.find(c => c.id === casinoId);
    if (!casino || !semanaActiva) return;

    $('entrega-casino-name').textContent = casino.nombre;

    // Show snack details — use custom qty if set
    const detalle = $('entrega-detalle-snacks');
    const entregaData = entregasMap.get(casinoId);
    const qty = (entregaData?.cantidadCustom != null) ? Number(entregaData.cantidadCustom) : (Number(casino.snackEstandar) || 0);
    let html = '<div class="entrega-detail-list">';

    // Snacks estándar
    semanaActiva.snacksSeleccionados.forEach(s => {
        html += `<div class="entrega-detail-item">
            <span>🍿 ${escapeHTML(s.nombre)}</span>
            <strong>${qty} unidades</strong>
        </div>`;
    });

    // Snacks extras
    const extras = entregaData?.snacksExtras || [];
    if (extras.length > 0) {
        extras.forEach(e => {
            html += `<div class="entrega-detail-item" style="background: rgba(139, 92, 246, 0.15); border-color: rgba(139, 92, 246, 0.3);">
                <span>🎁 ${escapeHTML(e.snackNombre)} <small style="color: var(--color-primary);">(Extra)</small></span>
                <strong>${e.cantidad} unidades</strong>
            </div>`;
        });
    }

    html += '</div>';
    detalle.innerHTML = html;

    // Clear inputs
    $('entrega-receptor-nombre').value = '';
    $('entrega-receptor-whatsapp').value = '';

    $('modal-entrega').classList.add('active');
}

function closeEntregaModal() {
    $('modal-entrega').classList.remove('active');
    currentEntregaCasinoId = null;
}

async function confirmarEntrega() {
    const nombre = $('entrega-receptor-nombre').value.trim();
    const whatsapp = $('entrega-receptor-whatsapp').value.trim();

    if (!nombre) {
        Swal.fire({ title: 'Falta el nombre', text: 'Escribe el nombre de quien recibe.', icon: 'warning', ...swalTheme() });
        return;
    }
    if (!whatsapp || whatsapp.length < 7) {
        Swal.fire({ title: 'Falta WhatsApp', text: 'Escribe un número de WhatsApp válido.', icon: 'warning', ...swalTheme() });
        return;
    }

    const casino = casinosCache.find(c => c.id === currentEntregaCasinoId);
    if (!casino || !semanaActiva) return;

    const entregaInfo = entregasMap.get(currentEntregaCasinoId);
    const qty = (entregaInfo?.cantidadCustom != null) ? Number(entregaInfo.cantidadCustom) : (Number(casino.snackEstandar) || 0);
    const now = new Date();

    // Calcular total de snacks estándar
    let totalCobro = 0;
    const detalleSnacks = semanaActiva.snacksSeleccionados.map(s => {
        const sub = qty * s.precio;
        totalCobro += sub;
        return { nombre: s.nombre, cantidad: qty, precioUnitario: s.precio, subtotal: sub };
    });

    // Obtener snacks extras y sumarlos al total
    const snacksExtras = entregaInfo?.snacksExtras || [];
    const totalExtras = snacksExtras.reduce((sum, e) => sum + (e.subtotal || 0), 0);
    const totalFinal = totalCobro + totalExtras;

    try {
        // Update delivery
        await updateDoc(doc(db, "config", "semanaActiva", "entregas", currentEntregaCasinoId), {
            estado: 'entregado',
            receptorNombre: nombre,
            receptorWhatsapp: whatsapp,
            fechaEntrega: now,
            detalleSnacks,
            snacksExtras,
            totalCobro: totalFinal
        });

        // Save/update contact
        const existingContact = contactosCache.find(c => c.nombre.toLowerCase() === nombre.toLowerCase());
        if (existingContact) {
            await updateDoc(doc(db, "contactos", existingContact.id), { whatsapp, ultimoUso: now });
        } else {
            await addDoc(collection(db, "contactos"), { nombre, whatsapp, ultimoUso: now });
        }

        closeEntregaModal();

        // Build WhatsApp message
        const whatsappNumber = whatsapp.startsWith('57') ? whatsapp : '57' + whatsapp;
        let msg = `📦 *Confirmación de Entrega - ${casino.nombre}*\n\n`;
        msg += `Hola, ${nombre}. Se ha realizado la entrega de snacks programada para hoy.\n\n`;
        msg += `*Detalle del Pedido:*\n`;
        detalleSnacks.forEach(s => { msg += `• ${s.nombre}: ${s.cantidad} unidades\n`; });

        // Agregar extras si existen
        if (snacksExtras.length > 0) {
            msg += `\n*🎁 Snacks Adicionales:*\n`;
            snacksExtras.forEach(e => {
                msg += `• ${e.snackNombre}: ${e.cantidad} unidades\n`;
            });
        }

        msg += `\n💰 *TOTAL: ${formatCOP(totalFinal)}*\n`;
        msg += `\n📅 Fecha: ${formatDate(now)}\n`;
        msg += `⏰ Hora: ${formatTime(now)}\n`;
        msg += `👤 Recibido por: ${nombre}\n\n`;
        msg += `*Acción Requerida:*\n`;
        msg += `Confirma que todo está correcto haciendo clic aquí:\n`;
        const confirmMsg = encodeURIComponent(`Confirmo la recepción de los snacks en ${casino.nombre} el día ${formatDate(now)} por un total de ${formatCOP(totalFinal)}`);
        msg += `🔗 https://wa.me/573028563958?text=${confirmMsg}`;

        const waURL = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(msg)}`;
        window.open(waURL, '_blank');

        Swal.fire({ icon: 'success', title: '¡Entrega Registrada!', text: `${casino.nombre} marcado como entregado.`, timer: 2000, showConfirmButton: false, ...swalTheme() });
    } catch (err) {
        console.error(err);
        Swal.fire({ title: 'Error', text: 'No se pudo registrar la entrega.', icon: 'error', ...swalTheme() });
    }
}

// ==================== CONTACTOS DATALIST ====================
function updateContactosDatalist() {
    const dl = $('contactos-datalist');
    if (!dl) return;
    dl.innerHTML = '';
    contactosCache.forEach(c => {
        dl.innerHTML += `<option value="${escapeHTML(c.nombre)}">`;
    });
}

// ==================== SNACKS EXTRAS ====================
let currentExtraCasinoId = null;

function openExtraSnackModal(casinoId) {
    currentExtraCasinoId = casinoId;
    const casino = casinosCache.find(c => c.id === casinoId);
    if (!casino || !semanaActiva) return;

    $('extra-casino-name').textContent = casino.nombre;

    // Llenar select con los 5 snacks de la semana
    const select = $('extra-snack-select');
    select.innerHTML = '<option value="">-- Elige un snack --</option>';
    semanaActiva.snacksSeleccionados.forEach(s => {
        select.innerHTML += `<option value="${s.id}" data-precio="${s.precio}">${escapeHTML(s.nombre)} - ${formatCOP(s.precio)}/ud</option>`;
    });

    // Resetear campos
    $('extra-snack-cantidad').value = '1';
    $('extra-precio-unitario').textContent = '$0';
    $('extra-total').textContent = '$0';
    $('btn-confirmar-extra').disabled = true;

    $('modal-snack-extra').classList.add('active');
}

function closeExtraSnackModal() {
    $('modal-snack-extra').classList.remove('active');
    currentExtraCasinoId = null;
}

function actualizarTotalExtra() {
    const select = $('extra-snack-select');
    const cantidad = Number($('extra-snack-cantidad').value) || 0;
    const option = select.options[select.selectedIndex];

    if (!option.value || cantidad < 1) {
        $('extra-precio-unitario').textContent = '$0';
        $('extra-total').textContent = '$0';
        $('btn-confirmar-extra').disabled = true;
        return;
    }

    const precio = Number(option.dataset.precio) || 0;
    const total = precio * cantidad;

    $('extra-precio-unitario').textContent = formatCOP(precio);
    $('extra-total').textContent = formatCOP(total);
    $('btn-confirmar-extra').disabled = false;
}

async function confirmarSnackExtra() {
    const select = $('extra-snack-select');
    const snackId = select.value;
    const cantidad = Number($('extra-snack-cantidad').value);

    if (!snackId || cantidad < 1) {
        Swal.fire({ title: 'Datos inválidos', text: 'Selecciona un snack y una cantidad válida.', icon: 'warning', ...swalTheme() });
        return;
    }

    const casino = casinosCache.find(c => c.id === currentExtraCasinoId);
    if (!casino || !semanaActiva) return;

    const snack = semanaActiva.snacksSeleccionados.find(s => s.id === snackId);
    if (!snack) return;

    try {
        const entregaRef = doc(db, "config", "semanaActiva", "entregas", currentExtraCasinoId);
        const entregaSnap = await getDoc(entregaRef);

        // Obtener extras existentes o crear array vacío
        const extrasExistentes = entregaSnap.exists() ? (entregaSnap.data().snacksExtras || []) : [];

        // Verificar si ya existe este snack en extras
        const indiceExistente = extrasExistentes.findIndex(e => e.snackId === snackId);
        const nuevoExtra = {
            snackId,
            snackNombre: snack.nombre,
            cantidad,
            precioUnitario: snack.precio,
            subtotal: snack.precio * cantidad
        };

        if (indiceExistente >= 0) {
            // Sumar a la cantidad existente
            extrasExistentes[indiceExistente].cantidad += cantidad;
            extrasExistentes[indiceExistente].subtotal = extrasExistentes[indiceExistente].cantidad * extrasExistentes[indiceExistente].precioUnitario;
        } else {
            // Agregar nuevo extra
            extrasExistentes.push(nuevoExtra);
        }

        await updateDoc(entregaRef, {
            snacksExtras: extrasExistentes
        });

        closeExtraSnackModal();
        Swal.fire({
            icon: 'success',
            title: 'Extra Agregado',
            text: `${cantidad} unidades de ${snack.nombre} agregadas al pedido.`,
            timer: 1500,
            showConfirmButton: false,
            ...swalTheme()
        });
    } catch (err) {
        console.error(err);
        Swal.fire({ title: 'Error', text: 'No se pudo agregar el snack extra.', icon: 'error', ...swalTheme() });
    }
}

async function eliminarSnackExtra(casinoId, snackId) {
    const casino = casinosCache.find(c => c.id === casinoId);
    if (!casino) return;

    const result = await Swal.fire({
        title: '¿Eliminar extra?',
        text: 'Se removerá este snack extra del pedido.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar',
        ...swalTheme()
    });

    if (!result.isConfirmed) return;

    try {
        const entregaRef = doc(db, "config", "semanaActiva", "entregas", casinoId);
        const entregaSnap = await getDoc(entregaRef);

        if (!entregaSnap.exists()) return;

        const extras = entregaSnap.data().snacksExtras || [];
        const nuevosExtras = extras.filter(e => e.snackId !== snackId);

        await updateDoc(entregaRef, {
            snacksExtras: nuevosExtras
        });

        Swal.fire({
            icon: 'success',
            title: 'Extra Eliminado',
            timer: 1500,
            showConfirmButton: false,
            ...swalTheme()
        });
    } catch (err) {
        console.error(err);
        Swal.fire({ title: 'Error', text: 'No se pudo eliminar el extra.', icon: 'error', ...swalTheme() });
    }
}

// ==================== FACTURA PDF SEMANAL ====================
// Helper: load image as base64
function loadImageAsBase64(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            canvas.getContext('2d').drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

async function generarFacturaSemanal() {
    if (!semanaActiva) return;

    Swal.fire({ title: 'Generando factura...', allowOutsideClick: false, didOpen: () => Swal.showLoading(), ...swalTheme() });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'letter');

    const purple = [46, 16, 101];
    const lightPurple = [120, 80, 200];
    const white = [255, 255, 255];
    const pageW = pdf.internal.pageSize.getWidth();
    let y = 15;

    // Header background
    pdf.setFillColor(...purple);
    pdf.rect(0, 0, pageW, 48, 'F');

    // Logo
    try {
        const logoData = await loadImageAsBase64('LOGO CASNACK.png');
        if (logoData) {
            pdf.addImage(logoData, 'PNG', 12, 6, 36, 36);
        }
    } catch (e) { console.log('Logo not loaded'); }

    // Title (offset for logo)
    pdf.setTextColor(...white);
    pdf.setFontSize(22);
    pdf.setFont('helvetica', 'bold');
    pdf.text('CASNACK', 52, y + 8);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Cuenta de Cobro Semanal', 52, y + 16);
    pdf.setFontSize(12);
    pdf.text('Semana: ' + (semanaActiva.semanaId || ''), pageW - 15, y + 8, { align: 'right' });
    pdf.text('Fecha: ' + formatDate(new Date()), pageW - 15, y + 16, { align: 'right' });

    y = 58;

    // Snacks de la semana
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(13);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Snacks de la Semana:', 15, y);
    y += 6;
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    (semanaActiva.snacksSeleccionados || []).forEach(s => {
        pdf.text('  - ' + s.nombre + ' -- ' + formatCOP(s.precio) + '/ud', 20, y);
        y += 5;
    });
    y += 5;

    // Per-casino breakdown
    let grandTotal = 0;
    casinosCache.forEach(casino => {
        const entrega = entregasMap.get(casino.id);
        if (!entrega || entrega.estado !== 'entregado') return;

        // Check if we need a new page
        if (y > 230) { pdf.addPage(); y = 20; }

        pdf.setFillColor(...lightPurple);
        pdf.setTextColor(...white);
        pdf.setFontSize(11);
        pdf.setFont('helvetica', 'bold');
        pdf.rect(15, y - 4, pageW - 30, 8, 'F');
        pdf.text(casino.nombre, 18, y + 1);
        y += 10;

        // Casino meta — sin emojis
        pdf.setTextColor(80, 80, 80);
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'normal');
        pdf.text('Direccion: ' + (casino.direccion || '') + ' - ' + (casino.barrio || ''), 18, y);
        y += 4;
        pdf.text('Recibido por: ' + (entrega.receptorNombre || ''), 18, y);
        y += 4;
        pdf.text('Fecha: ' + (entrega.fechaEntrega ? formatDate(entrega.fechaEntrega) + ' - ' + formatTime(entrega.fechaEntrega) : '--'), 18, y);
        y += 6;

        // Snack table - estándar
        const tableData = (entrega.detalleSnacks || []).map(s => [
            s.nombre, String(s.cantidad), formatCOP(s.precioUnitario), formatCOP(s.subtotal)
        ]);

        // Agregar snacks extras si existen
        const extras = entrega.snacksExtras || [];
        if (extras.length > 0) {
            extras.forEach(extra => {
                tableData.push([
                    `${extra.snackNombre} (Extra)`,
                    String(extra.cantidad),
                    formatCOP(extra.precioUnitario),
                    formatCOP(extra.subtotal)
                ]);
            });
        }

        // Calcular total con extras
        const totalConExtras = (entrega.totalCobro || 0) + (extras.reduce((sum, e) => sum + (e.subtotal || 0), 0));
        tableData.push([{ content: 'TOTAL CASINO', styles: { fontStyle: 'bold' } }, '', '', { content: formatCOP(totalConExtras), styles: { fontStyle: 'bold' } }]);
        grandTotal += totalConExtras;

        pdf.autoTable({
            startY: y,
            margin: { left: 18, right: 18 },
            head: [['Snack', 'Cantidad', 'Precio Ud.', 'Subtotal']],
            body: tableData,
            styles: { fontSize: 9, cellPadding: 2 },
            headStyles: { fillColor: purple, textColor: white },
            theme: 'grid'
        });
        y = pdf.lastAutoTable.finalY + 10;
    });

    // Grand total
    if (y > 250) { pdf.addPage(); y = 20; }
    pdf.setFillColor(...purple);
    pdf.rect(15, y - 2, pageW - 30, 12, 'F');
    pdf.setTextColor(...white);
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text('TOTAL GENERAL:', 20, y + 6);
    pdf.text(formatCOP(grandTotal), pageW - 20, y + 6, { align: 'right' });

    // Open in new tab for sharing (instead of downloading)
    const pdfBlob = pdf.output('blob');
    const filename = 'CuentaDeCobro_CASNACK_' + (semanaActiva.semanaId || '') + '.pdf';

    Swal.close();

    // Try Web Share API first (mobile), fallback to open in new tab
    if (navigator.share && navigator.canShare) {
        try {
            const file = new File([pdfBlob], filename, { type: 'application/pdf' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({ title: 'Cuenta de Cobro - CASNACK', files: [file] });
                return;
            }
        } catch (e) { console.log('Share cancelled or failed, opening in tab'); }
    }

    // Fallback: open in new tab
    const blobUrl = URL.createObjectURL(pdfBlob);
    window.open(blobUrl, '_blank');
}

// ==================== ARCHIVAR SEMANA ====================
async function archivarSemana() {
    if (!semanaActiva) return;

    // Collect all delivery data
    const entregas = [];
    entregasMap.forEach(e => entregas.push({ ...e }));

    // Save to historial as 1 document
    let targetId = semanaActiva.semanaId;
    let docRef = doc(db, "historial", targetId);
    let docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        let suffixCode = 66; // 'B' (66 in ASCII)
        while (docSnap.exists()) {
            targetId = semanaActiva.semanaId + '-' + String.fromCharCode(suffixCode);
            docRef = doc(db, "historial", targetId);
            docSnap = await getDoc(docRef);
            suffixCode++;
            if (suffixCode > 90) break; // Avoid infinite loop beyond 'Z'
        }
    }

    await setDoc(docRef, {
        semanaId: targetId,
        snacksSeleccionados: semanaActiva.snacksSeleccionados,
        fechaInicio: semanaActiva.fechaInicio,
        fechaArchivo: new Date(),
        entregas,
        casinos: casinosCache.map(c => ({ id: c.id, nombre: c.nombre, direccion: c.direccion, barrio: c.barrio, snackEstandar: c.snackEstandar }))
    });

    // Delete entregas subcollection
    const entregasSnap = await getDocs(collection(db, "config", "semanaActiva", "entregas"));
    for (const d of entregasSnap.docs) {
        await deleteDoc(d.ref);
    }

    // Delete semana activa
    await deleteDoc(doc(db, "config", "semanaActiva"));

    Swal.fire({ icon: 'success', title: 'Semana Archivada', text: 'El historial ha sido guardado.', timer: 2000, showConfirmButton: false, ...swalTheme() });
}

// ==================== HISTORIAL / REPORTES ====================
async function cargarHistorial() {
    const list = $('reports-list');
    if (!list) return;

    list.innerHTML = '<div class="glass-card"><p class="text-muted">Cargando historial...</p></div>';

    try {
        const snap = await getDocs(collection(db, "historial"));
        const weeks = [];
        snap.forEach(d => weeks.push({ id: d.id, ...d.data() }));
        weeks.sort((a, b) => (b.fechaArchivo?.seconds || 0) - (a.fechaArchivo?.seconds || 0));

        if (weeks.length === 0) {
            list.innerHTML = '<div class="glass-card welcome-card"><p class="text-muted">No hay historial todavía.</p></div>';
            return;
        }

        list.innerHTML = '';
        weeks.forEach(week => {
            let totalSemana = 0;
            const entregasCount = (week.entregas || []).filter(e => e.estado === 'entregado').length;
            (week.entregas || []).forEach(e => { totalSemana += e.totalCobro || 0; });

            let entregasDetailHTML = '';
            (week.entregas || []).forEach(e => {
                if (e.estado !== 'entregado') return;
                entregasDetailHTML += `
                    <div class="historial-entrega-item">
                        <strong>${escapeHTML(e.casinoNombre)}</strong>
                        <span>${escapeHTML(e.receptorNombre)} — ${e.fechaEntrega ? formatDate(e.fechaEntrega) + ' ' + formatTime(e.fechaEntrega) : '--'}</span>
                        <span>${formatCOP(e.totalCobro)}</span>
                    </div>`;
            });

            // Calculate Date Range (Monday to Sunday)
            let dateRangeStr = '';
            if (week.fechaInicio) {
                const d = week.fechaInicio.toDate ? week.fechaInicio.toDate() : new Date(week.fechaInicio);
                const day = d.getDay();
                const diffMonday = d.getDate() - day + (day === 0 ? -6 : 1);
                const monday = new Date(d.setDate(diffMonday));
                const sunday = new Date(monday);
                sunday.setDate(monday.getDate() + 6);

                const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
                const mStr = `${String(monday.getDate()).padStart(2, '0')} de ${months[monday.getMonth()]}`;
                const sStr = `${String(sunday.getDate()).padStart(2, '0')} de ${months[sunday.getMonth()]} del ${sunday.getFullYear()}`;
                dateRangeStr = `<p class="text-muted text-small mb-small" style="color:var(--color-primary-light);">Semana del ${mStr} al ${sStr}</p>`;
            }

            list.innerHTML += `
                <div class="glass-card historial-card">
                    <div class="historial-header" data-toggle="${week.id}">
                        <div>
                            <h3 class="font-bold">${escapeHTML(week.semanaId)}</h3>
                            ${dateRangeStr}
                            <p class="text-muted">${entregasCount} entregas — ${formatCOP(totalSemana)}</p>
                        </div>
                        <span class="material-icons-round">expand_more</span>
                    </div>
                    <div class="historial-detail" id="hist-${week.id}" style="display:none;">
                        <div class="mb-large">
                            <p class="font-bold mb-small">Snacks Seleccionados:</p>
                            <div class="historial-snacks">
                                ${(week.snacksSeleccionados || []).map(s => `<span class="dash-snack-chip">${escapeHTML(s.nombre)}</span>`).join(' ')}
                            </div>
                        </div>
                        ${entregasDetailHTML}
                        <div class="mt-xl" style="display:flex; justify-content:center; gap:8px;">
                            <button class="btn-primary btn-historial-pdf" data-week-id="${week.id}">
                                <span class="material-icons-round">picture_as_pdf</span> Generar Cuenta de Cobro
                            </button>
                            <button class="btn-outline-red btn-historial-delete" data-week-id="${week.id}">
                                <span class="material-icons-round">delete</span> Eliminar
                            </button>
                        </div>
                    </div>
                </div>`;
        });

        // Toggle detail
        list.querySelectorAll('.historial-header').forEach(h => {
            h.addEventListener('click', () => {
                const detail = $('hist-' + h.dataset.toggle);
                if (detail) {
                    const isOpen = detail.style.display !== 'none';
                    detail.style.display = isOpen ? 'none' : '';
                    h.querySelector('.material-icons-round').textContent = isOpen ? 'expand_more' : 'expand_less';
                }
            });
        });

        // PDF buttons
        list.querySelectorAll('.btn-historial-pdf').forEach(btn => {
            btn.addEventListener('click', () => {
                const weekId = btn.dataset.weekId;
                const weekData = weeks.find(w => w.id === weekId);
                if (weekData) generarFacturaHistorial(weekData);
            });
        });

        // Delete Historial buttons
        list.querySelectorAll('.btn-historial-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const weekId = btn.dataset.weekId;
                eliminarHistorialSemana(weekId);
            });
        });
    } catch (err) {
        console.error(err);
        list.innerHTML = '<div class="glass-card"><p class="text-muted">Error al cargar historial.</p></div>';
    }
}

// ==================== FACTURA PDF DESDE HISTORIAL ====================
async function generarFacturaHistorial(weekData) {
    Swal.fire({ title: 'Generando factura...', allowOutsideClick: false, didOpen: () => Swal.showLoading(), ...swalTheme() });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'letter');

    const purple = [46, 16, 101];
    const lightPurple = [120, 80, 200];
    const white = [255, 255, 255];
    const pageW = pdf.internal.pageSize.getWidth();
    let y = 15;

    pdf.setFillColor(...purple);
    pdf.rect(0, 0, pageW, 48, 'F');

    try {
        const logoData = await loadImageAsBase64('LOGO CASNACK.png');
        if (logoData) pdf.addImage(logoData, 'PNG', 12, 6, 36, 36);
    } catch (e) { }

    pdf.setTextColor(...white);
    pdf.setFontSize(22);
    pdf.setFont('helvetica', 'bold');
    pdf.text('CASNACK', 52, y + 8);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Cuenta de Cobro Semanal', 52, y + 16);
    pdf.setFontSize(12);
    pdf.text('Semana: ' + (weekData.semanaId || ''), pageW - 15, y + 8, { align: 'right' });
    const archDate = weekData.fechaArchivo?.toDate ? weekData.fechaArchivo.toDate() : (weekData.fechaArchivo ? new Date(weekData.fechaArchivo) : new Date());
    pdf.text('Fecha: ' + formatDate(archDate), pageW - 15, y + 16, { align: 'right' });

    y = 58;

    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(13);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Snacks de la Semana:', 15, y);
    y += 6;
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    (weekData.snacksSeleccionados || []).forEach(s => {
        pdf.text('  - ' + s.nombre + ' -- ' + formatCOP(s.precio) + '/ud', 20, y);
        y += 5;
    });
    y += 5;

    let grandTotal = 0;
    const casinos = weekData.casinos || [];
    (weekData.entregas || []).forEach(entrega => {
        if (entrega.estado !== 'entregado') return;
        const casino = casinos.find(c => c.id === entrega.casinoId) || { nombre: entrega.casinoNombre || '', direccion: '', barrio: '' };

        if (y > 230) { pdf.addPage(); y = 20; }

        pdf.setFillColor(...lightPurple);
        pdf.setTextColor(...white);
        pdf.setFontSize(11);
        pdf.setFont('helvetica', 'bold');
        pdf.rect(15, y - 4, pageW - 30, 8, 'F');
        pdf.text(casino.nombre || entrega.casinoNombre || '', 18, y + 1);
        y += 10;

        pdf.setTextColor(80, 80, 80);
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'normal');
        pdf.text('Direccion: ' + (casino.direccion || '') + ' - ' + (casino.barrio || ''), 18, y);
        y += 4;
        pdf.text('Recibido por: ' + (entrega.receptorNombre || ''), 18, y);
        y += 4;
        const eDate = entrega.fechaEntrega?.toDate ? entrega.fechaEntrega.toDate() : (entrega.fechaEntrega ? new Date(entrega.fechaEntrega) : null);
        pdf.text('Fecha: ' + (eDate ? formatDate(eDate) + ' - ' + formatTime(eDate) : '--'), 18, y);
        y += 6;

        const tableData = (entrega.detalleSnacks || []).map(s => [
            s.nombre, String(s.cantidad), formatCOP(s.precioUnitario), formatCOP(s.subtotal)
        ]);

        // Agregar snacks extras si existen
        const extras = entrega.snacksExtras || [];
        if (extras.length > 0) {
            extras.forEach(extra => {
                tableData.push([
                    `${extra.snackNombre} (Extra)`,
                    String(extra.cantidad),
                    formatCOP(extra.precioUnitario),
                    formatCOP(extra.subtotal)
                ]);
            });
        }

        // Calcular total con extras
        const totalConExtras = (entrega.totalCobro || 0) + (extras.reduce((sum, e) => sum + (e.subtotal || 0), 0));
        tableData.push([{ content: 'TOTAL CASINO', styles: { fontStyle: 'bold' } }, '', '', { content: formatCOP(totalConExtras), styles: { fontStyle: 'bold' } }]);
        grandTotal += totalConExtras;

        pdf.autoTable({
            startY: y, margin: { left: 18, right: 18 },
            head: [['Snack', 'Cantidad', 'Precio Ud.', 'Subtotal']],
            body: tableData,
            styles: { fontSize: 9, cellPadding: 2 },
            headStyles: { fillColor: purple, textColor: white },
            theme: 'grid'
        });
        y = pdf.lastAutoTable.finalY + 10;
    });

    if (y > 250) { pdf.addPage(); y = 20; }
    pdf.setFillColor(...purple);
    pdf.rect(15, y - 2, pageW - 30, 12, 'F');
    pdf.setTextColor(...white);
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text('TOTAL GENERAL:', 20, y + 6);
    pdf.text(formatCOP(grandTotal), pageW - 20, y + 6, { align: 'right' });

    const pdfBlob = pdf.output('blob');
    const filename = 'CuentaDeCobro_CASNACK_' + (weekData.semanaId || '') + '.pdf';
    Swal.close();

    if (navigator.share && navigator.canShare) {
        try {
            const file = new File([pdfBlob], filename, { type: 'application/pdf' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({ title: 'Cuenta de Cobro - CASNACK', files: [file] });
                return;
            }
        } catch (e) { }
    }
    window.open(URL.createObjectURL(pdfBlob), '_blank');
}

// ==================== ELIMINAR HISTORIAL SEMANA ====================
async function eliminarHistorialSemana(weekId) {
    const result = await Swal.fire({
        title: '¿Eliminar semana?',
        text: 'Se borrará este historial de entregas. Esta acción no se puede deshacer.',
        icon: 'warning', showCancelButton: true,
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar', ...swalTheme()
    });

    if (!result.isConfirmed) return;

    try {
        await deleteDoc(doc(db, "historial", weekId));
        Swal.fire({ icon: 'success', title: 'Historial eliminado', timer: 1500, showConfirmButton: false, ...swalTheme() });
        cargarHistorial(); // Reload list
    } catch (err) {
        console.error(err);
        Swal.fire({ title: 'Error', text: 'No se pudo eliminar.', icon: 'error', ...swalTheme() });
    }
}

// ==================== DESHACER ENTREGA ====================
async function deshacerEntrega(casinoId) {
    const casino = casinosCache.find(c => c.id === casinoId);
    if (!casino) return;

    const result = await Swal.fire({
        title: '¿Deshacer entrega?',
        text: `${casino.nombre} volverá a estado Pendiente. Los snacks extras se conservarán.`,
        icon: 'warning', showCancelButton: true,
        confirmButtonText: 'Sí, deshacer',
        cancelButtonText: 'Cancelar', ...swalTheme()
    });

    if (!result.isConfirmed) return;

    try {
        // Obtener los extras actuales para conservarlos
        const entregaRef = doc(db, "config", "semanaActiva", "entregas", casinoId);
        const entregaSnap = await getDoc(entregaRef);
        const extrasActuales = entregaSnap.exists() ? (entregaSnap.data().snacksExtras || []) : [];
        const cantidadCustom = entregaSnap.exists() ? (entregaSnap.data().cantidadCustom ?? null) : null;

        await updateDoc(entregaRef, {
            estado: 'pendiente',
            receptorNombre: '',
            receptorWhatsapp: '',
            fechaEntrega: null,
            detalleSnacks: [],
            totalCobro: 0,
            // Conservar extras y cantidad custom
            snacksExtras: extrasActuales,
            cantidadCustom: cantidadCustom
        });
        Swal.fire({ icon: 'success', title: 'Entrega deshecha', text: `${casino.nombre} vuelve a Pendiente.`, timer: 1500, showConfirmButton: false, ...swalTheme() });
    } catch (err) {
        console.error(err);
        Swal.fire({ title: 'Error', text: 'No se pudo deshacer.', icon: 'error', ...swalTheme() });
    }
}

// ==================== CONTACTOS ====================
function renderContactos() {
    const list = $('contactos-list');
    if (!list) return;

    if (contactosCache.length === 0) {
        list.innerHTML = `<div class="glass-card welcome-card">
            <div class="welcome-icon-wrap"><span class="material-icons-round welcome-icon">person_off</span></div>
            <h3 class="metallic-text">No hay contactos</h3>
            <p class="text-muted">Los contactos se agregan automáticamente al registrar una entrega.</p>
        </div>`;
        return;
    }

    list.innerHTML = '';
    contactosCache.forEach(c => {
        list.innerHTML += `
            <div class="glass-card list-item interactive">
                <div class="item-info">
                    <div class="icon-circle bg-blue"><span class="material-icons-round" style="color:#fff">person</span></div>
                    <div>
                        <p class="item-title">${escapeHTML(c.nombre)}</p>
                        <p class="item-desc">${escapeHTML(c.whatsapp || 'Sin WhatsApp')}</p>
                    </div>
                </div>
                <div style="display:flex;gap:8px;">
                    <button class="icon-btn btn-editar-contacto" data-contact-id="${c.id}" title="Editar">
                        <span class="material-icons-round">edit</span>
                    </button>
                    <button class="icon-btn btn-eliminar-contacto" data-contact-id="${c.id}" title="Eliminar" style="color:var(--color-red);">
                        <span class="material-icons-round">delete</span>
                    </button>
                </div>
            </div>`;
    });
}

async function editarContacto(contactId) {
    const contacto = contactosCache.find(c => c.id === contactId);
    if (!contacto) return;

    const { value, isConfirmed } = await Swal.fire({
        title: 'Editar Contacto',
        html: `
            <div style="text-align:left;">
                <label style="font-weight:600;display:block;margin-bottom:4px;">Nombre</label>
                <input id="swal-nombre" class="swal2-input" value="${escapeHTML(contacto.nombre)}" placeholder="Nombre">
                <label style="font-weight:600;display:block;margin-top:12px;margin-bottom:4px;">WhatsApp</label>
                <input id="swal-whatsapp" class="swal2-input" value="${escapeHTML(contacto.whatsapp || '')}" placeholder="3001234567">
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const nombre = document.getElementById('swal-nombre').value.trim();
            const whatsapp = document.getElementById('swal-whatsapp').value.trim();
            if (!nombre) { Swal.showValidationMessage('El nombre es obligatorio'); return false; }
            return { nombre, whatsapp };
        },
        ...swalTheme()
    });

    if (!isConfirmed || !value) return;

    try {
        await updateDoc(doc(db, "contactos", contactId), { nombre: value.nombre, whatsapp: value.whatsapp });
        Swal.fire({ icon: 'success', title: 'Contacto actualizado', timer: 1500, showConfirmButton: false, ...swalTheme() });
    } catch (err) {
        console.error(err);
        Swal.fire({ title: 'Error', text: 'No se pudo actualizar.', icon: 'error', ...swalTheme() });
    }
}

async function eliminarContacto(contactId) {
    const contacto = contactosCache.find(c => c.id === contactId);
    if (!contacto) return;

    const result = await Swal.fire({
        title: '¿Eliminar contacto?',
        text: `Se eliminará "${contacto.nombre}" de la lista.`,
        icon: 'warning', showCancelButton: true,
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar', ...swalTheme()
    });

    if (!result.isConfirmed) return;

    try {
        await deleteDoc(doc(db, "contactos", contactId));
        Swal.fire({ icon: 'success', title: 'Contacto eliminado', timer: 1500, showConfirmButton: false, ...swalTheme() });
    } catch (err) {
        console.error(err);
        Swal.fire({ title: 'Error', text: 'No se pudo eliminar.', icon: 'error', ...swalTheme() });
    }
}
