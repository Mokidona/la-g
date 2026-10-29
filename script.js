/* FAQ-аккордеон: в макете все ответы раскрыты, иконка «×» сворачивает карточку */

document.querySelectorAll('.faq-item').forEach((item) => {
  const button = item.querySelector('.faq-item__q');

  button.addEventListener('click', () => {
    const isOpen = item.classList.toggle('is-open');
    button.setAttribute('aria-expanded', String(isOpen));
  });
});

/* Модалка записи: любая кнопка «Записаться на диагностику» открывает выбор
   «сайт или WhatsApp» вместо прямого звонка. Без JS ссылки остаются tel:-ссылками. */

const bookingModal = document.getElementById('booking-modal');

if (bookingModal) {
  const FOCUSABLE = 'a[href], button:not([disabled])';
  let lastFocused = null;

  const openModal = (event) => {
    event.preventDefault();
    lastFocused = document.activeElement;

    bookingModal.classList.add('is-open');
    bookingModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-locked');

    const first = bookingModal.querySelector('.modal__option');
    if (first) first.focus({ preventScroll: true });
  };

  const closeModal = () => {
    bookingModal.classList.remove('is-open');
    bookingModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-locked');

    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus({ preventScroll: true });
    }
  };

  document.querySelectorAll('a[href^="tel:"]').forEach((link) => {
    link.addEventListener('click', openModal);
  });

  bookingModal.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (!bookingModal.classList.contains('is-open')) return;

    if (event.key === 'Escape') {
      closeModal();
      return;
    }

    if (event.key !== 'Tab') return;

    const items = [...bookingModal.querySelectorAll(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null
    );
    if (!items.length) return;

    const first = items[0];
    const last = items[items.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

/* Локализация RU / KZ: русские тексты берутся из разметки, казахские — из словаря.
   Выбор языка запоминается в localStorage и переживает перезагрузку. */

const KZ = {
  'html.lang': 'kk',
  'page.title': 'Астанадағы ЛФК және оңалту — инсульт пен жарақаттан кейінгі қалпына келу',
  'page.desc': 'Астанадағы жеке ЛФК бағдарламалары, мануалды терапия және аппараттық әдістер. Инсульт пен жарақаттан кейін қалпына келу және ауырсынудан арылу.',

  'hero.title': 'Астанадағы оңалту және&nbsp;ЛФК: инсульт пен жарақаттан кейінгі қалпына келу және&nbsp;ауырсынудан арылу',
  'hero.sub': 'Жеке ЛФК бағдарламалары, мануалды терапия және&nbsp;аппараттық әдістер',
  'cta.book': 'Диагностикаға жазылу',
  'card.title': 'Алғашқы диагностикадан өтіңіз',
  'card.text': 'Буындар мен&nbsp;бұлшықеттердің жағдайын бағалап, қауіпсіз оңалту бағдарламасын таңдаймыз',
  'card.cta': 'Толығырақ білу',

  'steps.q': 'Диагностика <br class="br-m">қалай <b>өтеді?</b>',
  'steps.hint': 'Жылжытыңыз',
  'steps.n1': '1 кезең',
  'steps.n2': '2 кезең',
  'steps.n3': '3 кезең',
  'steps.t1': 'Реабилитолог пациентті мұқият тыңдап, оның сұраныстарын, шағымдарын, өмір салты мен&nbsp;шектеулерін нақтылайды.',
  'steps.t2': 'Қолмен қарау және&nbsp;пальпация: бұлшықеттер мен&nbsp;фасцияның жағдайын бағалаймыз, триггерлік нүктелер мен&nbsp;кернеу аймақтарын анықтаймыз.',
  'steps.t3': 'Буындардың қозғалғыштығын тексереміз, қауіпсіз жүктеме мен&nbsp;қалпына келу жоспарын таңдаймыз.',

  'when.title': 'Қашан шұғылдануға болады және&nbsp;қажет',
  'when.i1': 'Инсульт және&nbsp;бас сүйек-ми жарақаттарынан кейінгі оңалту (қалпына келу кезеңдерінде)',
  'when.i2': 'Арқада, белде немесе буындарда созылмалы және&nbsp;сыздаған ауырсыну',
  'when.i3': 'Омыртқааралық жарықтар мен&nbsp;протрузиялар',
  'when.i4': 'Буындардың 1–3 дәрежелі артроздары мен&nbsp;артриттері',
  'when.i5': 'Тұрмыстық және&nbsp;спорттық жарақаттардан, тірек-қимыл аппаратына жасалған оталардан кейін қалпына келу',
  'when.cardTitle': 'Диагнозыңыз бар, бірақ&nbsp;бәрібір <b>күмәнданып</b> жүрсеңіз — біздің қамқорлық қызметімізге жазыңыз',
  'when.cardText1': 'Егер абсолютті қарсы көрсетілімдеріңіз болмаса, бірақ&nbsp;сізге қандай ЛФК курсы немесе оңалту форматы сәйкес келетініне сенімді болмасаңыз — Астанадағы мамандарымызға жазыңыз.',
  'when.cardText2': 'Біз артық қызметтерді таңып жүрмейміз — міндетіміз ауырсынудан қауіпсіз арылуға көмектесу.',

  'pkg.1.title': '1-пакет',
  'pkg.2.title': '2-пакет',
  'pkg.3.title': '3-пакет',
  'pkg.4.title': '4-пакет',
  'pkg.a': '12 жеке ЛФК сабағы',
  'pkg.b': 'Мануалды терапия сеанстары (ауырсыну мен&nbsp;кернеуді жылдам басу)',
  'pkg.c': 'Инфрақызыл жылыту',
  'pkg.why': '<b>Неге таңдайды:</b><br><br>Қозғалыс арқылы іргетас — біртіндеп қалпына келуге дайын адамдар үшін.',
  'pkg.1.price': '100 000 тг',
  'pkg.2.price': '120 000 тг',
  'pkg.3.price': '110 000 тг',
  'pkg.4.price': '130 000 тг',
  'split.title': 'Сплит-формат',
  'split.price': '140 000 тг',

  'svc.years': 'жылдық тәжірибе',
  'svc.yearsText': 'Тәжірибелі реабилитологтар және&nbsp;хирургиялық араласусыз күрделі жағдайлармен жұмыс',
  'svc.massage.tag': 'Массаж',
  'svc.massage.lead': 'массаж түрі',
  'svc.manual.tag': 'Мануалды терапия',
  'svc.manual.title': 'Мануалды үстел',
  'svc.manual.sub': 'тәжірибелі маманмен',
  'svc.ir.tag': 'Физиотерапия',
  'svc.ir.lead': 'Инфрақызыл жылыту',
  'svc.ir.sub': 'Сипаттама',
  'svc.prices': 'бағаларды қарау',

  'team.title': 'Мамандар',
  'team.cta': 'Толығырақ білу',

  'rev.title': 'Клиенттеріміз не дейді',
  'rev.p1': 'ЛФК залында шұғылданып жүрмін және&nbsp;нәтижесіне қатты ризамын! Басты артықшылығы — өзіңе ыңғайлы уақытта жаттықтырушымен жеке шұғылдану. Назар дәл сенің мақсаттарың мен&nbsp;мүмкіндіктеріңе бөлінеді, жаттығулар жағдайың мен&nbsp;мақсаттарыңды ескеріп дұрыс таңдалады.',
  'rev.p2': 'Осында жұмыс істейтін реабилитологтарды бөлек атап өткім келеді: олар нәтижеге шынымен қызығатыны көрінеді, тек уақытын өткізіп жүрген жоқ. Қолдайды, техниканы қадағалайды, алға жылжуға және&nbsp;қойған мақсатқа жетуге көмектеседі.',
  'rev.p3': 'Керемет көзқарас, кәсіби команда және&nbsp;жайлы атмосфера. Тек шұғылданып қана қоймай, шынымен нәтиже көргісі келетіндердің бәріне ұсынамын!',
  'rev.more': '2ГИС-тегі пікірлерді көру',

  'faq.title': 'Жиі <br>қойылатын <br>сұрақтар',
  'faq.q': 'Балаларға арналған шұғылдану қай жастан бастап қолжетімді?',
  'faq.a': 'Балаларға арналған шұғылдану 6&nbsp;жастан бастап қолжетімді',

  'm.eyebrow': 'Алғашқы диагностика',
  'm.title': 'Диагностикаға жазылу',
  'm.text': 'Ыңғайлы тәсілді таңдаңыз — әкімші сізбен байланысып, уақытты ұсынады.',
  'm.site': 'Онлайн жазылу',
  'm.siteSub': 'Сайтта уақыт таңдау',
  'm.wa': 'WhatsApp-қа жазу',
  'm.waSub': 'Кеңес беріп, уақыт таңдаймыз',
  'm.call': 'Немесе қоңырау шалыңыз:',

  'ft.tagline': 'Оңалту және&nbsp;ЛФК: жарақаттан, отадан кейін және&nbsp;ауырсынудан арылу',
  'ft.nav': 'Бөлімдер',
  'ft.navSteps': 'Диагностика қалай өтеді',
  'ft.navPackages': 'Пакеттер',
  'ft.navServices': 'Қызметтер',
  'ft.navTeam': 'Мамандар',
  'ft.navReviews': 'Пікірлер',
  'ft.navFaq': 'Сұрақтар',
  'ft.contacts': 'Байланыс',
  'ft.online': 'Онлайн жазылу',
  'ft.map': '2ГИС-те',
  'ft.copy': '© 2026 ЛФК Астана. Барлық құқықтар қорғалған.'
};

const i18nNodes = [...document.querySelectorAll('[data-i18n]')];
const ruText = new Map(i18nNodes.map((node) => [node, node.innerHTML]));
const ruTitle = document.title;
const ruDesc = document.querySelector('meta[name="description"]')?.content || '';

const langButtons = [...document.querySelectorAll('.lang__btn')];

function applyLang(lang) {
  const kz = lang === 'kz';

  i18nNodes.forEach((node) => {
    const key = node.dataset.i18n;
    const value = kz ? KZ[key] : ruText.get(node);
    if (value !== undefined) node.innerHTML = value;
  });

  document.documentElement.lang = kz ? 'kk' : 'ru';
  document.title = kz ? KZ['page.title'] : ruTitle;

  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.content = kz ? KZ['page.desc'] : ruDesc;

  langButtons.forEach((btn) => {
    const active = btn.dataset.lang === lang;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  try {
    localStorage.setItem('lfk-lang', lang);
  } catch (error) {
    /* приватный режим — просто не запоминаем выбор */
  }
}

langButtons.forEach((btn) => {
  btn.addEventListener('click', () => applyLang(btn.dataset.lang));
});

let savedLang = 'ru';
try {
  savedLang = localStorage.getItem('lfk-lang') === 'kz' ? 'kz' : 'ru';
} catch (error) {
  savedLang = 'ru';
}

if (savedLang === 'kz') applyLang('kz');
