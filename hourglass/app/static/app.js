/* =========================================================================
   THE HOURGLASS — frontend logic
   -------------------------------------------------------------------------
   What this file does, in plain language:
     • Draws the 7-day x 31-row grid.
     • Draws each block at the right place and color.
     • Lets you drag blocks (interact.js handles the pointer; OUR code decides
       where a block lands and pushes others out of the way — "cascade-push").
     • Lets you resize, rename, recategorize, and delete blocks.
     • Manages categories, the week library, and Argo JSON import.
     • Saves every change to the server immediately (autosave).
   ========================================================================= */

"use strict";

// ----- grid geometry (kept in sync with style.css --row-h) -----------------
const ROW_H = 28;                    // pixel height of one 30-minute row
const ROW_COUNT = 31;                // rows 0..30  (6:00am .. 9:00pm)
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Friendly labels for the curated palette keys.
const PALETTE = {
  blue:   "Blue",   cyan:  "Cyan",  teal:  "Teal",   coral: "Coral",
  purple: "Purple", pink:  "Pink",  green: "Green",  amber: "Amber",  gray: "Gray",
};

// In-memory copy of everything on screen. The server is the source of truth;
// this is the working copy we mutate, render, then save.
let state = {
  weekId: null,
  weekName: "",
  categories: [],     // [{id, name, color_key, display_order}]
  blocks: [],         // [{id, category_id, name, day, start_row, duration_slots}]
};

// ===========================================================================
//  Small helpers
// ===========================================================================

const $ = (sel) => document.querySelector(sel);

async function api(url, method = "GET", body = null) {
  // The Hourglass now runs fully in the browser: instead of fetch()-ing a
  // server, every request is answered by the in-browser store in db.js.
  // db.js returns the SAME JSON shapes and status codes the old Flask server
  // did, so nothing else in this file had to change.
  const { status, data } = HourglassDB.request(method, url, body !== null ? body : {});
  if (status >= 400) {
    const e = new Error((data && data.error) || "Request failed");
    e.payload = data;
    e.status = status;
    throw e;
  }
  return data;
}

function categoryById(id) {
  return state.categories.find((c) => c.id === id);
}

