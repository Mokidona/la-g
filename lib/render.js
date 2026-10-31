'use strict';

/* Серверный рендер лендинга из content.json. Разметка и классы повторяют
   исходный макет, поэтому styles.css работает без изменений. */

const ALLOWED_TAG = /&lt;(\/?)(b|strong|i|em|u|span)&gt;/gi;
const BR = /&lt;br\s*\/?&gt;/gi;
const BR_CLASS = /&lt;br\s+class=(?:&quot;|&#39;|"|')br-m(?:&quot;|&#39;|"|')\s*\/?&gt;/gi;
const ENTITY = /&amp;([a-zA-Z][a-zA-Z0-9]{1,8}|#[0-9]{1,6});/g;

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Текст из админки: экранируем всё, затем возвращаем безопасные теги
   форматирования (<b>, <br class="br-m"> и т. п.). */
function rich(value) {
  return esc(value)
    .replace(ENTITY, '&$1;')
    .replace(BR_CLASS, '<br class="br-m">')
    .replace(BR, '<br>')
    .replace(ALLOWED_TAG, '<$1$2>');
}

function pick(value, lang) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if ('ru' in value || 'kz' in value) {
      return value[lang] !== undefined && value[lang] !== null && value[lang] !== ''
        ? value[lang]
        : value.ru || '';
    }
    return '';
  }
  return value === undefined || value === null ? '' : String(value);
}

const SECTION_IDS = ['steps', 'when', 'packages', 'services', 'team', 'reviews', 'faq'];

/* Секции идут в том порядке, который задан в админке; новые или удалённые id
   игнорируются, поэтому страница не ломается от правок в JSON. */
function sectionOrder(sections) {
  const requested = Array.isArray(sections && sections.order) ? sections.order : [];
  const known = requested.filter((id) => SECTION_IDS.includes(id));
  const unique = known.filter((id, index) => known.indexOf(id) === index);
  return [...unique, ...SECTION_IDS.filter((id) => !unique.includes(id))];
}

