# NPC Character Bar for SillyTavern

## v0.10.0 — Lorebook Folders, Theme Colors & Simpler Quests

- **Lorebook folders replace the old group button workflow**
  - Create persistent folders from the Lorebook organizer sidebar.
  - Drag one Lorebook into a folder, or select several books and drag the whole selection.
  - Select one or more Lorebooks, right-click a selected card, then choose **Move to** any folder or **Ungrouped**.
  - Folder **…** options support rename/delete; deleting a folder keeps its Lorebooks and moves them to Ungrouped.
  - Folder metadata is shared with **NPC Profile → Lorebook**, so NPC filtering sees the same folder structure.
  - The old per-book **GROUP / TAG / ORGANIZE** movement button was removed from the NPC Lorebook view.

- **Customizable UI colors**
  - Open the right-side **SYSTEM** tab → **UI THEME**.
  - Choose a custom **Accent color** and **Panel background**.
  - Accent presets are included for cyan, purple, green, amber, pink/red and neutral white.
  - Theme settings are global extension preferences, so they follow you across chats.
  - The accent/background apply to the System HUD, character bar/archive, NPC Thoughts, dialogs and Lorebook organizer/native Lorebook theming.
  - **RESET** restores the original cyan-on-dark theme.

- **Quest categories simplified**
  - Quest Log now uses only **Main / Side / System**.
  - The **Story** quest tab/category is removed.
  - Existing Story quests automatically migrate to **Side**.
  - AI-generated durable non-main objectives are classified as Side; true System-issued quests remain System-only.

## v0.9.0 — Archive Bulk Tools, Chat Ownership & Large Lorebook UI

- **Character Archive checkbox selection**
  - Every archived NPC now has a visible tick box.
  - **Select all shown** works with the current search/filter result.
  - Bulk actions include **Add Tags**, **Replace Tags**, **Merge Selected**, and **Delete Selected**.
  - Individual archived NPCs also have an explicit **Delete** button.
  - Deleted archive records are tombstoned so per-chat copies do not silently recreate them on the next save.

- **Duplicate-safe archive identity**
  - Archive chat links now remember the owning SillyTavern character/group, not only the chat filename.
  - The same NPC appearing in a new chat under the same SillyTavern character/group reuses the existing archive identity automatically.
  - Legacy single-match archive records are reused when no conflicting source identity exists.
  - Existing duplicate records can be cleaned with **Merge Selected**; chat links, folders, aliases and tags are combined and old archive IDs redirect to the canonical record.

- **Character → chats browser**
  - Clicking an archive card opens a detail pane instead of immediately throwing the user into an editor.
  - The detail pane shows the NPC's portrait, role/faction, folders/tags, relationship summary and every recorded chat where they appeared.
  - Chat rows show the owning SillyTavern character/group and chat name.
  - **Open Chat** jumps directly to that individual or group chat when source ownership is known.
  - Older links without source metadata explain that opening the old chat once will teach the archive its owner.

- **Lorebook bulk selection**
  - Lorebook cards now have tick boxes plus **Select all shown**.
  - Bulk actions support **Add Tags**, **Replace Tags**, **Set Group**, and **Delete**.
  - Bulk delete removes the actual SillyTavern Lorebook files after confirmation and cleans extension grouping/tag metadata.

- **Large Lorebook typography**
  - Native SillyTavern Lorebook entry titles are approximately 20px and entry controls/content are approximately 15–17px.
  - Organizer book names are approximately 20px, filters are 16px, tags/status text are about 14px, and controls are larger.
  - Organizer cards are now full-width rows instead of cramped two-column cards.

## v0.8.0 — Native Lorebooks, Character Detail Tracking & RPG Resources

- **Native SillyTavern Lorebook overhaul**
  - The extension now themes the built-in **Worlds/Lorebooks** drawer to match the cyan System UI.
  - A shared **Lorebook Organizer** appears inside the native drawer with search, Active/Inactive filters, groups/folders and user tags.
  - Lorebook groups/tags use the same extension metadata as **NPC Profile → Lorebook**, so changes appear in both places.
  - Books can be opened in the native SillyTavern editor or activated/deactivated directly from the organizer.
  - Native World Info entry cards remain fully editable with SillyTavern's normal controls.

- **Tracker vs. in-story System**
  - Before the player's story actually grants a System, the panel is labeled **RPG TRACKER** and its process badge says **TRACKER ONLINE/IDLE**.
  - Only an explicitly acquired personal System changes the header to **THE SYSTEM / SYSTEM ACQUIRED**.
  - AI System detection is stricter and ignores generic mentions of systems, ranks, magic, quests, other characters' interfaces or the extension UI itself.

- **NPC appearance and live state**
  - AI now keeps persistent NPC age, appearance, identity, role and faction updated when new facts are explicitly revealed.
  - Clothing is tracked as live scene state and is replaced when outfits/armor/accessories change.
  - Temporary wounds, dirt and disguises stay separate from permanent appearance unless they become lasting traits.

- **Magic and Mana**
  - Characters may have Mana even without a System.
  - Canonical MP/Mana numbers are used when available.
  - If magic is clearly established without a numeric scale, NPCs use a relative **100% Mana reserve** and the tracker estimates conservative use/recovery from the narration.
  - Explicit skill costs override estimates. Mana may recover from rest, regeneration, items, skills or established time passage.

- **Numeric vitals and resistances**
  - Vital/custom stat values and maxima are normalized as numbers; values such as `85%` are parsed numerically while the unit is stored separately.
  - Added percentage **Resistances / Vulnerabilities** from -100% to +100%, AI-trackable and manually editable.
  - Resistance state is included in RP feasibility/context.

- **Equippable Titles**
  - Titles are structured RPG objects with description, effects and attribute modifiers.
  - One title can be equipped at a time; it can also be unequipped.
  - Equipped title effects modify displayed effective STR/DEX/INT/STA/SEN and are included in the RP constraint context.

- **NPC factions**
  - The System NPC tab can filter by faction and visually groups NPCs under faction headings.
  - Archive folders and faction organization work alongside one another.

- **Quests**
  - Durable story goals can be generated and updated automatically from RP.
  - The tracker classifies plot-driving goals as Main, optional/parallel goals as Side, actual System-issued objectives as System, and other durable goals as Story.
  - Existing matching quests are updated instead of duplicated.

- **RP time**
  - TIME is always represented in the World State UI.
  - Exact story clocks are preserved and relative time passage can advance them.
  - If only a daypart is known, a visibly approximate clock is used (for example Night → `~22:00`) instead of leaving Time blank.

- **NPC Thoughts**
  - The thoughts window is now resizable.
  - Its width, height and position are remembered.
  - **A− / A＋** controls adjust thought text size from the panel itself.

- **Readability**
  - Event Tracker titles/descriptions and RP world-state text are substantially larger.
  - Native Lorebook entries, controls and organizer cards have larger, cleaner typography.

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
