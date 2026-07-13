/**
 * Smart Default Form Component
 * Provides pre-filled form fields with intelligent defaults based on context
 * Based on UX Principles Report v2 - Smart Defaults Pattern
 */

import { smartDefaultsTokens } from './design-tokens';

export interface SmartDefault {
  /** Default value */
  value: string;
  /** Source of the default */
  source: 'user' | 'project' | 'team' | 'global' | 'heuristic';
  /** Whether user has modified this field */
  modified?: boolean;
  /** Description of the default */
  description?: string;
}

export interface SmartDefaultFormProps {
  /** Form fields with smart defaults */
  fields: SmartDefaultField[];
  /** Submit handler */
  onSubmit: (data: Record<string, string>) => Promise<void> | void;
  /** Form ID */
  formId?: string;
  /** Submit button text (uses smart framing) */
  submitText?: string;
  /** Show defaults indicator */
  showDefaultsIndicator?: boolean;
  /** Custom class */
  className?: string;
  /** Loading state */
  loading?: boolean;
  /** Error message */
  error?: string;
  /** Success message */
  success?: string;
}

export interface SmartDefaultField {
  /** Field name */
  name: string;
  /** Field label */
  label: string;
  /** Field type */
  type?: 'text' | 'email' | 'number' | 'select' | 'textarea' | 'checkbox' | 'radio' | 'password';
  /** Smart default configuration */
  default?: SmartDefault | string | (() => string | Promise<string>);
  /** Whether field is required */
  required?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Helper text */
  helpText?: string;
  /** Select options */
  options?: Array<{ value: string; label: string }>;
  /** Validation rules */
  validation?: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    custom?: (value: string) => string | null;
  };
  /** Field dependencies (other fields this depends on) */
  dependsOn?: string[];
  /** Field group for layout */
  group?: string;
  /** Whether to show default indicator */
  showDefaultIndicator?: boolean;
  /** Default source label */
  defaultSourceLabel?: string;
}

/**
 * HTML escape utility
 */
function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

/**
 * Render a single smart default field
 */
