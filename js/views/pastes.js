import { state, onChange, userOf } from "../state.js";
import {
  canEditPaste,
  canViewPaste,
  createPaste,
  deletePaste,
  findUserByNick,
  pasteMinRank,
  savePaste,
  setPasteEditors,
  setPastePublished
} from "../store.js";
import { confirmDialog, openModal } from "../ui.js";
import {
  RANKS,
  avatarData,
  escapeHtml,
  fmtRelative,
  imageFileToDataUrl,
  nickHtml,
  rankBadge,
  rankInfo,
  rankOf,
  safeUrl,
  toast,
  verifiedBadge
} from "../util.js";

const FILTERS = [
  { key: "all", label: "Все" },
  { key: "published", label: "Опубликованные" },
  { key: "drafts", label: "Черновики" },
  { key: "mine", label: "Мои" }
];

function chaptersCount(paste) {
  return Array.isArray(paste?.chapters) ? paste.chapters.length : 0;
}

function coverHtml(paste, className = "paste-cover") {
  const photo = safeUrl(paste?.photo || "");
  if (photo) return `<div class="${className}"><img src="${escapeHtml(photo)}" alt="" loading="lazy" /></div>`;
  return `<div class="${className} paste-cover-empty"><span>${escapeHtml((paste?.title || "?").slice(0, 2).toUpperCase())}</span></div>`;
}

