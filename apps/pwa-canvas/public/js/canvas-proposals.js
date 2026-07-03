// canvas-proposals.js — proposal system, approve/deny

import { state, proposalList, workspaceTransient, uid, now, safeText } from './canvas-state.js'
import { renderObjects } from './canvas-render.js'
import { updateSelection } from './canvas-selection.js'
import { saveDraft } from './canvas-persistence.js'

export function renderProposals() {
  if (!state.proposals.length) {
    proposalList.innerHTML = '<p class="muted">No pending proposals. Compose an agent instruction to create one.</p>'
    return
  }
  proposalList.innerHTML = state.proposals.map((proposal) => `
    <div class="proposal">
      <div class="proposal-header">
        <strong>${safeText(proposal.intent)}</strong>
        <span class="proposal-status ${safeText(proposal.status)}">${safeText(proposal.status)}</span>
      </div>
      <p class="muted">${safeText(proposal.description)}</p>
      <pre>expectedVersion: ${proposal.expectedVersion}
correlationId: ${proposal.correlationId}
policyDecision: ${proposal.policyDecision}</pre>
      <div class="proposal-actions">
        <button type="button" data-apply="${proposal.correlationId}">Apply</button>
        <button type="button" data-deny="${proposal.correlationId}">Deny</button>
      </div>
    </div>
  `).join('')
}

export function createProposal(intent, description, mutations) {
  const proposal = {
    intent,
    description,
    mutations,
    expectedVersion: state.version,
    correlationId: uid('proposal'),
    policyDecision: 'pending_review',
    status: 'pending_review',
    createdAt: now()
  }
  state.proposals.unshift(proposal)
  renderProposals()
  saveDraft()
  return proposal
}

export function applyProposal(proposal) {
  if (proposal.status !== 'pending_review') return
  proposal.status = 'applied'
  proposal.policyDecision = 'approved_by_user'
  for (const mutation of proposal.mutations) {
    if (mutation.kind === 'add_object') {
      state.objects.push(mutation.object)
    }
    if (mutation.kind === 'update_object' && mutation.patch) {
      const object = state.objects.find((item) => item.id === mutation.patch.id)
      if (object) Object.assign(object, mutation.patch)
    }
    if (mutation.kind === 'remove_object') {
      state.objects = state.objects.filter((item) => item.id !== mutation.id)
    }
    if (mutation.kind === 'clear_objects') {
      state.objects = []
      state.selectedId = null
      state.selectedIds = []
    }
  }
  state.version += 1
  state.transient.recentResults = `${proposal.intent} applied locally at ${now()}`
  state.transient.policyState = `approved:${proposal.correlationId}`
  renderObjects()
  renderProposals()
  updateSelection()
  saveDraft()
}

export function denyProposal(proposal) {
  if (proposal.status !== 'pending_review') return
  proposal.status = 'denied'
  proposal.policyDecision = 'denied_by_user'
  renderProposals()
  saveDraft()
}

// ── API loading — kept from original ──

export async function loadTransient() {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1200)
    const response = await fetch('/api/pwa/workspaces/default/transient', {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    })
    clearTimeout(timeout)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    state.transient = {
      selected: data.selected || state.transient.selected,
      recentResults: data.recentResults || state.transient.recentResults,
      policyState: data.policyState || state.transient.policyState
    }
    workspaceTransient.textContent = JSON.stringify(state.transient, null, 2)
  } catch {
    workspaceTransient.textContent = JSON.stringify(state.transient, null, 2)
  }
}

export async function loadProposals() {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1200)
    const response = await fetch('/api/pwa/workspaces/default/action-proposals', {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    })
    clearTimeout(timeout)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (Array.isArray(data.proposals)) state.proposals = data.proposals.concat(state.proposals)
  } catch {
    // Offline/local draft mode.
  }
}

// ── Proposal list event delegation ──

export function setupProposalHandlers() {
  proposalList.addEventListener('click', (event) => {
    const applyButton = event.target.closest('[data-apply]')
    const denyButton = event.target.closest('[data-deny]')
    if (applyButton) {
      const proposal = state.proposals.find((item) => item.correlationId === applyButton.dataset.apply)
      if (proposal) applyProposal(proposal)
    }
    if (denyButton) {
      const proposal = state.proposals.find((item) => item.correlationId === denyButton.dataset.deny)
      if (proposal) denyProposal(proposal)
    }
  })
}
