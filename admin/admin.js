'use strict';

/* Админка лендинга. Контент хранится на сервере в data/content.json;
   панель редактирует его целиком и сохраняет через PUT /api/content. */

const state = {
  content: null,
  mode: 'editor',
  section: 'general',
  dirty: false,
  lang: 'ru',
  device: 'desktop',
  selection: null,
  history: [],
  future: [],
  editing: null,
  scale: 1,
  previewStale: false,
  previewScroll: null,
};

const DEVICE_WIDTH = { desktop: 1440, tablet: 768, mobile: 390 };

const $ = (selector, root = document) => root.querySelector(selector);

/* --------------------------------------------------------------- запросы */

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    /* пустой ответ */
  }

  if (!response.ok) {
    const error = new Error(data.error || 'request_failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

/* ------------------------------------------------------------------- DOM */

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  Object.entries(props || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;

    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'value') node.value = value;
    else if (key === 'checked') node.checked = Boolean(value);
    else if (key === 'disabled') node.disabled = Boolean(value);
    else if (key === 'hidden') node.hidden = Boolean(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, value);
    }
  });

  children.flat(Infinity).forEach((child) => {
    if (child === undefined || child === null || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });

  return node;
}

const p = (ru = '', kz = '') => ({ ru, kz });

function getPath(object, path) {
  if (!path) return object;
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
}

function setPath(object, path, value) {
  const keys = path.split('.');
  let current = object;
  keys.slice(0, -1).forEach((key) => {
    if (!current[key] || typeof current[key] !== 'object') current[key] = {};
    current = current[key];
  });
  current[keys[keys.length - 1]] = value;
}

function writePair(object, path, lang, value) {
  let target = getPath(object, path);
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    target = { ru: '', kz: '' };
    setPath(object, path, target);
  }
  target[lang] = value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/* -------------------------------------------------------------- состояние */

let toastTimer = null;

function toast(message, isError = false) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.toggle('is-error', isError);
  node.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-visible'), 2600);
}

function setDirty(value) {
  state.dirty = Boolean(value);
  const status = $('#status');
  status.textContent = state.dirty ? 'Есть несохранённые изменения' : 'Всё сохранено';
  status.classList.toggle('is-dirty', state.dirty);
  $('#save-btn').disabled = !state.dirty;
}

function markDirty() {
  if (!state.dirty) setDirty(true);
}

function notifyChange(ctx, path) {
  ctx.markDirty();
  if (ctx.changed) ctx.changed(path);
}

/* ---------------------------------------------------------------- схемы */

