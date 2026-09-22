const MENU_DEFS = Object.freeze([
    {
        key: 'generation',
        drawerId: 'ai-config-button',
        panelId: 'left-nav-panel',
        label: 'Generation',
        kicker: 'AI',
        subtitle: 'Response, context & sampling',
    },
    {
        key: 'connections',
        drawerId: 'sys-settings-button',
        panelId: 'rm_api_block',
        label: 'Connections',
        kicker: 'API',
        subtitle: 'Models, endpoints & credentials',
    },
    {
        key: 'formatting',
        drawerId: 'advanced-formatting-button',
        panelId: 'AdvancedFormatting',
        label: 'Formatting',
        kicker: 'TEXT',
        subtitle: 'Prompt & response presentation',
    },
    {
        key: 'lorebook',
        drawerId: 'WI-SP-button',
        panelId: 'WorldInfo',
        label: 'Lorebook',
        kicker: 'WORLD',
        subtitle: 'World Info',
        skipPanel: true,
    },
    {
        key: 'settings',
        drawerId: 'user-settings-button',
        panelId: 'user-settings-block',
        label: 'Settings',
        kicker: 'APP',
        subtitle: 'Interface & behavior',
    },
    {
        key: 'backgrounds',
        drawerId: 'backgrounds-button',
        panelId: 'Backgrounds',
        label: 'Backgrounds',
        kicker: 'SCENE',
        subtitle: 'Backdrop library',
    },
    {
        key: 'extensions',
        drawerId: 'extensions-settings-button',
        panelId: 'rm_extensions_block',
        label: 'Extensions',
        kicker: 'TOOLS',
        subtitle: 'Add-ons & integrations',
    },
    {
        key: 'personas',
        drawerId: 'persona-management-button',
        panelId: 'PersonaManagement',
        label: 'Personas',
        kicker: 'YOU',
        subtitle: 'Identity & profile library',
    },
    {
        key: 'characters',
        drawerId: 'rightNavHolder',
        panelId: 'right-nav-panel',
        label: 'Characters',
        kicker: 'CAST',
        subtitle: 'Characters, chats & favorites',
    },
]);

let mounted = false;
let refreshQueued = false;
let observer = null;

function isPanelOpen(panel) {
    return Boolean(panel?.classList.contains('openDrawer') || panel?.classList.contains('open'));
}

function ensureMenuLabel(drawer, def) {
    const toggle = drawer?.querySelector(':scope > .drawer-toggle');
    if (!toggle) return;

    toggle.classList.add('npcb-native-menu-toggle');
    toggle.dataset.npcbMenu = def.key;
    toggle.setAttribute('aria-label', def.label);

    let label = toggle.querySelector(':scope > .npcb-native-menu-label');
    if (!label) {
        label = document.createElement('span');
        label.className = 'npcb-native-menu-label';
        label.innerHTML = `<small>${def.kicker}</small><strong>${def.label}</strong>`;
        toggle.appendChild(label);
    }

    const icon = toggle.querySelector('.drawer-icon');
    if (icon) icon.classList.add('npcb-native-menu-icon');
}

function ensurePanelHeader(drawer, panel, def) {
    if (!panel || def.skipPanel) return;

    panel.classList.add('npcb-native-panel', `npcb-native-panel--${def.key}`);
    panel.dataset.npcbNativePanel = def.key;

    let header = panel.querySelector(':scope > .npcb-native-panel-header');
    if (!header) {
        header = document.createElement('div');
        header.className = 'npcb-native-panel-header';
        header.innerHTML = `
            <div class="npcb-native-panel-heading">
                <small>${def.kicker}</small>
                <div>
                    <strong>${def.label}</strong>
                    <span>${def.subtitle}</span>
                </div>
            </div>
            <button type="button" class="npcb-native-panel-close" aria-label="Close ${def.label}" title="Close">×</button>
        `;

        const firstNonGrip = [...panel.children].find(child => !child.classList?.contains('drag-grabber'));
        if (firstNonGrip) panel.insertBefore(header, firstNonGrip);
        else panel.prepend(header);

        header.querySelector('.npcb-native-panel-close')?.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            drawer.querySelector(':scope > .drawer-toggle')?.click();
        });
    }

    panel.querySelectorAll(':scope h3, :scope .standoutHeader, :scope .title_restorable').forEach(el => {
        el.classList.add('npcb-native-section-heading');
    });
}

function decorateOne(def) {
    const drawer = document.getElementById(def.drawerId);
    const panel = document.getElementById(def.panelId);
    if (!drawer) return;

    drawer.classList.add('npcb-native-menu-tab', `npcb-native-menu-tab--${def.key}`);
    if (def.skipPanel) drawer.classList.add('npcb-native-menu-tab--lorebook-preserved');

    ensureMenuLabel(drawer, def);
    ensurePanelHeader(drawer, panel, def);
    drawer.classList.toggle('npcb-native-open', isPanelOpen(panel));
}

export function refreshNativeMenus() {
    const holder = document.getElementById('top-settings-holder');
    if (!holder) return false;

    document.body?.classList.add('npcb-native-menu-expanded');
    holder.classList.add('npcb-native-menu-rail');
    MENU_DEFS.forEach(decorateOne);
    return true;
}

function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
        refreshQueued = false;
        refreshNativeMenus();
    });
}

export function mountNativeMenus() {
    refreshNativeMenus();
    if (mounted) return;
    mounted = true;

    const holder = document.getElementById('top-settings-holder');
    if (holder && typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(scheduleRefresh);
        observer.observe(holder, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class'],
        });
    }

    window.addEventListener('resize', scheduleRefresh, { passive: true });

    setTimeout(refreshNativeMenus, 350);
    setTimeout(refreshNativeMenus, 1200);
}
