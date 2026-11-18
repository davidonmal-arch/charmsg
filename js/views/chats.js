import {
  DAY,
  canAccessChat,
  deleteChat,
  deleteMessage,
  markSeen,
  purgeExpiredMessages,
  sendMessage,
  subscribeMessages,
  updateChatTtl,
  createPublicChat
} from "../store.js";
import { state, onChange, userOf } from "../state.js";
import { confirmDialog, openModal, openProfileModal } from "../ui.js";
import {
  avatarData,
  escapeHtml,
  fmtDay,
  fmtDuration,
  fmtRelative,
  fmtTime,
  isMobile,
  nickHtml,
  rankBadge,
  rankOf,
  scrollToBottom,
  ttlLabel,
  ttlShort,
  toast,
  verifiedBadge
} from "../util.js";

const TTL_OPTIONS = [
  { value: DAY, label: "1 день", hint: "Сообщения исчезают через 24 часа" },
  { value: 2 * DAY, label: "2 дня", hint: "Сообщения исчезают через 48 часов" },
  { value: 7 * DAY, label: "Неделя", hint: "Сообщения исчезают через 7 дней" },
  { value: 30 * DAY, label: "Месяц", hint: "Сообщения исчезают через 30 дней" }
];

const EMOJIS = ["💬", "🔥", "🎮", "🎵", "🚀", "💰", "🌙", "🍿", "🕹️", "🪐"];

