import { addCharacter, getState, mutateState, updateCharacter } from './src/store.js';
import { pushLore, pullLore } from './src/lore.js';
import { applyTrackerPayload, installTrackerBridge } from './src/tracker.js';
import { mountUI, openArchive, openWorkshop, renderBar } from './src/ui.js';
import { getContext } from './src/utils.js';

const TAG = '[NPC Character Bar]';
let initialized = false;
let listenersInstalled = false;

function installEvents() {
    if (listenersInstalled) return;
    listenersInstalled = true;

    const ctx = getContext();
    const events = ctx.eventTypes || ctx.event_types || {};
    const refresh = () => {
        setTimeout(() => {
            mountUI();
            renderBar();
        }, 50);
    };

    if (events.CHAT_CHANGED) ctx.eventSource.on(events.CHAT_CHANGED, refresh);
    if (events.APP_READY) ctx.eventSource.on(events.APP_READY, refresh);
    if (events.MESSAGE_RECEIVED) ctx.eventSource.on(events.MESSAGE_RECEIVED, () => renderBar());
    window.addEventListener('npcb:state-changed', () => renderBar());
}

async function boot() {
    if (initialized) return;
    if (!window.SillyTavern?.getContext) return;
    initialized = true;
    installTrackerBridge();
    installEvents();
    mountUI();

    window.NPCCharacterBar = {
        version: '0.1.1',
        getState,
        addCharacter: async seed => { const c = await addCharacter(seed); renderBar(); return c; },
        updateCharacter: async (id, patch) => { const c = await updateCharacter(id, patch); renderBar(); return c; },
        setOptions: async patch => { const s = await mutateState(state => Object.assign(state.ui, patch)); renderBar(); return s.ui; },
        applyTrackerPayload,
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
        render: renderBar,
    };

    console.info(`${TAG} v0.1.1 ready`);
}

const timer = setInterval(() => {
    if (window.SillyTavern?.getContext) {
        clearInterval(timer);
        boot().catch(error => console.error(TAG, error));
    }
}, 250);
setTimeout(() => clearInterval(timer), 30000);

if (window.SillyTavern?.getContext) boot().catch(error => console.error(TAG, error));
