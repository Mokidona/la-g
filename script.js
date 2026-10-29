/* FAQ-аккордеон: в макете все ответы раскрыты, иконка «×» сворачивает карточку */

document.querySelectorAll('.faq-item').forEach((item) => {
  const button = item.querySelector('.faq-item__q');

  button.addEventListener('click', () => {
    const isOpen = item.classList.toggle('is-open');
    button.setAttribute('aria-expanded', String(isOpen));
  });
});