const SECTIONS = [
  {
    id: 'general',
    icon: '⚙️',
    title: 'Основное',
    subtitle: 'Название сайта, SEO-тексты, контакты и соцсети.',
    fields: [
      {
        type: 'group',
        title: 'Сайт и SEO',
        desc: 'Заголовок вкладки и описание, которое показывают поисковики.',
        fields: [
          { type: 'pair', path: 'meta.title', label: 'Title страницы', rows: 2 },
          { type: 'pair', path: 'meta.description', label: 'Meta description', rows: 3 },
          { type: 'text', path: 'brand.name', label: 'Логотип: первая часть', hint: 'Например «ЛФК»' },
          { type: 'text', path: 'brand.dot', label: 'Логотип: разделитель', hint: 'Например «·»' },
          { type: 'text', path: 'brand.city', label: 'Логотип: город', hint: 'Например «Астана»' },
        ],
      },
      {
        type: 'group',
        title: 'Контакты',
        desc: 'Телефон подставляется во все кнопки «Записаться на диагностику».',
        fields: [
          { type: 'text', path: 'contacts.phone', label: 'Телефон для ссылки tel:', hint: 'Только цифры и плюс, без пробелов: +77066887866' },
          { type: 'text', path: 'contacts.phoneDisplay', label: 'Телефон как на сайте', hint: '+7 706 688 78 66' },
          { type: 'url', path: 'contacts.booking', label: 'Ссылка онлайн-записи' },
          { type: 'url', path: 'contacts.map', label: 'Ссылка на 2ГИС' },
          { type: 'url', path: 'contacts.whatsapp', label: 'WhatsApp — иконки в шапке и подвале' },
          { type: 'url', path: 'contacts.whatsappBooking', label: 'WhatsApp — кнопка в форме записи' },
        ],
      },
      {
        type: 'list',
        path: 'socials',
        label: 'Соцсети',
        addLabel: 'Добавить соцсеть',
        itemTitle: (item, index) => item.label || `Соцсеть ${index + 1}`,
        blank: { label: 'Новая соцсеть', icon: '/assets/icons/instagram.svg', url: '' },
        fields: [
          { type: 'text', path: 'label', label: 'Название' },
          { type: 'image', path: 'icon', label: 'Иконка' },
          { type: 'url', path: 'url', label: 'Ссылка', hint: 'Если пусто, иконка показывается неактивной.' },
        ],
      },
    ],
  },
  {
    id: 'hero',
    icon: '🖼️',
    title: 'Главный экран',
    subtitle: 'Первый экран сайта: заголовок, кнопка и фотография.',
    fields: [
      {
        type: 'group',
        title: 'Тексты',
        fields: [
          { type: 'pair', path: 'hero.title', label: 'Заголовок', rows: 3, html: true },
          { type: 'pair', path: 'hero.subtitle', label: 'Подзаголовок', rows: 2, html: true },
          { type: 'pair', path: 'hero.cta', label: 'Текст кнопки' },
        ],
      },
      {
        type: 'group',
        title: 'Фотография',
        fields: [
          { type: 'image', path: 'hero.photo', label: 'Фото главного экрана' },
          { type: 'pair', path: 'hero.photoAlt', label: 'Alt-текст', hint: 'Описание фото для поисковиков и незрячих пользователей.' },
        ],
      },
    ],
  },
  {
    id: 'steps',
    icon: '🩺',
    title: 'Диагностика',
    subtitle: 'Блок «Как проходит диагностика».',
    fields: [
      {
        type: 'group',
        title: 'Вступительная карточка',
        fields: [
          { type: 'pair', path: 'steps.intro.title', label: 'Заголовок', rows: 2, html: true },
          { type: 'pair', path: 'steps.intro.hint', label: 'Подсказка «Листайте» (мобильные)' },
        ],
      },
      {
        type: 'list',
        path: 'steps.items',
        label: 'Этапы',
        addLabel: 'Добавить этап',
        itemTitle: (item, index) => `${index + 1}. ${getPath(item, 'num.ru') || 'Этап'}`,
        blank: { num: p('Этап', 'Кезең'), text: p(), accent: false },
        fields: [
          { type: 'pair', path: 'num', label: 'Номер / название этапа' },
          { type: 'pair', path: 'text', label: 'Описание', rows: 3, html: true },
          { type: 'toggle', path: 'accent', label: 'Выделить фиолетовым' },
        ],
      },
    ],
  },
  {
    id: 'when',
    icon: '✅',
    title: 'Когда заниматься',
    subtitle: 'Список показаний и карточка «Есть диагноз».',
    fields: [
      {
        type: 'group',
        title: 'Заголовок и список',
        fields: [
          { type: 'pair', path: 'when.title', label: 'Заголовок', rows: 2, html: true },
          {
            type: 'list',
            path: 'when.items',
            label: 'Пункты списка',
            addLabel: 'Добавить пункт',
            itemTitle: (item) => getPath(item, 'text.ru') || 'Пункт',
            blank: { text: p() },
            fields: [{ type: 'pair', path: 'text', label: 'Текст', rows: 2, html: true }],
          },
        ],
      },
      {
        type: 'group',
        title: 'Карточка с призывом',
        fields: [
          { type: 'pair', path: 'when.card.title', label: 'Заголовок карточки', rows: 3, html: true },
          { type: 'pair', path: 'when.card.text1', label: 'Первый абзац', rows: 3, html: true },
          { type: 'pair', path: 'when.card.text2', label: 'Второй абзац', rows: 3, html: true },
          { type: 'pair', path: 'when.card.cta', label: 'Текст кнопки' },
        ],
      },
    ],
  },
  {
    id: 'packages',
    icon: '📦',
    title: 'Пакеты',
    subtitle: 'Пакеты услуг, состав, цены и сплит-формат.',
    fields: [
      {
        type: 'group',
        title: 'Заголовок и примечание',
        fields: [
          { type: 'pair', path: 'packages.title', label: 'Заголовок блока' },
          {
            type: 'pair',
            path: 'packages.note',
            label: 'Примечание под пакетами',
            rows: 3,
            html: true,
            hint: 'Например про обязательную диагностику. Пустое поле скроет примечание.',
          },
        ],
      },
      {
        type: 'list',
        path: 'packages.items',
        label: 'Пакеты',
        addLabel: 'Добавить пакет',
        itemTitle: (item, index) => getPath(item, 'title.ru') || `Пакет ${index + 1}`,
        blank: {
          title: p('Новый пакет', 'Жаңа пакет'),
          price: p('0 тг', '0 тг'),
          why: p('<b>Почему выбирают:</b><br><br>', '<b>Неге таңдайды:</b><br><br>'),
          cta: p('Записаться на диагностику', 'Диагностикаға жазылу'),
          features: [{ text: p('Услуга', 'Қызмет'), included: true }],
        },
        fields: [
          { type: 'pair', path: 'title', label: 'Название' },
          { type: 'pair', path: 'price', label: 'Цена' },
          { type: 'pair', path: 'why', label: 'Почему выбирают', rows: 4, html: true },
          { type: 'pair', path: 'cta', label: 'Текст кнопки' },
          {
            type: 'list',
            path: 'features',
            label: 'Что входит',
            addLabel: 'Добавить услугу',
            itemTitle: (item) => getPath(item, 'text.ru') || 'Услуга',
            blank: { text: p(), included: true },
            fields: [
              { type: 'pair', path: 'text', label: 'Услуга', rows: 2, html: true },
              { type: 'toggle', path: 'included', label: 'Входит в пакет (иначе — зачёркнуто)' },
            ],
          },
        ],
      },
      {
        type: 'group',
        title: 'Сплит-формат',
        fields: [
          { type: 'toggle', path: 'packages.split.visible', label: 'Показывать карточку сплит-формата' },
          { type: 'pair', path: 'packages.split.title', label: 'Название' },
          { type: 'pair', path: 'packages.split.price', label: 'Цена' },
          { type: 'pair', path: 'packages.split.cta', label: 'Текст кнопки' },
        ],
      },
    ],
  },
  {
    id: 'services',
    icon: '💆',
    title: 'Услуги',
    subtitle: 'Фото, цифра опыта и карточки услуг.',
    fields: [
      {
        type: 'group',
        title: 'Фото и опыт',
        fields: [
          { type: 'image', path: 'services.photo', label: 'Фотография блока' },
          { type: 'pair', path: 'services.photoAlt', label: 'Alt-текст фото' },
          { type: 'text', path: 'services.years', label: 'Цифра', hint: 'Например 15' },
          { type: 'pair', path: 'services.yearsLabel', label: 'Подпись к цифре' },
          { type: 'pair', path: 'services.yearsText', label: 'Текст под цифрой', rows: 3, html: true },
          { type: 'pair', path: 'services.pricesLabel', label: 'Надпись «смотреть цены»' },
        ],
      },
      {
        type: 'list',
        path: 'services.items',
        label: 'Карточки услуг',
        addLabel: 'Добавить услугу',
        itemTitle: (item, index) => getPath(item, 'title.ru') || getPath(item, 'badge.ru') || `Услуга ${index + 1}`,
        blank: { badge: p(), badgeMobile: p(), title: p(), lead: p(), sub: p(), pricesUrl: '' },
        fields: [
          { type: 'pair', path: 'badge', label: 'Плашка сверху (десктоп)' },
          { type: 'pair', path: 'badgeMobile', label: 'Плашка на мобильном', hint: 'Если заполнена, на телефоне вместо основной плашки показывается эта.' },
          { type: 'pair', path: 'title', label: 'Крупный заголовок' },
          { type: 'pair', path: 'lead', label: 'Подпись под заголовком', rows: 2, html: true },
          { type: 'pair', path: 'sub', label: 'Описание', rows: 2, html: true },
          { type: 'url', path: 'pricesUrl', label: 'Ссылка «смотреть цены»', hint: 'Если пусто, надпись показывается без ссылки.' },
        ],
      },
    ],
  },
  {
    id: 'team',
    icon: '👥',
    title: 'Специалисты',
    subtitle: 'Команда: фото, имена и ссылки.',
    fields: [
      {
        type: 'group',
        title: 'Заголовки',
        fields: [
          { type: 'pair', path: 'team.title', label: 'Заголовок блока' },
          { type: 'pair', path: 'team.linkLabel', label: 'Надпись у специалиста' },
        ],
      },
      {
        type: 'list',
        path: 'team.items',
        label: 'Специалисты',
        addLabel: 'Добавить специалиста',
        itemTitle: (item) => item.name || 'Специалист',
        blank: { name: 'Новый специалист', photo: '', link: '' },
        fields: [
          { type: 'text', path: 'name', label: 'Имя' },
          { type: 'image', path: 'photo', label: 'Фотография' },
          { type: 'url', path: 'link', label: 'Ссылка «Узнать подробнее»', hint: 'Если пусто, ссылка неактивна.' },
        ],
      },
    ],
  },
  {
    id: 'reviews',
    icon: '⭐',
    title: 'Отзывы',
    subtitle: 'Отзывы клиентов и ссылка на 2ГИС.',
    fields: [
      {
        type: 'group',
        title: 'Заголовок и кнопки',
        fields: [
          { type: 'pair', path: 'reviews.title', label: 'Заголовок блока' },
          { type: 'pair', path: 'reviews.cta', label: 'Текст кнопки записи' },
          { type: 'pair', path: 'reviews.moreLabel', label: 'Текст кнопки «больше отзывов»' },
          { type: 'url', path: 'reviews.moreUrl', label: 'Ссылка на отзывы' },
        ],
      },
      {
        type: 'list',
        path: 'reviews.items',
        label: 'Отзывы',
        addLabel: 'Добавить отзыв',
        itemTitle: (item) => item.name || 'Отзыв',
        blank: { name: 'Имя', initials: 'И', rating: 5, text: p() },
        fields: [
          { type: 'text', path: 'name', label: 'Имя' },
          { type: 'text', path: 'initials', label: 'Инициалы в кружке', hint: '1–2 символа' },
          {
            type: 'select',
            path: 'rating',
            label: 'Оценка',
            options: [
              { value: 5, label: '5 звёзд' },
              { value: 4, label: '4 звезды' },
              { value: 3, label: '3 звезды' },
              { value: 2, label: '2 звезды' },
              { value: 1, label: '1 звезда' },
            ],
          },
          {
            type: 'pair',
            path: 'text',
            label: 'Текст отзыва',
            rows: 6,
            html: true,
            paragraphs: true,
            hint: 'Пустая строка между абзацами — новый абзац.',
          },
        ],
      },
    ],
  },
  {
    id: 'faq',
    icon: '❓',
    title: 'Вопросы',
    subtitle: 'Блок частых вопросов.',
    fields: [
      {
        type: 'group',
        title: 'Заголовок',
        fields: [{ type: 'pair', path: 'faq.title', label: 'Заголовок', rows: 2, html: true }],
      },
      {
        type: 'list',
        path: 'faq.items',
        label: 'Вопросы и ответы',
        addLabel: 'Добавить вопрос',
        itemTitle: (item) => getPath(item, 'question.ru') || 'Вопрос',
        blank: { question: p('Новый вопрос', 'Жаңа сұрақ'), answer: p(), open: false },
        fields: [
          { type: 'pair', path: 'question', label: 'Вопрос', rows: 2, html: true },
          { type: 'pair', path: 'answer', label: 'Ответ', rows: 3, html: true },
          { type: 'toggle', path: 'open', label: 'Раскрыт по умолчанию' },
        ],
      },
    ],
  },
  {
    id: 'footer',
    icon: '🧱',
    title: 'Подвал сайта',
    subtitle: 'Подпись, навигация и контакты внизу страницы.',
    fields: [
      {
        type: 'group',
        title: 'Тексты',
        fields: [
          { type: 'pair', path: 'footer.tagline', label: 'Подпись под логотипом', rows: 2, html: true },
          { type: 'pair', path: 'footer.navTitle', label: 'Заголовок «Разделы»' },
          { type: 'pair', path: 'footer.contactsTitle', label: 'Заголовок «Контакты»' },
          { type: 'pair', path: 'footer.onlineLabel', label: 'Ссылка «Записаться онлайн»' },
          { type: 'pair', path: 'footer.mapLabel', label: 'Ссылка «Мы на 2ГИС»' },
          { type: 'pair', path: 'footer.copyright', label: 'Копирайт' },
        ],
      },
      {
        type: 'list',
        path: 'footer.nav',
        label: 'Ссылки в подвале',
        addLabel: 'Добавить ссылку',
        itemTitle: (item) => getPath(item, 'label.ru') || 'Ссылка',
        blank: { label: p('Раздел', 'Бөлім'), href: '#' },
        fields: [
          { type: 'pair', path: 'label', label: 'Название' },
          { type: 'text', path: 'href', label: 'Якорь или ссылка', hint: 'Например #packages или https://…' },
        ],
      },
    ],
  },
  {
    id: 'modal',
    icon: '📝',
    title: 'Форма записи',
    subtitle: 'Модальное окно, которое открывается по кнопкам записи.',
    fields: [
      {
        type: 'group',
        title: 'Тексты окна',
        fields: [
          { type: 'pair', path: 'modal.eyebrow', label: 'Надпись над заголовком' },
          { type: 'pair', path: 'modal.title', label: 'Заголовок', rows: 2, html: true },
          { type: 'pair', path: 'modal.text', label: 'Описание', rows: 2, html: true },
          { type: 'pair', path: 'modal.siteTitle', label: 'Кнопка «онлайн»: заголовок' },
          { type: 'pair', path: 'modal.siteSub', label: 'Кнопка «онлайн»: подпись' },
          { type: 'pair', path: 'modal.waTitle', label: 'Кнопка WhatsApp: заголовок' },
          { type: 'pair', path: 'modal.waSub', label: 'Кнопка WhatsApp: подпись' },
          { type: 'pair', path: 'modal.callNote', label: 'Надпись перед телефоном' },
        ],
      },
    ],
  },
  {
    id: 'design',
    icon: '🎨',
    title: 'Оформление',
    subtitle: 'Фирменные цвета, фон и видимость секций.',
    fields: [
      {
        type: 'group',
        title: 'Цвета',
        desc: 'Изменения применятся на сайте после сохранения.',
        fields: [
          { type: 'color', path: 'theme.lime', label: 'Фон главного экрана' },
          { type: 'color', path: 'theme.limeSoft', label: 'Салатовые кнопки и карточки' },
          { type: 'color', path: 'theme.purple', label: 'Основной фиолетовый' },
          { type: 'color', path: 'theme.purpleDeep', label: 'Тёмный фиолетовый (рамки, кружки)' },
          { type: 'color', path: 'theme.purpleMid', label: 'Аватар в отзывах' },
        ],
      },
      {
        type: 'group',
        title: 'Фон',
        fields: [{ type: 'image', path: 'theme.pattern', label: 'Узор для блоков «Когда» и «Сплит»' }],
      },
      {
        type: 'group',
        title: 'Секции на сайте',
        desc: 'Снимите галочку, чтобы скрыть блок со страницы.',
        fields: [
          { type: 'toggle', path: 'sections.steps', label: 'Как проходит диагностика' },
          { type: 'toggle', path: 'sections.when', label: 'Когда можно и нужно заниматься' },
          { type: 'toggle', path: 'sections.packages', label: 'Пакеты' },
          { type: 'toggle', path: 'sections.services', label: 'Услуги' },
          { type: 'toggle', path: 'sections.team', label: 'Специалисты' },
          { type: 'toggle', path: 'sections.reviews', label: 'Отзывы' },
          { type: 'toggle', path: 'sections.faq', label: 'Вопросы' },
          { type: 'toggle', path: 'sections.footer', label: 'Подвал сайта' },
        ],
      },
    ],
  },
  {
    id: 'backup',
    icon: '🔐',
    title: 'Резервная копия',
    subtitle: 'Экспорт, импорт, сброс настроек и смена пароля.',
    custom: renderBackupSection,
  },
];

