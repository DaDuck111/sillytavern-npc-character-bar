# NPC Character Bar for SillyTavern

## v0.7.0 — RPG Rules, Lorebook Library & Readability

- **Responsive overlay fix**
  - NPC profile/archive dialogs now use a viewport-level overlay with a very high stacking layer so SillyTavern drawers do not cover them.
  - Half-width and narrow windows use a compact header and 2×2 profile tabs.
  - Horizontal overflow is suppressed in the System HUD and dialogs.

- **Thoughts as current RP reactions**
  - Present/nearby NPCs can receive one short current inner thought based on known personality, goals, mood, relationship and current events.
  - Thoughts are ephemeral UI flavor, not NPC memory and not Lorebook canon.
  - The floating thought panel remains draggable and toggleable.

- **Automatic continuity events**
  - Scene-advancing assistant replies produce 1–2 compact durable event summaries when material changes occur.
  - Event titles stay short and descriptions are one compact sentence.
  - The rolling scene summary and recent events are injected back into normal RP context for continuity.

- **Lorebook Library**
  - Raw Lorebook text is removed from the normal NPC UI.
  - Browse Lorebooks as readable cards, search them, filter Active/Inactive, filter by group and tags.
  - User-defined Lorebook groups/tags are stored by this extension.
  - Toggle SillyTavern global Lorebooks active/inactive directly from the NPC Lorebook tab.
  - Choose a Lorebook for the NPC or return to the current chat Lorebook.
  - **SYNC NPC** remains the one normal sync action: existing entry refreshes the NPC; missing entry creates it.

- **NPC Mana & scene views**
  - NPC portrait covers and the System NPC tab now support Mana alongside HP.
  - System NPC tab has **Scene Only** to hide absent NPCs.
  - NPCs can be assigned to archive groups directly from the System NPC tab.

- **Quest categories**
  - Quest UI is divided into **Main / Side / System / Story** categories with quick filters.

- **Two fund types**
  - **System Fund** is System-only currency, normally Gold.
  - **Real-world / setting fund** is ordinary story currency and is inferred only from the fictional setting/story evidence.
  - The two balances are tracked and edited separately.

- **Skills as gameplay rules**
  - Skills can store type, rank, explanation, resource cost, cooldown, remaining cooldown, requirements, passive attribute modifiers and gameplay effects.
  - Buffs/debuffs/status effects are tracked separately with durations and attribute modifiers.
  - Effective STR/DEX/INT/STA/SEN display includes passive/status modifiers.

- **Lightweight tabletop-style feasibility**
  - Optional **Respect RPG constraints in RP** setting injects a compact live state into normal SillyTavern generation.
  - The RP model is instructed to consider HP/Mana/Stamina, injuries, status effects, equipment, skill costs/cooldowns/requirements and attributes before resolving attempted actions.
  - Difficult or state-constrained actions may fail, partially succeed, be delayed or carry consequences instead of automatically succeeding.
  - This is a narrative constraint layer, not a full dice engine; it does not take control of the user's choices.

- **Readability**
  - RP date/time/weather and event text are larger.
  - The System panel uses narrow themed scrollbars and suppresses native scrollbar buttons.
  - The layout avoids the horizontal scrollbar seen in narrow System windows.

## v0.6.0 — NPC UX, Thoughts, Archive Scopes & RP World State

- **NPC profile layout**
  - Profile modal is now constrained to the current viewport and switches to a compact responsive layout on half-width/smaller browser windows.
  - Four simple tabs remain: **Overview / Current / Lorebook / System**.
  - NPC Memory UI was removed; the extension no longer creates NPC memories in its tracker or Lorebook output.
  - The System checkbox remains manually editable, but AI may also enable/disable NPC System status when the roleplay clearly establishes it.

- **NPC thoughts**
  - NPC covers show a 💭 marker when explicit internal thoughts are available.
  - A 💭 button on the character bar opens a floating thoughts window.
  - The thoughts window is draggable, remembers its position, and can be hidden/shown.
  - Thoughts remain conservative: only narration that explicitly reveals an NPC's thoughts is tracked.

- **NPC HP**
  - Portrait covers above the input now show HP bars.
  - Archive cards also show HP.
  - Existing right-side NPC vital bars remain.

- **Lorebook workflow**
  - Lorebook is now selected from a dropdown populated from SillyTavern Lorebooks.
  - Selecting a book automatically searches for a matching NPC entry and hydrates the profile when found.
  - Replaced confusing Pull/Push buttons with one **SYNC NPC** action:
    - existing entry → refresh profile from Lorebook;
    - no matching entry → create the NPC entry from the current profile.
  - Lorebook profile hydration is local/token-free.

