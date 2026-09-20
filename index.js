import { addCharacter, getState, mutateState, updateCharacter } from './src/store.js';
import { pushLore, pullLore } from './src/lore.js';
import { applyTrackerPayload, installTrackerBridge } from './src/tracker.js';
import { mountUI, openArchive, openWorkshop, renderBar } from './src/ui.js';
import { mountDashboard, renderDashboard } from './src/dashboard.js';
import { resetAutoTrackerSession, scanLatestRoleplay, scheduleAutoTrack } from './src/autoTracker.js';
import { getContext } from './src/utils.js';
import { refreshGameContext } from './src/gameContext.js';

const TAG = '[NPC Character Bar]';
let initialized = false;
let listenersInstalled = false;

function refreshAll() {
    setTimeout(() => {
        mountUI();
        mountDashboard();
        renderBar();
        renderDashboard();
        refreshGameContext();
    }, 50);
}

function installEvents() {
    if (listenersInstalled) return;
    listenersInstalled = true;

    const ctx = getContext();
    const events = ctx.eventTypes || ctx.event_types || {};

    if (events.CHAT_CHANGED) {
        ctx.eventSource.on(events.CHAT_CHANGED, async () => {
            resetAutoTrackerSession();
            try { await mutateState(() => {}); } catch (error) { console.warn(TAG, 'Archive sync skipped:', error); }
            refreshAll();
        });
    }
    if (events.APP_READY) ctx.eventSource.on(events.APP_READY, refreshAll);

    if (events.MESSAGE_RECEIVED) {
        ctx.eventSource.on(events.MESSAGE_RECEIVED, () => {
            renderBar();
            renderDashboard();
            scheduleAutoTrack(500);
        });
    }

    if (events.MESSAGE_SWIPED) {
        ctx.eventSource.on(events.MESSAGE_SWIPED, () => {
            scheduleAutoTrack(550);
        });
    }

    if (events.MESSAGE_UPDATED) {
        ctx.eventSource.on(events.MESSAGE_UPDATED, () => {
            scheduleAutoTrack(650);
        });
    }

    window.addEventListener('npcb:state-changed', () => {
        renderBar();
        renderDashboard();
        refreshGameContext();
    });
}

async function boot() {
    if (initialized) return;
    if (!window.SillyTavern?.getContext) return;
    initialized = true;

    installTrackerBridge();
    installEvents();
    try { await mutateState(() => {}); } catch (error) { console.warn(TAG, 'Initial archive sync skipped:', error); }
    mountUI();
    mountDashboard();
    refreshGameContext();

    window.NPCCharacterBar = {
        version: '0.7.0',
        getState,
        addCharacter: async seed => { const c = await addCharacter(seed); renderBar(); renderDashboard(); return c; },
        updateCharacter: async (id, patch) => { const c = await updateCharacter(id, patch); renderBar(); renderDashboard(); return c; },
        setOptions: async patch => { const s = await mutateState(state => Object.assign(state.ui, patch)); renderBar(); renderDashboard(); return s.ui; },
        applyTrackerPayload,
        scanLatestRoleplay: options => scanLatestRoleplay({ force: true, manual: true, ...(options || {}) }),
        openCharacter: openWorkshop,
        openArchive,
        pushLore: async id => {
            const character = getState().characters[id];
            if (!character) throw new Error('Character not found.');
            return pushLore(character);
        },
        pullLore: async id => {
            const character = getState().characters[id];
            if (!character) throw new Error('Character not found.');
            return pullLore(character);
        },
        render: () => { renderBar(); renderDashboard(); },
    };

    renderBar();
    renderDashboard();
    scheduleAutoTrack(1200);
    console.info(`${TAG} v0.7.0 ready — RPG constraints, Lorebook library, split funds, rich skills, NPC Mana and continuity tracking enabled.`);
}

const timer = setInterval(() => {
    if (window.SillyTavern?.getContext) {
        clearInterval(timer);
        boot().catch(error => console.error(TAG, error));
    }
}, 250);
setTimeout(() => clearInterval(timer), 30000);

if (window.SillyTavern?.getContext) boot().catch(error => console.error(TAG, error));
