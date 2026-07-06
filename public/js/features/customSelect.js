export function initCustomSelect() {
  const customSelect = document.querySelector('.custom-select');
  if (!customSelect) return;
  
  const trigger = customSelect.querySelector('.select-trigger');
  const triggerText = trigger.querySelector('span');
  const optionsContainer = customSelect.querySelector('.select-options');
  const options = optionsContainer.querySelectorAll('.option');
  const nativeSelect = document.getElementById('chat-effort-select');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    customSelect.classList.toggle('open');
  });

  options.forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = opt.getAttribute('data-value');
      const text = opt.innerText;

      options.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');

      triggerText.innerText = text;

      nativeSelect.value = val;
      nativeSelect.dispatchEvent(new Event('change'));

      customSelect.classList.remove('open');
    });
  });

  document.addEventListener('click', () => {
    customSelect.classList.remove('open');
  });
}
