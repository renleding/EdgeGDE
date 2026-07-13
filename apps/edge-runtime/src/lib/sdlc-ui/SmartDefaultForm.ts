/**
 * Smart Default Form Component - Clean Implementation
 * Based on UX Principles Report v2 - Smart Defaults Pattern
 */

import { smartDefaultsTokens } from './design-tokens';

export interface SmartDefault {
  value: string;
  source: 'user' | 'project' | 'team' | 'global' | 'heuristic';
  modified?: boolean;
  description?: string;
}

export interface SmartDefaultFormProps {
  fields: SmartDefaultField[];
  onSubmit: (data: Record<string, string>) => Promise<void> | void;
  formId?: string;
  submitText?: string;
  showDefaultsIndicator?: boolean;
  className?: string;
  loading?: boolean;
  error?: string;
  success?: string;
}

export interface SmartDefaultField {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'number' | 'select' | 'textarea' | 'checkbox' | 'radio' | 'password';
  default?: SmartDefault | string | (() => string | Promise<string>);
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: Array<{ value: string; label: string }>;
  validation?: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    custom?: (value: string) => string | null;
  };
  dependsOn?: string[];
  group?: string;
  showDefaultIndicator?: boolean;
  defaultSourceLabel?: string;
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

function renderField(field: SmartDefaultField, showDefaultsIndicator: boolean): string {
  const {
    name,
    label,
    type = 'text',
    required = false,
    placeholder,
    helpText,
    options,
    validation,
    default: defaultValue,
    showDefaultIndicator = true,
  } = field;

  const hasDefault = defaultValue !== undefined && defaultValue !== null && defaultValue !== '';
  const defaultValueStr = typeof defaultValue === 'function' ? '' : String(defaultValue);
  const defaultSource = typeof defaultValue === 'object' && defaultValue?.source ? defaultValue.source : 'heuristic';
  const defaultLabel = field.defaultSourceLabel || defaultSource;

  const requiredMark = required ? '<span class="sdlc-required-mark">required</span>' : '';
  const defaultBadgeHtml = showDefaultsIndicator && hasDefault && showDefaultIndicator
    ? `<span class="sdlc-default-badge" title="Default from ${escapeHtml(defaultLabel)}">${defaultLabel}</span>`
    : '';

  const helpTextHtml = helpText ? `<div class="sdlc-field-hint">${escapeHtml(helpText)}</div>` : '';

  const defaultAttr = hasDefault ? `data-default="true" data-default-source="${escapeHtml(defaultSource)}"` : '';
  const modifiedClass = hasDefault ? 'sdlc-form-field' : 'sdlc-form-field';

  let inputHtml = '';

  switch (type) {
    case 'textarea':
      inputHtml = `
        <textarea 
          name="${escapeHtml(name)}" 
          class="sdlc-textarea" 
          ${defaultAttr}
          ${required ? 'required' : ''}
          ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''}
          ${validation?.minLength ? `minlength="${validation.minLength}"` : ''}
          ${validation?.maxLength ? `maxlength="${validation.maxLength}"` : ''}
        >${defaultValueStr ? escapeHtml(defaultValueStr) : ''}</textarea>
      `;
      break;
    case 'select':
      inputHtml = `
        <select 
          name="${escapeHtml(name)}" 
          class="sdlc-select" 
          ${defaultAttr}
          ${required ? 'required' : ''}
        >
          ${placeholder ? `<option value="" disabled selected>${escapeHtml(placeholder)}</option>` : ''}
          ${options?.map(opt => `<option value="${escapeHtml(opt.value)}" ${defaultValueStr === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('') || ''}
        </select>
      `;
      break;
    case 'checkbox':
      inputHtml = `
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input 
            type="checkbox" 
            name="${escapeHtml(name)}" 
            class="sdlc-checkbox" 
            ${defaultAttr}
            ${required ? 'required' : ''}
            ${hasDefault && defaultValueStr === 'true' ? 'checked' : ''}
          >
          <span>${escapeHtml(label)}</span>
        </label>
      `;
      break;
    case 'radio':
      inputHtml = `
        <fieldset style="display: flex; flex-direction: column; gap: 8px;">
          ${options?.map(opt => `
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input 
                type="radio" 
                name="${escapeHtml(name)}" 
                value="${escapeHtml(opt.value)}" 
                class="sdlc-radio" 
                ${defaultAttr}
                ${required ? 'required' : ''}
                ${defaultValueStr === opt.value ? 'checked' : ''}
              >
              <span>${escapeHtml(opt.label)}</span>
            </label>
          `).join('') || ''}
        </fieldset>
      `;
      break;
    default:
      inputHtml = `
        <input 
          type="${type}" 
          name="${escapeHtml(name)}" 
          class="sdlc-input" 
          ${defaultAttr}
          ${required ? 'required' : ''}
          ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''}
          ${validation?.minLength ? `minlength="${validation.minLength}"` : ''}
          ${validation?.maxLength ? `maxlength="${validation.maxLength}"` : ''}
          ${validation?.pattern ? `pattern="${validation.pattern.source}"` : ''}
          value="${defaultValueStr ? escapeHtml(defaultValueStr) : ''}"
        >
      `;
  }

  // defaultBadgeHtml already declared at line 79 - using that one
  // const defaultBadgeHtml = showDefaultsIndicator && hasDefault && showDefaultIndicator

  const fieldHtml = `
      <div 
        class="${modifiedClass}" 
        data-field-name="${escapeHtml(name)}"
        data-field-type="${type}"
      >
        <label class="sdlc-form-label">
          ${escapeHtml(label)} ${defaultBadgeHtml} ${requiredMark}
        </label>
        <div class="sdlc-field-wrapper">
          ${inputHtml}
          ${helpTextHtml}
          ${defaultBadgeHtml}
        </div>
      </div>
    `;

  return fieldHtml;
}

/**
 * Render a smart default form
 */
export async function renderSmartDefaultForm(props: SmartDefaultFormProps): Promise<string> {
  const {
    fields = [],
    formId = 'smart-default-form',
    submitText = 'Continue',
    showDefaultsIndicator = true,
    className = '',
    loading = false,
    error,
    success,
  } = props;

  const hasDefaults = fields.some(f => f.default);
  const defaultsIndicator = showDefaultsIndicator && hasDefaults ? `
      <div class="sdlc-defaults-indicator" style="
        display: flex; align-items: center; gap: 8px; 
        padding: 10px 14px; background: var(--default-bg, #161b22); 
        border: 1px solid var(--default-border, #2d3140); border-radius: 8px;
        margin-bottom: 20px; font-size: 13px; color: var(--default-text, #e1e4e8);
      ">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink: 0;">
          <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zm0 1a5.5 5.5 0 110 11 5.5 5.5 0 000-11zm-.75 3a.75.75 0 01-.53.22l-2.5-2.5a.75.75 0 111.06-1.06l2 2 3.25-3.5a.75.75 0 111.42 1.42l-2.75 2.75.02.02v.75a.75.75 0 01-.53.22h-.02Z"/>
        </svg>
        <span>Smart defaults applied from your context. Edit any field to override.</span>
      </div>
    ` : '';

  const fieldsHtml = fields.map(field => renderField(field, showDefaultsIndicator)).join('\n');

  const submitButton = `
    <button 
      type="submit" 
      class="btn btn-primary sdlc-submit-btn"
      ${loading ? 'disabled' : ''}
      ${loading ? 'aria-busy="true"' : ''}
    >
      ${loading ? '<span class="spinner"></span> ' : ''}${submitText}
    </button>
  `;

  const errorHtml = error ? `
    <div class="form-error" role="alert">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="margin-right: 8px;">
        <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm3.78 10.22a.75.75 0 01-1.06 0L8 9.06 5.28 11.78a.75.75 0 11-1.06-1.06L6.94 8 4.22 5.28a.75.75 0 011.06-1.06L8 6.94l2.78-2.78a.75.75 0 011.06 1.06L9.06 8l2.78 2.78a.75.75 0 11-1.06 1.06z"/>
      </svg>
      <span>${escapeHtml(error)}</span>
    </div>
  ` : '';

  const successHtml = success ? `
    <div class="form-success" role="alert" style="
      display: flex; align-items: center; gap: 8px; padding: 12px 16px; 
      background: var(--inline-success-bg, #162a16); border: 1px solid var(--inline-success-border, #3fb950); 
      border-radius: 8px; color: var(--inline-success-text, #56d364); font-size: 13px;
    ">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink: 0;">
        <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
      </svg>
      <span>${escapeHtml(success)}</span>
    </div>
  ` : '';

  return `
<form id="smart-default-form" class="sdlc-smart-form ${className}" 
      data-form-id="${escapeHtml(formId)}"
      novalidate
      style="display: flex; flex-direction: column; gap: 16px; max-width: 640px;">
  ${errorHtml}
  ${successHtml}
  ${defaultsIndicator}
  <div class="sdlc-form-fields" style="display: flex; flex-direction: column; gap: 16px;">
    ${fieldsHtml}
  </div>
  <div class="form-actions" style="display: flex; gap: 12px; margin-top: 8px; flex-wrap: wrap;">
    ${submitButton}
    <button 
      type="button" 
      class="btn btn-secondary"
      onclick="this.form.reset(); this.form.querySelectorAll('[data-default]').forEach(el => el.classList.remove('modified')); document.dispatchEvent(new CustomEvent('form-reset'));"
      ${loading ? 'disabled' : ''}
    >
      Reset to defaults
    </button>
  </div>
</form>

<style>
.sdlc-smart-form { display: flex; flex-direction: column; gap: 16px; }
.sdlc-form-field { display: flex; flex-direction: column; gap: 6px; }
.sdlc-field-group { display: flex; flex-direction: column; gap: 24px; margin-bottom: 8px; }
.sdlc-form-label { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--default-label, #8b949e); }
.sdlc-required-mark { color: var(--inline-error-text, #ff7b72); font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
.sdlc-default-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 4px; background: var(--default-bg, #161b22); color: var(--default-text, #e1e4e8); border: 1px solid var(--default-border, #2d3140); }
.sdlc-default-source { font-size: 9px; color: var(--default-text, #8b949e); text-transform: uppercase; letter-spacing: 0.5px; }
.sdlc-field-wrapper { position: relative; }
.sdlc-input, .sdlc-select, .sdlc-textarea { width: 100%; padding: 10px 12px; font-size: 14px; font-family: inherit; color: var(--default-text, #e1e4e8); background: var(--default-field-bg, #161b22); border: 1px solid var(--default-border, #2d3140); border-radius: 6px; transition: border-color 0.15s ease, box-shadow 0.15s ease; background-image: none; }
.sdlc-input:hover, .sdlc-select:hover, .sdlc-textarea:hover { border-color: var(--default-border-hover, #3d3d50); }
.sdlc-input:focus, .sdlc-select:focus, .sdlc-textarea:focus { outline: none; border-color: var(--default-focus-border, #3fb950); box-shadow: 0 0 0 3px var(--default-focus-ring, rgba(63, 185, 80, 0.3)); }
.sdlc-input:disabled, .sdlc-select:disabled, .sdlc-textarea:disabled { opacity: 0.5; cursor: not-allowed; }
.sdlc-input.modified, .sdlc-select.modified, .sdlc-textarea.modified { border-color: var(--modified-border, #3fb950); }
.sdlc-input.modified::placeholder, .sdlc-select.modified::placeholder, .sdlc-textarea.modified::placeholder { color: var(--default-placeholder, #6e7681); }
.sdlc-input[data-default]:not(.modified), .sdlc-select[data-default]:not(.modified), .sdlc-textarea[data-default]:not(.modified) { background-image: linear-gradient(45deg, transparent 48%, rgba(63, 185, 80, 0.08) 50%, rgba(63, 185, 80, 0.08) 52%, transparent 52%); background-size: 4px 4px; }
.sdlc-textarea { min-height: 100px; resize: vertical; line-height: 1.5; }
.sdlc-select { cursor: pointer; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238b949e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 40px; }
.sdlc-select:disabled { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23484f58' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); }
.sdlc-field-hint { font-size: 12px; color: var(--default-label, #8b949e); margin-top: 4px; }
.sdlc-field-error { font-size: 12px; color: var(--inline-error-text, #ff7b72); display: flex; align-items: center; gap: 4px; margin-top: 4px; }
.sdlc-field-error::before { content: ''; width: 10px; height: 10px; background: var(--inline-error-bg, #2d1b1b); border: 1px solid var(--inline-error-border, #f85149); border-radius: 2px; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%23ff7b72'%3E%3Cpath d='M8 0a8 8 0 100 16A8 8 0 008 0zm3.78 10.22a.75.75 0 01-1.06 0L8 9.06 5.28 11.78a.75.75 0 01-1.06-1.06L6.94 8 4.22 5.28a.75.75 0 011.06-1.06L8 6.94l2.78-2.78a.75.75 0 011.06 1.06L9.06 8l2.78 2.78a.75.75 0 01-1.06 1.06z'/%3E%3C/svg%3E"); mask-size: contain; }
.sdlc-defaults-indicator { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--default-bg, #161b22); border: 1px solid var(--default-border, #2d3140); border-radius: 8px; margin-bottom: 20px; font-size: 13px; color: var(--default-text, #e1e4e8); }
.sdlc-defaults-indicator svg { flex-shrink: 0; color: var(--primary, #3fb950); }
.sdlc-form-actions { display: flex; gap: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--default-border, #2d3140); flex-wrap: wrap; }
.sdlc-form-actions .btn { flex: 1; min-width: 140px; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 20px; font-size: 14px; font-weight: 500; border-radius: 8px; text-decoration: none; cursor: pointer; border: none; transition: all 0.15s ease; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--btn-primary-bg, #238636); color: var(--btn-primary-text, #ffffff); }
.btn-primary:hover:not(:disabled) { background: var(--btn-primary-hover, #2ea043); }
.btn-secondary { background: var(--btn-secondary-bg, #1c2128); color: var(--btn-secondary-text, #e1e4e8); border: 1px solid var(--btn-secondary-border, #2d3140); }
.btn-secondary:hover:not(:disabled) { background: var(--btn-secondary-hover, #2d3140); }
.spinner { width: 16px; height: 16px; border: 2px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.form-error { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: var(--inline-error-bg, #2d1b1b); border: 1px solid var(--inline-error-border, #f85149); border-radius: 8px; color: var(--inline-error-text, #ff7b72); font-size: 13px; }
.form-error svg { flex-shrink: 0; }
.form-success { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: var(--inline-success-bg, #162a16); border: 1px solid var(--inline-success-border, #3fb950); border-radius: 8px; color: var(--inline-success-text, #56d364); font-size: 13px; }
.sdlc-form-field.modified > .sdlc-input, .sdlc-form-field.modified > .sdlc-select, .sdlc-form-field.modified > .sdlc-textarea { border-color: var(--modified-border, #3fb950); }
.sdlc-form-field.modified .sdlc-default-badge { opacity: 0.5; }
.sdlc-form-field[data-default]:not(.modified) .sdlc-input, .sdlc-form-field[data-default]:not(.modified) > .sdlc-select, .sdlc-form-field[data-default]:not(.modified) > .sdlc-textarea { background-image: linear-gradient(45deg, transparent 48%, rgba(63, 185, 80, 0.08) 50%, rgba(63, 185, 80, 0.08) 52%, transparent 52%); background-size: 4px 4px; }
.sdlc-defaults-indicator { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--default-bg, #161b22); border: 1px solid var(--default-border, #2d3140); border-radius: 8px; margin-bottom: 20px; font-size: 13px; color: var(--default-text, #e1e4e8); }
.sdlc-defaults-indicator svg { flex-shrink: 0; color: var(--primary, #3fb950); }
.sdlc-form-actions { display: flex; gap: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--default-border, #2d3140); flex-wrap: wrap; }
.sdlc-form-actions .btn { flex: 1; min-width: 140px; }
</style>
`;}
