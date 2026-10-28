"""ProxyCatalog — authoritative Grasshopper component lookup (FRS-012 P2-F02).

Loads proxy_catalog.json (a live dump of the Rhino ComponentServer) and provides
ranked, disambiguating lookup. Replaces hardcoded GUIDs. Multiple Grasshopper
components share the same NickName (e.g. "Circle", "Extrude", "Bounding Box"),
so every lookup returns ALL matches ranked by (exact name+category, exact name,
exact nickname, fuzzy substring). Resolve() raises AmbiguousProxyError when more
than one candidate remains, forcing the caller to disambiguate by category.

Source of truth: the JSON next to this module, regenerated from
RhinoClaw ComponentServer via dump_proxies.ghpy. Do not hand-edit the JSON.
"""
import json
import os
import re


class AmbiguousProxyError(Exception):
    """Raised by resolve() when more than one proxy matches the query."""

    def __init__(self, query, candidates):
        self.query = query
        self.candidates = candidates
        detail = "; ".join(
            "{} | {} | {}".format(c["g"], c["n"], c["c"]) for c in candidates
        )
        super(AmbiguousProxyError, self).__init__(
            "Ambiguous proxy {!r}: {} candidates -> {}".format(query, len(candidates), detail)
        )


class NotFoundProxyError(Exception):
    """Raised by resolve() when zero proxies match the query."""


class ProxyCatalog(object):
    def __init__(self, catalog_path=None):
        if catalog_path is None:
            catalog_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "proxy_catalog.json")
        with open(catalog_path, "r") as fh:
            data = json.load(fh)
        self.meta = data.get("meta", {})
        self.proxies = data["proxies"]
        self.by_guid = {p["g"]: p for p in self.proxies}
        self.count = len(self.proxies)

    def get(self, guid):
        return self.by_guid.get(guid)

    def find(self, query, category=None, exact=False):
        """Return all proxies matching query, ranked best-first.

        query: component Name or NickName (case-insensitive).
        category: optional Grasshopper category filter (e.g. "Surface", "Nautilus").
        exact: if True require exact Name/NickName equality; else substring match.
        """
        q = (query or "").strip().lower()
        if not q:
            return []
        ranked = []
        for p in self.proxies:
            name = (p.get("n") or "").strip()
            nick = (p.get("k") or "").strip()
            cat = (p.get("c") or "").strip()
            if category and cat.lower() != category.lower():
                continue
            name_l = name.lower()
            nick_l = nick.lower()
            if exact:
                name_hit = name_l == q
                nick_hit = nick_l == q
            else:
                name_hit = q in name_l
                nick_hit = q in nick_l
            if not (name_hit or nick_hit):
                continue
            exact_cat = 0 if (category is None or cat.lower() == category.lower()) else 1
            if name_l == q and nick_l == q:
                rank = 0
            elif name_l == q:
                rank = 1
            elif nick_l == q:
                rank = 2
            else:
                rank = 3
            ranked.append((rank + exact_cat, p))
        ranked.sort(key=lambda t: t[0])
        return [p for _, p in ranked]

    def resolve(self, query, category=None, exact=False):
        """Return a single GUID for the query, or raise.

        Raises NotFoundProxyError on zero hits and AmbiguousProxyError on >1 hit,
        so callers must disambiguate (usually by supplying category) rather than
        silently accept an arbitrary component.
        """
        hits = self.find(query, category=category, exact=exact)
        if not hits:
            raise NotFoundProxyError("No proxy matches {!r} (category={!r})".format(query, category))
        if len(hits) == 1:
            return hits[0]["g"]
        # collapse exact-name+category duplicates before declaring ambiguity
        exact_hits = [p for p in hits if p["n"].lower() == query.lower() and (category is None or p["c"].lower() == category.lower())]
        if len(exact_hits) == 1:
            return exact_hits[0]["g"]
        raise AmbiguousProxyError(query, hits[:10])

    def find_by_guid(self, guid):
        return self.by_guid.get(guid)

    def categories(self):
        cats = set()
        for p in self.proxies:
            if p.get("c"):
                cats.add(p["c"])
        return sorted(cats)

    def summary(self):
        return {
            "source": self.meta.get("source"),
            "proxy_count": self.count,
            "by_guid": len(self.by_guid),
            "categories": len(self.categories()),
            "generated_at": self.meta.get("generated_at"),
        }


# Module-level convenience singleton
_DEFAULT = None
def load():
    global _DEFAULT
    if _DEFAULT is None:
        _DEFAULT = ProxyCatalog()
    return _DEFAULT

def find(query, category=None, exact=False):
    return load().find(query, category=category, exact=exact)

def resolve(query, category=None, exact=False):
    return load().resolve(query, category=category, exact=exact)