/* ------------------------------------- индексы путей для визуального редактора */

const FIELD_SPECS = new Map();
const LIST_SPECS = new Map();

function indexSchema(fields, prefix) {
  fields.forEach((spec) => {
    if (spec.type === 'group') {
      indexSchema(spec.fields, prefix);
      return;
    }

    const path = prefix ? `${prefix}.${spec.path}` : spec.path;

    if (spec.type === 'list') {
      LIST_SPECS.set(path, spec);
      indexSchema(spec.fields, `${path}.*`);
    } else {
      FIELD_SPECS.set(path, spec);
    }
  });
}

SECTIONS.forEach((section) => {
  if (section.fields) indexSchema(section.fields, '');
});

function pathPattern(path) {
  return path.replace(/\.\d+(?=\.|$)/g, '.*');
}

function resolveFieldContext(path) {
  const spec = FIELD_SPECS.get(path) || FIELD_SPECS.get(pathPattern(path));
  if (!spec) return null;

  const segments = path.split('.');
  let base = '';
  let indexPos = -1;

  segments.forEach((segment, i) => {
    if (!/^\d+$/.test(segment)) return;
    const listPath = segments.slice(0, i).join('.');
    if (LIST_SPECS.has(pathPattern(listPath))) {
      indexPos = i;
      base = segments.slice(0, i + 1).join('.');
    }
  });

  if (indexPos === -1) return { spec, object: state.content, path };
  return { spec, object: getPath(state.content, base), path: segments.slice(indexPos + 1).join('.') };
}