export function mountPastes(container) {
  const local = {
    selectedId: null,
    search: "",
    filter: "all",
    openedOnce: false
  };

  container.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">архив личностей</div>
        <h1 class="page-title">Пасты</h1>
        <p class="page-sub">Досье на людей CharMsg: название, фото и главы. Автор может открыть редактирование другим, опубликовать пасту или снять её с публикации.</p>
      </div>
      <div class="row wrap">
        <span class="badge" id="pasteCount">0</span>
        <button class="btn btn-primary" id="newPasteBtn" type="button">Создать пасту</button>
      </div>
    </div>

    <div class="pastes-layout" id="pastesLayout">
      <aside class="paste-sidebar card">
        <div class="search-wrap">
          <input class="input" id="pasteSearch" placeholder="Поиск по названию, человеку, автору" autocomplete="off" />
        </div>
        <div class="seg paste-filters" id="pasteFilters">
          ${FILTERS.map((f) => `<button type="button" class="seg-btn ${f.key === "all" ? "active" : ""}" data-filter="${f.key}">${f.label}</button>`).join("")}
        </div>
        <div class="paste-list" id="pasteList"></div>
      </aside>

      <section class="paste-reader card" id="pasteReader"></section>
    </div>`;

  const layout = container.querySelector("#pastesLayout");
  const listEl = container.querySelector("#pasteList");
  const readerEl = container.querySelector("#pasteReader");
  const searchEl = container.querySelector("#pasteSearch");
  const countEl = container.querySelector("#pasteCount");
  const filtersEl = container.querySelector("#pasteFilters");

  function canSee(paste) {
    if (!paste) return false;
    if (!paste.published && !canEditPaste(paste, state.profile)) return false;
    return canViewPaste(paste, state.profile);
  }

  function visiblePastes() {
    const q = local.search.trim().toLowerCase();
    return (state.pastes || []).filter((paste) => {
      if (!canSee(paste)) return false;
      if (local.filter === "published" && !paste.published) return false;
      if (local.filter === "drafts" && paste.published) return false;
      if (local.filter === "mine" && paste.authorUid !== state.uid && !(paste.editors || []).includes(state.uid)) return false;
      if (!q) return true;
      return `${paste.title || ""} ${paste.subject || ""} ${paste.authorNick || ""}`.toLowerCase().includes(q);
    });
  }

  function authorOf(paste) {
    return userOf(paste.authorUid) || { nick: paste.authorNick || "Аноним", avatar: "", rank: 0, verified: false, isAdmin: false };
  }

  function renderList() {
    const pastes = visiblePastes();
    const total = (state.pastes || []).filter(canSee).length;
    countEl.textContent = `${total}`;
    if (!pastes.length) {
      listEl.innerHTML = `<div class="empty" style="min-height:180px"><p>Пока нет паст${local.search ? " по этому запросу" : ""}. Создайте первую — она может стать легендой.</p></div>`;
      return;
    }
    listEl.innerHTML = pastes
      .map((paste) => {
        const author = authorOf(paste);
        return `<article class="paste-card ${paste.id === local.selectedId ? "active" : ""}" data-paste="${paste.id}" role="button" tabindex="0">
          ${coverHtml(paste, "paste-thumb")}
          <div class="paste-card-body">
            <div class="paste-card-top">
              <h3>${escapeHtml(paste.title || "Без названия")}</h3>
              <span class="badge ${paste.published ? "solid" : ""}">${paste.published ? "опубликована" : "черновик"}</span>
            </div>
            <div class="paste-card-subject">${paste.subject ? escapeHtml(paste.subject) : '<span class="muted">человек не указан</span>'}</div>
            <div class="paste-card-meta">
              ${avatarData(author.nick, author.avatar, 20)}
              <span>${escapeHtml(author.nick || "Аноним")}</span>
              ${rankBadge(author.rank, { compact: true })}
              <span>· ${chaptersCount(paste)} ${chaptersCount(paste) === 1 ? "глава" : "глав"}</span>
              ${pasteMinRank(paste) > 0 ? `<span class="badge rank-lock">🔒 ${escapeHtml(rankInfo(pasteMinRank(paste)).name)}</span>` : ""}
              <span>· ${fmtRelative(paste.updatedAt)}</span>
            </div>
          </div>
        </article>`;
      })
      .join("");
  }

  function chapterHtml(chapter, index) {
    return `<article class="paste-chapter">
      <div class="paste-chapter-no">${String(index + 1).padStart(2, "0")}</div>
      <div class="paste-chapter-body">
        <h3 class="paste-chapter-title">${escapeHtml(chapter.title || "Без названия")}</h3>
        <p class="paste-chapter-text">${escapeHtml(chapter.text || "")}</p>
      </div>
    </article>`;
  }

  function renderReader() {
    const paste = (state.pastes || []).find((p) => p.id === local.selectedId);
    if (!paste) {
      layout.classList.remove("reader-open");
      readerEl.innerHTML = `<div class="paste-empty empty">
        <div class="empty-logo"><img src="./assets/logo.jpg" alt="" /></div>
        <h3>Выберите пасту</h3>
        <p>Пасты — это досье на человека: фото, название и главы с большим заголовком и текстом. Их можно писать вместе.</p>
      </div>`;
      return;
    }
    layout.classList.add("reader-open");
    const author = authorOf(paste);
    const editors = (paste.editors || []).map((uid) => userOf(uid) || { uid, nick: uid }).filter(Boolean);
    const editable = canEditPaste(paste, state.profile);
    const isOwner = state.profile?.isAdmin || paste.authorUid === state.uid;
    const chapters = Array.isArray(paste.chapters) ? paste.chapters : [];

    readerEl.innerHTML = `
      <button class="btn btn-sm btn-ghost paste-back" id="pasteBack" type="button">← К списку</button>
      <div class="paste-hero">
        ${coverHtml(paste, "paste-hero-cover")}
        <div class="paste-hero-body">
          <div class="row wrap" style="gap:7px">
            <span class="badge ${paste.published ? "solid" : ""}">${paste.published ? "опубликована" : "черновик"}</span>
            <span class="badge">${chapters.length} ${chapters.length === 1 ? "глава" : "глав"}</span>
            ${pasteMinRank(paste) > 0 ? `<span class="badge rank-lock">🔒 просмотр с ранга «${escapeHtml(rankInfo(pasteMinRank(paste)).name)}»</span>` : '<span class="badge">открыта всем</span>'}
            <span class="badge">обновлено ${fmtRelative(paste.updatedAt)}</span>
          </div>
          <h2 class="paste-title">${escapeHtml(paste.title || "Без названия")}</h2>
          ${paste.subject ? `<div class="paste-subject">паста на человека: <b>${escapeHtml(paste.subject)}</b></div>` : ""}
          <div class="paste-author">
            ${avatarData(author.nick, author.avatar, 30)}
            <div>
              <div class="row" style="gap:6px">${nickHtml(author.nick || "Аноним", author.isAdmin)}${rankBadge(author.rank, { compact: true })}${verifiedBadge(author.verified, { compact: true })}</div>
              <div class="hint">автор · ${escapeHtml(fmtRelative(paste.createdAt))}</div>
            </div>
          </div>
          ${editable ? `<div class="paste-controls">
            <button class="btn btn-sm btn-primary" id="pasteEdit" type="button">Редактировать</button>
            <button class="btn btn-sm" id="pastePublish" type="button">${paste.published ? "Снять с публикации" : "Опубликовать"}</button>
            ${isOwner ? `<button class="btn btn-sm" id="pasteEditors" type="button">Редакторы · ${editors.length}</button>` : ""}
            ${isOwner ? `<button class="btn btn-sm btn-danger" id="pasteDelete" type="button">Удалить</button>` : ""}
          </div>` : ""}
          ${!paste.published ? `<div class="paste-draft-note">Черновик виден только автору, редакторам и админу. Нажмите «Опубликовать», чтобы паста появилась у всех.</div>` : ""}
        </div>
      </div>

      ${editors.length ? `<div class="paste-editors-line"><span class="muted">Редакторы:</span> ${editors.map((e) => `${escapeHtml(e.nick || e.uid)}`).join(", ")}</div>` : ""}

      <div class="paste-chapters">
        ${chapters.length ? chapters.map(chapterHtml).join("") : `<div class="empty" style="min-height:140px"><p>В пасте пока нет глав. Добавьте первую в редакторе.</p></div>`}
      </div>`;

    readerEl.querySelector("#pasteBack")?.addEventListener("click", () => {
      local.selectedId = null;
      renderReader();
      renderList();
    });
    readerEl.querySelector("#pasteEdit")?.addEventListener("click", () => openEditor(paste));
    readerEl.querySelector("#pastePublish")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await setPastePublished(paste.id, !paste.published);
        toast(paste.published ? "Паста снята с публикации" : "Паста опубликована", "success");
      } catch (err) {
        toast(err.message || "Не удалось изменить публикацию", "error");
        btn.disabled = false;
      }
    });
    readerEl.querySelector("#pasteDelete")?.addEventListener("click", async () => {
      const ok = await confirmDialog("Удалить пасту?", `«${paste.title || "Без названия"}» и все её главы исчезнут без возможности восстановления.`, "Удалить", true);
      if (!ok) return;
      try {
        await deletePaste(paste.id);
        local.selectedId = null;
        toast("Паста удалена", "success");
      } catch (err) {
        toast(err.message || "Не удалось удалить пасту", "error");
      }
    });
    readerEl.querySelector("#pasteEditors")?.addEventListener("click", () => openEditors(paste));
  }

  function renderAll() {
    const visible = visiblePastes();
    if (local.selectedId && !visible.some((p) => p.id === local.selectedId)) {
      local.selectedId = null;
    }
    if (!local.selectedId && visible.length && !local.openedOnce) {
      local.openedOnce = true;
      local.selectedId = visible[0].id;
    }
    renderList();
    renderReader();
  }

  function openEditor(paste = null) {
    if (!state.profile) {
      toast("Сначала создайте профиль", "error");
      return;
    }
    if (paste && !canEditPaste(paste, state.profile)) {
      toast("У вас нет прав на редактирование этой пасты", "error");
      return;
    }
    const canSetRank = !paste || state.profile.isAdmin || paste.authorUid === state.uid;
    const maxRank = state.profile.isAdmin ? RANKS.length - 1 : rankOf(state.profile);
    const draft = {
      title: paste?.title || "",
      subject: paste?.subject || "",
      photo: paste?.photo || "",
      published: !!paste?.published,
      minRank: paste ? pasteMinRank(paste) : 0,
      chapters: (paste?.chapters || []).map((c) => ({ id: c.id, title: c.title || "", text: c.text || "" }))
    };
    if (!draft.chapters.length) draft.chapters.push({ id: "new_1", title: "", text: "" });
    const rankOptions = RANKS.filter((r) => (canSetRank ? r.level <= maxRank : true));
    const selectedRank = canSetRank ? Math.min(draft.minRank, maxRank) : draft.minRank;

    const modal = openModal(
      `<button class="modal-close" data-close aria-label="Закрыть">×</button>
       <h3 class="modal-title">${paste ? "Редактировать пасту" : "Новая паста"}</h3>
       <p class="modal-sub">Название пасты, человек, на которого она написана, фото и главы. Заголовок главы показывается крупно, текст под ним — мелко.</p>
       <div class="form-grid">
         <div class="field">
           <label for="pasteTitle">Название пасты</label>
           <input class="input" id="pasteTitle" maxlength="80" placeholder="Например, Дело о ночном флуде" value="${escapeHtml(draft.title)}" />
         </div>
         <div class="field">
           <label for="pasteSubject">На человека</label>
           <input class="input" id="pasteSubject" maxlength="60" placeholder="Ник или имя человека" value="${escapeHtml(draft.subject)}" />
         </div>
       </div>

       <div class="field" style="margin-top:14px">
         <label for="pasteMinRank">Минимальный ранг для просмотра</label>
         <select class="select" id="pasteMinRank" ${canSetRank ? "" : "disabled"}>
           ${rankOptions.map((r) => `<option value="${r.level}" ${r.level === selectedRank ? "selected" : ""}>${escapeHtml(r.name)}${r.level === 0 ? " — видно всем" : ` — с ${r.level + 1}-го уровня`}</option>`).join("")}
         </select>
         <div class="hint" style="margin-top:6px">${
           canSetRank
             ? `Порог нельзя поднять выше вашего ранга «${escapeHtml(rankInfo(rankOf(state.profile)).name)}».`
             : "Менять минимальный ранг может только автор пасты или админ."
         }</div>
       </div>

       <div class="field" style="margin-top:14px">
         <label>Фото пасты</label>
         <div class="paste-photo-editor">
           <div class="paste-photo-preview" id="pastePhotoPreview"></div>
           <div class="grow">
             <div class="row wrap" style="gap:7px">
               <span class="btn btn-sm file-btn">Загрузить фото<input type="file" id="pastePhotoFile" accept="image/*" /></span>
               <button class="btn btn-sm btn-ghost" id="pastePhotoClear" type="button">Убрать</button>
             </div>
             <input class="input" id="pastePhotoUrl" placeholder="или ссылка https://…" style="margin-top:8px" />
             <div class="hint" style="margin-top:6px">Файл сжимается до 1000×700 и хранится в Firestore.</div>
           </div>
         </div>
       </div>

       <div class="field" style="margin-top:14px">
         <div class="row-between">
           <label>Главы</label>
           <button class="btn btn-sm" id="addChapterBtn" type="button">+ Добавить главу</button>
         </div>
         <div class="chapter-editor-list" id="chapterEditorList"></div>
       </div>

       <label class="check-row" style="margin-top:14px">
         <input type="checkbox" id="pastePublished" ${draft.published ? "checked" : ""} />
         <span>Опубликовать сразу — пасту увидят все</span>
       </label>

       <div class="error-text" id="pasteError"></div>
       <div class="modal-actions">
         <button class="btn btn-ghost" data-close type="button">Отмена</button>
         <button class="btn btn-primary" id="pasteSave" type="button">${paste ? "Сохранить" : "Создать пасту"}</button>
       </div>`,
      { className: "paste-editor-modal" }
    );

    const body = modal.body;
    const photoPreview = body.querySelector("#pastePhotoPreview");
    const chapterList = body.querySelector("#chapterEditorList");

    const paintPhoto = () => {
      const url = safeUrl(draft.photo);
      photoPreview.innerHTML = url
        ? `<img src="${escapeHtml(url)}" alt="" />`
        : `<span class="muted">нет фото</span>`;
      body.querySelector("#pastePhotoUrl").value = /^https?:\/\//i.test(draft.photo || "") ? draft.photo : "";
    };

    const paintChapters = () => {
      chapterList.innerHTML = draft.chapters
        .map(
          (chapter, index) => `<div class="chapter-editor" data-chapter="${index}">
            <div class="chapter-editor-head">
              <span class="badge">глава ${index + 1}</span>
              <button class="btn btn-sm btn-ghost" data-remove-chapter="${index}" type="button">Удалить</button>
            </div>
            <input class="input" data-chapter-title="${index}" maxlength="120" placeholder="Название главы — крупный текст" value="${escapeHtml(chapter.title)}" />
            <textarea class="textarea" data-chapter-text="${index}" maxlength="5000" rows="4" placeholder="Текст главы — мелкий текст под заголовком">${escapeHtml(chapter.text)}</textarea>
          </div>`
        )
        .join("");
    };

    paintPhoto();
    paintChapters();

    body.querySelector("#pastePhotoFile").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        draft.photo = await imageFileToDataUrl(file, { maxW: 1000, maxH: 700, quality: 0.8 });
        paintPhoto();
      } catch (err) {
        toast(err.message || "Не удалось обработать фото", "error");
      } finally {
        e.target.value = "";
      }
    });
    body.querySelector("#pastePhotoClear").addEventListener("click", () => {
      draft.photo = "";
      paintPhoto();
    });
    body.querySelector("#pastePhotoUrl").addEventListener("input", (e) => {
      const url = safeUrl(e.target.value);
      if (url) {
        draft.photo = url;
        paintPhoto();
      }
    });
    body.querySelector("#addChapterBtn").addEventListener("click", () => {
      draft.chapters.push({ id: `new_${Date.now()}`, title: "", text: "" });
      paintChapters();
    });
    chapterList.addEventListener("input", (e) => {
      const titleIndex = e.target.dataset.chapterTitle;
      const textIndex = e.target.dataset.chapterText;
      if (titleIndex !== undefined) draft.chapters[Number(titleIndex)].title = e.target.value;
      if (textIndex !== undefined) draft.chapters[Number(textIndex)].text = e.target.value;
    });
    chapterList.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-chapter]");
      if (!btn) return;
      const index = Number(btn.dataset.removeChapter);
      draft.chapters.splice(index, 1);
      if (!draft.chapters.length) draft.chapters.push({ id: `new_${Date.now()}`, title: "", text: "" });
      paintChapters();
    });

    body.querySelector("#pasteSave").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const errorEl = body.querySelector("#pasteError");
      errorEl.textContent = "";
      const payload = {
        title: body.querySelector("#pasteTitle").value,
        subject: body.querySelector("#pasteSubject").value,
        photo: draft.photo,
        minRank: Number(body.querySelector("#pasteMinRank").value) || 0,
        chapters: draft.chapters,
        published: body.querySelector("#pastePublished").checked
      };
      btn.disabled = true;
      btn.textContent = "Сохраняем…";
      try {
        if (paste) {
          await savePaste(paste.id, state.profile, payload);
          toast("Паста сохранена", "success");
        } else {
          const id = await createPaste(state.profile, payload);
          local.selectedId = id;
          toast("Паста создана", "success");
        }
        modal.close();
      } catch (err) {
        errorEl.textContent = err.message || "Не удалось сохранить пасту";
        btn.disabled = false;
        btn.textContent = paste ? "Сохранить" : "Создать пасту";
      }
    });
  }

  async function openEditors(paste) {
    const modal = openModal(
      `<button class="modal-close" data-close aria-label="Закрыть">×</button>
       <h3 class="modal-title">Редакторы пасты</h3>
       <p class="modal-sub">Люди из списка смогут редактировать пасту, публиковать и снимать её с публикации.</p>
       <div class="field">
         <label for="editorNick">Ник пользователя</label>
         <div class="row" style="gap:7px">
           <input class="input" id="editorNick" placeholder="Например, ТестерПро" autocomplete="off" />
           <button class="btn btn-primary btn-sm" id="addEditorBtn" type="button">Добавить</button>
         </div>
       </div>
       <div class="editor-list" id="editorList"></div>
       <div class="error-text" id="editorError"></div>
       <div class="modal-actions"><button class="btn btn-ghost btn-block" data-close type="button">Готово</button></div>`
    );
    const listEl = modal.body.querySelector("#editorList");
    const errorEl = modal.body.querySelector("#editorError");
    let editors = Array.isArray(paste.editors) ? [...paste.editors] : [];

    const paint = () => {
      listEl.innerHTML = editors.length
        ? editors
            .map((uid) => {
              const user = userOf(uid) || { uid, nick: uid };
              return `<div class="editor-row">
                ${avatarData(user.nick, user.avatar, 28)}
                <div class="grow"><div class="nick">${escapeHtml(user.nick || uid)}</div><div class="hint" style="font-size:9px">${escapeHtml(uid)}</div></div>
                <button class="btn btn-sm btn-danger" data-remove-editor="${escapeHtml(uid)}" type="button">Убрать</button>
              </div>`;
            })
            .join("")
        : `<div class="hint" style="padding:10px 0">Пока никого. Автор всегда может редактировать пасту сам.</div>`;
    };
    paint();

    modal.body.querySelector("#addEditorBtn").addEventListener("click", async () => {
      errorEl.textContent = "";
      const nick = modal.body.querySelector("#editorNick").value;
      if (!nick.trim()) return;
      try {
        const user = await findUserByNick(nick);
        if (!user) throw new Error("Пользователь с таким ником не найден");
        const uid = user.uid || user.id;
        if (uid === paste.authorUid) throw new Error("Автор и так может редактировать");
        if (editors.includes(uid)) throw new Error("Этот пользователь уже редактор");
        editors = await setPasteEditors(paste.id, [...editors, uid]);
        modal.body.querySelector("#editorNick").value = "";
        paint();
        toast("Редактор добавлен", "success");
      } catch (err) {
        errorEl.textContent = err.message || "Не удалось добавить редактора";
      }
    });
    listEl.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-remove-editor]");
      if (!btn) return;
      const uid = btn.dataset.removeEditor;
      try {
        editors = await setPasteEditors(paste.id, editors.filter((id) => id !== uid));
        paint();
        toast("Редактор убран", "success");
      } catch (err) {
        toast(err.message || "Не удалось убрать редактора", "error");
      }
    });
  }

  container.querySelector("#newPasteBtn").addEventListener("click", () => openEditor(null));
  searchEl.addEventListener("input", () => {
    local.search = searchEl.value;
    renderList();
  });
  filtersEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    local.filter = btn.dataset.filter;
    filtersEl.querySelectorAll("[data-filter]").forEach((b) => b.classList.toggle("active", b === btn));
    renderList();
  });
  listEl.addEventListener("click", (e) => {
    const card = e.target.closest("[data-paste]");
    if (!card) return;
    local.selectedId = card.dataset.paste;
    renderList();
    renderReader();
  });
  listEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest("[data-paste]");
    if (!card) return;
    e.preventDefault();
    local.selectedId = card.dataset.paste;
    renderList();
    renderReader();
  });

  const unsub = onChange(renderAll);
  renderAll();
  return () => unsub();
}
