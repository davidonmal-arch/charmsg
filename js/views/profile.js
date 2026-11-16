import { state, onChange } from "../state.js";
import { openAdminLoginModal, confirmDialog } from "../ui.js";
import { adminLogout, updateProfile } from "../store.js";
import {
  avatarData,
  escapeHtml,
  fmtNum,
  nickHtml,
  safeUrl,
  toast
} from "../util.js";

function cropAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Выберите изображение"));
    if (file.size > 6 * 1024 * 1024) return reject(new Error("Файл больше 6 МБ"));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Не удалось открыть изображение"));
      img.onload = () => {
        const size = 160;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function mountProfile(container) {
  let avatarValue = "";
  let initialized = false;
  let dirty = false;

  container.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">личное пространство</div>
        <h1 class="page-title">Профиль</h1>
        <p class="page-sub">Ник, аватар и описание видны другим. Ни email, ни номера телефона — только анонимный ID устройства.</p>
      </div>
      <div class="badge solid" id="profileModeBadge">аноним</div>
    </div>

    <div class="profile-grid">
      <div class="stack">
        <div class="card profile-card">
          <div class="profile-banner"></div>
          <div class="profile-body">
            <div class="profile-avatar" id="previewAvatar"></div>
            <div class="profile-name" id="previewName">Гость</div>
            <p class="profile-bio" id="previewBio">Заполните профиль ниже — и вас начнут узнавать в чатах.</p>
            <div class="profile-stats">
              <div class="mini-stat">
                <div class="mini-stat-label">Баланс</div>
                <div class="mini-stat-value" id="previewCoins">100 <small>CR</small></div>
              </div>
              <div class="mini-stat">
                <div class="mini-stat-label">CharCoin</div>
                <div class="mini-stat-value" id="previewChr">0 <small>CHR</small></div>
              </div>
              <div class="mini-stat">
                <div class="mini-stat-label">Сообщений</div>
                <div class="mini-stat-value" id="previewMsgs">0</div>
              </div>
            </div>
          </div>
        </div>

        <div class="card card-pad">
          <div class="row-between" style="margin-bottom:15px">
            <div>
              <div class="eyebrow">редактор</div>
              <div style="font-size:16px;font-weight:750;letter-spacing:-.02em;margin-top:4px">Настроить профиль</div>
            </div>
            <span class="badge">без регистрации</span>
          </div>

          <div class="editor-avatar-row" style="margin-bottom:15px">
            <div class="avatar-preview" id="editorAvatar"></div>
            <div class="grow">
              <div class="row wrap" style="gap:7px">
                <span class="btn btn-sm file-btn">Загрузить фото<input type="file" id="avatarFile" accept="image/*" /></span>
                <button class="btn btn-sm btn-ghost" id="avatarClear" type="button">Убрать</button>
              </div>
              <div class="hint" style="margin-top:7px">Квадратное изображение до 6 МБ. Хранится в Firestore как сжатый аватар 160×160.</div>
            </div>
          </div>

          <div class="form-grid">
            <div class="field">
              <label for="nickInput">Ник</label>
              <input class="input" id="nickInput" maxlength="18" placeholder="Ваш анонимный ник" autocomplete="off" />
            </div>
            <div class="field">
              <label for="avatarUrl">Ссылка на аватар</label>
              <input class="input" id="avatarUrl" placeholder="https://…" autocomplete="off" />
            </div>
            <div class="field full">
              <label for="bioInput">Описание</label>
              <textarea class="textarea" id="bioInput" maxlength="240" placeholder="Пара слов о себе. Без личных данных, если не хотите раскрываться."></textarea>
            </div>
          </div>
          <div class="error-text" id="profileError"></div>
          <div class="row" style="justify-content:flex-end;gap:8px">
            <button class="btn btn-ghost" id="profileReset" type="button">Сбросить</button>
            <button class="btn btn-primary" id="profileSave" type="button">Сохранить профиль</button>
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card card-pad">
          <div class="eyebrow">аккаунт</div>
          <div style="font-size:16px;font-weight:750;letter-spacing:-.02em;margin:4px 0 14px">Анонимная идентичность</div>
          <div class="profile-rows" style="display:flex;flex-direction:column;gap:8px">
            <div class="p-row"><span>Анонимный ID</span><b class="mono" id="accountUid" style="font-size:10.5px">—</b></div>
            <div class="p-row"><span>Режим</span><b id="accountMode">Аноним</b></div>
            <div class="p-row"><span>Чатов доступно</span><b id="accountChats">0</b></div>
          </div>
          <div class="hint" style="margin-top:12px">ID хранится только в этом браузере (localStorage). Очистка данных сайта создаст новую анонимную личность.</div>
          <button class="btn btn-ghost btn-block btn-sm" id="copyUidBtn" style="margin-top:11px">Скопировать ID</button>
          <button class="btn btn-danger btn-block btn-sm" id="newIdentityBtn" style="margin-top:7px">Новая анонимная личность</button>
        </div>

        <div class="card card-pad" id="adminCard">
          <div class="eyebrow">администрация</div>
          <div style="font-size:16px;font-weight:750;letter-spacing:-.02em;margin:4px 0 8px" id="adminCardTitle">Вход для админа</div>
          <p class="hint" id="adminCardText">Панель управления пользователями, контентом и рынком. Ник администратора переливается фиолетовым по всему сайту.</p>
          <button class="btn btn-primary btn-block" id="adminActionBtn" style="margin-top:12px">Войти как администратор</button>
        </div>

        <div class="card card-pad">
          <div class="eyebrow">приватность</div>
          <div style="font-size:16px;font-weight:750;letter-spacing:-.02em;margin:4px 0 8px">Как это работает</div>
          <p class="hint">CharMsg не просит email, телефон или соцсети. Сообщения лежат в Google Firestore и удаляются по таймеру чата. Публичные сообщения видны всем, личные — только двум участникам.</p>
        </div>
      </div>
    </div>`;

  const $ = (id) => container.querySelector(`#${id}`);
  const previewAvatar = $("previewAvatar");
  const previewName = $("previewName");
  const previewBio = $("previewBio");
  const previewCoins = $("previewCoins");
  const previewChr = $("previewChr");
  const previewMsgs = $("previewMsgs");
  const editorAvatar = $("editorAvatar");
  const nickInput = $("nickInput");
  const avatarUrl = $("avatarUrl");
  const bioInput = $("bioInput");
  const errorEl = $("profileError");
  const saveBtn = $("profileSave");
  const resetBtn = $("profileReset");
  const modeBadge = $("profileModeBadge");

  function paintAvatar(node, nick, avatar) {
    node.innerHTML = avatarData(nick, avatar, "");
  }

  function refresh() {
    const p = state.profile;
    if (!p) return;
    paintAvatar(previewAvatar, p.nick, p.avatar);
    previewName.innerHTML = `${nickHtml(p.nick || "Гость", p.isAdmin)} ${p.isAdmin ? '<span class="admin-tag">admin</span>' : ""}`;
    previewBio.textContent = p.bio || "Без описания — загадочная личность.";
    previewCoins.innerHTML = `${fmtNum(p.coins || 0)} <small>CR</small>`;
    previewChr.innerHTML = `${fmtNum(p.chr || 0, 2)} <small>CHR</small>`;
    previewMsgs.textContent = fmtNum(p.msgCount || 0);
    modeBadge.textContent = state.admin ? "админ-режим" : "аноним";
    modeBadge.classList.toggle("solid", state.admin);
    $("accountUid").textContent = p.uid || state.uid;
    $("accountMode").textContent = state.admin ? "Администратор" : "Аноним";
    $("accountChats").textContent = String(state.chats.length);

    if (!initialized) {
      initialized = true;
      if (!dirty) {
        nickInput.value = p.nick || "";
        bioInput.value = p.bio || "";
        avatarUrl.value = /^https?:\/\//i.test(p.avatar || "") ? p.avatar : "";
        avatarValue = p.avatar || "";
        paintAvatar(editorAvatar, p.nick, avatarValue);
      }
    }

    const adminTitle = $("adminCardTitle");
    const adminText = $("adminCardText");
    const adminBtn = $("adminActionBtn");
    if (state.admin) {
      adminTitle.textContent = "Вы администратор";
      adminText.textContent = "Ник farnaz переливается фиолетовым во всех чатах, профилях и на бирже. Управление доступно во вкладке «Админ».";
      adminBtn.textContent = "Выйти из админ-режима";
      adminBtn.onclick = async () => {
        const ok = await confirmDialog("Выйти из админ-режима?", "Вы вернётесь к своей анонимной личности на этом устройстве.", "Выйти");
        if (!ok) return;
        adminLogout();
        location.reload();
      };
    } else {
      adminTitle.textContent = "Вход для админа";
      adminText.textContent = "Панель управления пользователями, контентом и рынком. Ник администратора переливается фиолетовым по всему сайту.";
      adminBtn.textContent = "Войти как администратор";
      adminBtn.onclick = () => openAdminLoginModal();
    }
  }

  $("avatarFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    dirty = true;
    try {
      avatarValue = await cropAvatar(file);
      avatarUrl.value = "";
      paintAvatar(editorAvatar, nickInput.value || state.profile?.nick, avatarValue);
      toast("Аватар готов — не забудьте сохранить", "info");
    } catch (err) {
      toast(err.message || "Не удалось обработать изображение", "error");
    } finally {
      e.target.value = "";
    }
  });

  $("avatarClear").addEventListener("click", () => {
    dirty = true;
    avatarValue = "";
    avatarUrl.value = "";
    paintAvatar(editorAvatar, nickInput.value || state.profile?.nick, "");
  });

  avatarUrl.addEventListener("input", () => {
    dirty = true;
    const url = safeUrl(avatarUrl.value);
    if (url) {
      avatarValue = url;
      paintAvatar(editorAvatar, nickInput.value || state.profile?.nick, url);
    }
  });

  bioInput.addEventListener("input", () => {
    dirty = true;
  });

  nickInput.addEventListener("input", () => {
    dirty = true;
    paintAvatar(editorAvatar, nickInput.value, avatarValue);
  });

  resetBtn.addEventListener("click", () => {
    const p = state.profile;
    if (!p) return;
    dirty = false;
    nickInput.value = p.nick || "";
    bioInput.value = p.bio || "";
    avatarValue = p.avatar || "";
    avatarUrl.value = /^https?:\/\//i.test(p.avatar || "") ? p.avatar : "";
    paintAvatar(editorAvatar, p.nick, avatarValue);
    errorEl.textContent = "";
  });

  saveBtn.addEventListener("click", async () => {
    if (!state.profile) return;
    errorEl.textContent = "";
    saveBtn.disabled = true;
    saveBtn.textContent = "Сохраняем…";
    try {
      await updateProfile(state.uid, {
        nick: nickInput.value,
        bio: bioInput.value,
        avatar: avatarValue
      });
      toast("Профиль обновлён", "success");
    } catch (err) {
      errorEl.textContent = err.message || "Не удалось сохранить профиль";
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Сохранить профиль";
    }
  });

  $("copyUidBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.uid || "");
      toast("Анонимный ID скопирован", "success");
    } catch {
      toast("Не удалось скопировать", "error");
    }
  });

  $("newIdentityBtn").addEventListener("click", async () => {
    const ok = await confirmDialog(
      "Создать новую личность?",
      "Текущий профиль останется в Firestore, но этот браузер больше не будет к нему привязан. Вернуть доступ без сохранённого ID нельзя.",
      "Создать новую",
      true
    );
    if (!ok) return;
    localStorage.removeItem("charmsg_device_uid");
    localStorage.removeItem("charmsg_admin_session");
    location.reload();
  });

  const unsub = onChange(refresh);
  refresh();

  return () => unsub();
}