function paragraphs(value, lang) {
  const text = pick(value, lang);
  if (!text) return '';
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${rich(part)}</p>`)
    .join('');
}

function renderPage(content, options = {}) {
  const lang = options.lang === 'kz' ? 'kz' : 'ru';
  const origin = options.origin || '';
  const t = (value) => pick(value, lang);
  const w = (value) => rich(pick(value, lang));

  const htmlLang = lang === 'kz' ? 'kk' : 'ru';
  const sections = content.sections || {};

  /* В режиме редактора проставляем пути к полям контента, чтобы админка
     могла выделять и править элементы прямо на странице. */
  const edit = Boolean(options.edit);
  const ea = (path) => (edit ? ` data-e="${path}"` : '');
  const ei = (path) => (edit ? ` data-img="${path}"` : '');
  const eb = (list, index) =>
    edit ? ` data-block="${list}.${index}" data-list="${list}" data-index="${index}"` : '';
  const es = (id) => (edit ? ` data-section="${id}"` : '');

  const socials = (content.socials || [])
    .filter((item) => item && item.icon)
    .map((item, index) => {
      const url = item.url ? `href="${esc(item.url)}" target="_blank" rel="noopener"` : 'href="#"';
      return `<a class="social" ${url} aria-label="${esc(item.label)}"${
        item.url ? '' : ' title="Скоро"'
      }${eb('socials', index)}><img src="${esc(item.icon)}" alt="" width="32" height="32"${ei(
        `socials.${index}.icon`
      )}></a>`;
    })
    .join('');

  const langSwitch = (footer) => {
    const base = footer ? ' lang--footer' : '';
    const ruActive = lang === 'ru' ? ' is-active' : '';
    const kzActive = lang === 'kz' ? ' is-active' : '';
    return `<div class="lang${base}" role="group" aria-label="Язык сайта / Сайт тілі">
          <a class="lang__btn${ruActive}" href="?lang=ru" data-lang="ru"${
      lang === 'ru' ? ' aria-current="true"' : ''
    }>RU</a>
          <a class="lang__btn${kzActive}" href="?lang=kz" data-lang="kz"${
      lang === 'kz' ? ' aria-current="true"' : ''
    }>KZ</a>
        </div>`;
  };

  const bookButton = (classes, label, editPath) =>
    `<a class="btn ${classes}" href="tel:${esc(content.contacts.phone)}"${
      editPath ? ea(editPath) : ''
    }>${w(label)}</a>`;

  const themeVars = [
    `--lime:${content.theme.lime}`,
    `--lime-soft:${content.theme.limeSoft}`,
    `--purple:${content.theme.purple}`,
    `--purple-deep:${content.theme.purpleDeep}`,
    `--purple-mid:${content.theme.purpleMid}`,
    `--pattern:url("${content.theme.pattern}")`,
  ].join(';');

  /* ---------- ЭТАПЫ ДИАГНОСТИКИ ---------- */
  const stepsSection = !sections.steps
    ? ''
    : `
  <section class="steps" id="steps"${es('steps')}>
    <div class="steps__grid">
      <article class="step step--lime">
        <h2 class="step__title"${ea('steps.intro.title')}>${w(content.steps.intro.title)}</h2>

        <div class="steps__hint" aria-hidden="true">
          <span${ea('steps.intro.hint')}>${w(content.steps.intro.hint)}</span>
          <svg viewBox="0 0 26 12" width="26" height="12" fill="none">
            <path d="M0 6h23M18 1l5.5 5L18 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </article>
${content.steps.items
  .map(
    (item, index) => `
      <article class="step${item.accent ? ' step--purple' : ''}"${eb('steps.items', index)}>
        <span class="step__num"${ea(`steps.items.${index}.num`)}>${w(item.num)}</span>
        <p class="step__text"${ea(`steps.items.${index}.text`)}>${w(item.text)}</p>
      </article>`
  )
  .join('')}
    </div>
  </section>`;

  /* ---------- КОГДА ЗАНИМАТЬСЯ ---------- */
  const whenSection = !sections.when
    ? ''
    : `
  <section class="when"${es('when')}>
    <div class="when__inner">
      <div class="when__left">
        <h2 class="when__title"${ea('when.title')}>${w(content.when.title)}</h2>
        <ul class="checklist">
${content.when.items
  .map(
    (item, index) =>
      `          <li${eb('when.items', index)}><span${ea(`when.items.${index}.text`)}>${w(
        item.text
      )}</span></li>`
  )
  .join('\n')}
        </ul>
      </div>

      <div class="when__card">
        <h3 class="when__card-title"${ea('when.card.title')}>${w(content.when.card.title)}</h3>
        <p class="when__card-text"${ea('when.card.text1')}>${w(content.when.card.text1)}</p>
        <p class="when__card-text"${ea('when.card.text2')}>${w(content.when.card.text2)}</p>
        ${bookButton('btn--purple btn--md', content.when.card.cta, 'when.card.cta')}
      </div>
    </div>
  </section>`;

  /* ---------- ПАКЕТЫ ---------- */
  const packageCards = (content.packages.items || [])
    .map((pkg, pkgIndex) => {
      const features = (pkg.features || [])
        .map((feature, featureIndex) => {
          if (feature.included) {
            return `          <li${eb(
              `packages.items.${pkgIndex}.features`,
              featureIndex
            )}><span class="pkg__ok"><img src="/assets/icons/check-purple.svg" alt="" width="13" height="10"></span><span${ea(
              `packages.items.${pkgIndex}.features.${featureIndex}.text`
            )}>${w(feature.text)}</span></li>`;
          }
          return `          <li class="is-off"${eb(
            `packages.items.${pkgIndex}.features`,
            featureIndex
          )}><span${ea(`packages.items.${pkgIndex}.features.${featureIndex}.text`)}>${w(
            feature.text
          )}</span></li>`;
        })
        .join('\n');

      return `
      <article class="pkg"${eb('packages.items', pkgIndex)}>
        <h3 class="pkg__title"${ea(`packages.items.${pkgIndex}.title`)}>${w(pkg.title)}</h3>
        <ul class="pkg__list">
${features}
        </ul>
        <p class="pkg__why"${ea(`packages.items.${pkgIndex}.why`)}>${w(pkg.why)}</p>
        <p class="pkg__price"${ea(`packages.items.${pkgIndex}.price`)}>${w(pkg.price)}</p>
        ${bookButton('btn--lime btn--md', pkg.cta, `packages.items.${pkgIndex}.cta`)}
      </article>`;
    })
    .join('');

  const splitCard =
    content.packages.split && content.packages.split.visible
      ? `
      <article class="split">
        <h3 class="split__title"${ea('packages.split.title')}>${w(content.packages.split.title)}</h3>
        <p class="split__price"${ea('packages.split.price')}>${w(content.packages.split.price)}</p>
        ${bookButton('btn--white btn--md', content.packages.split.cta, 'packages.split.cta')}
      </article>`
      : '';

  const packagesTitle = t(content.packages.title)
    ? `    <h2 class="packages__title"${ea('packages.title')}>${w(content.packages.title)}</h2>\n`
    : '';
  const packagesNote = t(content.packages.note)
    ? `\n    <p class="packages__note"${ea('packages.note')}>${w(content.packages.note)}</p>`
    : '';

  const packagesSection = !sections.packages
    ? ''
    : `
  <section class="packages" id="packages"${es('packages')}>
${packagesTitle}    <div class="packages__row">${packageCards}${splitCard}
    </div>${packagesNote}
  </section>`;

  /* ---------- УСЛУГИ ---------- */
  const serviceCards = (content.services.items || [])
    .map((item, index, all) => {
      const variant = index === 0 ? ' svc--massage' : index === all.length - 1 ? ' svc--ir' : '';
      const p = `services.items.${index}`;
      const badge = t(item.badge)
        ? `<span class="svc__tag svc__tag--physio"${ea(`${p}.badge`)}>${w(item.badge)}</span>`
        : '';
      const badgeMobile = t(item.badgeMobile)
        ? `<span class="svc__tag svc__tag--ir">${w(item.badgeMobile)}</span>`
        : '';
      const title = t(item.title) ? `<h3 class="svc__title"${ea(`${p}.title`)}>${w(item.title)}</h3>` : '';
      const lead = t(item.lead) ? `<p class="svc__lead"${ea(`${p}.lead`)}>${w(item.lead)}</p>` : '';
      const sub = t(item.sub) ? `<p class="svc__sub"${ea(`${p}.sub`)}>${w(item.sub)}</p>` : '';
      const prices = item.pricesUrl
        ? `<a class="svc__prices" href="${esc(item.pricesUrl)}"${ea('services.pricesLabel')}>${w(
            content.services.pricesLabel
          )}</a>`
        : `<span class="svc__prices"${ea('services.pricesLabel')}>${w(content.services.pricesLabel)}</span>`;

      return `
      <article class="svc${variant}"${eb('services.items', index)}>
        ${badge}${badgeMobile}
        ${title}
        ${lead}
        ${sub}
        <div class="svc__foot">
          ${prices}
          <span class="svc__circle" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </span>
        </div>
      </article>`;
    })
    .join('');

  const servicesSection = !sections.services
    ? ''
    : `
  <section class="services" id="services"${es('services')}>
    <div class="services__top">
      <figure class="services__media">
        <img src="${esc(content.services.photo)}" alt="${esc(t(content.services.photoAlt))}" width="1700" height="949"${ei(
          'services.photo'
        )}>
      </figure>
      <div class="services__exp">
        <p class="services__num"${ea('services.years')}>${w(content.services.years)}</p>
        <p class="services__num-sub"${ea('services.yearsLabel')}>${w(content.services.yearsLabel)}</p>
        <p class="services__num-text"${ea('services.yearsText')}>${w(content.services.yearsText)}</p>
      </div>
    </div>

    <div class="services__row">${serviceCards}
    </div>
  </section>`;

  /* ---------- КОМАНДА ---------- */
  const teamPeople = (content.team.items || [])
    .map((person, index) => {
      const p = `team.items.${index}`;
      const photo = person.photo
        ? `<img class="person__photo" src="${esc(person.photo)}" alt="${esc(person.name)}" width="792" height="792"${ei(
            `${p}.photo`
          )}>`
        : '<div class="person__photo person__photo--empty" aria-hidden="true"></div>';
      const link = person.link
        ? `<a class="person__link" href="${esc(person.link)}"${ea('team.linkLabel')}>${w(content.team.linkLabel)}</a>`
        : `<a class="person__link" href="#" role="link" aria-disabled="true"${ea(
            'team.linkLabel'
          )}>${w(content.team.linkLabel)}</a>`;

      return `
      <article class="person"${eb('team.items', index)}>
        ${photo}
        <p class="person__name"${ea(`${p}.name`)}>${esc(person.name)}</p>
        ${link}
      </article>`;
    })
    .join('');

  const teamSection = !sections.team
    ? ''
    : `
  <section class="team" id="team"${es('team')}>
    <h2 class="team__title"${ea('team.title')}>${w(content.team.title)}</h2>
    <div class="team__inner">${teamPeople}
    </div>
  </section>`;

  /* ---------- ОТЗЫВЫ ---------- */
  const reviewCards = (content.reviews.items || [])
    .map((review, index) => {
      const rating = Math.max(0, Math.min(5, Number(review.rating) || 0));
      const p = `reviews.items.${index}`;
      const stars = Array.from({ length: 5 }, () =>
        `<img src="/assets/icons/star.svg" alt="">`
      )
        .slice(0, rating)
        .join('');
      return `
      <article class="rev"${eb('reviews.items', index)}>
        <header class="rev__head">
          <span class="rev__avatar"${ea(`${p}.initials`)}>${esc(review.initials)}</span>
          <span class="rev__name"${ea(`${p}.name`)}>${esc(review.name)}</span>
          <span class="rev__stars" aria-label="${rating} из 5">${stars}</span>
        </header>
        <div class="rev__text"${ea(`${p}.text`)}>${paragraphs(review.text, lang)}</div>
      </article>`;
    })
    .join('');

  const reviewsSection = !sections.reviews
    ? ''
    : `
  <section class="reviews" id="reviews"${es('reviews')}>
    <div class="reviews__head">
      <span class="reviews__quote" aria-hidden="true">“</span>
      <h2 class="reviews__title"${ea('reviews.title')}>${w(content.reviews.title)}</h2>
    </div>

    <div class="reviews__track">${reviewCards}
    </div>

    <div class="reviews__actions">
      ${bookButton('btn--purple btn--md', content.reviews.cta, 'reviews.cta')}
      <a class="btn btn--lime btn--md btn--wide" href="${esc(content.reviews.moreUrl)}" target="_blank" rel="noopener"${ea(
      'reviews.moreLabel'
    )}>${w(content.reviews.moreLabel)}</a>
    </div>
  </section>`;

  /* ---------- FAQ ---------- */
  const faqItems = (content.faq.items || [])
    .map(
      (item, index) => `
      <div class="faq-item${item.open ? ' is-open' : ''}"${eb('faq.items', index)}>
        <button class="faq-item__q" type="button" aria-expanded="${item.open ? 'true' : 'false'}">
          <span${ea(`faq.items.${index}.question`)}>${w(item.question)}</span>
          <img class="faq-item__icon" src="/assets/icons/close.svg" alt="" width="24" height="24">
        </button>
        <div class="faq-item__a"><p${ea(`faq.items.${index}.answer`)}>${w(item.answer)}</p></div>
      </div>`
    )
    .join('');

  const faqSection = !sections.faq
    ? ''
    : `
  <section class="faq" id="faq"${es('faq')}>
    <h2 class="faq__title"${ea('faq.title')}>${w(content.faq.title)}</h2>

    <div class="faq__list">${faqItems}
    </div>
  </section>`;

  /* ---------- ПОДВАЛ ---------- */
  const footerLinks = (content.footer.nav || [])
    .map(
      (link, index) =>
        `        <a href="${esc(link.href)}"${eb('footer.nav', index)}><span${ea(
          `footer.nav.${index}.label`
        )}>${w(link.label)}</span></a>`
    )
    .join('\n');

  const footerSection = !sections.footer
    ? ''
    : `
  <footer class="footer"${es('footer')}>
    <div class="footer__inner">
      <div class="footer__brand">
        <p class="footer__logo"><span class="footer__logo-part"${ea(
          'brand.name'
        )}>${esc(content.brand.name)}</span><span class="footer__logo-dot">${esc(
      content.brand.dot
    )}</span><span class="footer__logo-part"${ea('brand.city')}>${esc(content.brand.city)}</span></p>
        <p class="footer__tagline"${ea('footer.tagline')}>${w(content.footer.tagline)}</p>
        <div class="footer__socials">${socials}</div>
      </div>

      <nav class="footer__nav" aria-label="${esc(t(content.footer.navTitle))}">
        <p class="footer__head"${ea('footer.navTitle')}>${w(content.footer.navTitle)}</p>
${footerLinks}
      </nav>

      <div class="footer__contacts">
        <p class="footer__head"${ea('footer.contactsTitle')}>${w(content.footer.contactsTitle)}</p>
        <a class="footer__phone" href="tel:${esc(content.contacts.phone)}"${ea(
      'contacts.phoneDisplay'
    )}>${esc(content.contacts.phoneDisplay)}</a>
        <a class="footer__link" href="${esc(content.contacts.booking)}" target="_blank" rel="noopener"${ea(
      'footer.onlineLabel'
    )}>${w(content.footer.onlineLabel)}</a>
        <a class="footer__link" href="${esc(content.contacts.map)}" target="_blank" rel="noopener"${ea(
      'footer.mapLabel'
    )}>${w(content.footer.mapLabel)}</a>
      </div>
    </div>

    <div class="footer__bottom">
      <p${ea('footer.copyright')}>${w(content.footer.copyright)}</p>
      ${langSwitch(true)}
    </div>
  </footer>`;

  const sectionBlocks = {
    steps: stepsSection,
    when: whenSection,
    packages: packagesSection,
    services: servicesSection,
    team: teamSection,
    reviews: reviewsSection,
    faq: faqSection,
  };
  const middleSections = sectionOrder(sections)
    .map((id) => sectionBlocks[id] || '')
    .join('\n');

  const title = t(content.meta.title);
  const description = t(content.meta.description);
  const ogImage = /^https?:\/\//i.test(content.hero.photo)
    ? content.hero.photo
    : `${origin}${content.hero.photo}`;

  return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(origin)}/?lang=${lang}">
  <link rel="alternate" hreflang="ru" href="${esc(origin)}/?lang=ru">
  <link rel="alternate" hreflang="kk" href="${esc(origin)}/?lang=kz">
  <link rel="alternate" hreflang="x-default" href="${esc(origin)}/">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${esc(ogImage)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Manrope:wght@300;400;500;700&family=Gravitas+One&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <style>:root{${themeVars}}</style>
</head>
<body${edit ? ' class="is-editor"' : ''}>

  <!-- ГЕРОЙ -->
  <section class="hero"${es('hero')}>
    <div class="hero__left">
      <div class="hero__top">
        ${langSwitch(false)}

        <div class="hero__socials">${socials}</div>
      </div>

      <div class="hero__center">
        <h1 class="hero__title"${ea('hero.title')}>${w(content.hero.title)}</h1>
        <p class="hero__subtitle"${ea('hero.subtitle')}>${w(content.hero.subtitle)}</p>
        ${bookButton('btn--purple btn--hero', content.hero.cta, 'hero.cta')}
      </div>
    </div>

    <div class="hero__media">
      <img class="hero__photo" src="${esc(content.hero.photo)}" alt="${esc(
    t(content.hero.photoAlt)
  )}" width="1280" height="720"${ei('hero.photo')}>
    </div>
  </section>
${middleSections}
${footerSection}

  <!-- МОДАЛКА ЗАПИСИ -->
  <div class="modal" id="booking-modal" role="dialog" aria-modal="true" aria-labelledby="booking-title" aria-hidden="true">
    <div class="modal__overlay" data-close></div>

    <div class="modal__dialog">
      <button class="modal__close" type="button" data-close aria-label="Закрыть">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>

      <p class="modal__eyebrow">${w(content.modal.eyebrow)}</p>
      <h2 class="modal__title" id="booking-title">${w(content.modal.title)}</h2>
      <p class="modal__text">${w(content.modal.text)}</p>

      <div class="modal__actions">
        <a class="modal__option modal__option--site" href="${esc(content.contacts.booking)}" target="_blank" rel="noopener">
          <span class="modal__option-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>
          </span>
          <span class="modal__option-body">
            <span class="modal__option-title">${w(content.modal.siteTitle)}</span>
            <span class="modal__option-sub">${w(content.modal.siteSub)}</span>
          </span>
          <svg class="modal__option-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </a>

        <a class="modal__option modal__option--wa" href="${esc(content.contacts.whatsappBooking)}" target="_blank" rel="noopener">
          <span class="modal__option-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.5L3.5 20.5l1.4-4.2a8.5 8.5 0 1 1 15.6-4.6Z"/><path d="M9 8.7c.2-.4.5-.4.8-.4h.5c.2 0 .4.1.5.4l.7 1.6c.1.2 0 .4-.1.5l-.5.6c-.1.2-.2.3 0 .6.4.7 1.2 1.4 2 1.8.3.1.4.1.6-.1l.6-.7c.2-.2.3-.2.5-.1l1.6.8c.2.1.3.3.3.5 0 .8-.5 1.5-1.4 1.7-.6.1-1.4 0-2.7-.6a9 9 0 0 1-3.6-3.2c-.6-1-.8-1.7-.8-2.3 0-.5.2-.9.5-1.1Z"/></svg>
          </span>
          <span class="modal__option-body">
            <span class="modal__option-title">${w(content.modal.waTitle)}</span>
            <span class="modal__option-sub">${w(content.modal.waSub)}</span>
          </span>
          <svg class="modal__option-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </a>
      </div>

      <p class="modal__note"><span>${w(content.modal.callNote)}</span> <a href="tel:${esc(
    content.contacts.phone
  )}">${esc(content.contacts.phoneDisplay)}</a></p>
    </div>
  </div>

  ${edit ? '' : '<script src="/script.js"></script>'}
</body>
</html>
`;
}

module.exports = { renderPage, esc, rich, pick };
