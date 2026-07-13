/**
 * Progress Ring Component
 * Pure template function for server-side rendering with Hono
 * Based on UX Principles Report v2 - Progress Tokens
 */

import { progressTokens } from './design-tokens';

export interface ProgressRingProps {
  /** Progress value (0-100) */
  value: number;
  /** Minimum progress to show (default: 20) */
  minProgress?: number;
  /** Size of the ring in pixels */
  size?: number;
  /** Show percentage label */
  showLabel?: boolean;
  /** Custom label */
  label?: string;
  /** Stroke width */
  strokeWidth?: number;
  /** Progress state */
  state?: 'pending' | 'active' | 'complete' | 'warning' | 'error';
  /** Additional CSS classes */
  className?: string;
  /** Center content (HTML string) */
  centerContent?: string;
}

/** Generate SVG for progress ring */
export function renderProgressRing(props: ProgressRingProps): string {
  const {
    value = 0,
    minProgress = progressTokens.minProgress,
    size = 48,
    showLabel = true,
    label,
    strokeWidth = 4,
    state = 'active',
    className = '',
    centerContent = '',
  } = props;

  // Clamp value to minProgress
  const displayValue = Math.max(minProgress, Math.min(100, value));

  // Ring dimensions
  const ringSize = size;
  const stroke = strokeWidth;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - displayValue / 100);

  // State colors
  const stateColors: Record<string, string> = {
    active: 'var(--progress-ring-fg, #3fb950)',
    complete: 'var(--progress-complete-fg, #2ea043)',
    warning: 'var(--progress-warning-fg, #d29922)',
    error: 'var(--progress-error-fg, #f85149)',
    pending: 'var(--progress-pending-fg, #8b949e)',
  };

  const strokeColor = stateColors[state] || stateColors.active;
  const trackColor = 'var(--progress-track-bg, #2d3140)';

  // Inner radius for center content
  const innerRadius = radius - 4;

  // Generate label text
  const labelText = label || (showLabel ? `${displayValue}%` : '');

  // Generate completion mark if complete
  const completionMark = displayValue >= 100 ? `
      <!-- Completion checkmark -->
      <g class="completion-mark">
        <circle
          cx="${size / 2}"
          cy="${size / 2}"
          r="${14}"
          fill="none"
          stroke="${strokeColor}"
          stroke-width="2.5"
          stroke-dasharray="${14 * Math.PI * 2}"
          stroke-dashoffset="0"
          stroke-linecap="round"
          style="animation: checkmark 0.3s ease-out forwards;"
        />
        <path
          d="M${size / 2 - 4} ${size / 2 + 1} L${size / 2 - 1} ${size / 2 + 4} L${size / 2 + 5} ${size / 2 - 4}"
          fill="none"
          stroke="${strokeColor}"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="animation: checkmark 0.3s ease-out forwards; animation-delay: 0.15s;"
        />
      </g>
    ` : '';

  // Generate SVG
  const svg = `
    <svg 
      width="${size}" 
      height="${size}" 
      style="transform: rotate(-90deg);"
      aria-hidden="true"
      class="progress-ring-svg"
    >
      <!-- Track -->
      <circle
        cx="${size / 2}"
        cy="${size / 2}"
        r="${radius}"
        fill="none"
        stroke="${trackColor}"
        stroke-width="${strokeWidth}"
        class="progress-track"
        style="transition: stroke 0.2s ease;"
      />
      
      <!-- Progress -->
      <circle
        cx="${size / 2}"
        cy="${size / 2}"
        r="${radius}"
        fill="none"
        stroke="${strokeColor}"
        stroke-width="${strokeWidth}"
        stroke-linecap="round"
        stroke-dasharray="${circumference}"
        stroke-dashoffset="${offset}"
        class="progress-ring-progress"
        style="transition: stroke-dashoffset 0.5s ease, stroke 0.3s ease;"
      />
      
      ${completionMark}
    </svg>
  `;

  const labelHtml = showLabel && labelText
    ? `<div class="progress-label" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 12px; font-weight: 600; color: var(--progress-label-color, #e1e4e8); text-align: center; pointer-events: none; z-index: 5;">${labelText}</div>`
    : '';

  const centerHtml = centerContent
    ? `<div class="progress-center" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none; z-index: 10; max-width: ${size - 16}px;">${centerContent}</div>`
    : '';

  return `
<div 
  class="progress-ring ${className}"
  style="width: ${size}px; height: ${size}px; position: relative; display: inline-flex; align-items: center; justify-content: center;"
  role="progressbar"
  aria-valuenow="${displayValue}"
  aria-valuemin="${progressTokens.minProgress}"
  aria-valuemax="100"
  aria-label="${label || `Progress: ${displayValue}%`}"
  style="position: relative; display: inline-flex; align-items: center; justify-content: center;"
>
  ${svg}
  ${labelHtml}
  ${centerHtml}
</div>
`;
}

/** CSS for the component (include once in your stylesheet) */
export const progressRingStyles = `
@keyframes checkmark {
  0% {
    stroke-dashoffset: 100;
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
  100% {
    stroke-dashoffset: 0;
    opacity: 1;
  }
}

.progress-ring-svg {
  transform: rotate(-90deg);
}

.progress-track {
  transition: stroke 0.2s ease;
}

.progress-ring-progress {
  transition: stroke-dashoffset 0.5s ease, stroke 0.3s ease;
}

.completion-mark {
  animation: checkmark 0.3s ease-out forwards;
}

.completion-mark path {
  animation: checkmark 0.3s ease-out forwards;
  animation-delay: 0.15s;
}

@keyframes checkmark {
  0% {
    stroke-dashoffset: 100;
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
  100% {
    stroke-dashoffset: 0;
    opacity: 1;
  }
}

.progress-ring {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.progress-ring:focus-visible {
  outline: 2px solid var(--focus-ring-color, #3fb950);
  outline-offset: 2px;
  border-radius: 50%;
}

.progress-label {
  transition: opacity 0.2s ease;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 12px;
  font-weight: 600;
  color: var(--progress-label-color, #e1e4e8);
  text-align: center;
  pointer-events: none;
  z-index: 5;
}

.progress-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 10;
}
`;