function resolveListSpec(listPath) {
  return LIST_SPECS.get(pathPattern(listPath)) || null;
}

/* ------------------------------------------------------------- редакторы */

function renderFields(host, fields, object, ctx) {
  fields.forEach((spec) => {
    switch (spec.type) {
      case 'group':
        renderGroup(host, spec, object, ctx);
        break;
      case 'list':
        renderList(host, spec, object, ctx);
        break;
      case 'pair':
        host.append(renderPair(spec, object, ctx));
        break;
      case 'image':
        host.append(renderImage(spec, object, ctx));
        break;
      case 'color':
        host.append(renderColor(spec, object, ctx));
        break;
      case 'toggle':
        host.append(renderToggle(spec, object, ctx));
        break;
      case 'select':
        host.append(renderSelect(spec, object, ctx));
        break;
      default:
        host.append(renderText(spec, object, ctx));
    }
  });
}

function fieldLabel(text, hint) {
  return h(
    'span',
    { class: 'field__label' },
    text,
    hint ? h('span', { class: 'field__hint', style: 'text-transform:none;font-weight:400' }, hint) : null
  );
}

function renderText(spec, object, ctx) {
  const value = getPath(object, spec.path);
  const common = {
    class: spec.rows ? 'textarea' : 'input',
    value: typeof value === 'string' ? value : '',
    placeholder: spec.placeholder || '',
    oninput: (event) => {
      setPath(object, spec.path, event.target.value);
      notifyChange(ctx, spec.path);
    },
  };

  const control = spec.rows
    ? h('textarea', { ...common, rows: spec.rows })
    : h('input', { ...common, type: spec.type === 'url' ? 'url' : 'text' });

  return h(
    'label',
    { class: 'field' },
    fieldLabel(spec.label),
    control,
    spec.hint ? h('p', { class: 'field__hint' }, spec.hint) : null
  );
}

