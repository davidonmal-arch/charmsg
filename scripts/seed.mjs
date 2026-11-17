/**
 * Seeds CharMsg Firestore with demo rooms and market history.
 * Usage: FIREBASE_TOKEN=... node scripts/seed.mjs
 */

const PROJECT = "charmsg";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const TOKEN = process.env.FIREBASE_TOKEN;
if (!TOKEN) {
  console.error("FIREBASE_TOKEN is required");
  process.exit(1);
}

const now = Date.now();
const DAY = 86_400_000;
function value(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === "string") return { stringValue: x };
  if (typeof x === "boolean") return { booleanValue: x };
  if (typeof x === "number") {
    return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  }
  if (Array.isArray(x)) return { arrayValue: { values: x.map(value) } };
  if (typeof x === "object") {
    return { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, v]) => [k, value(v)])) } };
  }
  throw new Error(`Unsupported value: ${x}`);
}

async function put(path, data) {
  const res = await fetch(`${BASE}/${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: value(data).mapValue.fields })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path}: ${res.status} ${text}`);
  }
  return res.json();
}

const admin = {
  uid: "admin_farnaz",
  nick: "farnaz",
  nickLower: "farnaz",
  bio: "Создатель CharMsg. Анонимность — это свобода.",
  avatar: "./assets/logo.jpg",
  banner: "",
  isAdmin: true,
  verified: true,
  rank: 5,
  coins: 100,
  chr: 0,
  chrCost: 0,
  banned: false,
  msgCount: 0,
  seen: {},
  createdAt: now - 12 * DAY,
  lastSeen: now
};

const system = {
  uid: "system_charmsg",
  nick: "CharMsg",
  nickLower: "charmsg",
  bio: "Официальный аккаунт мессенджера. Новости, правила и обновления.",
  avatar: "./assets/logo.jpg",
  banner: "",
  isAdmin: false,
  verified: true,
  rank: 2,
  coins: 100,
  chr: 0,
  chrCost: 0,
  banned: false,
  msgCount: 0,
  seen: {},
  createdAt: now - 30 * DAY,
  lastSeen: now
};

const history = [];
for (let i = 29; i >= 0; i--) {
  const t = now - i * (DAY / 29);
  const wave = Math.sin(i / 3.4) * 0.028 + (Math.random() - 0.5) * 0.012;
  history.push({ t: Math.round(t), p: Math.round(100 * (1 + wave) * 1000) / 1000 });
}
history[history.length - 1].p = 100;

