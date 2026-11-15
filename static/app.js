(() => {
  const nav = document.getElementById("nav");
  const reader = document.getElementById("reader");
  const backdrop = document.getElementById("modal-backdrop");
  const modalTitle = document.getElementById("modal-title");
  const modalForm = document.getElementById("modal-form");
  const modalCancel = document.getElementById("modal-cancel");
  const modalSubmit = document.getElementById("modal-submit");
  const modalBox = backdrop.querySelector(".modal");
  const IS_STATIC = Boolean(window.__READER_STATIC__);

  let data = null;
  let level = "days";
  let modalHandler = null;
  let openDays = new Set([1]);
  let previewTimer = null;
  let philosophy = { skills: "", skillset: "" };
  let philosophyModes = { skills: "preview", skillset: "preview" };
  let philosophySaveTimers = { skills: null, skillset: null };
  let philosophyLoaded = false;

  const ICONS = {
    edit: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 17.25V20h2.75L17.81 8.94l-2.75-2.75L4 17.25zm14.71-9.04a.996.996 0 0 0 0-1.41l-1.51-1.51a.996.996 0 0 0-1.41 0l-1.18 1.18 2.75 2.75 1.35-1.01z"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6v-2z"/></svg>`,
    grip: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="1.6" fill="currentColor"/><circle cx="15" cy="7" r="1.6" fill="currentColor"/><circle cx="9" cy="12" r="1.6" fill="currentColor"/><circle cx="15" cy="12" r="1.6" fill="currentColor"/><circle cx="9" cy="17" r="1.6" fill="currentColor"/><circle cx="15" cy="17" r="1.6" fill="currentColor"/></svg>`,
  };

  let dayDrag = null;
  let reorderBusy = false;

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function iconBtn(act, title, extra = "", danger = false) {
    const icon = act.includes("delete") ? ICONS.trash : act.includes("add") || act.includes("plus") ? ICONS.plus : ICONS.edit;
    return `<button type="button" class="tool-btn${danger ? " danger" : ""}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" data-act="${act}" ${extra}>${icon}</button>`;
  }

  function canEdit() {
    return !IS_STATIC;
  }

  function staticDataUrl(url) {
    if (url === "/api/course") return "data/course.json";
    if (url === "/api/philosophy") return "data/philosophy.json";
    return null;
  }

  async function api(method, url, body) {
    let fetchUrl = url;
    if (IS_STATIC) {
      if (method !== "GET") {
        throw new Error("В опубликованной версии доступен только просмотр");
      }
      fetchUrl = staticDataUrl(url);
      if (!fetchUrl) throw new Error(`Нет статических данных для ${url}`);
    }
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(fetchUrl, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = json.detail;
      const msg =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail.map((d) => d.msg || JSON.stringify(d)).join("; ")
            : json.message || res.statusText || "Ошибка API";
      throw new Error(msg);
    }
    return json;
  }

  function applyCourse(course) {
    data = course;
    render();
  }

  function renderBlocks(nodes) {
    if (!nodes || !nodes.length) return "";
    return nodes
      .map((n) => {
        if (n.type === "p") return `<p>${n.html}</p>`;
        if (n.type === "quote") return `<blockquote class="quote">${n.html}</blockquote>`;
        if (n.type === "h3") return `<h3>${escapeHtml(n.text)}</h3>`;
        if (n.type === "h4") return `<h4>${escapeHtml(n.text)}</h4>`;
        if (n.type === "h5") return `<h5>${escapeHtml(n.text)}</h5>`;
        if (n.type === "ul") return `<ul>${n.items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
        if (n.type === "ol") return `<ol>${n.items.map((i) => `<li>${i}</li>`).join("")}</ol>`;
        if (n.type === "table") {
          const head = `<thead><tr>${(n.headers || [])
            .map((h) => `<th>${h}</th>`)
            .join("")}</tr></thead>`;
          const body = `<tbody>${(n.rows || [])
            .map(
              (row) =>
                `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`
            )
            .join("")}</tbody>`;
          return `<div class="md-table-wrap"><table class="md-table">${head}${body}</table></div>`;
        }
        return "";
      })
      .join("");
  }

  function renderPart(label, nodes, className) {
    if (!nodes || !nodes.length) return "";
    return `
      <section class="sec-part ${className}">
        <p class="sec-part-label">${escapeHtml(label)}</p>
        <div class="content">${renderBlocks(nodes)}</div>
      </section>`;
  }

  function renderSectionBody(sec) {
    const main = sec.body?.length
      ? `<div class="content sec-main">${renderBlocks(sec.body)}</div>`
      : "";
    const summary = renderPart("Резюме", sec.summary, "summary");
    return `${main}${summary}`;
  }

  function mdPreview(text) {
    if (typeof marked !== "undefined" && marked.parse) {
      return marked.parse(text || "", { breaks: true });
    }
    return `<pre>${escapeHtml(text || "")}</pre>`;
  }

  function showGoal() {
    return level !== "days";
  }

  function showStructure() {
    return level === "toc" || level === "full";
  }

  function showBodies() {
    return level === "full";
  }

  function practiceStepsOf(practice) {
    return (practice?.items || []).filter(
      (i) => i.kind === "step" || i.kind === "situation" || !i.kind || i.kind === "task"
    );
  }

  function dayTools(d) {
    if (!canEdit()) return "";
    const bits = [iconBtn("edit-day", "Изменить день", `data-day="${d.day}"`)];
    if (showStructure()) {
      bits.push(iconBtn("add-block", "Добавить блок", `data-day="${d.day}"`));
    }
    return `<div class="tool-bar">${bits.join("")}</div>`;
  }

  function blockTools(d, sec) {
    if (!canEdit() || !showStructure()) return "";
    return `<div class="tool-bar">
      ${iconBtn("edit-block", "Изменить блок", `data-day="${d.day}" data-num="${sec.number}"`)}
      ${iconBtn("delete-block", "Удалить блок", `data-day="${d.day}" data-num="${sec.number}" data-label="${escapeHtml(sec.title)}"`, true)}
    </div>`;
  }

  function practiceTools(d) {
    if (!canEdit() || !showStructure()) return "";
    return `<div class="tool-bar">
      ${iconBtn("edit-practice", "Изменить практику", `data-day="${d.day}"`)}
      ${iconBtn("add-situation", "Добавить шаг практики", `data-day="${d.day}"`)}
    </div>`;
  }

  function completionTools(d) {
    if (!canEdit() || !showStructure()) return "";
    return `<div class="tool-bar">
      ${iconBtn("edit-completion", "Изменить завершение дня", `data-day="${d.day}"`)}
    </div>`;
  }

  function situationTools(d, item) {
    if (!canEdit() || !showStructure()) return "";
    return `<div class="tool-bar">
      ${iconBtn("edit-situation", "Изменить шаг", `data-day="${d.day}" data-num="${item.number}"`)}
      ${iconBtn("delete-situation", "Удалить шаг", `data-day="${d.day}" data-num="${item.number}" data-label="${escapeHtml(item.title)}"`, true)}
    </div>`;
  }

  function renderSituation(d, item) {
    const expandable = showBodies();
    const body = expandable
      ? `<div class="item-body"><div class="content">${renderBlocks(item.body)}</div></div>`
      : "";
    return `
      <article class="item" ${expandable ? 'data-accordion="item"' : ""}>
        ${situationTools(d, item)}
        ${
          expandable
            ? `<button type="button" class="item-toggle" aria-expanded="false">
                <div>
                  <p class="sec-label">Шаг ${item.number}</p>
                  <h4 class="item-title">${escapeHtml(item.title)}</h4>
                </div>
                <span class="chev" aria-hidden="true">▾</span>
              </button>`
            : `<div class="item-head">
                <p class="sec-label">Шаг ${item.number}</p>
                <h4 class="item-title">${escapeHtml(item.title)}</h4>
              </div>`
        }
        ${body}
      </article>`;
  }

  function renderSection(d, sec) {
    if (!showStructure()) return "";

    if (sec.kind === "practice") {
      // Шаги H4 — часть практики, не отдельный раздел дня наравне с блоками
      const steps = practiceStepsOf(sec);
      const goal =
        showGoal() && sec.goal
          ? `<p class="sec-goal">${escapeHtml(sec.goal)}</p>`
          : "";
      const expandable = showBodies();
      const mainHtml =
        expandable && sec.body?.length
          ? `<div class="content sec-main">${renderBlocks(sec.body)}</div>`
          : "";
      const stepsHtml = expandable
        ? `<div class="practice-steps">
            ${
              steps.length
                ? steps.map((it) => renderSituation(d, it)).join("")
                : `<p class="empty-hint">В практике пока нет шагов (#### Шаг N.).</p>`
            }
          </div>`
        : "";
      const summaryHtml = expandable
        ? renderPart("Резюме", sec.summary, "summary")
        : "";

      return `
        <article class="sec practice" ${expandable ? 'data-accordion="sec"' : ""}>
          ${practiceTools(d)}
          ${
            expandable
              ? `<button type="button" class="sec-toggle" aria-expanded="false">
                  <div>
                    <p class="sec-label">Практика дня ${sec.number}</p>
                    <h3 class="sec-title">${escapeHtml(sec.title)}</h3>
                    ${goal}
                  </div>
                  <span class="chev" aria-hidden="true">▾</span>
                </button>
                <div class="sec-body">${mainHtml}${stepsHtml}${summaryHtml}</div>`
              : `<div class="sec-static">
                  <p class="sec-label">Практика дня ${sec.number}</p>
                  <h3 class="sec-title">${escapeHtml(sec.title)}</h3>
                  ${goal}
                </div>`
          }
        </article>`;
    }

    const goal =
      showGoal() && sec.goal
        ? `<p class="sec-goal">${escapeHtml(sec.goal)}</p>`
        : "";
    const expandable = showBodies();
    const label =
      sec.kind === "block"
        ? `Блок ${sec.number}`
        : sec.kind === "completion"
          ? "Итог"
          : "Раздел";
    const tools =
      sec.kind === "block"
        ? blockTools(d, sec)
        : sec.kind === "completion"
          ? completionTools(d)
          : "";

    return `
      <article class="sec ${escapeHtml(sec.kind)}" ${expandable ? 'data-accordion="sec"' : ""}>
        ${tools}
        ${
          expandable
            ? `<button type="button" class="sec-toggle" aria-expanded="false">
                <div>
                  <p class="sec-label">${label}</p>
                  <h3 class="sec-title">${escapeHtml(sec.title)}</h3>
                  ${goal}
                </div>
                <span class="chev" aria-hidden="true">▾</span>
              </button>
              <div class="sec-body">${renderSectionBody(sec)}</div>`
            : `<div class="sec-static">
                <p class="sec-label">${label}</p>
                <h3 class="sec-title">${escapeHtml(sec.title)}</h3>
                ${goal}
              </div>`
        }
      </article>`;
  }

  function renderDayCard(d, idx) {
    // Режим «Дни»: компактная карточка с drag-and-drop (в static — только просмотр)
    const tools = canEdit()
      ? `<div class="day-card-top">
          <button type="button" class="drag-handle" title="Перетащить день" aria-label="Перетащить день ${d.day}" data-day="${d.day}">
            ${ICONS.grip}
          </button>
          <div class="tool-bar">
            ${iconBtn("edit-day", "Изменить день", `data-day="${d.day}"`)}
          </div>
        </div>`
      : "";
    return `
      <article class="day-card" id="day-${d.day}" data-day="${d.day}" style="animation-delay:${idx * 30}ms">
        ${tools}
        <div class="day-card-body">
          <p class="day-kicker"><span class="day-num" data-num="${d.day}">День ${d.day}</span></p>
          <h2 class="day-title">${escapeHtml(d.title)}</h2>
        </div>
      </article>`;
  }

  function dayCards() {
    return [...reader.querySelectorAll(".day-card")];
  }

  function syncProvisionalDayNumbers() {
    dayCards().forEach((card, idx) => {
      const num = idx + 1;
      const label = card.querySelector(".day-num");
      if (!label) return;
      const prev = Number(label.dataset.num);
      label.dataset.num = String(num);
      label.textContent = `День ${num}`;
      if (prev && prev !== num) {
        label.classList.remove("num-pop");
        void label.offsetWidth;
        label.classList.add("num-pop");
      }
    });
  }

  function flipRead(els) {
    const map = new Map();
    els.forEach((el) => map.set(el, el.getBoundingClientRect()));
    return map;
  }

  function flipPlay(els, first, ms = 380) {
    els.forEach((el) => {
      const a = first.get(el);
      if (!a) return;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: ms, easing: "cubic-bezier(.22, 1.15, .36, 1)" }
      );
    });
  }

  function moveCardBefore(card, target, before) {
    if (!target || card === target) return false;
    const cards = dayCards();
    const from = cards.indexOf(card);
    let to = cards.indexOf(target);
    if (from < 0 || to < 0) return false;
    if (!before) to += 1;
    if (from < to) to -= 1;
    if (from === to) return false;
    const first = flipRead(cards.filter((c) => c !== card));
    if (before) target.before(card);
    else target.after(card);
    flipPlay(
      dayCards().filter((c) => c !== card && first.has(c)),
      first
    );
    syncProvisionalDayNumbers();
    return true;
  }

  function cardFromPoint(x, y, skip) {
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      const card = el.closest?.(".day-card");
      if (card && reader.contains(card) && card !== skip) return card;
    }
    return null;
  }

  function cleanupDayDrag(restore) {
    if (!dayDrag) return;
    const { card, ghost, startOrder, pointerId, onMove, onUp, onCancel } = dayDrag;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    try {
      if (card.hasPointerCapture?.(pointerId)) card.releasePointerCapture(pointerId);
    } catch (_) {}
    ghost?.remove();
    card.classList.remove("is-dragging", "is-origin");
    reader.classList.remove("is-reordering");
    document.body.classList.remove("dnd-active");
    if (restore) {
      const byDay = new Map(dayCards().map((c) => [Number(c.dataset.day), c]));
      startOrder.forEach((n) => {
        const el = byDay.get(n);
        if (el) reader.appendChild(el);
      });
      syncProvisionalDayNumbers();
    }
    dayDrag = null;
  }

  async function commitDayReorder() {
    if (!dayDrag) return;
    const startOrder = dayDrag.startOrder;
    const nextOrder = dayCards().map((c) => Number(c.dataset.day));
    const changed = nextOrder.some((n, i) => n !== startOrder[i]);
    cleanupDayDrag(false);
    if (!changed) {
      syncProvisionalDayNumbers();
      return;
    }
    reorderBusy = true;
    reader.classList.add("is-saving-order");
    try {
      const mapping = new Map();
      nextOrder.forEach((oldNum, i) => mapping.set(oldNum, i + 1));
      openDays = new Set(
        [...openDays].map((n) => mapping.get(n)).filter((n) => n != null)
      );
      const res = await api("PUT", "/api/days/reorder", { order: nextOrder });
      reader.classList.add("no-enter");
      applyCourse(res.course);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => reader.classList.remove("no-enter"));
      });
    } catch (err) {
      alert(err.message || String(err));
      try {
        applyCourse(await api("GET", "/api/course"));
      } catch (_) {
        render();
      }
    } finally {
      reorderBusy = false;
      reader.classList.remove("is-saving-order");
    }
  }

  function startDayDrag(handle, e) {
    if (level !== "days" || reorderBusy || dayDrag) return;
    if (e.button != null && e.button !== 0) return;
    const card = handle.closest(".day-card");
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add("day-card-ghost");
    ghost.removeAttribute("id");
    ghost.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    const ghostH = 200;
    ghost.classList.remove("is-origin", "is-dragging");
    ghost.style.cssText = [
      `width:${rect.width}px`,
      `height:${ghostH}px`,
      `max-height:${ghostH}px`,
      `min-height:0`,
      `overflow:hidden`,
      `transform:translate(${rect.left}px, ${rect.top}px)`,
    ].join(";");
    document.body.appendChild(ghost);

    const offsetX = e.clientX - rect.left;
    const offsetY = Math.min(Math.max(e.clientY - rect.top, 12), ghostH - 12);
    const startOrder = dayCards().map((c) => Number(c.dataset.day));

    card.classList.add("is-dragging", "is-origin");
    reader.classList.add("is-reordering");
    document.body.classList.add("dnd-active");

    const onMove = (ev) => {
      if (!dayDrag) return;
      const x = ev.clientX - dayDrag.offsetX;
      const y = ev.clientY - dayDrag.offsetY;
      const drift = ev.clientX - dayDrag.originX;
      const lift = Math.min(16, Math.hypot(drift, ev.clientY - dayDrag.originY) * 0.08);
      ghost.style.transform = `translate(${x}px, ${y}px) rotate(${drift * 0.014}deg) scale(${1.05 + lift * 0.001})`;

      const over = cardFromPoint(ev.clientX, ev.clientY, card);
      if (!over) return;
      const r = over.getBoundingClientRect();
      const midX = r.left + r.width / 2;
      const midY = r.top + r.height / 2;
      const sameRow = Math.abs(ev.clientY - midY) <= r.height * 0.55;
      const before = sameRow ? ev.clientX < midX : ev.clientY < midY;
      moveCardBefore(card, over, before);
    };

    const onUp = () => {
      commitDayReorder();
    };
    const onCancel = () => cleanupDayDrag(true);

    dayDrag = {
      card,
      ghost,
      offsetX,
      offsetY,
      originX: e.clientX,
      originY: e.clientY,
      startOrder,
      pointerId: e.pointerId,
      onMove,
      onUp,
      onCancel,
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    try {
      handle.setPointerCapture(e.pointerId);
    } catch (_) {}
  }

  function wireDayDrag() {
    if (!canEdit() || level !== "days") return;
    reader.querySelectorAll(".drag-handle").forEach((handle) => {
      handle.addEventListener("pointerdown", (e) => startDayDrag(handle, e));
    });
  }

  function renderDayGoals(d, idx) {
    // Режим «Дни + Цели»: без accordion, цель видна сразу
    const goal = d.goal
      ? `<p class="day-goal">${escapeHtml(d.goal)}</p>`
      : "";
    const tools = canEdit()
      ? `<div class="tool-bar">
          ${iconBtn("edit-day", "Изменить день", `data-day="${d.day}"`)}
        </div>`
      : "";
    return `
      <article class="day day-flat" id="day-${d.day}" style="animation-delay:${idx * 30}ms">
        ${tools}
        <div class="day-flat-body">
          <p class="day-kicker">День ${d.day}</p>
          <h2 class="day-title">${escapeHtml(d.title)}</h2>
          ${goal}
        </div>
      </article>`;
  }

  function renderDayToc(d, idx) {
    // Режим «Содержание»: структура видна сразу, без свернуть/развернуть
    const goal = d.goal
      ? `<p class="day-goal">${escapeHtml(d.goal)}</p>`
      : "";
    const sections = d.sections.map((s) => renderSection(d, s)).join("");
    return `
      <article class="day day-flat day-toc" id="day-${d.day}" style="animation-delay:${idx * 30}ms">
        ${dayTools(d)}
        <div class="day-flat-body">
          <p class="day-kicker">День ${d.day}</p>
          <h2 class="day-title">${escapeHtml(d.title)}</h2>
          ${goal}
        </div>
        <div class="day-toc-body">${sections}</div>
      </article>`;
  }

  function renderDay(d, idx) {
    // Режим «Курс полный»: accordion для тел блоков
    const isOpen = openDays.has(d.day);
    const open = isOpen ? " open" : "";
    const expanded = isOpen ? "true" : "false";
    const goal = d.goal
      ? `<p class="day-goal">${escapeHtml(d.goal)}</p>`
      : "";
    const sections = d.sections.map((s) => renderSection(d, s)).join("");

    return `
      <article class="day${open}" id="day-${d.day}" data-accordion="day" style="animation-delay:${idx * 30}ms">
        ${dayTools(d)}
        <button type="button" class="day-toggle" aria-expanded="${expanded}">
          <div>
            <p class="day-kicker">День ${d.day}</p>
            <h2 class="day-title">${escapeHtml(d.title)}</h2>
            ${goal}
          </div>
          <span class="chev" aria-hidden="true">▾</span>
        </button>
        <div class="day-body">${sections}</div>
      </article>`;
  }

  function philosophyPanel(key, title) {
    const text = philosophy[key] || "";
    if (!canEdit()) {
      return `
      <section class="phil-col" data-phil-panel="${key}">
        <div class="phil-col-head">
          <h2 class="phil-col-title">${escapeHtml(title)}</h2>
        </div>
        <article class="phil-card">
          <div class="phil-card-body">
            <div class="phil-preview content">${
              text.trim()
                ? mdPreview(text)
                : `<p class="empty-hint">Пока пусто.</p>`
            }</div>
          </div>
        </article>
      </section>`;
    }
    const mode = philosophyModes[key] || "preview";
    const isEdit = mode === "edit";
    const body = isEdit
      ? `<textarea class="phil-editor" data-phil-key="${key}" spellcheck="true">${escapeHtml(text)}</textarea>`
      : `<div class="phil-preview content">${
          text.trim()
            ? mdPreview(text)
            : `<p class="empty-hint">Пока пусто — переключись в Edit и напиши markdown.</p>`
        }</div>`;
    return `
      <section class="phil-col" data-phil-panel="${key}">
        <div class="phil-col-head">
          <h2 class="phil-col-title">${escapeHtml(title)}</h2>
        </div>
        <article class="phil-card">
          <div class="phil-card-tools">
            <div class="phil-mode-switch" role="group" aria-label="Режим ${escapeHtml(title)}">
              <button type="button" class="phil-mode-btn${isEdit ? " active" : ""}" data-phil-mode="edit" data-phil-key="${key}">Edit</button>
              <button type="button" class="phil-mode-btn${!isEdit ? " active" : ""}" data-phil-mode="preview" data-phil-key="${key}">Preview</button>
            </div>
          </div>
          <div class="phil-card-body">${body}</div>
        </article>
      </section>`;
  }

  function renderPhilosophy() {
    reader.classList.remove("days-grid", "goals-list");
    reader.classList.add("phil-split");
    document.querySelector(".layout")?.classList.add("layout-phil");
    nav.hidden = true;
    nav.innerHTML = "";
    reader.innerHTML = `
      <div class="phil-grid">
        ${philosophyPanel("skills", "Сквозные навыки")}
        ${philosophyPanel("skillset", "Уникальные навыки 7 дней")}
      </div>`;
    wirePhilosophy();
  }

  function schedulePhilosophySave(key, value) {
    philosophy[key] = value;
    if (philosophySaveTimers[key]) clearTimeout(philosophySaveTimers[key]);
    philosophySaveTimers[key] = setTimeout(async () => {
      try {
        const res = await api("PUT", `/api/philosophy/${key}`, { body_md: philosophy[key] });
        if (res.philosophy) philosophy = { ...philosophy, ...res.philosophy };
      } catch (err) {
        alert(err.message || String(err));
      }
    }, 450);
  }

  function wirePhilosophy() {
    reader.querySelectorAll(".phil-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.philKey;
        const mode = btn.dataset.philMode;
        if (!key || !mode || philosophyModes[key] === mode) return;
        reader.querySelectorAll(".phil-editor").forEach((ta) => {
          philosophy[ta.dataset.philKey] = ta.value;
        });
        philosophyModes[key] = mode;
        renderPhilosophy();
        if (mode === "edit") {
          const ta = reader.querySelector(`.phil-editor[data-phil-key="${key}"]`);
          if (ta) ta.focus();
        }
      });
    });
    reader.querySelectorAll(".phil-editor").forEach((ta) => {
      const key = ta.dataset.philKey;
      ta.addEventListener("input", () => schedulePhilosophySave(key, ta.value));
      ta.addEventListener("blur", () => schedulePhilosophySave(key, ta.value));
    });
  }

  async function ensurePhilosophy() {
    if (philosophyLoaded) return;
    philosophy = await api("GET", "/api/philosophy");
    philosophyLoaded = true;
  }

  function render() {
    const expandAll = document.getElementById("expand-all");
    const collapseAll = document.getElementById("collapse-all");
    const layout = document.querySelector(".layout");

    if (level === "philosophy") {
      if (expandAll) expandAll.hidden = true;
      if (collapseAll) collapseAll.hidden = true;
      ensurePhilosophy()
        .then(() => renderPhilosophy())
        .catch((err) => {
          reader.classList.add("phil-split");
          layout?.classList.add("layout-phil");
          nav.hidden = true;
          reader.innerHTML = `<p class="loading">Ошибка философии: ${escapeHtml(err.message)}</p>`;
        });
      return;
    }

    layout?.classList.remove("layout-phil");
    reader.classList.remove("phil-split");
    nav.hidden = false;

    if (!data || !Array.isArray(data.days)) {
      reader.innerHTML = "<p class='loading'>Не удалось загрузить курс.</p>";
      return;
    }
    nav.innerHTML = data.days
      .map((d) => `<a href="#day-${d.day}" data-day="${d.day}">День ${d.day}</a>`)
      .join("");

    const canAccordion = showBodies();
    if (expandAll) expandAll.hidden = !canAccordion;
    if (collapseAll) collapseAll.hidden = !canAccordion;

    reader.classList.toggle("days-grid", level === "days");
    reader.classList.toggle("goals-list", level === "goals");

    if (level === "days") {
      reader.innerHTML = data.days.map((d, idx) => renderDayCard(d, idx)).join("");
      wireDayDrag();
    } else if (level === "goals") {
      reader.innerHTML = data.days.map((d, idx) => renderDayGoals(d, idx)).join("");
    } else if (level === "toc") {
      reader.innerHTML = data.days.map((d, idx) => renderDayToc(d, idx)).join("");
    } else {
      reader.innerHTML = data.days.map((d, idx) => renderDay(d, idx)).join("");
    }
    syncNav();
  }

  function setOpen(el, open) {
    el.classList.toggle("open", open);
    const toggle = el.querySelector(
      ":scope > .day-toggle, :scope > .sec-toggle, :scope > .item-toggle"
    );
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (el.dataset.accordion === "day") {
      const id = Number(el.id.replace("day-", ""));
      if (open) openDays.add(id);
      else openDays.delete(id);
    }
  }

  function closeModal() {
    backdrop.hidden = true;
    modalHandler = null;
    modalForm.innerHTML = "";
    modalForm.classList.remove("form-quad", "form-practice-edit");
    modalBox.classList.remove("modal-wide", "modal-fullscreen");
    if (previewTimer) clearTimeout(previewTimer);
  }

  function field(name, label, value, multiline, rows) {
    if (multiline) {
      return `<div class="field"><label for="f-${name}">${label}</label><textarea id="f-${name}" name="${name}" rows="${rows || 4}">${escapeHtml(value || "")}</textarea></div>`;
    }
    return `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" value="${escapeHtml(value || "")}" /></div>`;
  }

  function mdField(name, label, value, rows) {
    return `
      <div class="field md-field">
        <label for="f-${name}">${label}</label>
        <div class="md-split">
          <textarea id="f-${name}" name="${name}" class="md-source" rows="${rows || 14}">${escapeHtml(value || "")}</textarea>
          <div class="md-preview content" id="preview-${name}" aria-live="polite"></div>
        </div>
      </div>`;
  }

  function splitBlockBody(bodyMd) {
    const lines = String(bodyMd || "").split(/\r?\n/);
    const idx = lines.findIndex((l) => /^\*\*Ситуация\s+\d+\./.test(l.trim()));
    if (idx < 0) {
      return { content_md: String(bodyMd || "").trim(), situation_md: "" };
    }
    return {
      content_md: lines.slice(0, idx).join("\n").replace(/\s+$/, ""),
      situation_md: lines.slice(idx).join("\n").trim(),
    };
  }

  function joinBlockBody(contentMd, situationMd) {
    const content = String(contentMd || "").trim();
    const situation = String(situationMd || "").trim();
    if (content && situation) return `${content}\n\n${situation}`;
    return content || situation;
  }

  function wirePreview(name) {
    const source = modalForm.querySelector(`#f-${name}`);
    const preview = modalForm.querySelector(`#preview-${name}`);
    if (!source || !preview) return;
    const update = () => {
      preview.innerHTML = mdPreview(source.value);
    };
    update();
    source.addEventListener("input", () => {
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(update, 120);
    });
  }

  function openModal({
    title,
    fieldsHtml,
    submitLabel,
    onSubmit,
    danger,
    wide,
    fullscreen,
    formClass,
    previewNames,
  }) {
    modalTitle.textContent = title;
    modalForm.innerHTML = fieldsHtml;
    modalForm.className = "modal-form";
    if (formClass) modalForm.classList.add(formClass);
    modalSubmit.textContent = submitLabel || "Сохранить";
    modalSubmit.className = danger ? "ghost danger-submit" : "primary";
    modalBox.classList.toggle("modal-wide", Boolean(wide) && !fullscreen);
    modalBox.classList.toggle("modal-fullscreen", Boolean(fullscreen));
    modalHandler = onSubmit;
    backdrop.hidden = false;
    (previewNames || []).forEach(wirePreview);
    const first = modalForm.querySelector("input, textarea");
    if (first) first.focus();
  }

  async function afterMutation(res) {
    if (res.course) applyCourse(res.course);
    else applyCourse(await api("GET", "/api/course"));
    closeModal();
  }

  reader.addEventListener("click", async (e) => {
    const actBtn = e.target.closest("[data-act]");
    if (actBtn && reader.contains(actBtn)) {
      e.preventDefault();
      e.stopPropagation();
      const act = actBtn.dataset.act;
      const dayNum = Number(actBtn.dataset.day);
      const day = data.days.find((d) => d.day === dayNum);

      if (act === "edit-day") {
        openModal({
          title: `День ${dayNum}`,
          fieldsHtml:
            field("title", "Название дня", day.title) +
            field("goal", "Цель дня", day.goal, true, 5),
          onSubmit: async (fd) => {
            await afterMutation(
              await api("PATCH", `/api/days/${dayNum}`, {
                title: fd.get("title"),
                goal: fd.get("goal"),
              })
            );
          },
        });
        return;
      }

      if (act === "add-block") {
        openModal({
          title: `День ${dayNum} · Новый блок`,
          fullscreen: true,
          formClass: "form-quad",
          previewNames: ["content_md", "situation_md", "summary_md"],
          fieldsHtml:
            `<div class="quad-meta">` +
            field("title", "Название блока", "") +
            field("goal", "Цель блока", "", true, 2) +
            `</div>` +
            `<div class="quad-grid">` +
            mdField("content_md", "Основная часть", "", 8) +
            mdField("situation_md", "Ситуация", "**Ситуация N. Название**\n\n", 8) +
            mdField("summary_md", "Резюме", "", 8) +
            `</div>`,
          submitLabel: "Добавить",
          onSubmit: async (fd) => {
            await afterMutation(
              await api("POST", `/api/days/${dayNum}/blocks`, {
                title: fd.get("title"),
                goal: fd.get("goal"),
                body_md: joinBlockBody(fd.get("content_md"), fd.get("situation_md")),
                summary_md: fd.get("summary_md"),
              })
            );
          },
        });
        return;
      }

      if (act === "edit-block") {
        const num = Number(actBtn.dataset.num);
        const block = day.sections.find((s) => s.kind === "block" && s.number === num);
        const parts = splitBlockBody(block.body_md || "");
        openModal({
          title: `День ${dayNum} · Блок ${num}. ${block.title || ""}`.trim(),
          fullscreen: true,
          formClass: "form-quad",
          previewNames: ["content_md", "situation_md", "summary_md"],
          fieldsHtml:
            `<div class="quad-meta">` +
            field("title", "Название блока", block.title) +
            field("goal", "Цель блока", block.goal, true, 2) +
            `</div>` +
            `<div class="quad-grid">` +
            mdField("content_md", "Основная часть", parts.content_md || "", 8) +
            mdField("situation_md", "Ситуация", parts.situation_md || "", 8) +
            mdField("summary_md", "Резюме", block.summary_md || "", 8) +
            `</div>`,
          onSubmit: async (fd) => {
            await afterMutation(
              await api("PATCH", `/api/days/${dayNum}/blocks/${num}`, {
                title: fd.get("title"),
                goal: fd.get("goal"),
                body_md: joinBlockBody(fd.get("content_md"), fd.get("situation_md")),
                summary_md: fd.get("summary_md"),
              })
            );
          },
        });
        return;
      }

      if (act === "delete-block") {
        const num = Number(actBtn.dataset.num);
        openModal({
          title: "Удалить блок?",
          fieldsHtml: `<p class="confirm-text">Удалить блок «${escapeHtml(actBtn.dataset.label)}»? Текст блока будет удалён из файла дня.</p>`,
          submitLabel: "Удалить",
          danger: true,
          onSubmit: async () => {
            await afterMutation(await api("DELETE", `/api/days/${dayNum}/blocks/${num}`));
          },
        });
        return;
      }

      if (act === "edit-practice") {
        const practice = day.sections.find((s) => s.kind === "practice");
        openModal({
          title: `День ${dayNum} · Практика${practice?.title ? `. ${practice.title}` : ""}`,
          fullscreen: true,
          formClass: "form-practice-edit",
          previewNames: ["body_md", "summary_md"],
          fieldsHtml:
            `<div class="quad-meta">` +
            field("title", "Название практики", practice?.title || "") +
            field("goal", "Цель практики", practice?.goal || "", true, 2) +
            `</div>` +
            `<div class="practice-edit-grid">` +
            mdField("body_md", "Ввод / содержание практики", practice?.body_md || "", 8) +
            mdField("summary_md", "Резюме", practice?.summary_md || "", 8) +
            `</div>`,
          onSubmit: async (fd) => {
            await afterMutation(
              await api("PATCH", `/api/days/${dayNum}/practice`, {
                title: fd.get("title"),
                goal: fd.get("goal"),
                body_md: fd.get("body_md"),
                summary_md: fd.get("summary_md"),
              })
            );
          },
        });
        return;
      }

      if (act === "edit-completion") {
        const completion = day.sections.find((s) => s.kind === "completion");
        openModal({
          title: `Завершение дня ${dayNum}`,
          wide: true,
          previewNames: ["body_md"],
          fieldsHtml: mdField(
            "body_md",
            "Содержание завершения дня (Markdown)",
            completion?.body_md || ""
          ),
          onSubmit: async (fd) => {
            await afterMutation(
              await api("PATCH", `/api/days/${dayNum}/completion`, {
                body_md: fd.get("body_md"),
              })
            );
          },
        });
        return;
      }

      if (act === "add-situation") {
        openModal({
          title: `Новый шаг · день ${dayNum}`,
          wide: true,
          previewNames: ["body_md"],
          fieldsHtml:
            field("title", "Название шага", "") +
            mdField("body_md", "Содержание шага (Markdown)", ""),
          submitLabel: "Добавить",
          onSubmit: async (fd) => {
            await afterMutation(
              await api("POST", `/api/days/${dayNum}/practice/steps`, {
                title: fd.get("title"),
                body_md: fd.get("body_md"),
              })
            );
          },
        });
        return;
      }

      if (act === "edit-situation") {
        const num = Number(actBtn.dataset.num);
        const practice = day.sections.find((s) => s.kind === "practice");
        const item = practiceStepsOf(practice).find((i) => i.number === num);
        openModal({
          title: `Шаг ${num}`,
          wide: true,
          previewNames: ["body_md"],
          fieldsHtml:
            field("title", "Название шага", item.title) +
            mdField("body_md", "Содержание шага (Markdown)", item.body_md || ""),
          onSubmit: async (fd) => {
            await afterMutation(
              await api("PATCH", `/api/days/${dayNum}/practice/steps/${num}`, {
                title: fd.get("title"),
                body_md: fd.get("body_md"),
              })
            );
          },
        });
        return;
      }

      if (act === "delete-situation") {
        const num = Number(actBtn.dataset.num);
        openModal({
          title: "Удалить шаг?",
          fieldsHtml: `<p class="confirm-text">Удалить шаг «${escapeHtml(actBtn.dataset.label)}»?</p>`,
          submitLabel: "Удалить",
          danger: true,
          onSubmit: async () => {
            await afterMutation(
              await api("DELETE", `/api/days/${dayNum}/practice/steps/${num}`)
            );
          },
        });
        return;
      }
    }

    const btn = e.target.closest(
      "button.day-toggle, button.sec-toggle, button.item-toggle"
    );
    if (!btn || !reader.contains(btn)) return;
    const box = btn.closest("[data-accordion]");
    if (!box) return;
    setOpen(box, !box.classList.contains("open"));
  });

  modalForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!modalHandler) return;
    modalSubmit.disabled = true;
    try {
      await modalHandler(new FormData(modalForm));
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      modalSubmit.disabled = false;
    }
  });

  modalCancel.addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !backdrop.hidden) closeModal();
  });

  document.querySelectorAll(".level-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      level = btn.dataset.level;
      document
        .querySelectorAll(".level-btn")
        .forEach((b) => b.classList.toggle("active", b === btn));
      render();
    });
  });

  document.getElementById("expand-all").addEventListener("click", () => {
    reader.querySelectorAll("[data-accordion]").forEach((el) => setOpen(el, true));
  });
  document.getElementById("collapse-all").addEventListener("click", () => {
    reader.querySelectorAll("[data-accordion]").forEach((el) => setOpen(el, false));
  });

  function syncNav() {
    const all = [...nav.querySelectorAll("a")];
    const y = window.scrollY + 120;
    let current = all[0];
    for (const a of all) {
      const el = document.getElementById(`day-${a.dataset.day}`);
      if (el && el.offsetTop <= y) current = a;
    }
    all.forEach((a) => a.classList.toggle("active", a === current));
  }

  nav.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-day]");
    if (!a) return;
    e.preventDefault();
    const day = document.getElementById(`day-${a.dataset.day}`);
    if (!day) return;
    setOpen(day, true);
    day.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  window.addEventListener("scroll", syncNav, { passive: true });

  api("GET", "/api/course")
    .then(applyCourse)
    .catch((err) => {
      const hint = IS_STATIC
        ? "Проверьте, что рядом лежат <code>data/course.json</code>."
        : "Запустите <code>python start.py</code>.";
      reader.innerHTML = `<p class="loading">Ошибка загрузки: ${escapeHtml(err.message)}. ${hint}</p>`;
    });
})();
