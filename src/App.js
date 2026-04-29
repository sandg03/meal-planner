import { useState, useEffect, useCallback, useRef } from "react";

const USDA_KEY = "xQv4lmejRzJr30ZbmNPEbZRwbSioxXYrjYghdNDC";

const SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];
const SLOT_ICONS = { Breakfast: "🌅", Lunch: "☀️", Dinner: "🌙", Snack: "🍎" };

function getWeekDates(offset = 0) {
  const d = new Date();
  const dow = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(mon);
    dt.setDate(mon.getDate() + i);
    return dt.toISOString().split("T")[0];
  });
}

function fmt(ds, opts) {
  return new Date(ds + "T12:00:00").toLocaleDateString("en-US", opts);
}

async function storageGet(key) {
  try {
    const r = await window.storage.get(key);
    return r ? JSON.parse(r.value) : null;
  } catch { return null; }
}

async function storageSet(key, val) {
  try { await window.storage.set(key, JSON.stringify(val)); } catch {}
}

async function searchMeals(q) {
  const r = await fetch(
    `https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(q)}`
  );
  const d = await r.json();
  return (d.meals || []).slice(0, 8).map((m) => ({
    id: m.idMeal,
    name: m.strMeal,
    thumb: m.strMealThumb,
    category: m.strCategory,
    calories: null,
  }));
}