function renderPair(spec, object, ctx) {
  const value = getPath(object, spec.path) || {};

  const make = (lang) => {
    const common = {
      value: typeof value[lang] === 'string' ? value[lang] : '',
      placeholder: lang === 'ru' ? 'Русский текст' : 'Қазақша мәтін',
      oninput: (event) => {
        writePair(object, spec.path, lang, event.target.value);
        notifyChange(ctx, spec.path);
      },
    };
    return spec.rows
      ? h('textarea', { class: 'textarea', rows: spec.rows, ...common })
      : h('input', { class: 'input', type: 'text', ...common });
  };

  return h(
    'div',
    { class: 'field' },
    fieldLabel(spec.label, spec.html ? 'можно <b>, <br>' : ''),
    h(
      'div',
      { class: 'pair' },
      h('div', { class: 'pair__col' }, h('span', { class: 'pair__lang' }, 'RU'), make('ru')),
      h('div', { class: 'pair__col' }, h('span', { class: 'pair__lang' }, 'KZ'), make('kz'))
    ),
    spec.hint ? h('p', { class: 'field__hint' }, spec.hint) : null
  );
}

function renderToggle(spec, object, ctx) {
  const input = h('input', {
    type: 'checkbox',
    checked: Boolean(getPath(object, spec.path)),
    onchange: (event) => {
      if (ctx.beforeChange) ctx.beforeChange();
      setPath(object, spec.path, event.target.checked);
      notifyChange(ctx, spec.path);
    },
  });

  return h(
    'div',
    { class: 'field' },
    h(
      'label',
      { class: 'toggle' },
      input,
      h('span', { class: 'toggle__track' }),
      h('span', { class: 'toggle__label' }, spec.label)
    ),
    spec.hint ? h('p', { class: 'field__hint' }, spec.hint) : null
  );
}