export function mountChats(container) {
  const local = {
    chatId: null,
    messages: [],
    unsubMessages: null,
    search: "",
    renderedCount: 0,
    lastPurge: 0,
    lastSnapshotAt: 0
  };

  container.innerHTML = `
    <section class="chats-view" id="chatsView">
      <aside class="chat-sidebar">
        <div class="sidebar-head">
          <h2>Чаты <span class="chat-count" id="chatCount">0</span></h2>
          <button class="icon-btn primary" id="newChatBtn" title="Создать чат" aria-label="Создать чат">
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
        <div class="search-wrap">
          <input class="input" id="chatSearch" placeholder="Поиск чатов и людей" autocomplete="off" />
        </div>
        <div class="chat-list" id="chatList">
          <div class="empty" style="min-height:180px"><p>Загружаем чаты…</p></div>
        </div>
      </aside>

      <section class="chat-main" id="chatPane">
        <div class="empty chat-empty" id="chatEmpty">
          <div class="empty-logo"><img src="./assets/logo.jpg" alt="" /></div>
          <h3>Выберите чат</h3>
          <p>Публичные комнаты исчезают по таймеру. Или откройте чей-нибудь профиль и напишите в личные сообщения.</p>
        </div>

        <div class="chat-room" id="chatRoom" hidden>
          <header class="chat-head">
            <button class="icon-btn back-btn" id="chatBack" aria-label="Назад">
              <svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <div class="chat-head-avatar" id="chatAvatar"></div>
            <div class="chat-head-info">
              <h3 id="chatTitle"></h3>
              <div class="chat-head-sub">
                <span id="chatSub"></span>
                <span class="ttl-chip" id="chatTtl"></span>
              </div>
            </div>
            <div class="chat-head-actions">
              <button class="icon-btn" id="chatSettingsBtn" title="Настройки чата" aria-label="Настройки чата">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
              </button>
            </div>
          </header>

          <div class="messages" id="messages"></div>

          <div class="composer">
            <textarea id="composerInput" rows="1" maxlength="1500" placeholder="Написать сообщение…"></textarea>
            <button class="send-btn" id="sendBtn" aria-label="Отправить">
              <svg viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </button>
          </div>
          <div class="composer-note" id="composerNote"></div>
        </div>
      </section>
    </section>`;

  const view = container.querySelector("#chatsView");
  const listEl = container.querySelector("#chatList");
  const countEl = container.querySelector("#chatCount");
  const searchEl = container.querySelector("#chatSearch");
  const emptyEl = container.querySelector("#chatEmpty");
  const roomEl = container.querySelector("#chatRoom");
  const messagesEl = container.querySelector("#messages");
  const inputEl = container.querySelector("#composerInput");
  const sendBtn = container.querySelector("#sendBtn");
  const noteEl = container.querySelector("#composerNote");
  const titleEl = container.querySelector("#chatTitle");
  const subEl = container.querySelector("#chatSub");
  const ttlEl = container.querySelector("#chatTtl");
  const avatarEl = container.querySelector("#chatAvatar");

  const currentChat = () => state.chats.find((c) => c.id === local.chatId) || null;

  function otherMember(chat) {
    if (!chat?.isDM) return null;
    const otherUid = (chat.members || []).find((id) => id !== state.uid);
    return userOf(otherUid) || { uid: otherUid, nick: "Аноним", avatar: "", isAdmin: false };
  }

  function chatDisplay(chat) {
    if (!chat) return { name: "Чат", avatar: "", emoji: "💬", isDM: false };
    if (chat.isDM) {
      const other = otherMember(chat);
      return { name: other?.nick || "Аноним", avatar: other?.avatar || "", emoji: "✉️", isDM: true, other };
    }
    return { name: chat.name || "Чат", avatar: "", emoji: chat.emoji || "💬", isDM: false };
  }

  function isUnread(chat) {
    const seen = Number(state.profile?.seen?.[chat.id] || 0);
    return (chat.lastMessageAt || 0) > seen && chat.lastSender !== state.uid && chat.lastMessageAt;
  }

  function previewText(chat) {
    if (!chat.lastMessageAt) return chat.isDM ? "Личный чат — сообщения видят только двое" : "Пока тихо. Начните разговор.";
    const ttl = Number(chat.ttl) || DAY;
    if (chat.lastMessageAt + ttl < Date.now()) return "Сообщения исчезли по таймеру";
    const prefix = chat.lastSender === state.uid ? '<span class="you">Вы: </span>' : "";
    return `${prefix}${escapeHtml(chat.lastMessage || "…")}`;
  }

  function renderList() {
    const chats = (state.chats || []).filter((chat) => canAccessChat(chat, state.profile));
    countEl.textContent = chats.length;
    const q = local.search.trim().toLowerCase();
    const filtered = chats.filter((chat) => {
      if (!q) return true;
      const d = chatDisplay(chat);
      return d.name.toLowerCase().includes(q) || (chat.desc || "").toLowerCase().includes(q);
    });

    if (!chats.length) {
      listEl.innerHTML = `<div class="empty" style="min-height:200px"><p>Чатов пока нет. Создайте первый — он появится у всех.</p></div>`;
      return;
    }
    if (!filtered.length) {
      listEl.innerHTML = `<div class="empty" style="min-height:180px"><p>Ничего не найдено.</p></div>`;
      return;
    }

    const dms = filtered.filter((c) => c.isDM);
    const publicChats = filtered.filter((c) => !c.isDM);

    const itemHtml = (chat) => {
      const d = chatDisplay(chat);
      const active = chat.id === local.chatId;
      const unread = isUnread(chat);
      const av = d.isDM
        ? `<span class="chat-item-avatar">${avatarData(d.other?.nick || d.name, d.other?.avatar || "")}</span>`
        : `<span class="chat-item-avatar">${escapeHtml(d.emoji)}</span>`;
      const nameHtml = d.isDM
        ? `${nickHtml(d.other?.nick || "Аноним", d.other?.isAdmin)} ${d.other?.isAdmin ? '<span class="admin-tag" style="font-size:8px">admin</span>' : ""}`
        : escapeHtml(d.name);
      return `
        <div class="chat-item ${active ? "active" : ""}" data-chat="${chat.id}" role="button" tabindex="0">
          ${av}
          <div class="chat-item-body">
            <div class="chat-item-top">
              <div class="chat-item-name">${nameHtml}</div>
              <div class="chat-item-time">${chat.lastMessageAt ? fmtRelative(chat.lastMessageAt) : ""}</div>
            </div>
            <div class="chat-item-preview">${previewText(chat)}</div>
            <div class="chat-item-badges">
              <span class="badge">⏳ ${ttlShort(chat.ttl)}</span>
              ${chat.isDM ? '<span class="dm-tag">ЛС</span>' : ""}
              ${chat.verifiedOnly ? '<span class="dm-tag lock-tag">🔒 verified</span>' : ""}
            </div>
          </div>
          ${unread ? '<span class="unread-dot"></span>' : ""}
        </div>`;
    };

    let html = "";
    if (dms.length) {
      html += `<div class="list-label">Личные сообщения · ${dms.length}</div>`;
      html += dms.map(itemHtml).join("");
    }
    if (publicChats.length) {
      html += `<div class="list-label">Публичные чаты · ${publicChats.length}</div>`;
      html += publicChats.map(itemHtml).join("");
    }
    listEl.innerHTML = html;

    listEl.querySelectorAll("[data-chat]").forEach((node) => {
      const open = () => openChat(node.dataset.chat);
      node.addEventListener("click", open);
      node.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    });
  }

  function renderHeader() {
    const chat = currentChat();
    if (!chat) {
      roomEl.hidden = true;
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    roomEl.hidden = false;
    const d = chatDisplay(chat);
    titleEl.innerHTML = d.isDM
      ? `${nickHtml(d.other?.nick || "Аноним", d.other?.isAdmin)} ${rankBadge(rankOf(d.other), { compact: true })} ${verifiedBadge(d.other?.verified, { compact: true })} ${d.other?.isAdmin ? '<span class="admin-tag">admin</span>' : ""}`
      : `${escapeHtml(d.emoji)} ${escapeHtml(d.name)} ${chat.verifiedOnly ? '<span class="lock-tag">🔒</span>' : ""}`;
    avatarEl.innerHTML = d.isDM
      ? avatarData(d.other?.nick || d.name, d.other?.avatar || "")
      : `<span style="font-size:21px">${escapeHtml(d.emoji)}</span>`;
    const isCreator = chat.createdBy === state.uid;
    const ttl = Number(chat.ttl) || DAY;
    subEl.innerHTML = d.isDM
      ? `<span>Личный чат</span> · <span>${d.other?.isAdmin ? "администратор" : "аноним"}</span>`
      : `<span>${chat.verifiedOnly ? "Только для верифицированных" : chat.desc ? escapeHtml(chat.desc) : "Публичный чат"}</span>${isCreator || state.profile?.isAdmin ? " · <span>вы создатель</span>" : ""}`;
    const nextExpiry = local.messages.reduce((min, m) => (m.expiresAt && m.expiresAt > Date.now() ? Math.min(min, m.expiresAt) : min), Infinity);
    const countdown = Number.isFinite(nextExpiry) ? ` · ближайшее ${fmtDuration(nextExpiry - Date.now())}` : "";
    ttlEl.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> ${escapeHtml(ttlLabel(ttl))}${countdown ? escapeHtml(countdown) : ""}`;
    ttlEl.title = `Новые сообщения исчезают ${ttlLabel(ttl)}`;

    if (state.profile?.banned) {
      inputEl.disabled = true;
      sendBtn.disabled = true;
      noteEl.textContent = "Аккаунт заблокирован администратором — отправка сообщений недоступна.";
    } else {
      inputEl.disabled = false;
      noteEl.textContent = chat.verifiedOnly
        ? `Закрытый чат для верифицированных · сообщения исчезают ${ttlLabel(ttl)}`
        : `Сообщения этого чата исчезают ${ttlLabel(ttl)} · Firestore хранит данные в облаке`;
    }
  }

  function renderMessages({ scroll = false } = {}) {
    const chat = currentChat();
    if (!chat) {
      messagesEl.innerHTML = "";
      return;
    }
    const now = Date.now();
    const visible = local.messages.filter((m) => !m.expiresAt || m.expiresAt > now);
    if (!visible.length) {
      messagesEl.innerHTML = `<div class="empty" style="min-height:220px"><p>Здесь пока пусто. Первое сообщение исчезнет ${ttlLabel(Number(chat.ttl) || DAY)}.</p></div>`;
      return;
    }
    let html = "";
    let lastDay = "";
    for (const msg of visible) {
      const day = fmtDay(msg.createdAt);
      if (day !== lastDay) {
        lastDay = day;
        html += `<div class="day-sep">${escapeHtml(day)}</div>`;
      }
      const own = msg.uid === state.uid;
      const author = userOf(msg.uid);
      const nick = msg.nick || author?.nick || "Аноним";
      const avatar = author?.avatar || "";
      const isAdmin = !!msg.isAdmin || !!author?.isAdmin;
      const canDelete = own || state.profile?.isAdmin;
      html += `
        <div class="msg ${own ? "own" : ""}" data-msg="${msg.id}">
          ${own ? "" : `<div class="msg-avatar" data-uid="${escapeHtml(msg.uid)}" role="button" tabindex="0">${avatarData(nick, avatar)}</div>`}
          <div class="msg-body">
            <div class="msg-meta">
              <span class="nick ${isAdmin ? "nick-admin" : ""}" data-uid="${escapeHtml(msg.uid)}" role="button" tabindex="0">${escapeHtml(nick)}</span>
              ${rankBadge(rankOf(author), { compact: true })}
              ${verifiedBadge(author?.verified, { compact: true })}
              ${isAdmin ? '<span class="admin-tag">admin</span>' : ""}
              <span class="msg-time">${fmtTime(msg.createdAt)}</span>
            </div>
            <div class="msg-bubble">
              <div class="msg-text">${escapeHtml(msg.text)}</div>${canDelete ? `<button class="msg-delete" data-delete="${msg.id}" title="Удалить сообщение">×</button>` : ""}<div class="msg-foot">
                <span>${fmtTime(msg.createdAt)}</span>
                <svg viewBox="0 0 24 24" title="Исчезнет через ${fmtDuration((msg.expiresAt || 0) - Date.now())}"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
              </div>
            </div>
          </div>
        </div>`;
    }
    messagesEl.innerHTML = html;
    if (scroll) scrollToBottom(messagesEl);
  }

  function openChat(chatId) {
    if (!chatId) return;
    const chat = state.chats.find((c) => c.id === chatId);
    if (!chat) {
      toast("Чат не найден или удалён", "error");
      return;
    }
    if (!canAccessChat(chat, state.profile)) {
      toast("Этот чат доступен только верифицированным пользователям", "error");
      return;
    }
    if (local.chatId === chatId) {
      view.classList.add("room-open");
      renderHeader();
      return;
    }
    if (local.unsubMessages) {
      local.unsubMessages();
      local.unsubMessages = null;
    }
    local.chatId = chatId;
    local.messages = [];
    local.renderedCount = 0;
    local.lastPurge = 0;
    state.activeChatId = chatId;
    view.classList.add("room-open");
    renderHeader();
    messagesEl.innerHTML = `<div class="empty" style="min-height:200px"><div class="boot-spinner"></div><p>Загружаем сообщения…</p></div>`;
    renderList();
    markSeen(state.uid, chatId);

    local.unsubMessages = subscribeMessages(
      chatId,
      (messages) => {
        const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 90;
        const grew = messages.length > local.messages.length;
        local.messages = messages;
        local.renderedCount = messages.length;
        renderMessages({ scroll: grew ? nearBottom || messages.some((m) => m.uid === state.uid && Date.now() - m.createdAt < 4000) : true });
        renderHeader();
        markSeen(state.uid, chatId);
        const now = Date.now();
        if (now - local.lastPurge > 90_000) {
          local.lastPurge = now;
          purgeExpiredMessages(chatId).catch(() => {});
        }
      },
      (err) => {
        console.error(err);
        if (!local.messages.length) {
          const message = err.code === "functions/resource-exhausted"
            ? "Дневной лимит базы исчерпан. Сообщения загрузятся после сброса лимита."
            : "Не удалось загрузить сообщения. Приложение попробует снова.";
          messagesEl.innerHTML = `<div class="empty"><p>${message}</p></div>`;
        }
      }
    );
    if (!isMobile()) setTimeout(() => inputEl.focus(), 60);
  }

  function closeRoom() {
    if (local.unsubMessages) {
      local.unsubMessages();
      local.unsubMessages = null;
    }
    local.chatId = null;
    local.messages = [];
    state.activeChatId = null;
    view.classList.remove("room-open");
    roomEl.hidden = true;
    emptyEl.hidden = false;
    renderList();
  }

  let autoOpened = false;
  function renderAll() {
    renderList();
    if (state.activeChatId !== local.chatId && state.chats.some((chat) => chat.id === state.activeChatId)) {
      openChat(state.activeChatId);
    }
    if (local.chatId) {
      if (!state.chats.some((c) => c.id === local.chatId)) {
        closeRoom();
      } else {
        renderHeader();
      }
    }
    if (!autoOpened && !isMobile() && !state.activeChatId && state.chats.length) {
      autoOpened = true;
      const accessible = state.chats.filter((c) => canAccessChat(c, state.profile));
      const first = accessible.find((c) => c.isPublic) || accessible[0];
      if (first) openChat(first.id);
    }
  }

  // ---------- composer ----------
  function resizeInput() {
    inputEl.style.height = "auto";
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 130)}px`;
  }

  async function send() {
    const chat = currentChat();
    const text = inputEl.value.trim();
    if (!chat || !state.profile) return;
    if (state.profile.banned) {
      toast("Вы заблокированы и не можете писать", "error");
      return;
    }
    if (!text) return;
    sendBtn.disabled = true;
    try {
      await sendMessage(chat, state.profile, text);
      inputEl.value = "";
      resizeInput();
      scrollToBottom(messagesEl, true);
    } catch (err) {
      toast(err.message || "Не удалось отправить сообщение", "error");
    } finally {
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  inputEl.addEventListener("input", resizeInput);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      send();
    }
  });
  sendBtn.addEventListener("click", send);
  searchEl.addEventListener("input", () => {
    local.search = searchEl.value;
    renderList();
  });
  container.querySelector("#chatBack").addEventListener("click", closeRoom);
  container.querySelector("#chatSettingsBtn").addEventListener("click", openChatSettings);
  container.querySelector("#newChatBtn").addEventListener("click", openCreateChat);

  messagesEl.addEventListener("click", async (e) => {
    const deleteBtn = e.target.closest("[data-delete]");
    if (deleteBtn) {
      const msgId = deleteBtn.dataset.delete;
      const ok = await confirmDialog("Удалить сообщение?", "Оно исчезнет у всех участников чата без возможности восстановления.", "Удалить", true);
      if (ok && local.chatId) {
        try {
          await deleteMessage(local.chatId, msgId);
          toast("Сообщение удалено", "success");
        } catch (err) {
          toast(err.message || "Не удалось удалить", "error");
        }
      }
      return;
    }
    const nickNode = e.target.closest("[data-uid]");
    if (nickNode) openProfileModal(nickNode.dataset.uid);
  });

  messagesEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const node = e.target.closest("[data-uid]");
    if (node) {
      e.preventDefault();
      openProfileModal(node.dataset.uid);
    }
  });

  const onOpenChat = (e) => {
    const chatId = e.detail?.chatId;
    if (!chatId) return;
    if (local.chatId === chatId) {
      view.classList.add("room-open");
      return;
    }
    openChat(chatId);
  };
  window.addEventListener("charmsg:open-chat", onOpenChat);

  function openChatSettings() {
    const chat = currentChat();
    if (!chat) return;
    const canDelete = !chat.isPublic || chat.createdBy === state.uid || state.profile?.isAdmin;
    const modal = openModal(
      `<button class="modal-close" data-close aria-label="Закрыть">×</button>
       <h3 class="modal-title">Настройки чата</h3>
       <p class="modal-sub">Таймер действует на новые сообщения. Уже отправленные исчезнут по своему сроку.</p>
       <div class="field">
         <label>Время жизни сообщений</label>
         <div class="seg" id="ttlSeg">
           ${TTL_OPTIONS.map((o) => `<button type="button" class="seg-btn ${Number(chat.ttl) === o.value ? "active" : ""}" data-ttl="${o.value}">${o.label}</button>`).join("")}
         </div>
         <div class="hint" id="ttlHint">${escapeHtml(TTL_OPTIONS.find((o) => o.value === Number(chat.ttl))?.hint || "")}</div>
       </div>
       ${canDelete ? `<div class="divider"></div><button class="btn btn-danger btn-block" id="deleteChatBtn">Удалить чат целиком</button>` : ""}
       <div class="modal-actions">
         <button class="btn btn-ghost" data-close>Отмена</button>
         <button class="btn btn-primary" id="saveTtlBtn">Сохранить</button>
       </div>`
    );
    let selected = Number(chat.ttl) || DAY;
    modal.body.querySelectorAll("[data-ttl]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selected = Number(btn.dataset.ttl);
        modal.body.querySelectorAll("[data-ttl]").forEach((b) => b.classList.toggle("active", b === btn));
        const hint = TTL_OPTIONS.find((o) => o.value === selected)?.hint || "";
        modal.body.querySelector("#ttlHint").textContent = hint;
      });
    });
    modal.body.querySelector("#saveTtlBtn").addEventListener("click", async () => {
      try {
        await updateChatTtl(chat.id, selected);
        toast("Таймер обновлён", "success");
        modal.close();
      } catch (err) {
        toast(err.message || "Не удалось сохранить", "error");
      }
    });
    modal.body.querySelector("#deleteChatBtn")?.addEventListener("click", async () => {
      modal.close();
      const ok = await confirmDialog("Удалить чат?", "Все сообщения и сам чат будут удалены для всех участников.", "Удалить чат", true);
      if (!ok) return;
      try {
        await deleteChat(chat.id);
        if (local.chatId === chat.id) closeRoom();
        toast("Чат удалён", "success");
      } catch (err) {
        toast(err.message || "Не удалось удалить чат", "error");
      }
    });
  }

  function openCreateChat() {
    if (!state.profile) {
      toast("Сначала создайте профиль", "error");
      return;
    }
    const modal = openModal(
      `<button class="modal-close" data-close aria-label="Закрыть">×</button>
       <h3 class="modal-title">Новый публичный чат</h3>
       <p class="modal-sub">Чат увидят все пользователи CharMsg. Выберите, как быстро должны исчезать сообщения.</p>
       <div class="field" style="margin-bottom:13px">
         <label for="newChatName">Название</label>
         <input class="input" id="newChatName" maxlength="40" placeholder="Например, Ночной флуд" />
       </div>
       <div class="field" style="margin-bottom:13px">
         <label>Иконка</label>
         <div class="quick-row" id="emojiRow">
           ${EMOJIS.map((e, i) => `<button type="button" class="quick-btn ${i === 0 ? "active" : ""}" data-emoji="${e}" style="font-size:16px;padding:8px">${e}</button>`).join("")}
         </div>
       </div>
       <div class="field" style="margin-bottom:13px">
         <label for="newChatDesc">Описание</label>
         <input class="input" id="newChatDesc" maxlength="160" placeholder="О чём этот чат?" />
       </div>
       <div class="field">
         <label>Время жизни сообщений</label>
         <div class="seg" id="newTtlSeg">
           ${TTL_OPTIONS.map((o, i) => `<button type="button" class="seg-btn ${i === 0 ? "active" : ""}" data-ttl="${o.value}">${o.label}</button>`).join("")}
         </div>
       </div>
       <div class="error-text" id="newChatError"></div>
       <div class="modal-actions">
         <button class="btn btn-ghost" data-close>Отмена</button>
         <button class="btn btn-primary" id="createChatBtn">Создать чат</button>
       </div>`
    );
    let emoji = EMOJIS[0];
    let ttl = DAY;
    modal.body.querySelectorAll("[data-emoji]").forEach((btn) => {
      btn.addEventListener("click", () => {
        emoji = btn.dataset.emoji;
        modal.body.querySelectorAll("[data-emoji]").forEach((b) => b.classList.toggle("active", b === btn));
      });
    });
    modal.body.querySelectorAll("#newTtlSeg [data-ttl]").forEach((btn) => {
      btn.addEventListener("click", () => {
        ttl = Number(btn.dataset.ttl);
        modal.body.querySelectorAll("#newTtlSeg [data-ttl]").forEach((b) => b.classList.toggle("active", b === btn));
      });
    });
    modal.body.querySelector("#newChatName").focus();
    modal.body.querySelector("#createChatBtn").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const name = modal.body.querySelector("#newChatName").value;
      const desc = modal.body.querySelector("#newChatDesc").value;
      const errorEl = modal.body.querySelector("#newChatError");
      errorEl.textContent = "";
      btn.disabled = true;
      btn.textContent = "Создаём…";
      try {
        const id = await createPublicChat({ name, desc, emoji, ttl, uid: state.uid });
        modal.close();
        toast("Чат создан", "success");
        state.activeChatId = id;
        openChat(id);
      } catch (err) {
        errorEl.textContent = err.message || "Не удалось создать чат";
        btn.disabled = false;
        btn.textContent = "Создать чат";
      }
    });
  }

  const unsubState = onChange(renderAll);
  const timer = setInterval(() => {
    if (!local.chatId) return;
    const chat = currentChat();
    if (!chat) return;
    const before = local.messages.length;
    local.messages = local.messages.filter((m) => !m.expiresAt || m.expiresAt > Date.now());
    if (local.messages.length !== before) renderMessages();
    renderHeader();
    if (Date.now() - local.lastPurge > 90_000) {
      local.lastPurge = Date.now();
      purgeExpiredMessages(local.chatId).catch(() => {});
    }
  }, 30_000);

  renderAll();

  // auto-open first chat on desktop for a lively first screen
  if (!isMobile() && !state.activeChatId && state.chats.length) {
    const accessible = state.chats.filter((c) => canAccessChat(c, state.profile));
    const first = accessible.find((c) => c.isPublic) || accessible[0];
    if (first) openChat(first.id);
  }

  return () => {
    unsubState();
    clearInterval(timer);
    window.removeEventListener("charmsg:open-chat", onOpenChat);
    if (local.unsubMessages) local.unsubMessages();
  };
}