- **Archive organizer**
  - Folder sidebar with drag-and-drop NPC assignment.
  - Drop onto **Ungrouped** to remove folder memberships, or click a folder chip × to remove a single membership.
  - Tags, tag filtering, search, and sorting by name / recently updated / relationship / scope.
  - NPC scope can be **Global / This Chat / This Group Chat**.
  - **AUTO-LINK** decides whether a matching archived NPC may be reused automatically when detected in another scope-allowed chat.
  - Folder rename/delete controls included.

- **RP world state**
  - Tracks story-only time, date/day, day/night period, weather, season, year and holiday/festival.
  - The Status tab shows the current RP world state and allows manual correction.
  - Quests may carry time/date/weather/season/holiday conditions.
  - Events may be pending on trigger conditions and later updated to occurred/cancelled.
  - Trigger matching is shown in the HUD; the extension does not invent an event merely because a trigger condition is met.

## v0.5.0 — Profile UX & movable System HUD

- **NPC profile redesign**
  - Replaced the crowded seven-tab workshop with four tabs: **Overview / Current / Memory & Lore / System**.
  - Added a clear **Back** button to return to the Global Character Archive.
  - Header and four-tab navigation stay fixed; only the profile body scrolls.
  - Tab switching now re-renders the selected pane instead of relying on fragile in-place tab state.

- **Automatic, token-conscious profile hydration**
  - Structured Lorebook content is parsed locally and applied to NPC profiles with **zero model tokens**.
  - Opening a Lorebook-linked NPC pulls its entry once per session and refreshes structured profile fields.
  - **Pull Lore → Profile** forces a manual refresh at any time.
  - AI-created NPCs and existing NPCs with missing fields use compact profile patches inside the existing tracker generation — no second generation call.
  - Tracker context sends only missing profile field names plus a short Lore hint when needed and uses compact JSON to reduce token overhead.

- **System HUD layout**
  - Removed the **HOME** tab from the right-side HUD. Home/base data remains available to the tracker and inventory storage logic.
  - HUD tabs are draggable to reorder; the order is stored in extension settings.
  - The entire System HUD can be dragged by its header.
  - The HUD is resizable from its lower-right edge.
  - Position and size persist across chats/reloads through SillyTavern extension settings.

## v0.4.0 — Quests, Events, System Rules & RPG Inventory

- **Event Tracker**
  - EVENTS tab lives inside the right-side System HUD.
  - Recent important events also appear on STATUS.
  - AI can record combat outcomes, discoveries, social turning points, travel, acquisitions, System events and quest developments.
  - Keeps up to 100 events per chat and suppresses recent duplicates.

- **Inventory compartments + limits**
  - Minor tabs: **On Person / Clothing / Stored**.
  - On Person and Clothing each have configurable slot limits.
  - Stored items belong to named storage locations with separate capacities.
  - Story-established storage can be generated by AI: apartment storage, guild locker, car trunk, vault, etc.
  - System-only storage is blocked until the player actually has a System.
  - Capacity is tracked in item stacks; over-capacity is visibly flagged instead of silently deleting story items.

- **System gating**
  - No System = **Lv. 0**, **XP locked**, **STR/DEX/INT/STA/SEN locked**.
  - AI may unlock System state only when the roleplay explicitly establishes it.
  - When System activates, core attributes initialize to 10 unless the story provides values.
  - Level gains grant configurable allocatable stat points (default 5 per level).
  - Spend points manually with + buttons beside STR / DEX / INT / STA / SEN.
  - XP and detailed attributes cannot update while System is absent.

- **NPC vitals and System stats**
  - All recurring NPCs can track HP, Fatigue, Relationship (-100..100), condition, location, mood and action.
  - NPC tab shows quick HP/Fatigue/Relationship bars.
  - NPCs explicitly possessing a System gain detailed Level / XP / STR / DEX / INT / STA / SEN and editable custom System stats.
  - Non-System NPCs remain lightweight and cannot receive detailed RPG attributes.

- **Quest Tracker**
  - QUESTS tab in the right-side HUD.
  - Supports Story / Main / Side / System quests.
  - AI can create quests from clear missions, assignments, promises, investigations, survival goals or explicit System quests.
  - Objectives are individually checkable and AI-updatable.
  - Tracks active/completed/failed/hidden state, reward and source/issuer.
  - System quests are rejected while the player has no System.

## v0.3.0 — System HUD

This release expands the extension from an NPC tracker into a lightweight RPG HUD.