function rowToTime(row) {
  // row 0 -> 6:00am
  const totalMin = 6 * 60 + row * 30;
  let h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const ampm = h >= 12 ? "pm" : "am";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${m === 0 ? "00" : "30"}${ampm}`;
}

let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1200);
}

// ===========================================================================
//  CASCADE-PUSH  — the core collision resolver
//  ---------------------------------------------------------------------------
//  Given all blocks in ONE day and the id of the block that was just
//  placed/moved/resized (the "active" one), push any colliding blocks LATER
//  (downward) in time. Pushing one block may push the next — the push chains
//  down the day. Blocks cannot go past the 9:00pm floor: if a cascade would
//  push something off the bottom, it clamps to the last valid row and piles
//  up against the floor (nothing is ever deleted).
//
//  Returns the list of blocks whose start_row changed (so we can save them).
// ===========================================================================
function resolveCascade(dayBlocks, activeId) {
  const active = dayBlocks.find((b) => b.id === activeId);
  if (!active) return [];

  // The active block stays put. Everything else is processed top-to-bottom.
  const obstacles = [
    { start: active.start_row, end: active.start_row + active.duration_slots },
  ];
  const others = dayBlocks
    .filter((b) => b.id !== activeId)
    .sort((a, b) => a.start_row - b.start_row || a.id - b.id);

  const changed = [];

  for (const blk of others) {
    let start = blk.start_row;
    const dur = blk.duration_slots;

    // Keep pushing down past any obstacle this block overlaps, until it fits
    // in a gap (or we run out of obstacles). Re-scan after each push because
    // moving down may land it on a different obstacle.
    let moved = true;
    while (moved) {
      moved = false;
      for (const o of obstacles) {
        const overlaps = start < o.end && start + dur > o.start;
        if (overlaps && o.end > start) {
          start = o.end;
          moved = true;
        }
      }
    }

    // Floor: never extend past 9:00pm. Clamp and pile against the bottom.
    if (start + dur > ROW_COUNT) {
      start = Math.max(0, ROW_COUNT - dur);
    }

    if (start !== blk.start_row) {
      blk.start_row = start;
      changed.push(blk);
    }
    obstacles.push({ start: start, end: start + dur });
  }

  return changed;
}

// Run cascade for the active block's day, persist anything that moved.
async function applyCascadeAndSave(activeBlock) {
  const dayBlocks = state.blocks.filter((b) => b.day === activeBlock.day);
  const moved = resolveCascade(dayBlocks, activeBlock.id);
  renderBlocks();
  // Always save the active block; plus any blocks the cascade displaced.
  const toSave = [activeBlock, ...moved.filter((b) => b.id !== activeBlock.id)];
  await api("/api/blocks/positions", "POST", {
    blocks: toSave.map((b) => ({
      id: b.id,
      day: b.day,
      start_row: b.start_row,
      duration_slots: b.duration_slots,
    })),
  });
  toast("Saved");
}

// ===========================================================================
//  RENDER — grid scaffold (built once) and blocks (re-drawn on change)
// ===========================================================================
function buildGrid() {
  const grid = $("#grid");
  grid.style.setProperty("--row-h", ROW_H + "px");
  document.documentElement.style.setProperty("--row-h", ROW_H + "px");
  grid.innerHTML = "";

  // Row 1: corner + 7 day headers
  const corner = document.createElement("div");
  corner.className = "corner";
  grid.appendChild(corner);
  for (const d of DAYS) {
    const h = document.createElement("div");
    h.className = "dayhead";
    h.textContent = d;
    grid.appendChild(h);
  }

  // Row 2: time-label column + 7 day columns
  const bodyHeight = ROW_COUNT * ROW_H;

  const timecol = document.createElement("div");
  timecol.className = "timecol";
  timecol.style.height = bodyHeight + "px";
  for (let r = 0; r < ROW_COUNT; r++) {
    const lbl = document.createElement("div");
    const onHour = r % 2 === 0;
    lbl.className = "timelabel" + (onHour ? "" : " half");
    lbl.style.top = r * ROW_H + "px";
    lbl.textContent = rowToTime(r);
    timecol.appendChild(lbl);
  }
  grid.appendChild(timecol);

  for (let day = 0; day < 7; day++) {
    const col = document.createElement("div");
    col.className = "daycol";
    col.dataset.day = day;
    col.style.height = bodyHeight + "px";
    grid.appendChild(col);
  }

  enableBlockCreation();
}

function dayCol(day) {
  return document.querySelector(`.daycol[data-day="${day}"]`);
}

function renderBlocks() {
  // Clear existing block elements (keep highlights/select rects out of the way).
  document.querySelectorAll(".block").forEach((el) => el.remove());

  for (const blk of state.blocks) {
    const cat = categoryById(blk.category_id);
    const colorKey = cat ? cat.color_key : "gray";

    const el = document.createElement("div");
    el.className = `block cat-${colorKey}`;
    el.dataset.id = blk.id;
    el.style.top = blk.start_row * ROW_H + "px";
    el.style.height = blk.duration_slots * ROW_H - 2 + "px";

    const endRow = blk.start_row + blk.duration_slots;
    el.innerHTML = `
      <div class="grip top"></div>
      <span class="del" title="Delete">×</span>
      <div class="label">${escapeHtml(blk.name)}</div>
      <div class="time">${rowToTime(blk.start_row)}–${rowToTime(endRow)}</div>
      <div class="grip bottom"></div>`;

    dayCol(blk.day).appendChild(el);
    // Tapping the block (or its × / grips) is handled centrally in
    // setupInteractions() via interact.js's `tap` event — native click is
    // unreliable inside a draggable(), so we route everything through tap.
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderLegend() {
  const wrap = $("#legend");
  wrap.innerHTML = "";
  for (const c of [...state.categories].sort((a, b) => a.display_order - b.display_order)) {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `<span class="dot swatch-${c.color_key}"></span>${escapeHtml(c.name)}`;
    wrap.appendChild(item);
  }
}

function renderWeekName() {
  $("#weekName").textContent = state.weekName ? `· ${state.weekName}` : "";
}

// ===========================================================================
//  DRAG + RESIZE (interact.js drives the pointer; our code resolves the rest)
// ===========================================================================

// Convert a screen point to a {day, row} grid cell (or null if off-grid).
function cellFromPoint(clientX, clientY) {
  const cols = document.querySelectorAll(".daycol");
  for (const col of cols) {
    const r = col.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right) {
      let row = Math.floor((clientY - r.top) / ROW_H);
      row = Math.max(0, Math.min(ROW_COUNT - 1, row));
      return { day: parseInt(col.dataset.day, 10), row, colRect: r };
    }
  }
  return null;
}

function clearDropHighlight() {
  document.querySelectorAll(".drop-highlight").forEach((e) => e.remove());
}

function showDropHighlight(day, row, durationSlots) {
  clearDropHighlight();
  const col = dayCol(day);
  if (!col) return;
  const h = document.createElement("div");
  h.className = "drop-highlight";
  const clampedRow = Math.min(row, ROW_COUNT - durationSlots);
  h.style.top = Math.max(0, clampedRow) * ROW_H + "px";
  h.style.height = durationSlots * ROW_H - 2 + "px";
  col.appendChild(h);
}

function setupInteractions() {
  // --- Dragging an existing block ---------------------------------------
  interact(".block").draggable({
    // free movement; we snap on release.
    // Don't start a drag from the delete × or the resize grips.
    ignoreFrom: ".del, .grip",
    listeners: {
      start(event) {
        const el = event.target;
        el.classList.add("dragging");
        el.dataset.dx = 0;
        el.dataset.dy = 0;
      },
      move(event) {
        const el = event.target;
        const dx = parseFloat(el.dataset.dx) + event.dx;
        const dy = parseFloat(el.dataset.dy) + event.dy;
        el.dataset.dx = dx;
        el.dataset.dy = dy;
        el.style.transform = `translate(${dx}px, ${dy}px)`;

        const blk = blockOf(el);
        const cell = cellFromPoint(event.client.x, event.client.y);
        if (cell) showDropHighlight(cell.day, cell.row, blk.duration_slots);
      },
      async end(event) {
        const el = event.target;
        el.classList.remove("dragging");
        el.style.transform = "";
        clearDropHighlight();

        const blk = blockOf(el);
        const cell = cellFromPoint(event.client.x, event.client.y);
        if (!cell) { renderBlocks(); return; }

        // Snap start row so the whole block fits above the floor.
        let newRow = Math.min(cell.row, ROW_COUNT - blk.duration_slots);
        newRow = Math.max(0, newRow);

        const movedDays = blk.day !== cell.day;
        blk.day = cell.day;
        blk.start_row = newRow;

        // Moving to a different day leaves a gap on the origin day (no cascade
        // there); the destination day cascades around the drop point.
        await applyCascadeAndSave(blk);
        if (movedDays) renderBlocks();
      },
    },
  });

  // --- Resizing a block by its top/bottom edge --------------------------
  // We use interact.js's built-in edge detection: the top/bottom `margin`
  // pixels of a block are resize zones, everything else drags. This is the
  // canonical, reliable pattern (selector-based edges are fragile). The
  // visible `.grip` strips are just an affordance so you can see where to grab.
  interact(".block").resizable({
    edges: { top: true, bottom: true, left: false, right: false },
    margin: 9,                       // px from the top/bottom edge that resizes
    ignoreFrom: ".del",              // a press on the × deletes, never resizes
    inertia: false,
    modifiers: [
      // Never let a block become shorter than one 30-minute slot.
      interact.modifiers.restrictSize({ min: { width: 0, height: ROW_H } }),
    ],
    listeners: {
      start(event) {
        const el = event.target;
        el.classList.add("dragging");
        // Remember where the block started so we can pin the edge that ISN'T
        // being dragged (resizing the bottom must never move the top, etc.).
        const blk = blockOf(el);
        el.dataset.origStart = blk.start_row;
        el.dataset.origDur = blk.duration_slots;
      },
      move(event) {
        const el = event.target;
        // Live visual feedback during the drag (snapped on release).
        el.style.height = event.rect.height + "px";
        const curTop = parseFloat(el.style.top) || 0;
        el.style.top = curTop + event.deltaRect.top + "px";
      },
      async end(event) {
        const el = event.target;
        el.classList.remove("dragging");
        const blk = blockOf(el);
        if (!blk) { renderBlocks(); return; }

        const origStart = parseInt(el.dataset.origStart, 10);
        const origDur = parseInt(el.dataset.origDur, 10);
        const draggingTop = event.edges && event.edges.top && !event.edges.bottom;

        let newStart, newDur;
        if (draggingTop) {
          // Top edge moved: the bottom (end row) stays fixed.
          const endRow = origStart + origDur;
          newStart = Math.round((parseFloat(el.style.top) || 0) / ROW_H);
          newStart = Math.max(0, Math.min(newStart, endRow - 1));  // keep >= 1 slot
          newDur = endRow - newStart;
        } else {
          // Bottom edge moved: the top (start row) stays fixed.
          newStart = origStart;
          newDur = Math.max(1, Math.round(parseFloat(el.style.height) / ROW_H));
          if (newStart + newDur > ROW_COUNT) newDur = ROW_COUNT - newStart; // 9pm floor
        }

        blk.start_row = newStart;
        blk.duration_slots = newDur;

        await applyCascadeAndSave(blk);   // growing a block pushes the one below
      },
    },
  });

  // --- Taps: open the editor, or delete via the × -----------------------
  // We use interact.js's `tap` event (a press-and-release with no drag) rather
  // than a native `click`, because draggable() calls preventDefault() on
  // pointerdown which stops the browser from ever firing `click` on a block.
  // interact distinguishes a tap from a drag/resize for us, so editing,
  // recategorizing, and deleting all work again.
  interact(".block").on("tap", async (event) => {
    const blockEl = event.target.closest(".block");
    if (!blockEl) return;
    const blk = blockOf(blockEl);
    if (!blk) return;

    // Grips are for the resize cursor only — tapping them does nothing.
    if (event.target.closest(".grip")) return;

    event.preventDefault();

    // × deletes the block.
    if (event.target.closest(".del")) {
      await deleteBlock(blk.id);
      return;
    }

    // Anything else on the block opens the editor.
    openBlockEditor(blk.id);
  });
}

function blockOf(el) {
  const id = parseInt(el.dataset.id, 10);
  return state.blocks.find((b) => b.id === id);
}

// ===========================================================================
//  CREATE a block by dragging on empty grid space
// ===========================================================================
function enableBlockCreation() {
  document.querySelectorAll(".daycol").forEach((col) => {
    col.addEventListener("pointerdown", (e) => {
      // Ignore clicks that land on an existing block or its controls.
      if (e.target.closest(".block")) return;
      e.preventDefault();

      const day = parseInt(col.dataset.day, 10);
      const rect = col.getBoundingClientRect();
      const startRow = clampRow(Math.floor((e.clientY - rect.top) / ROW_H));

      const sel = document.createElement("div");
      sel.className = "select-rect";
      col.appendChild(sel);

      const draw = (curRow) => {
        const a = Math.min(startRow, curRow);
        const b = Math.max(startRow, curRow);
        sel.style.top = a * ROW_H + "px";
        sel.style.height = (b - a + 1) * ROW_H - 2 + "px";
        return { a, b };
      };
      let span = draw(startRow);

      const onMove = (ev) => {
        const curRow = clampRow(Math.floor((ev.clientY - rect.top) / ROW_H));
        span = draw(curRow);
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        sel.remove();
        const duration = span.b - span.a + 1;
        // Open the editor to name + categorize the new block.
        openBlockEditor(null, { day, start_row: span.a, duration_slots: duration });
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  });
}

function clampRow(r) {
  return Math.max(0, Math.min(ROW_COUNT - 1, r));
}

// ===========================================================================
//  BLOCK EDITOR modal (create + edit)
// ===========================================================================
let editorContext = null;  // {mode:'create'|'edit', blockId, draft}

function fillCategorySelect(selectEl, selectedId) {
  selectEl.innerHTML = "";
  for (const c of [...state.categories].sort((a, b) => a.display_order - b.display_order)) {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = `${c.name}  (${PALETTE[c.color_key] || c.color_key})`;
    if (c.id === selectedId) o.selected = true;
    selectEl.appendChild(o);
  }
}

// Populate the duration dropdown in 30-minute steps, capped so the block never
// extends past the 9:00pm floor given where it starts.
function fillDurationSelect(selectEl, startRow, selectedSlots) {
  selectEl.innerHTML = "";
  const maxSlots = ROW_COUNT - startRow;                 // floor enforcement
  for (let s = 1; s <= maxSlots; s++) {
    const mins = s * 30;
    let label;
    if (mins < 60) label = `${mins} min`;
    else if (mins % 60 === 0) label = `${mins / 60} hr`;
    else label = `${Math.floor(mins / 60)} hr ${mins % 60} min`;
    const o = document.createElement("option");
    o.value = s;
    o.textContent = `${label}  ·  ${rowToTime(startRow)}–${rowToTime(startRow + s)}`;
    if (s === selectedSlots) o.selected = true;
    selectEl.appendChild(o);
  }
}

function openBlockEditor(blockId, draft = null) {
  const isCreate = blockId === null;
  editorContext = { mode: isCreate ? "create" : "edit", blockId, draft };

  $("#blockModalTitle").textContent = isCreate ? "New block" : "Edit block";
  $("#blockDelete").style.display = isCreate ? "none" : "block";

  let name = "", catId = state.categories[0] && state.categories[0].id;
  let startRow, durSlots;
  if (isCreate) {
    startRow = draft.start_row;
    durSlots = draft.duration_slots;     // pre-filled from the drag-to-span
  } else {
    const blk = state.blocks.find((b) => b.id === blockId);
    name = blk.name;
    catId = blk.category_id;
    startRow = blk.start_row;
    durSlots = blk.duration_slots;
  }
  // Remember where the block starts so saving can re-check the floor.
  editorContext.startRow = startRow;

  $("#blockName").value = name;
  fillCategorySelect($("#blockCategory"), catId);
  fillDurationSelect($("#blockDuration"), startRow, durSlots);

  openModal("#blockModal");
  setTimeout(() => $("#blockName").focus(), 30);
}

async function saveBlockEditor() {
  const name = $("#blockName").value.trim() || "Untitled";
  const categoryId = parseInt($("#blockCategory").value, 10);
  // Duration comes from the dropdown; it's already capped to the floor.
  let durSlots = parseInt($("#blockDuration").value, 10) || 1;
  durSlots = Math.max(1, durSlots);

  if (editorContext.mode === "create") {
    const d = editorContext.draft;
    const created = await api("/api/blocks", "POST", {
      week_id: state.weekId,
      category_id: categoryId,
      name,
      day: d.day,
      start_row: d.start_row,
      duration_slots: durSlots,
    });
    state.blocks.push(created);
    closeModal("#blockModal");
    await applyCascadeAndSave(created);     // resolve any overlap at the new spot
  } else {
    const blk = state.blocks.find((b) => b.id === editorContext.blockId);
    blk.name = name;
    blk.category_id = categoryId;
    // Apply the new duration, keeping it above the 9:00pm floor.
    if (blk.start_row + durSlots > ROW_COUNT) durSlots = ROW_COUNT - blk.start_row;
    blk.duration_slots = durSlots;
    await api(`/api/blocks/${blk.id}`, "PUT", { name, category_id: categoryId });
    closeModal("#blockModal");
    // Persist the new duration/position and cascade anything it now overlaps.
    await applyCascadeAndSave(blk);
  }
}

async function deleteBlock(id) {
  try {
    await api(`/api/blocks/${id}`, "DELETE");
    state.blocks = state.blocks.filter((b) => b.id !== id);
    renderBlocks();
    toast("Deleted");
  } catch (e) {
    console.error("Delete failed:", e);
    toast(`Delete failed: ${e.message}`);
  }
}

// ===========================================================================
//  CATEGORIES modal
// ===========================================================================
let newCatColor = "blue";

function renderColorPicker(container, selectedKey, onPick) {
  container.innerHTML = "";
  for (const key of Object.keys(PALETTE)) {
    const opt = document.createElement("div");
    opt.className = `color-opt swatch-${key}` + (key === selectedKey ? " sel" : "");
    opt.textContent = PALETTE[key];
    opt.addEventListener("click", () => {
      onPick(key);
      container.querySelectorAll(".color-opt").forEach((o) => o.classList.remove("sel"));
      opt.classList.add("sel");
    });
    container.appendChild(opt);
  }
}

function renderCatList() {
  const list = $("#catList");
  list.innerHTML = "";
  const sorted = [...state.categories].sort((a, b) => a.display_order - b.display_order);

  sorted.forEach((c, idx) => {
    const row = document.createElement("div");
    row.className = "cat-row";
    row.innerHTML = `
      <span class="swatch swatch-${c.color_key}"></span>
      <input type="text" class="cname" value="${escapeHtml(c.name)}">
      <select class="crecolor"></select>
      <div class="ord">
        <button class="btn small up" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button class="btn small down" ${idx === sorted.length - 1 ? "disabled" : ""}>▼</button>
      </div>
      <button class="btn small danger cdel">Delete</button>`;
    list.appendChild(row);

    // recolor dropdown
    const sel = row.querySelector(".crecolor");
    for (const key of Object.keys(PALETTE)) {
      const o = document.createElement("option");
      o.value = key; o.textContent = PALETTE[key];
      if (key === c.color_key) o.selected = true;
      sel.appendChild(o);
    }

    // rename (on blur) + recolor (on change)
    const saveCat = async (patch) => {
      const updated = await api(`/api/categories/${c.id}`, "PUT", patch);
      Object.assign(c, updated);
      renderCatList(); renderLegend(); renderBlocks();
    };
    row.querySelector(".cname").addEventListener("blur", (e) => {
      const v = e.target.value.trim();
      if (v && v !== c.name) saveCat({ name: v });
    });
    sel.addEventListener("change", (e) => saveCat({ color_key: e.target.value }));

    // reorder
    row.querySelector(".up").addEventListener("click", () => moveCategory(c.id, -1));
    row.querySelector(".down").addEventListener("click", () => moveCategory(c.id, +1));

    // delete (with reassign guard)
    row.querySelector(".cdel").addEventListener("click", () => deleteCategory(c));
  });
}

async function moveCategory(id, dir) {
  const sorted = [...state.categories].sort((a, b) => a.display_order - b.display_order);
  const i = sorted.findIndex((c) => c.id === id);
  const j = i + dir;
  if (j < 0 || j >= sorted.length) return;
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  await api("/api/categories/reorder", "POST", { order: sorted.map((c) => c.id) });
  sorted.forEach((c, idx) => { c.display_order = idx; });
  renderCatList(); renderLegend();
}

async function deleteCategory(c) {
  try {
    await api(`/api/categories/${c.id}`, "DELETE", {});
    state.categories = state.categories.filter((x) => x.id !== c.id);
    renderCatList(); renderLegend();
    toast("Category deleted");
  } catch (err) {
    if (err.status === 409) {
      // Some blocks use it — require reassignment.
      const others = state.categories.filter((x) => x.id !== c.id);
      const names = others.map((o) => `${o.id}: ${o.name}`).join("\n");
      const choice = prompt(
        `"${c.name}" is used by ${err.payload.count} block(s).\n` +
        `Reassign them to which category? Enter the id:\n\n${names}`
      );
      const targetId = parseInt(choice, 10);
      if (!targetId || !others.find((o) => o.id === targetId)) {
        if (choice !== null) alert("No valid category chosen — deletion cancelled.");
        return;
      }
      await api(`/api/categories/${c.id}`, "DELETE", { reassign_to: targetId });
      // Update local blocks that pointed at the deleted category.
      state.blocks.forEach((b) => { if (b.category_id === c.id) b.category_id = targetId; });
      state.categories = state.categories.filter((x) => x.id !== c.id);
      renderCatList(); renderLegend(); renderBlocks();
      toast("Reassigned & deleted");
    } else if (err.status === 400) {
      alert(err.message || "Cannot delete that category.");
    } else {
      throw err;
    }
  }
}

async function addCategory() {
  const name = $("#newCatName").value.trim();
  if (!name) { alert("Give the category a name."); return; }
  const created = await api("/api/categories", "POST", { name, color_key: newCatColor });
  state.categories.push(created);
  $("#newCatName").value = "";
  renderCatList(); renderLegend();
}

// ===========================================================================
//  WEEKS modal
// ===========================================================================
async function openWeeks() {
  $("#activeWeekName").value = state.weekName;
  await renderWeekList();
  openModal("#weeksModal");
}

async function renderWeekList() {
  const weeks = await api("/api/weeks");
  const list = $("#weekList");
  list.innerHTML = "";
  for (const w of weeks) {
    const row = document.createElement("div");
    row.className = "week-row" + (w.is_current ? " current" : "");
    const tags =
      (w.is_current ? `<span class="tag">active</span> ` : "") +
      (w.is_template ? `<span class="tag tmpl">template</span>` : "");
    row.innerHTML = `
      <div class="wmeta">
        <div class="wname">${escapeHtml(w.name)} ${tags}</div>
        <div class="wsub">${w.block_count} block(s)</div>
      </div>
      <div class="row-inline"></div>`;
    const actions = row.querySelector(".row-inline");

    actions.appendChild(btn(w.is_template ? "Load as new" : "Load", "primary", async () => {
      const data = await api(`/api/weeks/${w.id}/load`, "POST", { as_new: w.is_template });
      loadWeekData(data);
      closeModal("#weeksModal");
      toast("Week loaded");
    }));

    actions.appendChild(btn("Duplicate", "", async () => {
      await api(`/api/weeks/${w.id}/duplicate`, "POST", {});
      renderWeekList();
    }));

    actions.appendChild(btn(w.is_template ? "Unmark template" : "Make template", "", async () => {
      await api(`/api/weeks/${w.id}`, "PUT", { is_template: !w.is_template });
      renderWeekList();
    }));

    if (!w.is_current) {
      actions.appendChild(btn("Delete", "danger", async () => {
        if (!confirm(`Delete "${w.name}"? This cannot be undone.`)) return;
        try { await api(`/api/weeks/${w.id}`, "DELETE"); renderWeekList(); }
        catch (e) { alert(e.message); }
      }));
    }
    list.appendChild(row);
  }
}

function btn(label, cls, onClick) {
  const b = document.createElement("button");
  b.className = "btn small " + cls;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

// ===========================================================================
//  IMPORT modal
// ===========================================================================
function renderImportResult(res) {
  const wrap = $("#importResult");
  let html = `<div class="ok">Imported ${res.imported} block(s).</div>`;
  if (res.errors && res.errors.length) {
    html += `<div class="muted" style="margin-top:6px">${res.errors.length} row(s) had problems and were skipped:</div>`;
    html += `<div class="err-list">`;
    for (const e of res.errors) {
      const where = e.index >= 0 ? `Row ${e.index + 1}` : "Input";
      html += `<div class="err"><strong>${where}:</strong> ${escapeHtml(e.message)}</div>`;
    }
    html += `</div>`;
  }
  wrap.innerHTML = html;
}

async function runImport() {
  const text = $("#importText").value;
  const mode = $("#importMode").value;
  const body = {
    text,
    mode,
    new_name: $("#importName").value.trim() || "Imported week",
    create_missing_categories: $("#importCreateCats").checked,
  };
  try {
    const res = await api("/api/import", "POST", body);
    renderImportResult(res);
    // Importing changes the active week (replace) or creates+activates a new one.
    if (res.week) {
      // Refresh categories too (auto-create may have added some).
      const fresh = await api("/api/state");
      state.categories = fresh.categories;
      loadWeekData(res.week);
      renderLegend();
    }
  } catch (e) {
    $("#importResult").innerHTML = `<div class="err">${escapeHtml(e.message)}</div>`;
  }
}

// ===========================================================================
//  Modal open/close plumbing
// ===========================================================================
function openModal(sel) { $(sel).classList.add("open"); }
function closeModal(sel) { $(sel).classList.remove("open"); }

// Close when clicking the dark backdrop (but not the modal itself).
document.querySelectorAll(".overlay").forEach((ov) => {
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.classList.remove("open"); });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".overlay.open").forEach((o) => o.classList.remove("open"));
});

// ===========================================================================
//  Load week data into state + screen
// ===========================================================================
function loadWeekData(week) {
  state.weekId = week.id;
  state.weekName = week.name;
  state.blocks = week.blocks || [];
  renderWeekName();
  renderBlocks();
}

// ===========================================================================
//  Wire up buttons
// ===========================================================================
function wireButtons() {
  $("#btnCategories").addEventListener("click", () => {
    renderCatList();
    renderColorPicker($("#newCatColors"), newCatColor, (k) => { newCatColor = k; });
    openModal("#catModal");
  });
  $("#catClose").addEventListener("click", () => closeModal("#catModal"));
  $("#catAdd").addEventListener("click", addCategory);

  $("#btnWeeks").addEventListener("click", openWeeks);
  $("#weeksClose").addEventListener("click", () => closeModal("#weeksModal"));
  $("#weekNew").addEventListener("click", async () => {
    const name = prompt("Name for the new blank week:", "New week");
    if (name === null) return;
    const data = await api("/api/weeks", "POST", { name: name || "New week" });
    loadWeekData(data);
    renderWeekList();
    toast("New week created");
  });
  $("#weekRename").addEventListener("click", async () => {
    const name = $("#activeWeekName").value.trim();
    if (!name) return;
    await api(`/api/weeks/${state.weekId}`, "PUT", { name });
    state.weekName = name;
    renderWeekName();
    renderWeekList();
  });

  $("#btnImport").addEventListener("click", () => {
    $("#importResult").innerHTML = "";
    openModal("#importModal");
  });
  $("#importClose").addEventListener("click", () => closeModal("#importModal"));
  $("#importRun").addEventListener("click", runImport);
  $("#importMode").addEventListener("change", (e) => {
    $("#importNameWrap").style.display = e.target.value === "new" ? "block" : "none";
  });

  // Export: download the current week as Argo-format JSON (round-trips through
  // the Import panel, and is the user's own backup since data lives in-browser).
  $("#btnExport").addEventListener("click", () => {
    const { week_name, rows } = HourglassDB.exportCurrentWeek();
    const json = JSON.stringify(rows, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const safe = (week_name || "week").replace(/[^a-z0-9\-_]+/gi, "-").toLowerCase();
    const a = document.createElement("a");
    a.href = url;
    a.download = `hourglass-${safe}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Exported");
  });

  // Reset: wipe this browser's Hourglass data and reload to the fresh seed.
  $("#btnReset").addEventListener("click", () => {
    const sure = confirm(
      "Reset The Hourglass?\n\nThis erases ALL weeks, blocks, and categories " +
      "stored in this browser and starts fresh. This cannot be undone.\n\n" +
      "Tip: use Export first if you want to keep the current week."
    );
    if (!sure) return;
    HourglassDB.resetAll();
    location.reload();
  });

  // Block editor buttons
  $("#blockSave").addEventListener("click", saveBlockEditor);
  $("#blockCancel").addEventListener("click", () => closeModal("#blockModal"));
  $("#blockDelete").addEventListener("click", async () => {
    if (editorContext.mode === "edit") {
      await deleteBlock(editorContext.blockId);
      closeModal("#blockModal");
    }
  });
  $("#blockName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); saveBlockEditor(); }
  });
}

// ===========================================================================
//  Boot
// ===========================================================================
async function boot() {
  buildGrid();
  wireButtons();
  setupInteractions();

  const data = await api("/api/state");
  state.categories = data.categories;
  if (data.week) {
    loadWeekData(data.week);
  }
  renderLegend();
}

document.addEventListener("DOMContentLoaded", boot);