function renderSelect(spec, object, ctx) {
  const current = getPath(object, spec.path);
  const select = h(
    'select',
    {
      class: 'input',
      onchange: (event) => {
        if (ctx.beforeChange) ctx.beforeChange();
        setPath(object, spec.path, event.target.value);
        notifyChange(ctx, spec.path);
      },
    },
    spec.options.map((option) =>
      h('option', { value: String(option.value), selected: String(current) === String(option.value) }, option.label)
    )
  );

  return h('label', { class: 'field' }, fieldLabel(spec.label), select);
}

function renderColor(spec, object, ctx) {
  const value = getPath(object, spec.path) || '#ffffff';
  const isValid = /^#[0-9a-f]{6}$/i.test(value);

  const text = h('input', {
    class: 'input',
    type: 'text',
    value,
    oninput: (event) => {
      if (/^#[0-9a-f]{6}$/i.test(event.target.value)) picker.value = event.target.value;
      setPath(object, spec.path, event.target.value);
      notifyChange(ctx, spec.path);
    },
  });

  const picker = h('input', {
    type: 'color',
    value: isValid ? value : '#ffffff',
    oninput: (event) => {
      text.value = event.target.value;
      setPath(object, spec.path, event.target.value);
      notifyChange(ctx, spec.path);
    },
  });

  return h('div', { class: 'field' }, fieldLabel(spec.label), h('div', { class: 'input--color-row' }, picker, text));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderImage(spec, object, ctx) {
  let value = getPath(object, spec.path) || '';

  const preview = h('div', { class: 'image-field__preview' });
  const text = h('input', { class: 'input', type: 'text', value, placeholder: '/assets/photo.jpg' });
  const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
  const uploadBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--small' }, 'Загрузить');
  const clearBtn = h('button', { type: 'button', class: 'btn btn--icon', title: 'Убрать изображение' }, '✕');

  const paint = () => {
    preview.textContent = '';
    preview.style.backgroundImage = '';
    if (value) {
      preview.style.backgroundImage = `url("${value}")`;
    } else {
      preview.textContent = 'Нет изображения';
    }
  };

  const apply = (next) => {
    if (ctx.beforeChange) ctx.beforeChange();
    value = next;
    text.value = next;
    paint();
    setPath(object, spec.path, next);
    notifyChange(ctx, spec.path);
  };

  text.addEventListener('change', () => apply(text.value.trim()));
  uploadBtn.addEventListener('click', () => fileInput.click());
  clearBtn.addEventListener('click', () => apply(''));

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;

    if (file.size > 6 * 1024 * 1024) {
      toast('Файл больше 6 МБ — уменьшите изображение', true);
      return;
    }

    const previous = uploadBtn.textContent;
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Загрузка…';

    try {
      const data = await readFileAsDataUrl(file);
      const result = await api('/api/upload', { method: 'POST', body: JSON.stringify({ data }) });
      apply(result.url);
      toast('Изображение загружено');
    } catch (error) {
      toast(
        error.status === 401 ? 'Сессия истекла — войдите заново' : 'Не удалось загрузить изображение',
        true
      );
      if (error.status === 401) showLogin();
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = previous;
    }
  });

  paint();

  return h(
    'div',
    { class: 'field' },
    fieldLabel(spec.label),
    h(
      'div',
      { class: 'image-field' },
      preview,
      h(
        'div',
        { class: 'image-field__row' },
        text,
        uploadBtn,
        clearBtn,
        fileInput
      )
    ),
    spec.hint ? h('p', { class: 'field__hint' }, spec.hint) : null
  );
}

function renderGroup(host, spec, object, ctx) {
  const body = h('div', { class: 'card__body' });
  renderFields(body, spec.fields, object, { ...ctx, nested: true });

  host.append(
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card__title' }, spec.title),
      spec.desc ? h('p', { class: 'card__desc' }, spec.desc) : null,
      body
    )
  );
}