- **Global Character Archive**
  - NPCs persist across chats in an account-wide archive.
  - Create custom NPC groups.
  - Filter by group or linked chat.
  - Link an archived NPC into the current chat, or unlink them without deleting the global archive entry.
  - Existing per-chat NPCs are migrated into the global archive when a chat loads.

- **Tall portrait covers**
  - The character shelf above the input now uses tall portrait-cover cards instead of horizontal rows.
  - Present/nearby status remains visible and away cards can be optionally shown.

- **Player RPG state**
  - Level, XP and XP-to-next.
  - Money + custom currency.
  - Current location and persistent home/base.
  - Custom stats with per-stat AI tracking toggle.
  - Inventory with quantity and equipped state.
  - Skills, ranks and titles.
  - Current condition.

- **Automatic RP tracking**
  - Separate-generation tracker can update player stats, money, inventory, skills, titles, level/XP, location and NPC state.
  - The prompt is conservative: rewards/items/stat changes are only applied when the roleplay clearly establishes them.
  - Tracker categories can be enabled/disabled independently in the SYSTEM tab.

- **System UI**
  - The right dashboard now uses a dark glass / cyan-neon RPG-System aesthetic.
  - Tabs: STATUS / ITEMS / SKILLS / HOME / NPC / SYSTEM.

A persistent NPC roster + portrait bar for long-form roleplay.

## What this build does

### v0.2.0 (previous)
- RPG-style fixed dashboard on the right side of SillyTavern.
- Characters / Scene / Tracker tabs.
- Automatic post-response RP scanning using SillyTavern's own `getContext().generateRaw()`.
- New named characters can be registered automatically into the persistent per-chat roster.
- Present/away state, role, faction, relationship, location, mood, action, condition, aliases and durable memories can update from roleplay.
- Current scene location/time/summary are extracted and shown in the dashboard.
- Manual **Scan latest RP** button for re-reading the newest assistant reply.
- Tracker settings inside the dashboard: auto-read toggle, auto-register toggle, context depth, away-card visibility and compact mode.
- The latest existing RP is scanned once after extension startup.

> **Important:** Auto-read uses one additional model/API generation after each assistant RP response. Disable **Auto-read roleplay** in the Tracker tab if you do not want the extra request/token usage.

### Existing character system

- Horizontal character bar directly above the chat input.
- Persistent per-chat NPC registry stored in SillyTavern `chatMetadata`.
- Present / Nearby / Away / Unknown / Missing / Dead / Inactive states.
- Portrait URL or uploaded/compressed portrait.
- Character Workshop with Identity, Profile, Scene, Relations, Memory, and Lorebook tabs.
- Aliases prevent one NPC from becoming multiple records when a tracker integration uses different names.
- Character Archive with search, JSON import/export, and compact mode.
- Right-click a character card to change roster status quickly.
- Collapse/expand the bar like a portrait shelf.
- Tracker bridge accepts both the custom payload and RPG Companion-style present-character arrays.
- Lorebook Push/Pull using SillyTavern's own World Info slash commands.
- Tracker bridge API for a later RPG Companion / separate-generation integration.

## Install locally

1. Put this folder under SillyTavern's third-party extensions directory, or push it to a Git repository.
2. In SillyTavern: Extensions → Install Extension → enter the Git URL.
3. Reload SillyTavern.

## Tracker integration

The extension exposes `window.NPCCharacterBar.applyTrackerPayload(payload)` and also listens for a browser event named `npcb:tracker-update`.

Example payload:

```js
window.dispatchEvent(new CustomEvent('npcb:tracker-update', {
  detail: {
    presentCharacters: ['Old Zhang', 'Chen Wei'],
    replacePresent: true,
    characterUpdates: [
      { name: 'Old Zhang', mood: 'uneasy', action: 'watching the door' }
    ],
    newCharacters: [
      {
        name: 'Chen Wei',
        aliases: ['陈伟', 'Senior Brother Chen'],
        role: 'Azure Cloud Sect disciple',
        faction: 'Azure Cloud Sect'
      }
    ]
  }
}));
```

This is intentionally separated from the UI so a future separate-generation tracker can feed structured JSON into the roster without rewriting the character system.

## Lorebook behavior

The Lorebook tab supports:

- blank Lorebook name → use/create the current chat-bound Lorebook;
- first Push → creates an entry and stores its UID;
- later Push → updates key/title/content;
- Pull → loads the entry content back into the Workshop;
- scene-state fields are excluded from generated lore by default.

## Design notes

This implementation is original code inspired by the interaction patterns of RPG Companion and Doom's Enhancement Suite. It does not require either extension to be installed.

## License

AGPL-3.0-or-later. If you merge code from AGPL projects such as the referenced extensions, retain their notices and attribution as required by their licenses.
