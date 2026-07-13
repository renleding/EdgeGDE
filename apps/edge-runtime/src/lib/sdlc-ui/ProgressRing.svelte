<script lang="ts">
  import type { Snippet } from 'svelte';
  import { progressTokens } from './design-tokens';
  
  interface ProgressRingProps {
    /** Progress value (0-100) */
    value: number;
    /** Minimum progress to show (default: 20) */
    minProgress?: number;
    /** Size of the ring */
    size?: keyof typeof progressTokens.size | number;
    /** Show percentage label */
    showLabel?: boolean;
    /** Custom label */
    label?: string;
    /** Stroke width */
    strokeWidth?: number;
    /** Progress state */
    state?: typeof progressTokens.state[keyof typeof progressTokens.state];
    /** Additional CSS classes */
    class?: string;
    /** Slot for center content */
    children?: Snippet;
  }
  
  const {
    value = 0,
    minProgress = 20,
    size = 'ring',
    showLabel = true,
    label,
    strokeWidth = 4,
    state = 'active',
    class: className = '',
    children,
  } = $props();
  
  // Clamp value to minProgress
  const displayValue = Math.max(minProgress, Math.min(100, value));
  
  // Ring dimensions
  const ringSize = typeof size === 'number' ? size : 
    typeof size === 'string' ? parseInt(size) : 32;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - displayValue / 100);
  
  // State colors
  const stateColors = {
    active: 'var(--progress-ring-fg, #3fb950)',
    complete: 'var(--progress-complete-fg, #2ea043)',
    warning: 'var(--progress-warning-fg, #d29922)',
    error: 'var(--progress-error-fg, #f85149)',
    pending: 'var(--progress-pending-fg, #8b949e)',
  };
  
  const strokeColor = stateColors[state] || stateColors.active;
  const trackColor = 'var(--progress-track-bg, #2d3140)';
  
  // Label text
  const labelText = label || (showLabel ? `${displayValue}%` : '');
  
  // Arc radius for center content
  const innerRadius = radius - strokeWidth - 4;
</script>

<div 
  class="progress-ring {className}"
  style:width="{ringSize}px"
  style:height="{ringSize}px"
  role="progressbar"
  aria-valuenow={displayValue}
  aria-valuemin={minProgress}
  aria-valuemax={100}
  aria-label={label || `Progress: ${displayValue}%`}
  style="position: relative; display: inline-flex; align-items: center; justify-content: center;"
>
  <svg 
    width={ringSize} 
    height={ringSize} 
    style="transform: rotate(-90deg);"
    aria-hidden="true"
  >
    <!-- Track -->
    <circle
      cx={ringSize / 2}
      cy={ringSize / 2}
      r={radius}
      fill="none"
      stroke={trackColor}
      stroke-width={strokeWidth}
      style="transition: stroke 0.2s ease;"
    />
    
    <!-- Progress -->
    <circle
      cx={ringSize / 2}
      cy={ringSize / 2}
      r={radius}
      fill="none"
      stroke={strokeColor}
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-dasharray={circumference}
      stroke-dashoffset={offset}
      style="transition: stroke-dashoffset 0.5s ease, stroke 0.3s ease;"
    />
    
    {#if displayValue >= 100}
    <!-- Completion checkmark -->
    <circle
      cx={ringSize / 2}
      cy={ringSize / 2}
      r={innerRadius}
      fill="none"
      stroke={strokeColor}
      stroke-width={2}
      stroke-dasharray={innerRadius * Math.PI * 2}
      stroke-dashoffset={0}
      stroke-linecap="round"
      style="animation: checkmark 0.3s ease-out forwards;"
    />
    {/if}
  </svg>
  
  {#if showLabel && labelText}
  <div class="progress-label" style="
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 12px;
    font-weight: 600;
    color: var(--progress-label-color, #e1e4e8);
    text-align: center;
    pointer-events: none;
  ">
    {labelText}
  </div>
  {/if}
  
  {#if children}
  <div class="progress-center" style="
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 10;
  ">
    {@render children()}
  </div>
  {/if}
</div>

<style>
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
  }
  
  .progress-ring:focus-visible {
    outline: 2px solid var(--focus-ring-color, #3fb950);
    outline-offset: 2px;
    border-radius: 50%;
  }
  
  .progress-label {
    transition: opacity 0.2s ease;
  }
</style>
</script>