function renderList(host, spec, object, ctx) {
  let items = getPath(object, spec.path);
  if (!Array.isArray(items)) {
    items = [];
    setPath(object, spec.path, items);
  }

  const listEl = h('div', { class: 'list' });
  const addBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--ghost btn--small',
      onclick: () => {
        if (ctx.beforeChange) ctx.beforeChange();
        items.push(clone(spec.blank || {}));
        ctx.markDirty();
        ctx.rerender();
      },
    },
    `+ ${spec.addLabel || 'Добавить'}`
  );

  if (!items.length) {
    listEl.append(h('p', { class: 'list__empty' }, 'Пока пусто — добавьте первый элемент.'));
  }

  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      items[index] = {};
    }

    const titleEl = h(
      'span',
      { class: 'list-item__title' },
      spec.itemTitle ? spec.itemTitle(items[index], index) || `#${index + 1}` : `#${index + 1}`
    );

    const move = (delta) => {
      const target = index + delta;
      if (target < 0 || target >= items.length) return;
      if (ctx.beforeChange) ctx.beforeChange();
      const [moved] = items.splice(index, 1);
      items.splice(target, 0, moved);
      ctx.markDirty();
      ctx.rerender();
    };

    const removeBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--icon',
        title: 'Удалить',
        onclick: () => {
          if (!confirm('Удалить этот элемент?')) return;
          if (ctx.beforeChange) ctx.beforeChange();
          items.splice(index, 1);
          ctx.markDirty();
          ctx.rerender();
        },
      },
      '✕'
    );

    const head = h(
      'div',
      { class: 'list-item__head' },
      titleEl,
      h('button', { type: 'button', class: 'btn btn--icon', title: 'Выше', disabled: index === 0, onclick: () => move(-1) }, '↑'),
      h(
        'button',
        { type: 'button', class: 'btn btn--icon', title: 'Ниже', disabled: index === items.length - 1, onclick: () => move(1) },
        '↓'
      ),
      removeBtn
    );

    const body = h('div', { class: 'list-item__body' });
    renderFields(body, spec.fields, items[index], { ...ctx, nested: true });

    listEl.append(h('div', { class: 'list-item' }, head, body));
  });

  const head = h(
    'div',
    { class: 'list__head' },
    h('span', { class: ctx.nested ? 'list__title' : 'card__title' }, spec.label),
    addBtn
  );

  if (ctx.nested) {
    host.append(h('div', { class: 'list-block' }, head, listEl));
  } else {
    host.append(h('section', { class: 'card' }, head, listEl));
  }
}

/* ------------------------------------------------------- резервная копия */