function renderSmartDefaultField(field: SmartDefaultField, showDefaultsIndicator: boolean): string {
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
  } = field;

  const hasDefault = defaultValue !== undefined && defaultValue !== null && defaultValue !== '';
  const defaultValueStr = typeof defaultValue === 'function' ? '' : String(defaultValue);
  const defaultSource = typeof defaultValue === 'object' && defaultValue?.source ? defaultValue.source : 'heuristic';
  const defaultLabel = field.defaultSourceLabel || defaultSource;

  const requiredMark = required ? '<span class="sdlc-required-mark">required</span>' : '';
  const defaultBadge = (() => {
    if (!hasDefault) return '';
    return `<span class="sdlc-default-badge" title="Default from ${defaultLabel}">${defaultLabel}</span>`;
  })();

  const defaultAttr = hasDefault ? `data-default="true" data-default-value="${escapeHtml(defaultValueStr)}" data-default-source="${escapeHtml(defaultLabel)}"` : '';
  const modifiedClass = hasDefault ? 'data-default="true"' : '';

  const inputHtml = (() => {
    switch (type) {
      case 'select':
        return `
          <select 
            name="${escapeHtml(name)}" 
            class="sdlc-select" 
            ${defaultAttr}
            ${required ? 'required' : ''}
            ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''}
          >
            ${placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : ''}
            ${options?.map(opt => `<option value="${escapeHtml(opt.value)}" ${defaultValueStr === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('') || ''}
          </select>
        `;
      case 'textarea':
        return `
          <textarea 
            name="${escapeHtml(name)}" 
            class="sdlc-textarea" 
            ${defaultAttr}
            ${required ? 'required' : ''}
            ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''}
            ${validation?.minLength ? `minlength="${validation.minLength}"` : ''}
            ${validation?.maxLength ? `maxlength="${validation.maxLength}"` : ''}
            style="min-height: 100px; resize: vertical;"
          >${defaultValueStr ? escapeHtml(defaultValueStr) : ''}</textarea>
        `;
      case 'checkbox':
        return `
          <label class="sdlc-checkbox-wrapper">
            <input 
              type="checkbox" 
              name="${escapeHtml(name)}" 
              class="sdlc-checkbox" 
              ${defaultAttr}
              ${required ? 'required' : ''}
              ${defaultValueStr === 'true' || defaultValueStr === 'on' ? 'checked' : ''}
            >
            <span class="sdlc-checkbox-label">${escapeHtml(label)}</span>
          </label>
        `;
      case 'radio':
        return `
          <div class="sdlc-radio-group">
            ${options?.map(opt => `
              <label class="sdlc-radio-option">
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
          </div>
        `;
      case 'select':
        return `
          <select 
            name="${escapeHtml(name)}" 
            class="sdlc-select" 
            ${defaultAttr}
            ${required ? 'required' : ''}
            ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''}
          >
            ${placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : ''}
            ${options?.map(opt => `<option value="${escapeHtml(opt.value)}" ${defaultValueStr === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('') || ''}
          </select>
        `;
      default:
        return `
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
  })();

  const defaultBadgeHtml = (() => {
    if (!showDefaultsIndicator || !hasDefault) return '';
    return `<span class="sdlc-default-badge" title="Default from ${escapeHtml(defaultLabel)}">${defaultLabel}</span>`;
  })();

  const helpTextHtml = helpText ? `<div class="sdlc-field-hint">${escapeHtml(helpText)}</div>` : '';

  const fieldHtml = `
    <div 
      class="sdlc-form-field ${modifiedClass}" 
      data-field-name="${escapeHtml(name)}"
      data-field-type="${type}"
      ${modifiedClass}
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

const escapeHtml = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
};

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

  const formIdAttr = `form-${formId}`;
  
  // Build field HTML
  const fieldsHtml = fields.map(field => renderSmartDefaultField(field, showDefaultsIndicator)).join('\n');
  
  // Submit button with smart framing
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
      <span>${escapeHtml(success || error)}</span>
    </div>
  ` : '';

  const defaultsIndicator = (() => {
    if (!showDefaultsIndicator) return '';
    const hasDefaults = fields.some(f => f.default !== undefined && f.default !== null && f.default !== '');
    if (!hasDefaults) return '';
    return `
      <div class="sdlc-defaults-indicator" style="
        display: flex; align-items: center; gap: 8px; 
        padding: 8px 12px; background: var(--default-bg, #161b22); 
        border: 1px solid var(--default-border, #2d3140); border-radius: 6px;
        margin-bottom: 16px; font-size: 12px; color: var(--default-text, #e1e4e8);
      ">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink: 0;">
          <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zm0 1a5.5 5.5 0 110 11 5.5 5.5 0 000-11zm-.75 3a.75.75 0 01-.53.22l-2.5-2.5a.75.75 0 111.06-1.06l2 2 3.25-3.5a.75.75 0 111.42 1.42l-2.75 2.75.02.02v.75a.75.75 0 01-.53.22h-.02Z"/>
        </svg>
        <span>Smart defaults applied from your context. Edit any field to override.</span>
      </div>
    ` : '';
  })();

  // Build field HTML
  const fieldsHtml = fields.map(field => {
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
    } = field;

    const hasDefault = defaultValue !== undefined && defaultValue !== null && defaultValue !== '';
    const defaultValueStr = typeof defaultValue === 'function' ? '' : String(defaultValue);
    const defaultSource = typeof defaultValue === 'object' && defaultValue?.source ? defaultValue.source : 'heuristic';
    const defaultLabel = field.defaultSourceLabel || defaultSource;

    const requiredMark = required ? '<span class="sdlc-required-mark">required</span>' : '';
    const defaultBadgeHtml = showDefaultsIndicator && hasDefaults
      ? `<span class="sdlc-default-badge" title="Default from ${defaultLabel}">${defaultLabel}</span>`
      : '';

    const defaultAttr = hasDefault ? `data-default="true" data-default-value="${escapeHtml(defaultValueStr)}" data-default-source="${escapeHtml(defaultLabel)}"` : '';
    const modifiedClass = hasDefault ? 'data-default="true"' : '';

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
            style="min-height: 100px; resize: vertical;"
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
            ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''}
          >
            ${placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : ''}
            ${options?.map(opt => `<option value="${escapeHtml(opt.value)}" ${defaultValueStr === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('') || ''}
          </select>
        `;
        break;
      case 'checkbox':
        inputHtml = `
          <label class="sdlc-checkbox-wrapper">
            <input 
              type="checkbox" 
              name="${escapeHtml(name)}" 
              class="sdlc-checkbox" 
              ${defaultAttr}
              ${required ? 'required' : ''}
              ${defaultValueStr === 'true' || defaultValueStr === 'on' ? 'checked' : ''}
            >
            <span class="sdlc-checkbox-label">${escapeHtml(label)}</span>
          </label>
        `;
        break;
      case 'radio':
        inputHtml = `
          <div class="sdlc-radio-group">
            ${options?.map(opt => `
              <label class="sdlc-radio-option">
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
          </div>
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
        break;
    }

    const defaultBadgeHtml = showDefaultsIndicator && hasDefault
      ? `<span class="sdlc-default-badge" title="Default from ${escapeHtml(defaultLabel)}">${defaultLabel}</span>`
      : '';

    const helpTextHtml = helpText ? `<div class="sdlc-field-hint">${escapeHtml(helpText)}</div>` : '';

    const fieldHtml = `
      <div 
        class="sdlc-form-field ${modifiedClass}" 
        data-field-name="${escapeHtml(name)}"
        data-field-type="${type}"
        ${modifiedClass}
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
  })();