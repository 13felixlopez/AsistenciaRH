// Renderizado dinámico de Layout (Navbar, Sidebar, Footer) manteniendo diseño original

function initAppLayout(activeKey = '') {
    if (!Auth.requireAuth()) return;

    const user = Auth.getUser() || { nombre: 'Usuario', rol_codigo: 'USER', rol_nombre: 'Usuario', email: '' };
    const isAdmin = user.rol_codigo === 'ADMIN';
    const isSoloVista = user.rol_codigo === 'CONSULTOR' || user.rol_codigo === 'SOLO_VISTA' || user.id_rol === 3;
    const userInitial = (user.nombre || 'U').charAt(0).toUpperCase();

    // Fecha actual en español
    const fechaActualStr = new Date().toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const homeUrl = isAdmin ? '/dashboard.html' : (isSoloVista ? '/reportes.html' : '/asistencias-registro.html');

    // 1. Inyectar Sidebar si existe el contenedor #sidebarMenu
    const sidebarEl = document.getElementById('sidebarMenu');
    if (sidebarEl) {
        sidebarEl.className = 'sidebar bg-white border-end d-flex flex-column';
        sidebarEl.innerHTML = `
            <div class="sidebar-header p-3 border-bottom d-flex align-items-center justify-content-between">
                <a href="${homeUrl}" class="text-decoration-none d-flex align-items-center gap-2">
                    <div class="brand-icon bg-white rounded-3 d-flex align-items-center justify-content-center p-1 border shadow-sm" style="width: 42px; height: 42px;">
                        <img src="/img/logo.png" alt="Logo" class="img-fluid" style="max-height: 34px; object-fit: contain;">
                    </div>
                    <div>
                        <span class="fs-6 fw-bold text-dark d-block lh-1">Registro de <span class="text-primary">Asistencia</span></span>
                        <small class="text-muted" style="font-size: 0.72rem;">Control por Áreas & Puestos</small>
                    </div>
                </a>
            </div>

            <div class="sidebar-user px-3 py-3 border-bottom bg-light-subtle">
                <div class="d-flex align-items-center gap-2">
                    <div class="user-avatar bg-primary-subtle text-primary fw-bold rounded-circle d-flex align-items-center justify-content-center" style="width: 36px; height: 36px; font-size: 0.9rem;">
                        ${userInitial}
                    </div>
                    <div class="overflow-hidden">
                        <div class="fw-semibold text-truncate text-dark" style="font-size: 0.88rem;">${user.nombre}</div>
                        <span class="badge ${isAdmin ? 'bg-danger' : (isSoloVista ? 'bg-info text-dark' : 'bg-primary')}" style="font-size: 0.68rem;">
                            ${user.rol_nombre || (isAdmin ? 'Administrador' : (isSoloVista ? 'Solo Vista' : 'Supervisor'))}
                        </span>
                    </div>
                </div>
            </div>

            <div class="sidebar-body flex-grow-1 overflow-auto py-2">
                <ul class="nav nav-pills flex-column px-2 gap-1">
                    <li class="nav-item">
                        <a href="/dashboard.html" class="nav-link text-secondary d-flex align-items-center gap-2 py-2 ${activeKey === 'dashboard' ? 'active' : ''}">
                            <i class="bi bi-grid-1x2-fill text-primary"></i>
                            <span>Panel Principal</span>
                        </a>
                    </li>

                    <li class="nav-header text-uppercase text-muted fw-bold mt-3 mb-1 px-3" style="font-size: 0.7rem; letter-spacing: 0.05rem;">
                        Operaciones
                    </li>

                    ${!isSoloVista ? `
                        <li class="nav-item">
                            <a href="/asistencias-registro.html" class="nav-link text-secondary d-flex align-items-center gap-2 py-2 ${activeKey === 'registro' ? 'active' : ''}">
                                <i class="bi bi-pencil-square text-success"></i>
                                <span>Registrar Asistencia</span>
                            </a>
                        </li>
                    ` : ''}

                    <li class="nav-item">
                        <a href="/asistencias-historial.html" class="nav-link text-secondary d-flex align-items-center gap-2 py-2 ${activeKey === 'historial' ? 'active' : ''}">
                            <i class="bi bi-clock-history text-info"></i>
                            <span>Historial de Registros</span>
                        </a>
                    </li>

                    <li class="nav-header text-uppercase text-muted fw-bold mt-3 mb-1 px-3" style="font-size: 0.7rem; letter-spacing: 0.05rem;">
                        Análisis & Datos
                    </li>

                    <li class="nav-item">
                        <a href="/reportes.html" class="nav-link text-secondary d-flex align-items-center gap-2 py-2 ${activeKey === 'reportes' ? 'active' : ''}">
                            <i class="bi bi-bar-chart-fill text-warning"></i>
                            <span>Reportes & Estadísticas</span>
                        </a>
                    </li>

                    ${isAdmin ? `
                        <li class="nav-header text-uppercase text-danger fw-bold mt-3 mb-1 px-3" style="font-size: 0.7rem; letter-spacing: 0.05rem;">
                            Administración
                        </li>

                        <li class="nav-item">
                            <a href="/areas.html" class="nav-link text-secondary d-flex align-items-center gap-2 py-2 ${activeKey === 'areas' ? 'active' : ''}">
                                <i class="bi bi-diagram-3-fill text-indigo"></i>
                                <span>Catálogo de Áreas</span>
                            </a>
                        </li>

                        <li class="nav-item">
                            <a href="/puestos.html" class="nav-link text-secondary d-flex align-items-center gap-2 py-2 ${activeKey === 'puestos' ? 'active' : ''}">
                                <i class="bi bi-briefcase-fill text-teal"></i>
                                <span>Puestos de Trabajo</span>
                            </a>
                        </li>

                        <li class="nav-item">
                            <a href="/usuarios.html" class="nav-link text-secondary d-flex align-items-center gap-2 py-2 ${activeKey === 'usuarios' ? 'active' : ''}">
                                <i class="bi bi-shield-lock-fill text-danger"></i>
                                <span>Usuarios y Permisos</span>
                            </a>
                        </li>
                    ` : ''}
                </ul>
            </div>

            <div class="sidebar-footer p-3 border-top">
                <button type="button" id="btnSidebarLogout" class="btn btn-outline-danger btn-sm w-100 d-flex align-items-center justify-content-center gap-2">
                    <i class="bi bi-box-arrow-right"></i>
                    <span>Cerrar Sesión</span>
                </button>
            </div>
        `;
    }

    // 2. Inyectar Navbar si existe el contenedor #appNavbar
    const navbarEl = document.getElementById('appNavbar');
    if (navbarEl) {
        navbarEl.className = 'navbar navbar-expand-lg navbar-light bg-white border-bottom px-3 sticky-top';
        navbarEl.innerHTML = `
            <div class="container-fluid p-0">
                <button class="btn btn-outline-secondary btn-sm me-2 d-lg-none" type="button" id="sidebarToggle">
                    <i class="bi bi-list fs-5"></i>
                </button>

                <!-- Logo para vista móvil -->
                <a href="${homeUrl}" class="d-flex d-lg-none align-items-center gap-2 text-decoration-none me-2">
                    <img src="/img/logo.png" alt="Logo" style="height: 30px; object-fit: contain;">
                    <span class="fw-bold text-dark fs-6">Registro de <span class="text-primary">Asistencia</span></span>
                </a>

                <div class="d-flex align-items-center gap-2">
                    <span class="badge bg-light text-dark border d-none d-sm-inline-flex align-items-center gap-1">
                        <i class="bi bi-calendar3 text-primary"></i>
                        <span id="currentDateDisplay" class="text-capitalize">${fechaActualStr}</span>
                    </span>
                </div>

                <div class="ms-auto d-flex align-items-center gap-2 gap-md-3">
                    <!-- Botón PWA para instalar la app en móvil o PC -->
                    <button class="btn btn-outline-primary btn-sm d-none align-items-center gap-1 shadow-sm" id="btnInstallPwa" type="button" title="Instalar como aplicación en este dispositivo">
                        <i class="bi bi-download"></i>
                        <span class="d-none d-sm-inline fw-semibold">Instalar App</span>
                    </button>

                    ${!isSoloVista ? `
                        <a href="/asistencias-registro.html" class="btn btn-primary btn-sm d-flex align-items-center gap-1 shadow-sm">
                            <i class="bi bi-plus-circle"></i>
                            <span class="d-none d-md-inline">Capturar Asistencia</span>
                        </a>
                    ` : ''}

                    <div class="dropdown">
                        <a href="#" class="d-flex align-items-center text-dark text-decoration-none dropdown-toggle" id="userMenuDropdown" data-bs-toggle="dropdown" aria-expanded="false">
                            <div class="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center me-2 shadow-sm" style="width: 32px; height: 32px; font-size: 0.85rem; font-weight: 600;">
                                ${userInitial}
                            </div>
                            <span class="d-none d-md-inline fw-semibold" style="font-size: 0.9rem;">
                                ${user.nombre}
                            </span>
                        </a>
                        <ul class="dropdown-menu dropdown-menu-end shadow border-0 mt-2" aria-labelledby="userMenuDropdown" style="min-width: 200px;">
                            <li class="px-3 py-2 border-bottom">
                                <div class="fw-bold text-dark">${user.nombre}</div>
                                <div class="small text-primary fw-semibold">${user.usuario ? '@' + user.usuario : ''}</div>
                                <small class="text-muted">${user.email || ''}</small>
                            </li>
                            <li>
                                <a class="dropdown-item py-2 d-flex align-items-center gap-2" href="/perfil.html">
                                    <i class="bi bi-person text-secondary"></i> Mi Perfil
                                </a>
                            </li>
                            <li><hr class="dropdown-divider my-1"></li>
                            <li>
                                <button type="button" id="btnNavbarLogout" class="dropdown-item py-2 d-flex align-items-center gap-2 text-danger">
                                    <i class="bi bi-box-arrow-right"></i> Cerrar Sesión
                                </button>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        `;
    }

    // 3. Inyectar Footer si existe el contenedor #appFooter
    const footerEl = document.getElementById('appFooter');
    if (footerEl) {
        footerEl.className = 'footer bg-white border-top py-3 px-4 text-center text-muted';
        footerEl.style.fontSize = '0.85rem';
        footerEl.innerHTML = `
            <div class="d-flex flex-column flex-sm-row justify-content-between align-items-center gap-2">
                <span>&copy; ${new Date().getFullYear()} <strong>Registro de Asistencia</strong> - Control por Áreas y Puestos.</span>
                <span>Todos los derechos reservados.</span>
            </div>
        `;
    }

    // 4. Inyectar Backdrop si no existe
    if (!document.getElementById('sidebarBackdrop')) {
        const backdrop = document.createElement('div');
        backdrop.className = 'sidebar-backdrop';
        backdrop.id = 'sidebarBackdrop';
        document.body.appendChild(backdrop);
    }

    // 5. Vincular eventos de cierre de sesión
    const handleLogout = () => {
        Swal.fire({
            title: '¿Cerrar sesión?',
            text: '¿Seguro que deseas salir del sistema de control?',
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#D83548',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'Sí, salir',
            cancelButtonText: 'Cancelar'
        }).then(res => {
            if (res.isConfirmed) {
                Auth.logout();
            }
        });
    };

    const btnSidebarLogout = document.getElementById('btnSidebarLogout');
    if (btnSidebarLogout) btnSidebarLogout.addEventListener('click', handleLogout);

    const btnNavbarLogout = document.getElementById('btnNavbarLogout');
    if (btnNavbarLogout) btnNavbarLogout.addEventListener('click', handleLogout);

    // 6. Configurar Sidebar en móviles
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
}
