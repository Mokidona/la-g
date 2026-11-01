/* FAQ-аккордеон: состояние берётся из разметки, иконка «×» сворачивает карточку */

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

/* Язык сайта: две статические страницы — index.html (RU) и kz.html (KZ).
   Выбор запоминается и применяется при следующем заходе. */

const pageLang = document.documentElement.lang === 'kk' ? 'kz' : 'ru';

document.querySelectorAll('.lang__btn[data-lang]').forEach((link) => {
  link.addEventListener('click', () => {
    try {
      localStorage.setItem('lfk-lang', link.dataset.lang);
    } catch (error) {
      /* приватный режим — просто не запоминаем выбор */
    }
  });
});

if (pageLang === 'ru') {
  try {
    if (localStorage.getItem('lfk-lang') === 'kz') {
      window.location.replace('kz.html');
    }
  } catch (error) {
    /* приватный режим — остаёмся на русской версии */
  }
}
