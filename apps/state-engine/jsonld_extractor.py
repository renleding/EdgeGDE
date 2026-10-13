"""
APA JSON-LD Extractor — CDP-injected script for semantic extraction.

Extracts JSON-LD entities (schema.org + Salestrekker vocabulary)
from the DOM via CDP Page.addScriptToEvaluateOnNewDocument.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger('state-engine.jsonld')

# The extraction script injected into the browser context.
# Runs before any page script via Page.addScriptToEvaluateOnNewDocument.
EXTRACTOR_SCRIPT = r"""
(() => {
  'use strict';

  const SALESTREKKER_VOCAB = new Set([
    'salestrekker:Deal',
    'salestrekker:SecurityProperty',
    'salestrekker:Borrower',
    'salestrekker:Lender',
  ]);

  function extractFromScriptTag(scriptEl) {
    try {
      const text = scriptEl.textContent || '';
      if (!text.trim()) return [];
      const data = JSON.parse(text);
      return Array.isArray(data) ? data : [data];
    } catch (e) {
      return [];
    }
  }

  function extractFromMicrodata() {
    const entities = [];
    const scopes = document.querySelectorAll('[itemscope]');
    scopes.forEach(scope => {
      const type = scope.getAttribute('itemtype') || '';
      const props = {};
      scope.querySelectorAll('[itemprop]').forEach(prop => {
        const name = prop.getAttribute('itemprop');
        const value = prop.getAttribute('content') ||
          prop.textContent ||
          prop.getAttribute('href') ||
          '';
        if (name) props[name] = value.trim();
      });
      entities.push({
        '@context': type.startsWith('http') ? type.split('/').slice(0, 3).join('/') : 'https://schema.org',
        '@type': type.split('/').pop() || 'Unknown',
        properties: props,
      });
    });
    return entities;
  }

  function extractFromRDFa() {
    const entities = [];
    const typed = document.querySelectorAll('[typeof]');
    typed.forEach(el => {
      const type = el.getAttribute('typeof') || '';
      const props = {};
      el.querySelectorAll('[property]').forEach(prop => {
        const name = prop.getAttribute('property');
        const value = prop.getAttribute('content') || prop.textContent || '';
        if (name) props[name] = value.trim();
      });
      entities.push({
        '@context': 'https://schema.org',
        '@type': type,
        properties: props,
      });
    });
    return entities;
  }

  function normalizeEntity(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const type = raw['@type'] || raw.type || 'Unknown';
    const context = raw['@context'] || 'https://schema.org';
    const id = raw['@id'] || raw.id || undefined;
    const props = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith('@') || key === 'type') continue;
      props[key] = value;
    }
    return {
      '@context': context,
      '@type': type,
      ...(id ? { '@id': id } : {}),
      properties: props,
    };
  }

  window.__extractJSONLD = function() {
    const entities = [];

    // 1. <script type="application/ld+json">
    document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
      extractFromScriptTag(el).forEach(raw => {
        const norm = normalizeEntity(raw);
        if (norm) entities.push(norm);
      });
    });

    // 2. Microdata (itemscope/itemtype/itemprop)
    extractFromMicrodata().forEach(e => entities.push(e));

    // 3. RDFa (typeof/property)
    extractFromRDFa().forEach(e => entities.push(e));

    // Deduplicate by @type + @id
    const seen = new Set();
    const unique = [];
    for (const e of entities) {
      const key = e['@type'] + '|' + (e['@id'] || '') + '|' + JSON.stringify(e.properties);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(e);
      }
    }

    return {
      entities: unique,
      extraction_url: window.location.href,
      timestamp: new Date().toISOString(),
    };
  };

  // Auto-extract on load
  window.addEventListener('load', () => {
    window.__jsonldSnapshot = window.__extractJSONLD();
  });
})();
"""


class JSONLDSnapshot:
    """Normalized JSON-LD extraction result."""

    def __init__(self, entities: List[Dict[str, Any]],
                 extraction_url: str, timestamp: str):
        self.entities = entities
        self.extraction_url = extraction_url
        self.timestamp = timestamp

    def to_dict(self) -> Dict[str, Any]:
        return {
            'entities': self.entities,
            'extraction_url': self.extraction_url,
            'timestamp': self.timestamp,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "JSONLDSnapshot":
        return cls(
            entities=data.get('entities', []),
            extraction_url=data.get('extraction_url', ''),
            timestamp=data.get('timestamp', ''),
        )

    def find_by_type(self, type_name: str) -> List[Dict[str, Any]]:
        """Return entities matching @type (supports namespaced types)."""
        results = []
        for e in self.entities:
            t = e.get('@type', '')
            if t == type_name or t.endswith(':' + type_name):
                results.append(e)
        return results

    def find_property(self, property_name: str) -> Any:
        """Search all entities for a property value (first match)."""
        for e in self.entities:
            props = e.get('properties', {})
            if property_name in props:
                return props[property_name]
        return None


class JSONLDExtractor:
    """
    Extracts JSON-LD from a CDP-connected browser.

    Usage:
        extractor = JSONLDExtractor(cdp)
        await extractor.inject()  # Register script on all new documents
        snapshot = await extractor.extract()  # Extract current page
    """

    def __init__(self, cdp):
        self.cdp = cdp
        self._injected = False

    async def inject(self) -> bool:
        """Register the extraction script via CDP.

        Returns True if injection succeeded.
        """
        try:
            await self.cdp.send(
                'Page.addScriptToEvaluateOnNewDocument',
                {'source': EXTRACTOR_SCRIPT},
            )
            # Also inject X-CDP-Frame-ID header for mitmproxy correlation
            await self.cdp.send(
                'Page.addScriptToEvaluateOnNewDocument',
                {
                    'source': """
(() => {
  const originalFetch = window.fetch;
  window.fetch = async (url, options = {}) => {
    const frameId = window.__CDP_FRAME_ID || 'unknown';
    options.headers = options.headers || {};
    options.headers['X-CDP-Frame-ID'] = frameId;
    return originalFetch(url, options);
  };

  // Capture frame ID from CDP
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CDP_FRAME_ID') {
      window.__CDP_FRAME_ID = event.data.frameId;
    }
  });
})();
"""
                },
            )
            self._injected = True
            logger.info("JSON-LD extractor injected via CDP")
            return True
        except Exception as e:
            logger.warning("JSON-LD extractor injection failed: %s", e)
            return False

    async def extract(self) -> JSONLDSnapshot:
        """Extract JSON-LD from the current page.

        Returns a JSONLDSnapshot with entities, URL, and timestamp.
        """
        # Try the auto-extracted snapshot first
        result = await self.cdp.send(
            'Runtime.evaluate',
            {
                'expression': 'window.__jsonldSnapshot || window.__extractJSONLD && window.__extractJSONLD() || null',
                'returnByValue': True,
            },
        )

        data = result.get('result', {}).get('value')
        if data:
            return JSONLDSnapshot.from_dict(data)

        # Fallback: empty snapshot
        return JSONLDSnapshot(
            entities=[],
            extraction_url='',
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    async def extract_for_url(self, url: str) -> JSONLDSnapshot:
        """Navigate to URL and extract JSON-LD.

        Convenience method for one-shot extraction.
        """
        await self.cdp.send('Page.navigate', {'url': url})
        # Wait for load
        await self.cdp.send('Page.loadEventFired', {})
        return await self.extract()

    @property
    def is_injected(self) -> bool:
        return self._injected