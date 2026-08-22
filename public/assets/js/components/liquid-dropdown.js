/**
 * Lumen Liquid-Glass Dropdown Component
 * Reusable dropdown component based on lg-09 reference design
 * Uses <details>/<summary> for native accessibility
 */

export function createLiquidDropdown(options = {}) {
  const {
    container,
    options: dropdownOptions = [],
    value,
    onChange,
    placeholder = 'Select...',
    disabled = false,
    searchable = false,
    maxHeight = 280,
    renderOption,
    className = '',
    id
  } = options;

  const dropdownId = id || `lg-dropdown-${Math.random().toString(36).substr(2, 9)}`;
  let selectedValue = value;
  let isOpen = false;

  // Create the dropdown element
  const details = document.createElement('details');
  details.className = `lg-dropdown ${className}`.trim();
  if (id) details.id = dropdownId;

  // Build trigger content
  const selectedOption = dropdownOptions.find(opt => opt.value === selectedValue);
  const triggerText = selectedValue ? (selectedOption?.label || selectedValue) : placeholder;

  // Build options HTML
  const optionsHtml = dropdownOptions.map(opt => {
    const isSelected = opt.value === selectedValue;
    const isDisabled = opt.disabled;
    const checkIcon = isSelected ? `
      <span class="lg-dropdown__item-check" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </span>
    ` : '';

    const label = renderOption ? renderOption(opt) : opt.label;

    return `
      <li class="lg-dropdown__item ${isSelected ? 'lg-dropdown__item--selected' : ''} ${isDisabled ? 'lg-dropdown__item--disabled' : ''}"
          data-value="${escapeHtml(opt.value)}"
          role="option"
          aria-selected="${isSelected}"
          ${isDisabled ? 'aria-disabled="true"' : ''}
          tabindex="${isDisabled ? '-1' : '0'}">
        <span class="lg-dropdown__item-text">${escapeHtml(label)}</span>
        ${checkIcon}
      </li>
    `;
  }).join('');

  // Build the dropdown HTML
  details.innerHTML = `
    <summary class="lg-dropdown__trigger" aria-haspopup="listbox" aria-expanded="false" ${disabled ? 'aria-disabled="true"' : ''} tabindex="${disabled ? '-1' : '0'}">
      <span class="lg-dropdown__trigger-text">${escapeHtml(triggerText)}</span>
      <span class="lg-dropdown__chevron" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </span>
    </summary>
    <div class="lg-dropdown__panel" role="listbox" aria-label="${escapeHtml(placeholder)}">
      <ul class="lg-dropdown__list">
        ${optionsHtml}
      </ul>
    </div>
  `;

  // Append the dropdown to the container
  if (container) {
    container.innerHTML = '';
    container.appendChild(details);
  }

  // Prevent native details toggle behavior - we'll handle it manually for animation
  details.addEventListener('toggle', (e) => {
    if (!details.open && isOpen) {
      // Prevent closing during animation
      e.preventDefault();
    }
  });

  // Handle trigger click
  const trigger = details.querySelector('.lg-dropdown__trigger');
  const panel = details.querySelector('.lg-dropdown__panel');
  const list = details.querySelector('.lg-dropdown__list');

  // The panel animates via max-height (see components.css) so it stays in
  // normal document flow and pushes following content down instead of
  // floating over it. That target height comes from the `maxHeight` option
  // (default 280) set here as an inline style, since CSS alone has no way
  // to know the per-instance value passed into this component.
  //
  // The inner list also needs its own explicit pixel max-height (not the
  // "100%" in components.css) - a percentage height only resolves against
  // a parent with an explicit (non-auto) height, and the panel's height is
  // driven by its content, not set directly. Browsers treat that
  // percentage as unconstrained, so without this the list never scrolls
  // and a screen (or day) list taller than the panel just gets silently
  // clipped by the panel's own overflow:hidden with no way to reach the
  // rest of it.
  const listMaxHeight = Math.max(0, maxHeight - 12);
  panel.style.maxHeight = '0px';
  list.style.maxHeight = `${listMaxHeight}px`;

  function open() {
    if (disabled) return;
    details.open = true;
    isOpen = true;
    trigger.setAttribute('aria-expanded', 'true');
    panel.style.maxHeight = `${maxHeight}px`;
    // Focus first item for keyboard navigation
    const firstItem = list.querySelector('.lg-dropdown__item:not(.lg-dropdown__item--disabled)');
    if (firstItem) firstItem.focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    trigger.setAttribute('aria-expanded', 'false');
    panel.style.maxHeight = '0px';
    details.open = false;
    trigger.focus();
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    toggle();
  });

  // Keyboard navigation
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      open();
    } else if (e.key === 'Escape') {
      close();
    }
  });

  // Panel keyboard navigation
  list.addEventListener('keydown', (e) => {
    const items = Array.from(list.querySelectorAll('.lg-dropdown__item:not(.lg-dropdown__item--disabled)'));
    const currentIndex = items.findIndex(item => item === document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = Math.min(currentIndex + 1, items.length - 1);
      items[nextIndex]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = Math.max(currentIndex - 1, 0);
      items[prevIndex]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (document.activeElement.classList.contains('lg-dropdown__item')) {
        document.activeElement.click();
      }
    } else if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  });

  // Click on option
  list.addEventListener('click', (e) => {
    const item = e.target.closest('.lg-dropdown__item');
    if (!item || item.classList.contains('lg-dropdown__item--disabled')) return;

    const newValue = item.dataset.value;
    if (newValue !== selectedValue) {
      selectedValue = newValue;
      const newOption = dropdownOptions.find(opt => opt.value === newValue);
      trigger.querySelector('.lg-dropdown__trigger-text').textContent = newOption?.label || newValue;

      // Update selected states
      list.querySelectorAll('.lg-dropdown__item').forEach(opt => {
        const isSelected = opt.dataset.value === newValue;
        opt.classList.toggle('lg-dropdown__item--selected', isSelected);
        opt.setAttribute('aria-selected', isSelected);
        const check = opt.querySelector('.lg-dropdown__item-check');
        if (check) check.remove();
        if (isSelected) {
          opt.insertAdjacentHTML('beforeend', `
            <span class="lg-dropdown__item-check" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </span>
          `);
        }
      });

      close();
      if (onChange) onChange(newValue, newOption);
    }
  });

  // Close on outside click
  function handleOutsideClick(e) {
    if (isOpen && !details.contains(e.target)) {
      close();
    }
  }
  document.addEventListener('click', handleOutsideClick);

  // Close on Escape
  function handleEscape(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', handleEscape);

  // Cleanup function
  const destroy = () => {
    document.removeEventListener('click', handleOutsideClick);
    document.removeEventListener('keydown', handleEscape);
    details.remove();
  };

  // Public API
  const api = {
    element: details,
    open,
    close,
    toggle,
    getValue: () => selectedValue,
    setValue: (newValue) => {
      const option = dropdownOptions.find(opt => opt.value === newValue);
      if (option) {
        selectedValue = newValue;
        trigger.querySelector('.lg-dropdown__trigger-text').textContent = option.label;
        list.querySelectorAll('.lg-dropdown__item').forEach(opt => {
          const isSelected = opt.dataset.value === newValue;
          opt.classList.toggle('lg-dropdown__item--selected', isSelected);
          opt.setAttribute('aria-selected', isSelected);
        });
      }
    },
    setOptions: (newOptions) => {
      dropdownOptions = newOptions;
      // Rebuild options
      const optionsHtml = newOptions.map(opt => {
        const isSelected = opt.value === selectedValue;
        const isDisabled = opt.disabled;
        const checkIcon = isSelected ? `
          <span class="lg-dropdown__item-check" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </span>
        ` : '';
        const label = renderOption ? renderOption(opt) : opt.label;
        return `
          <li class="lg-dropdown__item ${isSelected ? 'lg-dropdown__item--selected' : ''} ${isDisabled ? 'lg-dropdown__item--disabled' : ''}"
              data-value="${escapeHtml(opt.value)}"
              role="option"
              aria-selected="${isSelected}"
              ${isDisabled ? 'aria-disabled="true"' : ''}
              tabindex="${isDisabled ? '-1' : '0'}">
            <span class="lg-dropdown__item-text">${escapeHtml(label)}</span>
            ${checkIcon}
          </li>
        `;
      }).join('');
      list.innerHTML = optionsHtml;
    },
    setDisabled: (isDisabled) => {
      disabled = isDisabled;
      trigger.setAttribute('aria-disabled', isDisabled);
      trigger.tabIndex = isDisabled ? -1 : 0;
      if (isDisabled && isOpen) close();
    },
    destroy
  };

  return api;
}

// Utility function
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

// Helper to convert native <select> to liquid dropdown
export function convertSelectToLiquidDropdown(selectElement, options = {}) {
  const select = typeof selectElement === 'string' ? document.querySelector(selectElement) : selectElement;
  if (!select) return null;

  const options_list = Array.from(select.options).map(opt => ({
    value: opt.value,
    label: opt.textContent,
    disabled: opt.disabled
  }));

  const dropdown = createLiquidDropdown({
    trigger: select,
    options: options_list,
    value: select.value,
    placeholder: select.querySelector('option[value=""]')?.textContent || 'Select...',
    disabled: select.disabled,
    onChange: (value) => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
    ...options
  });

  // Replace the select with the dropdown
  select.style.display = 'none';
  select.parentNode.insertBefore(dropdown.element, select.nextSibling);

  // Sync disabled state
  const observer = new MutationObserver(() => {
    dropdown.setDisabled(select.disabled);
  });
  observer.observe(select, { attributes: true, attributeFilter: ['disabled'] });

  return dropdown;
}