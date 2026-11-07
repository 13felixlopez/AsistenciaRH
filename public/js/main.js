// Interactividad principal del cliente y soporte PWA
document.addEventListener('DOMContentLoaded', () => {
    // 1. Registro del Service Worker para PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => {
                console.log('✅ Service Worker PWA registrado exitosamente:', reg.scope);
            })
            .catch(err => {
                console.warn('⚠️ No se pudo registrar el Service Worker:', err);
            });
    }

    // 2. Manejo de Instalación PWA (beforeinstallprompt)
    let deferredPrompt = null;
    const btnInstallPwa = document.getElementById('btnInstallPwa');

    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevenir el banner automático del navegador
        e.preventDefault();
        deferredPrompt = e;
        // Mostrar el botón en el navbar
        if (btnInstallPwa) {
            btnInstallPwa.classList.remove('d-none');
            btnInstallPwa.classList.add('d-inline-flex');
        }
    });

    if (btnInstallPwa) {
        btnInstallPwa.addEventListener('click', async () => {
            if (!deferredPrompt) {
                Swal.fire({
                    title: 'Instalación PWA',
                    text: 'Para instalar esta app en tu dispositivo, usa la opción "Instalar app" o "Agregar a pantalla de inicio" en el menú de tu navegador.',
                    icon: 'info',
                    confirmButtonText: 'Entendido'
                });
                return;
            }
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`Respuesta de instalación del usuario: ${outcome}`);
            deferredPrompt = null;
            btnInstallPwa.classList.add('d-none');
            btnInstallPwa.classList.remove('d-inline-flex');
        });
    }

    window.addEventListener('appinstalled', () => {
        console.log('🎉 Aplicación AsistenciaRH instalada correctamente como PWA.');
        if (btnInstallPwa) {
            btnInstallPwa.classList.add('d-none');
        }
    });

    // 3. Manejo del sidebar en móviles
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebarMenu');
    const backdrop = document.getElementById('sidebarBackdrop');

    if (sidebarToggle && sidebar && backdrop) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('show');
            backdrop.classList.toggle('show');
        });

        backdrop.addEventListener('click', () => {
            sidebar.classList.remove('show');
            backdrop.classList.remove('show');
        });
    }

    // 4. Resaltar enlace activo en sidebar según la URL
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.sidebar .nav-link');
    navLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href === currentPath || (href !== '/dashboard' && currentPath.startsWith(href))) {
            link.classList.add('active');
        }
    });

    // 5. Confirmación SweetAlert2 para acciones destructivas o cambios de estado
    document.querySelectorAll('.btn-confirm-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const form = btn.closest('form');
            const message = btn.getAttribute('data-confirm-message') || '¿Está seguro de continuar con esta acción?';
            const confirmBtnText = btn.getAttribute('data-btn-text') || 'Sí, continuar';
            const isDanger = btn.classList.contains('btn-danger') || btn.classList.contains('btn-outline-danger');

            Swal.fire({
                title: 'Confirmación',
                text: message,
                icon: isDanger ? 'warning' : 'question',
                showCancelButton: true,
                confirmButtonColor: isDanger ? '#D83548' : '#860063',
                cancelButtonColor: '#6c757d',
                confirmButtonText: confirmBtnText,
                cancelButtonText: 'Cancelar'
            }).then((result) => {
                if (result.isConfirmed) {
                    if (form) form.submit();
                    else if (btn.getAttribute('href')) window.location.href = btn.getAttribute('href');
                }
            });
        });
    });

    // 6. Manejo global para modales de edición (Puestos y Áreas)
    document.addEventListener('click', (e) => {
        // Editar Puesto
        const btnPuesto = e.target.closest('.btn-edit-puesto');
        if (btnPuesto) {
            e.preventDefault();
            const modalEl = document.getElementById('modalEditarPuesto');
            if (modalEl) {
                const idEl = document.getElementById('edit_id_puesto');
                const areaEl = document.getElementById('edit_id_area');
                const nomEl = document.getElementById('edit_puesto_nombre');
                const descEl = document.getElementById('edit_puesto_descripcion');
                const turnosEl = document.getElementById('edit_aplica_turnos');
                const activoEl = document.getElementById('edit_puesto_activo');

                if (idEl) idEl.value = btnPuesto.getAttribute('data-id') || '';
                if (areaEl) areaEl.value = btnPuesto.getAttribute('data-area') || '';
                if (nomEl) nomEl.value = btnPuesto.getAttribute('data-nombre') || '';
                if (descEl) descEl.value = btnPuesto.getAttribute('data-descripcion') || '';
                if (turnosEl) turnosEl.checked = btnPuesto.getAttribute('data-turnos') === '1';
                if (activoEl) activoEl.checked = btnPuesto.getAttribute('data-activo') === '1';

                const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
                modalInstance.show();
            }
        }

        // Editar Área
        const btnArea = e.target.closest('.btn-edit-area');
        if (btnArea) {
            e.preventDefault();
            const modalEl = document.getElementById('modalEditarArea');
            if (modalEl) {
                const idEl = document.getElementById('edit_id_area');
                const codEl = document.getElementById('edit_codigo');
                const nomEl = document.getElementById('edit_nombre');
                const descEl = document.getElementById('edit_descripcion');
                const activaEl = document.getElementById('edit_activa');

                if (idEl) idEl.value = btnArea.getAttribute('data-id') || '';
                if (codEl) codEl.value = btnArea.getAttribute('data-codigo') || '';
                if (nomEl) nomEl.value = btnArea.getAttribute('data-nombre') || '';
                if (descEl) descEl.value = btnArea.getAttribute('data-descripcion') || '';
                if (activaEl) activaEl.checked = btnArea.getAttribute('data-activa') === '1';

                const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
                modalInstance.show();
            }
        }
    });
});