const chats = [
  {
    id: "general",
    data: {
      name: "Общий",
      desc: "Главный чат CharMsg: знакомства, мысли, всё сразу",
      emoji: "💬",
      ttl: DAY,
      isPublic: true,
      isDM: false,
      members: [],
      createdBy: "system_charmsg",
      createdAt: now - 20 * DAY,
      lastMessage: "Все сообщения исчезают по таймеру. Выбирайте комнату по вкусу.",
      lastMessageAt: now - 2.5 * 3600_000,
      lastSender: "system_charmsg"
    },
    messages: [
      {
        id: "msg_general_1",
        createdAt: now - 3.2 * 3600_000,
        uid: "system_charmsg",
        nick: "CharMsg",
        isAdmin: false,
        text: "Добро пожаловать в CharMsg — анонимный мессенджер. Ни email, ни номера: только ник и этот браузер."
      },
      {
        id: "msg_general_2",
        createdAt: now - 2.9 * 3600_000,
        uid: "admin_farnaz",
        nick: "farnaz",
        isAdmin: true,
        text: "Я farnaz ✦ — админ этого места. Ник переливается фиолетовым, чтобы меня нельзя было перепутать с кем-то ещё."
      },
      {
        id: "msg_general_3",
        createdAt: now - 2.5 * 3600_000,
        uid: "system_charmsg",
        nick: "CharMsg",
        isAdmin: false,
        text: "Все сообщения исчезают по таймеру чата: день, два, неделя или месяц. Выбирайте комнату по вкусу."
      }
    ]
  },
  {
    id: "flood",
    data: {
      name: "Флудилка",
      desc: "Мемы, музыка и ночные разговоры",
      emoji: "🔥",
      ttl: 2 * DAY,
      isPublic: true,
      isDM: false,
      members: [],
      createdBy: "system_charmsg",
      createdAt: now - 14 * DAY,
      lastMessage: "Проверка связи. Кто первый напишет — тот и легенда.",
      lastMessageAt: now - 40 * 60_000,
      lastSender: "admin_farnaz"
    },
    messages: [
      {
        id: "msg_flood_1",
        createdAt: now - 1.4 * 3600_000,
        uid: "system_charmsg",
        nick: "CharMsg",
        isAdmin: false,
        text: "Флудилка живёт 2 дня. Здесь можно всё, кроме личных данных — их лучше не публиковать."
      },
      {
        id: "msg_flood_2",
        createdAt: now - 40 * 60_000,
        uid: "admin_farnaz",
        nick: "farnaz",
        isAdmin: true,
        text: "Проверка связи. Кто первый напишет — тот и легенда."
      }
    ]
  },
  {
    id: "crypto",
    data: {
      name: "Крипто-таверна",
      desc: "CharCoin, стратегии и движение общего рынка",
      emoji: "💰",
      ttl: 7 * DAY,
      isPublic: true,
      isDM: false,
      members: [],
      createdBy: "system_charmsg",
      createdAt: now - 10 * DAY,
      lastMessage: "Боты торгуют каждые ~10 секунд. Реальные люди тоже влияют. Удачи.",
      lastMessageAt: now - 55 * 60_000,
      lastSender: "admin_farnaz"
    },
    messages: [
      {
        id: "msg_crypto_1",
        createdAt: now - 2.1 * 3600_000,
        uid: "system_charmsg",
        nick: "CharMsg",
        isAdmin: false,
        text: "CharCoin стартует со 100 CR у каждого. Цена общая: сделки двигают рынок для всех игроков."
      },
      {
        id: "msg_crypto_2",
        createdAt: now - 55 * 60_000,
        uid: "admin_farnaz",
        nick: "farnaz",
        isAdmin: true,
        text: "Боты торгуют каждые ~10 секунд. Реальные люди тоже влияют. Удачи."
      }
    ]
  },
  {
    id: "long",
    data: {
      name: "Долгие разговоры",
      desc: "Для тем, которые не хочется терять целый месяц",
      emoji: "🌙",
      ttl: 30 * DAY,
      isPublic: true,
      isDM: false,
      members: [],
      createdBy: "system_charmsg",
      createdAt: now - 8 * DAY,
      lastMessage: "Хорошее место для дневников и больших мыслей.",
      lastMessageAt: now - 50 * 60_000,
      lastSender: "system_charmsg"
    },
    messages: [
      {
        id: "msg_long_1",
        createdAt: now - 50 * 60_000,
        uid: "system_charmsg",
        nick: "CharMsg",
        isAdmin: false,
        text: "Долгая комната: сообщения живут 30 дней. Хорошее место для дневников и больших мыслей."
      }
    ]
  },
  {
    id: "club",
    data: {
      name: "Закрытый клуб",
      desc: "Приватный чат только для верифицированных администратором",
      emoji: "🔒",
      ttl: 7 * DAY,
      isPublic: true,
      isDM: false,
      verifiedOnly: true,
      members: [],
      createdBy: "system_charmsg",
      createdAt: now - 6 * DAY,
      lastMessage: "Верифицированные участники видят этот чат. Остальные — нет.",
      lastMessageAt: now - 5 * 3600_000,
      lastSender: "admin_farnaz"
    },
    messages: [
      {
        id: "msg_club_1",
        createdAt: now - 5.4 * 3600_000,
        uid: "system_charmsg",
        nick: "CharMsg",
        isAdmin: false,
        text: "Закрытый клуб. Доступ только у пользователей, которых администратор верифицировал в панели."
      },
      {
        id: "msg_club_2",
        createdAt: now - 5 * 3600_000,
        uid: "admin_farnaz",
        nick: "farnaz",
        isAdmin: true,
        text: "Верифицированные участники видят этот чат. Остальные — нет."
      }
    ]
  }
];