function renderBackupSection(host) {
  const exportBtn = h('button', { type: 'button', class: 'btn btn--ghost' }, 'Скачать JSON');
  const importInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const importBtn = h('button', { type: 'button', class: 'btn btn--ghost' }, 'Загрузить JSON');
  const resetBtn = h('button', { type: 'button', class: 'btn btn--danger' }, 'Сбросить к исходному');

  exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.content, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: `lfk-content-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  importBtn.addEventListener('click', () => importInput.click());

  importInput.addEventListener('change', async () => {
    const file = importInput.files && importInput.files[0];
    importInput.value = '';
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      if (!confirm('Заменить текущий контент данными из файла?')) return;

      const result = await api('/api/content', {
        method: 'PUT',
        body: JSON.stringify({ content: parsed }),
      });
      state.content = result.content;
      setDirty(false);
      renderSection();
      toast('Контент импортирован');
    } catch (error) {
      toast(error.status === 401 ? 'Сессия истекла — войдите заново' : 'Не удалось импортировать файл', true);
    }
  });

  resetBtn.addEventListener('click', async () => {
    if (!confirm('Сбросить все настройки сайта к исходным? Текущая версия сохранится на сервере как резервная копия.')) {
      return;
    }
    try {
      const result = await api('/api/reset', { method: 'POST', body: '{}' });
      state.content = result.content;
      setDirty(false);
      renderSection();
      toast('Настройки сброшены к исходным');
    } catch (error) {
      toast(error.status === 401 ? 'Сессия истекла — войдите заново' : 'Не удалось сбросить настройки', true);
    }
  });

  host.append(
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card__title' }, 'Резервные копии'),
      h(
        'p',
        { class: 'card__desc' },
        'Скачайте текущий контент в JSON, чтобы сохранить копию или перенести настройки. Импорт заменит весь контент сайта.'
      ),
      h(
        'div',
        { class: 'card__body' },
        h('div', { class: 'actions-row' }, exportBtn, importBtn, resetBtn, importInput),
        h('p', { class: 'status-line' }, 'Сервер хранит предыдущую версию в content.backup.json.')
      )
    )
  );

  const current = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const repeat = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const submit = h('button', { type: 'submit', class: 'btn btn--primary' }, 'Изменить пароль');

  const form = h(
    'form',
    {
      class: 'card__body',
      onsubmit: async (event) => {
        event.preventDefault();

        if (next.value.length < 8) {
          toast('Новый пароль должен быть не короче 8 символов', true);
          return;
        }
        if (next.value !== repeat.value) {
          toast('Пароли не совпадают', true);
          return;
        }

        submit.disabled = true;
        try {
          await api('/api/password', {
            method: 'POST',
            body: JSON.stringify({ current: current.value, next: next.value }),
          });
          current.value = '';
          next.value = '';
          repeat.value = '';
          toast('Пароль изменён');
        } catch (error) {
          const messages = {
            bad_current: 'Текущий пароль неверный',
            short_password: 'Новый пароль слишком короткий',
          };
          toast(messages[error.message] || 'Не удалось изменить пароль', true);
        } finally {
          submit.disabled = false;
        }
      },
    },
    h('label', { class: 'field' }, fieldLabel('Текущий пароль'), current),
    h('label', { class: 'field' }, fieldLabel('Новый пароль'), next),
    h('label', { class: 'field' }, fieldLabel('Повторите новый пароль'), repeat),
    h('div', { class: 'actions-row' }, submit)
  );

  host.append(
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card__title' }, 'Пароль администратора'),
      h('p', { class: 'card__desc' }, 'После смены пароля все другие сессии будут завершены.'),
      form
    )
  );
}

/* -------------------------------------------------------------- интерфейс */

function renderNav() {
  const nav = $('#nav');
  nav.textContent = '';

  SECTIONS.forEach((section) => {
    nav.append(
      h(
        'button',
        {
          type: 'button',
          class: `nav__item${state.section === section.id ? ' is-active' : ''}`,
          dataset: { section: section.id },
          onclick: () => openSection(section.id),
        },
        h('span', { class: 'nav__icon' }, section.icon),
        section.title
      )
    );
  });
}

function renderSection() {
  const section = SECTIONS.find((item) => item.id === state.section) || SECTIONS[0];
  $('#section-title').textContent = section.title;
  $('#section-subtitle').textContent = section.subtitle || '';

  const body = $('#section-body');
  body.textContent = '';

  const ctx = {
    markDirty,
    rerender: renderSection,
    beforeChange: pushHistory,
    toast,
  };

  if (section.custom) {
    section.custom(body, ctx);
  } else {
    renderFields(body, section.fields || [], state.content, ctx);
  }

  document.querySelectorAll('.nav__item').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.section === section.id);
  });
}

function openSection(id) {
  state.section = id;
  renderNav();
  renderSection();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showLogin() {
  $('#app').hidden = true;
  $('#login-screen').hidden = false;
  setTimeout(() => $('#login-password').focus(), 30);
}

function showApp() {
  $('#login-screen').hidden = true;
  $('#app').hidden = false;
}

async function save() {
  if (!state.content) return;

  const button = $('#save-btn');
  button.disabled = true;
  button.textContent = 'Сохраняю…';

  try {
    const result = await api('/api/content', {
      method: 'PUT',
      body: JSON.stringify({ content: state.content }),
    });
    state.content = result.content;
    setDirty(false);
    toast('Сохранено');
  } catch (error) {
    if (error.status === 401) {
      toast('Сессия истекла — войдите заново', true);
      showLogin();
    } else {
      toast('Не удалось сохранить изменения', true);
    }
    setDirty(true);
  } finally {
    button.textContent = 'Сохранить';
  }
}

async function loadContent() {
  const result = await api('/api/content');
  state.content = result.content;
  state.selection = null;
  state.history = [];
  state.future = [];
  showApp();
  setDirty(false);
  initEditor();
}

/* ---------------------------------------------------------------- запуск */

$('#save-btn').addEventListener('click', save);

$('#logout-btn').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST', body: '{}' });
  } catch {
    /* выходим в любом случае */
  }

  state.content = null;
  state.selection = null;
  state.editing = null;
  state.history = [];
  state.future = [];
  resetPreview();
  updateHistoryButtons();
  setDirty(false);
  showLogin();
});

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const errorEl = $('#login-error');
  const submit = $('#login-submit');
  const password = $('#login-password').value;

  errorEl.hidden = true;
  submit.disabled = true;
  submit.textContent = 'Проверяю…';

  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
    $('#login-password').value = '';
    await loadContent();
  } catch (error) {
    const messages = {
      bad_password: 'Неверный пароль',
      too_many_attempts: 'Слишком много попыток. Попробуйте через 15 минут.',
    };
    errorEl.textContent = messages[error.message] || 'Не удалось войти. Попробуйте ещё раз.';
    errorEl.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Войти';
  }
});

window.addEventListener('beforeunload', (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

(async function boot() {
  try {
    await loadContent();
  } catch (error) {
    showLogin();
    if (error.status !== 401) {
      const errorEl = $('#login-error');
      errorEl.textContent = 'Не удалось загрузить данные сайта. Проверьте, что сервер запущен.';
      errorEl.hidden = false;
    }
  }
})();