async function fetchCalories(mealName) {
  try {
    const r = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(
        mealName
      )}&api_key=${USDA_KEY}&pageSize=3&dataType=Survey%20(FNDDS)`
    );
    const d = await r.json();
    if (!d.foods?.length) return null;
    const nutrient = d.foods[0].foodNutrients?.find(
      (n) => n.nutrientId === 1008 || n.nutrientName?.toLowerCase().includes("energy")
    );
    if (!nutrient) return null;
    return Math.round(nutrient.value * 2.5); // ~250g serving estimate
  } catch { return null; }
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function MealPlanner() {
  const [weekOffset, setWeekOffset] = useState(0);
  // plan shape: { "2026-04-28": { Breakfast: [{id,name,thumb,calories}], ... } }
  const [plan, setPlan] = useState({});
  const [loaded, setLoaded] = useState(false);

  // Search panel state
  const [panel, setPanel] = useState(null); // { date, slot }
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [calLoading, setCalLoading] = useState({});
  const [addedIds, setAddedIds] = useState(new Set());

  const timer = useRef(null);
  const inputRef = useRef(null);
  const today = new Date().toISOString().split("T")[0];
  const week = getWeekDates(weekOffset);

  // ── Storage load/save ──
  useEffect(() => {
    storageGet("mp-plan-v1").then((d) => {
      if (d) setPlan(d);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (loaded) storageSet("mp-plan-v1", plan);
  }, [plan, loaded]);

  // ── Search with debounce ──
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    clearTimeout(timer.current);
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        setResults(await searchMeals(query));
      } catch { setResults([]); }
      setSearching(false);
    }, 450);
    return () => clearTimeout(timer.current);
  }, [query]);

  // ── Track already-added meals for the open panel ──
  useEffect(() => {
    if (!panel) { setAddedIds(new Set()); return; }
    const { date, slot } = panel;
    const ids = new Set(((plan[date] || {})[slot] || []).map((m) => m.id));
    setAddedIds(ids);
  }, [panel, plan]);

  // ── Calorie fetch per result item ──
  const getCalories = useCallback(async (meal) => {
    setCalLoading((p) => ({ ...p, [meal.id]: true }));
    const cal = await fetchCalories(meal.name);
    setResults((p) =>
      p.map((m) => (m.id === meal.id ? { ...m, calories: cal } : m))
    );
    setCalLoading((p) => ({ ...p, [meal.id]: false }));
  }, []);

  // ── Add meal ──
  const addMeal = useCallback(
    (meal) => {
      if (!panel) return;
      const { date, slot } = panel;
      setPlan((p) => {
        const day = p[date] || {};
        const arr = day[slot] || [];
        if (arr.find((m) => m.id === meal.id)) return p;
        return {
          ...p,
          [date]: {
            ...day,
            [slot]: [
              ...arr,
              { id: meal.id, name: meal.name, thumb: meal.thumb, calories: meal.calories },
            ],
          },
        };
      });
      setAddedIds((s) => new Set([...s, meal.id]));
    },
    [panel]
  );

  // ── Remove meal ──
  const removeMeal = useCallback((date, slot, id) => {
    setPlan((p) => ({
      ...p,
      [date]: {
        ...(p[date] || {}),
        [slot]: ((p[date] || {})[slot] || []).filter((m) => m.id !== id),
      },
    }));
  }, []);

  // ── Open/close panel ──
  const openPanel = (date, slot) => {
    setPanel({ date, slot });
    setQuery("");
    setResults([]);
    setTimeout(() => inputRef.current?.focus(), 50);
  };
  const closePanel = () => setPanel(null);

  // ── Day calorie total ──
  const dayTotal = (date) =>
    SLOTS.reduce(
      (sum, slot) =>
        sum + ((plan[date] || {})[slot] || []).reduce((s, m) => s + (m.calories || 0), 0),
      0
    );

  const weekLabel = `${fmt(week[0], { month: "short", day: "numeric" })} – ${fmt(week[6], {
    month: "short", day: "numeric", year: "numeric",
  })}`;

  if (!loaded) {
    return (
      <div style={S.loading}>
        <div style={{ fontSize: "2rem", marginBottom: 8 }}>🌿</div>
        Loading your meal plan…
      </div>
    );
  }

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={S.root}>
        {/* ── Header ── */}
        <header style={S.header}>
          <div>
            <div style={S.headerTitle}>Meal Planner</div>
            <div style={S.headerSub}>{weekLabel}</div>
          </div>
          <div style={S.weekNav}>
            <button style={S.navBtn} onClick={() => setWeekOffset((w) => w - 1)}>‹</button>
            <span style={S.navLabel}>
              {weekOffset === 0 ? "This week" : weekOffset > 0 ? `+${weekOffset}w` : `${weekOffset}w`}
            </span>
            <button style={S.navBtn} onClick={() => setWeekOffset((w) => w + 1)}>›</button>
          </div>
        </header>

        {/* ── Week Grid ── */}
        <div style={S.weekScroll}>
          {week.map((date) => {
            const isToday = date === today;
            const dayData = plan[date] || {};
            const total = dayTotal(date);
            const lbl = {
              wd: fmt(date, { weekday: "long" }),
              dt: fmt(date, { month: "short", day: "numeric" }),
            };

            return (
              <div
                key={date}
                style={{
                  ...S.dayCard,
                  ...(isToday ? S.dayCardToday : {}),
                }}
              >
                {/* Day header */}
                <div style={{ ...S.dayHead, ...(isToday ? S.dayHeadToday : {}) }}>
                  <div style={S.dayName}>{lbl.wd}</div>
                  <div style={S.dayDate}>{lbl.dt}{isToday ? " · Today" : ""}</div>
                  {total > 0 && (
                    <div style={S.dayTotal}>{total.toLocaleString()} cal</div>
                  )}
                </div>

                {/* Meal slots */}
                {SLOTS.map((slot) => {
                  const meals = dayData[slot] || [];
                  return (
                    <div key={slot} style={S.slotSection}>
                      <div style={S.slotLabel}>
                        <span style={{ fontSize: 11 }}>{SLOT_ICONS[slot]}</span>
                        {slot}
                      </div>
                      {meals.map((meal) => (
                        <div key={meal.id} style={S.mealChip}>
                          <img
                            src={`${meal.thumb}/preview`}
                            alt=""
                            style={S.mealThumb}
                            onError={(e) => { e.target.style.display = "none"; }}
                          />
                          <span style={S.mealName}>{meal.name}</span>
                          {meal.calories > 0 && (
                            <span style={S.mealCal}>{meal.calories}c</span>
                          )}
                          <button
                            style={S.removeBtn}
                            onClick={() => removeMeal(date, slot, meal.id)}
                            title="Remove"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        className="add-slot-btn"
                        onClick={() => openPanel(date, slot)}
                      >
                        + Add
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Search Panel ── */}
      {panel && (
        <div
          style={S.overlay}
          onClick={(e) => e.target === e.currentTarget && closePanel()}
        >
          <div style={S.sheet}>
            {/* Sheet header */}
            <div style={S.sheetHead}>
              <div style={{ flex: 1 }}>
                <div style={S.sheetTitle}>Add to {panel.slot}</div>
                <div style={S.sheetSub}>
                  {fmt(panel.date, { weekday: "long", month: "short", day: "numeric" })}
                </div>
              </div>
              <button style={S.closeBtn} onClick={closePanel}>✕</button>
            </div>

            {/* Search input */}
            <div style={{ padding: "10px 20px", borderBottom: "1px solid #E3D9C9" }}>
              <input
                ref={inputRef}
                style={S.searchInput}
                placeholder="Search meals — e.g. chicken, pasta, sushi…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {/* Results */}
            <div style={S.resultsList}>
              {!query && (
                <EmptyState icon="🌿" text="Type a meal name above to search" />
              )}
              {query && searching && (
                <EmptyState icon="🔍" text="Searching TheMealDB…" />
              )}
              {query && !searching && results.length === 0 && (
                <EmptyState icon="🍽️" text="No results — try a different search" />
              )}
              {results.map((meal) => {
                const added = addedIds.has(meal.id);
                return (
                  <div key={meal.id} style={S.resultItem}>
                    <img
                      src={`${meal.thumb}/preview`}
                      alt={meal.name}
                      style={S.resultThumb}
                      onError={(e) => { e.target.style.display = "none"; }}
                    />
                    <div style={S.resultInfo}>
                      <div style={S.resultName}>{meal.name}</div>
                      <div style={S.resultCat}>{meal.category}</div>
                      <div style={S.resultCal}>
                        {meal.calories
                          ? `~${meal.calories} cal/serving`
                          : "Calories not fetched"}
                      </div>
                    </div>
                    <div style={S.resultBtns}>
                      {!meal.calories && (
                        <button
                          style={S.calBtn}
                          onClick={() => getCalories(meal)}
                          disabled={calLoading[meal.id]}
                        >
                          {calLoading[meal.id] ? "…" : "Get cal"}
                        </button>
                      )}
                      <button
                        style={added ? S.addedBtn : S.addBtn}
                        onClick={() => !added && addMeal(meal)}
                      >
                        {added ? "Added ✓" : "Add"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* USDA attribution */}
            <div style={S.attribution}>
              Meal data from <strong>TheMealDB</strong> · Calories from{" "}
              <strong>USDA FoodData Central</strong> (estimated ~250g serving)
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── SUB-COMPONENTS ────────────────────────────────────────────────────────────
function EmptyState({ icon, text }) {
  return (
    <div style={{ textAlign: "center", padding: "36px 20px", color: "#877869" }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 13 }}>{text}</div>
    </div>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;0,700;1,400&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }

  .add-slot-btn {
    width: 100%;
    border: 1.5px dashed #D5CAB8;
    background: transparent;
    border-radius: 7px;
    padding: 5px 8px;
    font-size: 11px;
    color: #9E8E7A;
    cursor: pointer;
    transition: all 0.18s;
    font-family: 'DM Sans', sans-serif;
    margin-top: 2px;
  }
  .add-slot-btn:hover {
    border-color: #C4714A;
    color: #C4714A;
    background: #FDF1EC;
  }
`;

const S = {
  root: {
    minHeight: "100vh",
    background: "#F6F1E9",
    fontFamily: "'DM Sans', sans-serif",
    color: "#1E1308",
  },
  loading: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    fontFamily: "'DM Sans', sans-serif",
    color: "#877869",
    fontSize: 14,
    gap: 4,
    background: "#F6F1E9",
  },

  // Header
  header: {
    background: "#233B23",
    color: "white",
    padding: "18px 24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  headerTitle: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: "1.7rem",
    fontWeight: 700,
    letterSpacing: "0.01em",
  },
  headerSub: {
    fontSize: 11,
    opacity: 0.65,
    marginTop: 2,
    fontWeight: 300,
  },
  weekNav: { display: "flex", alignItems: "center", gap: 10 },
  navBtn: {
    width: 30, height: 30,
    borderRadius: "50%",
    border: "1.5px solid rgba(255,255,255,0.35)",
    background: "transparent",
    color: "white",
    cursor: "pointer",
    fontSize: "1rem",
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "background 0.15s",
  },
  navLabel: { fontSize: 11, opacity: 0.75, minWidth: 60, textAlign: "center" },

  // Week grid
  weekScroll: {
    display: "flex",
    gap: 10,
    overflowX: "auto",
    padding: "18px 16px 32px",
    scrollbarWidth: "thin",
  },

  // Day card
  dayCard: {
    flex: "0 0 176px",
    background: "#FFFEF9",
    borderRadius: 14,
    border: "1.5px solid #E3D9C9",
    overflow: "hidden",
    transition: "box-shadow 0.2s",
  },
  dayCardToday: {
    border: "2px solid #C4714A",
    boxShadow: "0 0 0 4px rgba(196,113,74,0.08)",
  },
  dayHead: {
    padding: "11px 13px 9px",
    borderBottom: "1.5px solid #E3D9C9",
    background: "#EEF2EE",
  },
  dayHeadToday: { background: "#FDF1EC" },
  dayName: {
    fontFamily: "'Cormorant Garamond', serif",
    fontWeight: 700,
    fontSize: "1rem",
    color: "#233B23",
  },
  dayDate: { fontSize: 10, color: "#877869", marginTop: 1 },
  dayTotal: { fontSize: 10, color: "#C4714A", fontWeight: 500, marginTop: 3 },

  // Slots
  slotSection: {
    padding: "7px 10px",
    borderBottom: "1px solid #EDE5D8",
  },
  slotLabel: {
    fontSize: 9,
    fontWeight: 500,
    color: "#9E8E7A",
    textTransform: "uppercase",
    letterSpacing: "0.09em",
    marginBottom: 4,
    display: "flex",
    alignItems: "center",
    gap: 3,
  },

  // Meal chip
  mealChip: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "#F8F4EE",
    border: "1px solid #E3D9C9",
    borderRadius: 7,
    padding: "4px 6px",
    marginBottom: 3,
  },
  mealThumb: {
    width: 26, height: 26,
    borderRadius: 5,
    objectFit: "cover",
    flexShrink: 0,
  },
  mealName: {
    fontSize: 10,
    flex: 1,
    color: "#2A1F0E",
    lineHeight: 1.3,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
  },
  mealCal: {
    fontSize: 9,
    color: "#C4714A",
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  removeBtn: {
    width: 14, height: 14,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    color: "#B0A090",
    fontSize: 12,
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
    lineHeight: 1,
    padding: 0,
  },

  // Overlay + sheet
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(20,12,4,0.5)",
    display: "flex",
    alignItems: "flex-end",
    zIndex: 50,
    animation: "none",
  },
  sheet: {
    width: "100%",
    maxHeight: "86vh",
    background: "#FFFEF9",
    borderRadius: "20px 20px 0 0",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  sheetHead: {
    padding: "18px 20px 14px",
    borderBottom: "1.5px solid #E3D9C9",
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
  },
  sheetTitle: {
    fontFamily: "'Cormorant Garamond', serif",
    fontWeight: 700,
    fontSize: "1.3rem",
    color: "#1E1308",
  },
  sheetSub: { fontSize: 11, color: "#877869", marginTop: 2 },
  closeBtn: {
    width: 30, height: 30,
    borderRadius: "50%",
    border: "1.5px solid #D5CAB8",
    background: "transparent",
    cursor: "pointer",
    fontSize: 13,
    color: "#877869",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  searchInput: {
    width: "100%",
    padding: "9px 14px",
    border: "1.5px solid #D5CAB8",
    borderRadius: 10,
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 14,
    background: "#F6F1E9",
    color: "#1E1308",
    outline: "none",
  },
  resultsList: {
    flex: 1,
    overflowY: "auto",
    padding: "8px 16px 16px",
  },
  resultItem: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1.5px solid #E3D9C9",
    marginBottom: 8,
    background: "#FFFEF9",
    transition: "border-color 0.15s",
  },
  resultThumb: {
    width: 52, height: 52,
    borderRadius: 10,
    objectFit: "cover",
    flexShrink: 0,
  },
  resultInfo: { flex: 1, minWidth: 0 },
  resultName: {
    fontSize: 13,
    fontWeight: 500,
    color: "#1E1308",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  resultCat: { fontSize: 11, color: "#877869", marginTop: 1 },
  resultCal: { fontSize: 11, color: "#C4714A", fontWeight: 500, marginTop: 2 },
  resultBtns: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    flexShrink: 0,
  },
  calBtn: {
    padding: "4px 8px",
    fontSize: 10,
    border: "1px solid #D5CAB8",
    borderRadius: 6,
    background: "transparent",
    cursor: "pointer",
    color: "#877869",
    fontFamily: "'DM Sans', sans-serif",
    whiteSpace: "nowrap",
  },
  addBtn: {
    padding: "6px 14px",
    fontSize: 12,
    border: "none",
    borderRadius: 8,
    background: "#233B23",
    color: "white",
    cursor: "pointer",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 500,
    whiteSpace: "nowrap",
    transition: "background 0.15s",
  },
  addedBtn: {
    padding: "6px 14px",
    fontSize: 12,
    border: "none",
    borderRadius: 8,
    background: "#D5EAD5",
    color: "#2D5A2D",
    cursor: "default",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  attribution: {
    padding: "8px 20px 16px",
    fontSize: 10,
    color: "#B0A090",
    borderTop: "1px solid #EDE5D8",
    textAlign: "center",
    flexShrink: 0,
  },
};
