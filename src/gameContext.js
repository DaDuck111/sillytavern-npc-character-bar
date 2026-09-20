import { getState } from './store.js';
import { getContext } from './utils.js';

const PROMPT_KEY = 'npc_character_bar_rpg_state';

function compactStat(stat) {
    if (!stat?.name) return '';
    const max = Number(stat.max);
    const value = Number(stat.value);
    if (Number.isFinite(value) && Number.isFinite(max) && max > 0) return `${stat.name} ${value}/${max}`;
    if (Number.isFinite(value)) return `${stat.name} ${value}`;
    return '';
}

function compactSkill(skill) {
    const parts = [skill.name];
    if (skill.rank) parts.push(`[${skill.rank}]`);
    if (skill.remainingCooldown) parts.push(`CD:${skill.remainingCooldown}`);
    else if (skill.cooldown) parts.push(`CD:${skill.cooldown}`);
    if (skill.cost?.resource && Number(skill.cost.amount) > 0) parts.push(`Cost:${skill.cost.amount} ${skill.cost.resource}`);
    if (skill.requirements?.text) parts.push(`Req:${skill.requirements.text}`);
    const attrs = Object.entries(skill.requirements?.attributes || {})
        .filter(([, value]) => Number(value) > 0)
        .map(([key, value]) => `${key}≥${value}`);
    if (attrs.length) parts.push(`Req:${attrs.join(',')}`);
    if (skill.effects?.length) parts.push(`Effect:${skill.effects.slice(0, 2).join('; ')}`);
    return parts.join(' ');
}

function buildPrompt(state) {
    const p = state.player || {};
    const lines = [
        '[NPC Character Bar — current RPG state]',
        'Treat this as live gameplay constraints and continuity, not as dialogue to repeat.',
    ];

    const world = [
        state.scene?.location && `Location=${state.scene.location}`,
        state.scene?.date && `Date=${state.scene.date}`,
        state.scene?.time && `Time=${state.scene.time}`,
        state.scene?.dayPart && `DayPart=${state.scene.dayPart}`,
        state.scene?.weather && `Weather=${state.scene.weather}`,
        state.scene?.season && `Season=${state.scene.season}`,
        state.scene?.holiday && `Holiday=${state.scene.holiday}`,
    ].filter(Boolean);
    if (world.length) lines.push(`World: ${world.join(' | ')}`);

    const playerBits = [];
    if (p.hasSystem) {
        playerBits.push(`Lv${p.level || 1}`);
        const attrs = Object.entries(p.attributes || {}).map(([key, value]) => `${key}=${value}`).join(' ');
        if (attrs) playerBits.push(attrs);
    } else {
        playerBits.push('No System; Lv0/XP locked');
    }
    if (p.condition) playerBits.push(`Condition=${p.condition}`);
    const stats = (p.stats || []).map(compactStat).filter(Boolean);
    if (stats.length) playerBits.push(stats.join(', '));
    lines.push(`Player: ${playerBits.join(' | ')}`);

    const effects = (p.effects || []).slice(0, 6).map(effect => {
        const bits = [effect.name];
        if (effect.duration) bits.push(`duration ${effect.duration}`);
        if (effect.description) bits.push(effect.description);
        return bits.join(': ');
    });
    if (effects.length) lines.push(`Active effects: ${effects.join(' || ')}`);

    const skills = (p.skills || []).slice(0, 12).map(compactSkill).filter(Boolean);
    if (skills.length) lines.push(`Relevant skills: ${skills.join(' || ')}`);

    const present = state.order
        .map(id => state.characters[id])
        .filter(Boolean)
        .filter(npc => ['present', 'nearby'].includes(npc.status))
        .slice(0, 10)
        .map(npc => {
            const vitals = [
                `HP ${npc.vitals?.hp ?? '?'}/${npc.vitals?.maxHp ?? '?'}`,
                Number(npc.vitals?.maxMana) > 0 ? `Mana ${npc.vitals.mana ?? 0}/${npc.vitals.maxMana}` : '',
                `Fatigue ${npc.vitals?.fatigue ?? 0}/${npc.vitals?.maxFatigue ?? 100}`,
            ].filter(Boolean);
            if (npc.scene?.condition) vitals.push(`Condition ${npc.scene.condition}`);
            return `${npc.name}: ${vitals.join(', ')}`;
        });
    if (present.length) lines.push(`Present NPCs: ${present.join(' || ')}`);

    const recentEvents = (state.events || [])
        .filter(event => event.status !== 'cancelled')
        .slice(-6)
        .map(event => `${event.title}: ${event.description}`.trim())
        .filter(Boolean);
    if (recentEvents.length) lines.push(`Recent continuity: ${recentEvents.join(' || ')}`);

    lines.push(
        'Gameplay rule: an attempted action is not automatically successful. Respect injuries, fatigue, Mana/Stamina/Health, active effects, skill cooldowns/costs/requirements, equipment, and established abilities.',
        'When an outcome is uncertain, resolve it proportionally to the tracked state and narrative difficulty, like a lightweight tabletop ability check. Strong stats/skills help; poor state, missing requirements, depleted resources, or cooldowns can cause failure, partial success, delay, or consequences.',
        'Do not invent hidden numeric requirements or change tracked values silently. Any resource loss, injury, cooldown, buff/debuff, acquisition, or major consequence should be made clear in the narration so the tracker can record it.',
        'Do not take control of the user character’s choices; only resolve consequences of actions the user attempts.',
    );

    return lines.join('\n');
}

export function refreshGameContext() {
    const ctx = getContext();
    if (typeof ctx.setExtensionPrompt !== 'function') return;

    const state = getState();
    if (state.tracker?.injectGameState === false) {
        ctx.setExtensionPrompt(PROMPT_KEY, '', -1, 0, false, 0);
        return;
    }

    // IN_CHAT = 1, depth 0, SYSTEM role = 0.
    ctx.setExtensionPrompt(PROMPT_KEY, buildPrompt(state), 1, 0, false, 0);
}

export function clearGameContext() {
    const ctx = getContext();
    if (typeof ctx.setExtensionPrompt === 'function') {
        ctx.setExtensionPrompt(PROMPT_KEY, '', -1, 0, false, 0);
    }
}
