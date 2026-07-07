/* =========================================================================
   THE HOURGLASS — in-browser "database" (db.js)
   -------------------------------------------------------------------------
   This file replaces the old Python server (app.py + hourglass.db). It stores
   everything in the browser's localStorage instead of on a server, so the app
   can run as plain static files (e.g. on Cloudflare Pages) with no backend.

   How it fits together:
     • app.js still calls api("/api/…", method, body) exactly as before.
     • api() now hands that call to HourglassDB.request(method, url, body).
     • This module answers with the SAME JSON shapes and the SAME error codes
       (404 / 409 / 400 / 200) the Flask routes used to return.

   All data lives under one localStorage key ("hourglass.state.v1") as a single
   JSON blob. Every change is saved immediately (the same "autosave" behavior
   the SQLite version had). Each visitor gets their own private copy in their
   own browser.
   ========================================================================= */

(function () {
  "use strict";

  // ----- constants (must match app.py / app.js) -------------------------
  const STORAGE_KEY = "hourglass.state.v1";
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const ROW_COUNT = 31;              // rows 0..30  (6:00am .. 9:00pm)
  const GRID_START_MIN = 6 * 60;     // 6:00am in minutes
  const PALETTE_KEYS = ["blue", "cyan", "teal", "coral", "purple", "pink", "green", "amber", "gray"];
  const SEED_CATEGORIES = [
    ["Slot 1", "blue"], ["Slot 2", "cyan"], ["Slot 3", "teal"], ["Workout", "coral"],
    ["Meeting", "purple"], ["Creativity", "pink"], ["Breathwork", "green"], ["Family", "amber"],
  ];

  // ----- tiny helpers ---------------------------------------------------
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const nowIso = () => new Date().toISOString();
  const ok = (data) => ({ status: 200, data: clone(data === undefined ? { ok: true } : data) });
  const fail = (status, data) => ({ status, data });

  function nextId(s) {
    const id = s.next_id;
    s.next_id += 1;
    return id;
  }

  // ----- load / seed / save --------------------------------------------
  function freshSeed() {
    // Categories get ids 1..8; the first week gets id 9; new items start at 100.
    const categories = SEED_CATEGORIES.map((c, i) => ({
      id: i + 1, name: c[0], color_key: c[1], display_order: i,
    }));
    const ts = nowIso();
    const week = { id: 9, name: "Current week", is_template: false, created_at: ts, modified_at: ts };
    return {
      categories,
      weeks: [week],
      blocks: [],
      settings: { current_week_id: week.id },
      next_id: 100,
    };
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) {
      const seeded = freshSeed();
      save(seeded);
      return seeded;
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      // Corrupt blob — start clean rather than break the app.
      const seeded = freshSeed();
      save(seeded);
      return seeded;
    }
  }

  function save(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }
    catch (e) { /* storage full or blocked — nothing we can do but keep running */ }
  }

  // ----- domain helpers (mirror app.py) --------------------------------
  function currentWeekId(s) {
    return s.settings ? s.settings.current_week_id : null;
  }

  function findWeek(s, id) {
    return s.weeks.find((w) => w.id === id) || null;
  }

  function findCategory(s, id) {
    return s.categories.find((c) => c.id === id) || null;
  }

  function findBlock(s, id) {
    return s.blocks.find((b) => b.id === id) || null;
  }

  function touchWeek(s, weekId) {
    const w = findWeek(s, weekId);
    if (w) w.modified_at = nowIso();
  }

  function sortedCategories(s) {
    return [...s.categories].sort((a, b) => a.display_order - b.display_order || a.id - b.id);
  }

  function serializeWeek(s, weekId) {
    const w = findWeek(s, weekId);
    if (!w) return null;
    const blocks = s.blocks
      .filter((b) => b.week_id === weekId)
      .sort((a, b) => a.day - b.day || a.start_row - b.start_row);
    return {
      id: w.id,
      name: w.name,
      is_template: !!w.is_template,
      created_at: w.created_at,
      modified_at: w.modified_at,
      blocks: blocks.map((b) => clone(b)),
    };
  }

  function copyWeek(s, sourceWeekId, newName, isTemplate) {
    const ts = nowIso();
    const newId = nextId(s);
    s.weeks.push({
      id: newId, name: newName, is_template: !!isTemplate, created_at: ts, modified_at: ts,
    });
    s.blocks
      .filter((b) => b.week_id === sourceWeekId)
      .forEach((b) => {
        s.blocks.push({
          id: nextId(s), week_id: newId, category_id: b.category_id,
          name: b.name, day: b.day, start_row: b.start_row, duration_slots: b.duration_slots,
        });
      });
    return newId;
  }

  function validPlacement(startRow, durationSlots) {
    if (durationSlots < 1) return false;
    if (startRow < 0 || startRow >= ROW_COUNT) return false;
    if (startRow + durationSlots > ROW_COUNT) return false;
    return true;
  }

  // ----- Argo import validator (ported from parse_import_rows in app.py) -
  function parseImportRows(rawRows, categoriesByName) {
    const valid = [];
    const errors = [];
    const dayIndex = {};
    DAYS.forEach((d, i) => { dayIndex[d] = i; });

    if (!Array.isArray(rawRows)) {
      return { valid: [], errors: [{ index: -1, message: "Top level must be a JSON array of blocks.", row: null }] };
    }

    rawRows.forEach((row, i) => {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        errors.push({ index: i, message: "Row is not an object.", row: row });
        return;
      }

      const day = row.day;
      const start = row.start;
      const duration = row.duration;
      const name = (row.name || "").trim();
      const catName = row.category;

      const problems = [];
      let startRow = null;
      let durationSlots = null;

      if (!(day in dayIndex)) {
        problems.push(`day '${day}' must be one of Mon–Sun`);
      }

      if (typeof start !== "string" || start.indexOf(":") === -1) {
        problems.push(`start '${start}' must be HH:MM`);
      } else {
        const parts = start.split(":");
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (Number.isNaN(h) || Number.isNaN(m)) {
          problems.push(`start '${start}' is not a valid time`);
        } else {
          const minutes = h * 60 + m;
          if (minutes < GRID_START_MIN || minutes > 21 * 60) {
            problems.push(`start '${start}' must be between 06:00 and 21:00`);
          } else if ((minutes - GRID_START_MIN) % 30 !== 0) {
            problems.push(`start '${start}' must land on the 30-minute grid`);
          } else {
            startRow = (minutes - GRID_START_MIN) / 30;
          }
        }
      }

      if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 30 || duration % 30 !== 0) {
        problems.push(`duration '${duration}' must be a multiple of 30 minutes (>= 30)`);
      } else {
        durationSlots = duration / 30;
      }

      if (!name) problems.push("name is empty");

      const category = catName
        ? categoriesByName[String(catName).trim().toLowerCase()]
        : undefined;
      if (!category) problems.push(`category '${catName}' does not exist`);

      if (startRow !== null && durationSlots !== null) {
        if (startRow + durationSlots > ROW_COUNT) problems.push("block extends past 9:00pm");
      }

      if (problems.length) {
        errors.push({ index: i, message: problems.join("; "), row: row });
        return;
      }

      valid.push({
        category_id: category.id, name: name,
        day: dayIndex[day], start_row: startRow, duration_slots: durationSlots,
      });
    });

    return { valid, errors };
  }

  // =====================================================================
  //  ROUTES — one handler per old Flask endpoint. Each returns {status,data}.
  // =====================================================================

  function routeState(s) {
    return ok({
      current_week_id: currentWeekId(s),
      week: serializeWeek(s, currentWeekId(s)),
      categories: sortedCategories(s),
      palette_keys: PALETTE_KEYS,
      days: DAYS,
      row_count: ROW_COUNT,
    });
  }

  // --- categories ---
  function categoriesList(s) {
    return ok(sortedCategories(s));
  }

  function categoriesCreate(s, body) {
    const name = (body.name || "").trim();
    const color = body.color_key;
    if (!name) return fail(400, { error: "Name is required." });
    if (PALETTE_KEYS.indexOf(color) === -1) return fail(400, { error: "Unknown color." });
    const maxOrder = s.categories.reduce((m, c) => Math.max(m, c.display_order), -1);
    const cat = { id: nextId(s), name, color_key: color, display_order: maxOrder + 1 };
    s.categories.push(cat);
    save(s);
    return ok(cat);
  }

  function categoriesUpdate(s, id, body) {
    const cat = findCategory(s, id);
    if (!cat) return fail(404, { error: "Category not found." });
    const name = body.name !== undefined ? body.name : cat.name;
    const color = body.color_key !== undefined ? body.color_key : cat.color_key;
    const order = body.display_order !== undefined ? body.display_order : cat.display_order;
    if (!String(name).trim()) return fail(400, { error: "Name is required." });
    if (PALETTE_KEYS.indexOf(color) === -1) return fail(400, { error: "Unknown color." });
    cat.name = String(name).trim();
    cat.color_key = color;
    cat.display_order = parseInt(order, 10);
    save(s);
    return ok(cat);
  }

  function categoriesReorder(s, body) {
    const ids = body.order || [];
    ids.forEach((cid, index) => {
      const c = findCategory(s, cid);
      if (c) c.display_order = index;
    });
    save(s);
    return ok({ ok: true });
  }

  function categoriesDelete(s, id, body) {
    const reassignTo = body.reassign_to;
    const inUse = s.blocks.filter((b) => b.category_id === id).length;
    if (s.categories.length <= 1) {
      return fail(400, { error: "Cannot delete the last remaining category." });
    }
    if (inUse) {
      if (reassignTo === undefined || reassignTo === null) {
        return fail(409, {
          error: "in_use", count: inUse,
          message: `${inUse} block(s) use this category. Reassign them first.`,
        });
      }
      const target = findCategory(s, reassignTo);
      if (!target || reassignTo === id) {
        return fail(400, { error: "Invalid reassignment target." });
      }
      s.blocks.forEach((b) => { if (b.category_id === id) b.category_id = reassignTo; });
    }
    s.categories = s.categories.filter((c) => c.id !== id);
    save(s);
    return ok({ ok: true });
  }

  // --- weeks ---
  function weeksList(s) {
    const current = currentWeekId(s);
    const rows = [...s.weeks]
      .sort((a, b) => (a.modified_at < b.modified_at ? 1 : a.modified_at > b.modified_at ? -1 : 0))
      .map((w) => ({
        id: w.id, name: w.name, is_template: !!w.is_template,
        created_at: w.created_at, modified_at: w.modified_at,
        block_count: s.blocks.filter((b) => b.week_id === w.id).length,
        is_current: w.id === current,
      }));
    return ok(rows);
  }

  function weeksCreate(s, body) {
    const name = (body.name || "New week").trim() || "New week";
    const ts = nowIso();
    const id = nextId(s);
    s.weeks.push({ id, name, is_template: false, created_at: ts, modified_at: ts });
    s.settings.current_week_id = id;
    save(s);
    return ok(serializeWeek(s, id));
  }

  function weeksUpdate(s, id, body) {
    const w = findWeek(s, id);
    if (!w) return fail(404, { error: "Week not found." });
    const name = ((body.name !== undefined ? body.name : w.name) || "").trim() || w.name;
    const isTemplate = body.is_template !== undefined ? body.is_template : !!w.is_template;
    w.name = name;
    w.is_template = !!isTemplate;
    w.modified_at = nowIso();
    save(s);
    return ok(serializeWeek(s, id));
  }

  function weeksDuplicate(s, id, body) {
    const src = findWeek(s, id);
    if (!src) return fail(404, { error: "Week not found." });
    const newName = (body.name || `${src.name} (copy)`).trim();
    const asTemplate = !!body.is_template;
    const newId = copyWeek(s, id, newName, asTemplate);
    save(s);
    return ok(serializeWeek(s, newId));
  }

  function weeksDelete(s, id) {
    const current = currentWeekId(s);
    if (s.weeks.length <= 1) return fail(400, { error: "Cannot delete the only week." });
    if (id === current) return fail(400, { error: "Cannot delete the active week. Load another week first." });
    s.blocks = s.blocks.filter((b) => b.week_id !== id);
    s.weeks = s.weeks.filter((w) => w.id !== id);
    save(s);
    return ok({ ok: true });
  }

  function weeksLoad(s, id, body) {
    const w = findWeek(s, id);
    if (!w) return fail(404, { error: "Week not found." });
    const asNew = !!body.as_new || !!w.is_template;
    let targetId = id;
    if (asNew) {
      const base = w.is_template ? (w.name + " — working copy") : (w.name + " (copy)");
      targetId = copyWeek(s, id, base, false);
    }
    s.settings.current_week_id = targetId;
    save(s);
    return ok(serializeWeek(s, targetId));
  }

  // --- blocks ---
  function blocksCreate(s, body) {
    const weekId = body.week_id || currentWeekId(s);
    const categoryId = body.category_id;
    const name = (body.name || "").trim() || "Untitled";
    const day = parseInt(body.day != null ? body.day : 0, 10);
    const startRow = parseInt(body.start_row != null ? body.start_row : 0, 10);
    const duration = parseInt(body.duration_slots != null ? body.duration_slots : 1, 10);

    if (!findCategory(s, categoryId)) return fail(400, { error: "Unknown category." });
    if (!(day >= 0 && day <= 6) || !validPlacement(startRow, duration)) {
      return fail(400, { error: "Invalid block placement." });
    }
    const block = {
      id: nextId(s), week_id: weekId, category_id: categoryId,
      name, day, start_row: startRow, duration_slots: duration,
    };
    s.blocks.push(block);
    touchWeek(s, weekId);
    save(s);
    return ok(block);
  }

  function blocksUpdate(s, id, body) {
    const b = findBlock(s, id);
    if (!b) return fail(404, { error: "Block not found." });
    const name = body.name !== undefined ? body.name : b.name;
    const categoryId = body.category_id !== undefined ? body.category_id : b.category_id;
    if (!String(name).trim()) return fail(400, { error: "Name is required." });
    if (!findCategory(s, categoryId)) return fail(400, { error: "Unknown category." });
    b.name = String(name).trim();
    b.category_id = categoryId;
    touchWeek(s, b.week_id);
    save(s);
    return ok(b);
  }

  function blocksPositions(s, body) {
    const items = body.blocks || [];
    const touched = new Set();
    items.forEach((item) => {
      const b = findBlock(s, item.id);
      if (!b) return;
      const day = parseInt(item.day, 10);
      const startRow = parseInt(item.start_row, 10);
      const duration = parseInt(item.duration_slots, 10);
      if (!(day >= 0 && day <= 6) || !validPlacement(startRow, duration)) return;
      b.day = day;
      b.start_row = startRow;
      b.duration_slots = duration;
      touched.add(b.week_id);
    });
    touched.forEach((wid) => touchWeek(s, wid));
    save(s);
    return ok({ ok: true });
  }

  function blocksDelete(s, id) {
    const b = findBlock(s, id);
    if (!b) return fail(404, { error: "Block not found." });
    s.blocks = s.blocks.filter((x) => x.id !== id);
    touchWeek(s, b.week_id);
    save(s);
    return ok({ ok: true });
  }

  // --- import ---
  function apiImport(s, body) {
    const mode = body.mode || "new";
    const createMissing = !!body.create_missing_categories;

    let rows = body.rows;
    if (rows === undefined || rows === null) {
      try { rows = JSON.parse(body.text || ""); }
      catch (e) { return fail(400, { error: `Could not parse JSON: ${e.message}` }); }
    }

    // Optionally create any missing categories before validating.
    if (createMissing && Array.isArray(rows)) {
      const existing = new Set(s.categories.map((c) => c.name.trim().toLowerCase()));
      const seen = new Set();
      rows.forEach((row) => {
        if (row && typeof row === "object") {
          const cn = (row.category || "").trim();
          const key = cn.toLowerCase();
          if (cn && !existing.has(key) && !seen.has(key)) {
            seen.add(key);
            const maxOrder = s.categories.reduce((m, c) => Math.max(m, c.display_order), -1);
            s.categories.push({ id: nextId(s), name: cn, color_key: "gray", display_order: maxOrder + 1 });
          }
        }
      });
      save(s);
    }

    const categoriesByName = {};
    s.categories.forEach((c) => { categoriesByName[c.name.trim().toLowerCase()] = { id: c.id }; });

    const { valid, errors } = parseImportRows(rows, categoriesByName);

    // Decide which week receives the blocks.
    let targetId;
    if (mode === "replace") {
      targetId = currentWeekId(s);
      s.blocks = s.blocks.filter((b) => b.week_id !== targetId);
    } else {
      const ts = nowIso();
      const name = (body.new_name || "Imported week").trim() || "Imported week";
      targetId = nextId(s);
      s.weeks.push({ id: targetId, name, is_template: false, created_at: ts, modified_at: ts });
      s.settings.current_week_id = targetId;
    }

    valid.forEach((b) => {
      s.blocks.push({
        id: nextId(s), week_id: targetId, category_id: b.category_id,
        name: b.name, day: b.day, start_row: b.start_row, duration_slots: b.duration_slots,
      });
    });
    touchWeek(s, targetId);
    save(s);

    return ok({ imported: valid.length, errors, week_id: targetId, week: serializeWeek(s, targetId) });
  }

  // =====================================================================
  //  DISPATCHER — parse (method, url) and call the right handler.
  //  Specific string routes are checked before numeric-id routes so that
  //  "/api/categories/reorder" and "/api/blocks/positions" are not mistaken
  //  for an id (mirrors Flask's <int:...> converters).
  // =====================================================================
  function request(method, url, body) {
    body = body || {};
    const s = load();
    const path = url.split("?")[0].replace(/\/+$/, "");
    const M = method.toUpperCase();

    // helper: match "/api/thing/:id/suffix" -> returns id or null
    const idAfter = (prefix, suffix) => {
      if (!path.startsWith(prefix + "/")) return null;
      let rest = path.slice(prefix.length + 1);
      if (suffix) {
        if (!rest.endsWith("/" + suffix)) return null;
        rest = rest.slice(0, rest.length - suffix.length - 1);
      }
      if (!/^\d+$/.test(rest)) return null;
      return parseInt(rest, 10);
    };

    try {
      if (path === "/api/state" && M === "GET") return routeState(s);

      // categories
      if (path === "/api/categories" && M === "GET") return categoriesList(s);
      if (path === "/api/categories" && M === "POST") return categoriesCreate(s, body);
      if (path === "/api/categories/reorder" && M === "POST") return categoriesReorder(s, body);
      {
        const cid = idAfter("/api/categories");
        if (cid !== null && M === "PUT") return categoriesUpdate(s, cid, body);
        if (cid !== null && M === "DELETE") return categoriesDelete(s, cid, body);
      }

      // weeks
      if (path === "/api/weeks" && M === "GET") return weeksList(s);
      if (path === "/api/weeks" && M === "POST") return weeksCreate(s, body);
      {
        const dupId = idAfter("/api/weeks", "duplicate");
        if (dupId !== null && M === "POST") return weeksDuplicate(s, dupId, body);
        const loadId = idAfter("/api/weeks", "load");
        if (loadId !== null && M === "POST") return weeksLoad(s, loadId, body);
        const wid = idAfter("/api/weeks");
        if (wid !== null && M === "PUT") return weeksUpdate(s, wid, body);
        if (wid !== null && M === "DELETE") return weeksDelete(s, wid);
      }

      // blocks
      if (path === "/api/blocks" && M === "POST") return blocksCreate(s, body);
      if (path === "/api/blocks/positions" && M === "POST") return blocksPositions(s, body);
      {
        const bid = idAfter("/api/blocks");
        if (bid !== null && M === "PUT") return blocksUpdate(s, bid, body);
        if (bid !== null && M === "DELETE") return blocksDelete(s, bid);
      }

      // import
      if (path === "/api/import" && M === "POST") return apiImport(s, body);

      return fail(404, { error: `No route for ${M} ${path}` });
    } catch (e) {
      return fail(500, { error: String((e && e.message) || e) });
    }
  }

  // ----- public surface -------------------------------------------------
  window.HourglassDB = {
    request,
    // Used by the Reset button: wipe everything and start fresh on reload.
    resetAll() {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    },
    // Used by the Export button: the current week's blocks in Argo import format.
    exportCurrentWeek() {
      const s = load();
      const weekId = currentWeekId(s);
      const w = findWeek(s, weekId);
      const catName = {};
      s.categories.forEach((c) => { catName[c.id] = c.name; });
      const rowToTime = (r) => {
        const mins = GRID_START_MIN + r * 30;
        const h = String(Math.floor(mins / 60)).padStart(2, "0");
        const m = String(mins % 60).padStart(2, "0");
        return `${h}:${m}`;
      };
      const rows = s.blocks
        .filter((b) => b.week_id === weekId)
        .sort((a, b) => a.day - b.day || a.start_row - b.start_row)
        .map((b) => ({
          day: DAYS[b.day],
          start: rowToTime(b.start_row),
          duration: b.duration_slots * 30,
          name: b.name,
          category: catName[b.category_id] || "",
        }));
      return { week_name: w ? w.name : "Week", rows };
    },
  };
})();