const pastes = [
  {
    id: "paste_farnaz",
    data: {
      title: "farnaz: Архитектор CharMsg",
      subject: "farnaz",
      subjectUid: "admin_farnaz",
      photo: "./assets/logo.jpg",
      chapters: [
        {
          id: "ch_farnaz_1",
          title: "Кто это",
          text: "farnaz — создатель CharMsg. Появился вместе с первым сообщением мессенджера и с тех пор держит это место на плаву. Его ник переливается фиолетовым, а ранг — «Архитектор»."
        },
        {
          id: "ch_farnaz_2",
          title: "Правила",
          text: "Уважать анонимность, не публиковать личные данные, не пытаться сохранять чужие переписки. За скриншоты — перманентный бан от 80 до 500 лет."
        }
      ],
      authorUid: "admin_farnaz",
      authorNick: "farnaz",
      editors: [],
      minRank: 0,
      published: true,
      publishedAt: now - 2 * DAY,
      createdAt: now - 2 * DAY,
      updatedAt: now - 2 * DAY
    }
  }
];

const nfts = [
  {
    id: "nft_genesis",
    data: {
      name: "Purple Genesis",
      description: "Первый NFT CharMsg. Фиолетовое свечение и логотип у истоков анонимного мессенджера.",
      image: "./assets/logo.jpg",
      effect: "glow",
      ownerUid: "admin_farnaz",
      ownerNick: "farnaz",
      createdBy: "admin_farnaz",
      createdByNick: "farnaz",
      forSale: true,
      price: 500,
      createdAt: now - 1 * DAY,
      updatedAt: now - 1 * DAY,
      soldAt: 0,
      lastPrice: 0,
      history: []
    }
  },
  {
    id: "nft_holo",
    data: {
      name: "Holo Signal",
      description: "Голографический сигнал из закрытого клуба. Меняет оттенок в реальном времени.",
      image: "./assets/logo.jpg",
      effect: "holo",
      ownerUid: "system_charmsg",
      ownerNick: "CharMsg",
      createdBy: "system_charmsg",
      createdByNick: "CharMsg",
      forSale: true,
      price: 250,
      createdAt: now - 12 * 3600_000,
      updatedAt: now - 12 * 3600_000,
      soldAt: 0,
      lastPrice: 0,
      history: []
    }
  }
];

const botTrades = [
  { id: "seed_bot_1", nick: "Nova", side: "buy", amountCr: 42.5, ts: now - 33 * 60_000 },
  { id: "seed_bot_2", nick: "Kryptos", side: "sell", amountCr: 61.2, ts: now - 21 * 60_000 },
  { id: "seed_bot_3", nick: "Astra", side: "buy", amountCr: 28.9, ts: now - 9 * 60_000 },
  { id: "seed_bot_4", nick: "Pixel", side: "sell", amountCr: 17.4, ts: now - 3 * 60_000 }
];

async function main() {
  await put("users/admin_farnaz", admin);
  await put("users/system_charmsg", system);
  await put("market/state", {
    price: 100,
    history,
    volume: 1842.5,
    lastTick: 0,
    bots: true,
    liq: 12000,
    floor: 1
  });

  for (const chat of chats) {
    await put(`chats/${chat.id}`, chat.data);
    for (const msg of chat.messages) {
      await put(`chats/${chat.id}/messages/${msg.id}`, {
        uid: msg.uid,
        nick: msg.nick,
        isAdmin: msg.isAdmin,
        text: msg.text,
        createdAt: msg.createdAt,
        expiresAt: msg.createdAt + chat.data.ttl
      });
    }
  }

  for (const paste of pastes) {
    await put(`pastes/${paste.id}`, paste.data);
  }

  for (const nft of nfts) {
    await put(`nfts/${nft.id}`, nft.data);
  }

  for (const t of botTrades) {
    await put(`trades/${t.id}`, {
      uid: `bot_${t.nick.toLowerCase()}`,
      nick: t.nick,
      isAdmin: false,
      isBot: true,
      side: t.side,
      amountCr: t.amountCr,
      amountChr: Math.round((t.amountCr / 100) * 1e6) / 1e6,
      price: 100,
      ts: t.ts
    });
  }

  console.log("Seed complete:", {
    chats: chats.length,
    messages: chats.reduce((n, c) => n + c.messages.length, 0),
    pastes: pastes.length,
    nfts: nfts.length,
    trades: botTrades.length
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
